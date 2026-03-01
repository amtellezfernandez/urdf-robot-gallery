#!/usr/bin/env node
/**
 * Robot Preview Generator
 *
 * Generates animated previews and thumbnails for URDF models.
 * Core rendering and capture logic lives in scripts/lib/robot-preview-core.mjs.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { parseArgs } from "./lib/cli.mjs";
import { ensureDir } from "./lib/fs-utils.mjs";
import {
  DEFAULT_CONFIG,
  FAST_PRESET,
  DEFAULT_THREE_URL,
  DEFAULT_URDF_LOADER_URL,
  LOCAL_THREE_PATH,
  LOCAL_THREE_EXAMPLES_PATH,
  LOCAL_URDF_LOADER_PATH,
  readPreviewConfig,
  startLocalModuleServer,
  hasFfmpeg,
  generateRobotPreview,
} from "./lib/robot-preview-core.mjs";

const args = parseArgs();
const configPath = args.get("config") ?? "scripts/preview-config.sample.json";
const galleryRoot = args.get("gallery") ?? "";
const manifestOutPath = args.get("manifest-out") ?? "";
const previewDir = args.get("preview-dir") ?? path.join(galleryRoot, "docs/previews");
const thumbnailDir = args.get("thumb-dir") ?? path.join(galleryRoot, "docs/thumbnails");
const keepFrames = Boolean(args.get("keep-frames"));
const concurrency = Math.max(1, Number(args.get("concurrency") || 3));
const fastMode = Boolean(args.get("fast"));
const cacheDir = args.get("cache-dir") || "";
const cacheMb = Number(args.get("cache-mb") || 0);
const noBackground = Boolean(args.get("no-background") || args.get("transparent"));
const saveBackgroundPath = args.get("save-background") || "";
const cacheClean = Boolean(args.get("cache-clean") || args.get("no-cache"));
const allowOpaque = Boolean(args.get("allow-opaque"));
const strictAlphaArg = args.get("strict-alpha");
const strictAlpha =
  strictAlphaArg === undefined ? true : !["0", "false", "no"].includes(String(strictAlphaArg).toLowerCase());

const resolveModuleUrls = () => {
  const threeUrl =
    args.get("three-url") ||
    process.env.PREVIEW_THREE_URL ||
    (fsSync.existsSync(LOCAL_THREE_PATH) ? `file://${LOCAL_THREE_PATH}` : DEFAULT_THREE_URL);

  const threeExamplesUrl =
    args.get("three-examples-url") ||
    process.env.PREVIEW_THREE_EXAMPLES_URL ||
    (fsSync.existsSync(LOCAL_THREE_EXAMPLES_PATH)
      ? `file://${LOCAL_THREE_EXAMPLES_PATH}`
      : "https://unpkg.com/three@0.160.0/examples/jsm/");

  const urdfLoaderUrl =
    args.get("urdf-loader-url") ||
    process.env.PREVIEW_URDF_LOADER_URL ||
    (fsSync.existsSync(LOCAL_URDF_LOADER_PATH)
      ? `file://${LOCAL_URDF_LOADER_PATH}`
      : DEFAULT_URDF_LOADER_URL);

  return {
    threeUrl,
    threeExamplesUrl,
    urdfLoaderUrl,
  };
};

const applyModeConfig = (config) => {
  const merged = fastMode ? { ...config, ...FAST_PRESET } : config;
  const withBackground = noBackground
    ? {
        ...merged,
        background: "transparent",
        showGround: false,
        showGrid: false,
        shadows: false,
        strictAlpha: allowOpaque ? false : strictAlpha,
      }
    : {
        ...merged,
        strictAlpha: false,
      };

  if (!saveBackgroundPath) {
    return withBackground;
  }

  return {
    ...withBackground,
    backgroundSnapshot: saveBackgroundPath,
  };
};

const RETRYABLE_TIMEOUT_RE = /\btimeout\b/i;
const FRAMING_OVERFLOW_RE = /framing overflow detected/i;
const SKIPPABLE_ERROR_PATTERNS = [
  /missing packages:/i,
  /no renderable geometry/i,
  /urdf parse returned no renderable robot tree/i,
  /invalid urdf/i,
  /reading 'children'/i,
];

const isTimeoutLikeError = (message = "") => RETRYABLE_TIMEOUT_RE.test(String(message));
const isFramingOverflowError = (message = "") => FRAMING_OVERFLOW_RE.test(String(message));
const isSkippableRobotError = (message = "") =>
  SKIPPABLE_ERROR_PATTERNS.some((pattern) => pattern.test(String(message)));

const main = async () => {
  const config = await readPreviewConfig(configPath);
  const finalConfig = applyModeConfig(config);
  const robots = Array.isArray(config.robots) ? config.robots : [];
  const formats = Array.isArray(config.formats)
    ? config.formats.map((format) => String(format).toLowerCase())
    : DEFAULT_CONFIG.formats;

  if (robots.length === 0) {
    console.error("[preview] No robots found in config.");
    process.exit(1);
  }

  await ensureDir(previewDir);
  await ensureDir(thumbnailDir);

  let moduleUrls = resolveModuleUrls();
  const moduleServer = await startLocalModuleServer();
  if (moduleServer) {
    moduleUrls = {
      threeUrl: `${moduleServer.baseUrl}/three/build/three.module.js`,
      threeExamplesUrl: `${moduleServer.baseUrl}/three/examples/jsm/`,
      urdfLoaderUrl: `${moduleServer.baseUrl}/urdf-loader/src/URDFLoader.js`,
    };
  }

  const ffmpegAvailable = hasFfmpeg();
  console.log(`[preview] ffmpeg: ${ffmpegAvailable ? "available" : "missing"}`);
  console.log(`[preview] Output previews: ${previewDir}`);
  console.log(`[preview] Output thumbnails: ${thumbnailDir}`);
  console.log(`[preview] Formats: ${formats.join(", ")}`);
  console.log(`[preview] Concurrency: ${concurrency}`);
  console.log(`[preview] Strict alpha: ${finalConfig.strictAlpha !== false ? "enabled" : "disabled"}`);
  console.log(
    `[preview] Framing: targetNdc=${finalConfig.framingTargetNdc ?? "default"} samples=${finalConfig.framingRotationSamples ?? "default"} safety=${finalConfig.framingDistanceSafety ?? "default"}`
  );
  if (cacheDir) {
    console.log(`[preview] Cache dir: ${cacheDir}`);
  }

  const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"];
  if (
    moduleUrls.threeUrl.startsWith("file://") ||
    moduleUrls.urdfLoaderUrl.startsWith("file://") ||
    moduleUrls.threeExamplesUrl.startsWith("file://")
  ) {
    launchArgs.push("--allow-file-access-from-files");
  }
  if (cacheMb > 0) {
    launchArgs.push(`--disk-cache-size=${Math.floor(cacheMb * 1024 * 1024)}`);
  }

  let browser;
  try {
    if (cacheDir) {
      launchArgs.push(`--user-data-dir=${cacheDir}`);
    }
    browser = await chromium.launch({
      headless: true,
      args: launchArgs,
    });

    const results = [];
    let cursor = 0;
    const getNext = () => {
      if (cursor >= robots.length) return null;
      const robot = robots[cursor];
      cursor += 1;
      return robot;
    };

    const backgroundSnapshotState = { saved: false };
    const baseTimeoutMs = finalConfig.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;

    const worker = async (workerId) => {
      while (true) {
        const robot = getNext();
        if (!robot) return;

        const robotLabel = robot.name || robot.id || robot.urdfUrl;
        try {
          console.log(`\n[preview:${workerId}] Generating: ${robotLabel}`);

          let attempt = 1;
          const maxAttempts = 2;
          let result = null;
          let pendingOverflowRetry = false;
          while (attempt <= maxAttempts) {
            try {
              const timeoutMs =
                attempt === 1 ? baseTimeoutMs : Math.max(Math.round(baseTimeoutMs * 2.5), 90000);
              const attemptConfig = { ...finalConfig, timeoutMs };
              if (pendingOverflowRetry && attempt > 1) {
                const retryTargetNdc = Number.isFinite(finalConfig.framingTargetNdc)
                  ? Number(finalConfig.framingTargetNdc) - 0.04
                  : 0.84;
                const retryDistanceSafety = Number.isFinite(finalConfig.framingDistanceSafety)
                  ? Number(finalConfig.framingDistanceSafety) + 0.05
                  : 1.09;
                attemptConfig.framingTargetNdc = Math.max(0.72, Math.min(0.95, retryTargetNdc));
                attemptConfig.framingDistanceSafety = Math.max(
                  1.0,
                  Math.min(1.25, retryDistanceSafety)
                );
                console.warn(
                  `[preview:${workerId}] Overflow retry with wider framing: ${robotLabel} ` +
                    `(targetNdc=${attemptConfig.framingTargetNdc.toFixed(3)}, ` +
                    `distanceSafety=${attemptConfig.framingDistanceSafety.toFixed(3)})`
                );
              }
              result = await generateRobotPreview({
                browser,
                robot,
                config: attemptConfig,
                ffmpegAvailable,
                formats,
                keepFrames,
                previewDir,
                thumbnailDir,
                moduleUrls,
                backgroundSnapshotPath: finalConfig.backgroundSnapshot,
                backgroundSnapshotState,
              });
              break;
            } catch (error) {
              const message = error?.message || "unknown preview error";
              if (isSkippableRobotError(message)) {
                console.warn(`[preview:${workerId}] Skipped: ${robotLabel} (${message})`);
                result = null;
                break;
              }

              if (attempt < maxAttempts && isFramingOverflowError(message)) {
                console.warn(
                  `[preview:${workerId}] Overflow retry ${attempt}/${maxAttempts - 1}: ${robotLabel}`
                );
                pendingOverflowRetry = true;
                attempt += 1;
                continue;
              }

              if (attempt < maxAttempts && isTimeoutLikeError(message)) {
                console.warn(
                  `[preview:${workerId}] Timeout retry ${attempt}/${maxAttempts - 1}: ${robotLabel}`
                );
                attempt += 1;
                continue;
              }

              throw error;
            }
          }

          if (result) {
            results.push(result);
          }
        } catch (error) {
          console.error(
            `[preview:${workerId}] Failed: ${robotLabel} (${error.message})`
          );
        }
      }
    };

    const workerCount = Math.min(concurrency, robots.length);
    const workers = Array.from({ length: workerCount }, (_, index) => worker(index + 1));
    await Promise.all(workers);

    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      previews: results,
    };

    if (manifestOutPath) {
      await ensureDir(path.dirname(manifestOutPath));
      await fs.writeFile(manifestOutPath, JSON.stringify(manifest, null, 2));
      console.log(`\n[preview] Manifest saved: ${manifestOutPath}`);
    }
    if (galleryRoot) {
      const manifestPath = path.join(galleryRoot, "docs/previews.json");
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`\n[preview] Manifest saved: ${manifestPath}`);
    }

    console.log("\n[preview] Done.");
  } finally {
    if (browser) {
      await browser.close();
    }
    if (moduleServer) {
      moduleServer.close();
    }
    if (cacheClean && cacheDir) {
      try {
        await fs.rm(cacheDir, { recursive: true, force: true });
        console.log(`[preview] Cache cleared: ${cacheDir}`);
      } catch (error) {
        console.warn(`[preview] Cache clear failed: ${error.message}`);
      }
    }
  }
};

main().catch((error) => {
  console.error("[preview] Fatal error:", error);
  process.exit(1);
});
