#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve();
const ROBOTS_JSON = path.join(ROOT, "docs", "robots.json");
const OUTPUT_ROOT = path.join(ROOT, "docs", "thumbnails");
const STUDIO_URL = (process.env.URDF_STUDIO_URL || "http://localhost:5173/").replace(/\/+$/, "/");
const VIEWPORT = 256;
const THUMBNAIL_BACKGROUND = process.env.URDF_THUMB_BG || "transparent";
const THUMBNAIL_TIMEOUT_MS = Math.max(30000, Number(process.env.URDF_THUMB_TIMEOUT_MS || 240000));
const USE_TRANSPARENT_BACKGROUND =
  THUMBNAIL_BACKGROUND === "transparent" || THUMBNAIL_BACKGROUND === "none";

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  if (idx === -1) return "";
  return args[idx + 1] || "";
};

const repoFilter = getArg("--repo");
const limit = Number(getArg("--limit") || 0);
const force = args.includes("--force");
const allowOpaque = args.includes("--allow-opaque");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const readPngColorType = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature");
  }

  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR" || ihdrLength < 13) {
    throw new Error("Invalid PNG IHDR chunk");
  }

  return buffer.readUInt8(25);
};

const pngHasAlphaChannel = async (filePath) => {
  const colorType = await readPngColorType(filePath);
  return colorType === 4 || colorType === 6;
};

const slugify = (value) =>
  value
    .trim()
    .replace(/\.urdf$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const toPreviewBase = (value) => {
  const normalized = value.replace(/\\/g, "/").replace(/\.urdf$/i, "");
  const name = normalized.split("/").pop() || normalized;
  const slug = slugify(name) || "robot";
  return `${slug}--${hashString(normalized)}`;
};

const readRobots = async () => {
  const raw = await fs.readFile(ROBOTS_JSON, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("robots.json must be an array");
  }
  return parsed;
};

const buildTasks = (repos) => {
  const tasks = [];
  for (const entry of repos) {
    const repoUrl = entry.repo;
    const repoKey = entry.repoKey || repoUrl?.replace(/^https?:\/\/github\.com\//, "").toLowerCase();
    if (!repoUrl || !repoKey) continue;
    if (repoFilter && repoKey !== repoFilter.toLowerCase()) continue;
    const robots = Array.isArray(entry.robots) ? entry.robots : [];
    for (const robot of robots) {
      const file = typeof robot === "string" ? robot : robot.file || robot.name || "";
      const name = typeof robot === "string" ? robot : robot.name || robot.file || "";
      const fileBase = typeof robot === "string" ? "" : robot.fileBase || "";
      if (!file && !name) continue;
      const baseTarget = file || name;
      const baseName = fileBase || toPreviewBase(baseTarget || name);
      if (!baseName) continue;
      tasks.push({
        repoUrl,
        repoKey,
        baseName,
        fileTarget: baseTarget,
      });
    }
  }
  return tasks;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const run = async () => {
  const repos = await readRobots();
  const tasks = buildTasks(repos);
  const finalTasks = limit > 0 ? tasks.slice(0, limit) : tasks;

  if (finalTasks.length === 0) {
    console.log("No robots to render.");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT, height: VIEWPORT },
    deviceScaleFactor: 1,
  });

  let completed = 0;
  for (const task of finalTasks) {
    const outDir = path.join(OUTPUT_ROOT, task.repoKey);
    const outFile = path.join(outDir, `${task.baseName}.png`);
    if (!force && (await fileExists(outFile))) {
      console.log(`skip ${task.repoKey}/${task.baseName} (exists)`);
      continue;
    }

    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const url = `${STUDIO_URL}?thumbnail=1&github=${encodeURIComponent(task.repoUrl)}&urdf=${encodeURIComponent(task.fileTarget)}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(
        () => window.__URDF_THUMB_READY__ === true || Boolean(window.__URDF_THUMB_ERROR__),
        undefined,
        { timeout: THUMBNAIL_TIMEOUT_MS }
      );
      const state = await page.evaluate(() => ({
        ready: window.__URDF_THUMB_READY__ === true,
        error: window.__URDF_THUMB_ERROR__ || "",
      }));
      if (!state.ready) {
        throw new Error(state.error || "Thumbnail did not become ready");
      }
      const canvas = await page.$("#urdf-thumb-canvas");
      if (!canvas) {
        throw new Error("Thumbnail canvas not found");
      }
      await page.evaluate((bg, transparent) => {
        const canvasEl = document.getElementById("urdf-thumb-canvas");
        if (canvasEl instanceof HTMLCanvasElement) {
          canvasEl.style.background = transparent ? "transparent" : bg;
        }
        document.body.style.background = transparent ? "transparent" : bg;
      }, THUMBNAIL_BACKGROUND, USE_TRANSPARENT_BACKGROUND);
      await ensureDir(outDir);
      await canvas.screenshot({
        path: outFile,
        omitBackground: USE_TRANSPARENT_BACKGROUND,
      });

      if (USE_TRANSPARENT_BACKGROUND && !allowOpaque) {
        const hasAlpha = await pngHasAlphaChannel(outFile);
        if (!hasAlpha) {
          await fs.rm(outFile, { force: true });
          throw new Error(
            "Rendered thumbnail is opaque (no alpha). Run with --allow-opaque to bypass."
          );
        }
      }

      completed += 1;
      console.log(`done ${task.repoKey}/${task.baseName}`);
    } catch (error) {
      console.error(`fail ${task.repoKey}/${task.baseName}:`, error.message || error);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`Rendered ${completed}/${finalTasks.length} thumbnails.`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
