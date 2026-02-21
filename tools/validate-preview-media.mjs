#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve();
const PREVIEWS_PATH = path.join(ROOT, "docs", "previews.json");

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArg = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
};

const strict = hasArg("--strict");
const requireAlpha = strict || hasArg("--require-alpha");
const requireWebmAlpha = strict || hasArg("--require-webm-alpha");
const darkThreshold = Number(getArg("--dark-threshold") || 18);
const enforceDarkness = strict || hasArg("--enforce-darkness");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const pngHasAlphaChannel = (filePath) => {
  const buffer = fsSync.readFileSync(filePath);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature");
  }

  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR" || ihdrLength < 13) {
    throw new Error("invalid PNG IHDR chunk");
  }

  const colorType = buffer.readUInt8(25);
  return colorType === 4 || colorType === 6;
};

const ffprobeValue = (lavfiInput, selector) => {
  try {
    return execSync(
      `ffprobe -v error -f lavfi -i "${lavfiInput}" -show_entries ${selector} -of default=nw=1:nk=1`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
  } catch {
    return "";
  }
};

const ffprobePixFmt = (filePath) => {
  try {
    return execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nw=1:nk=1 "${filePath}"`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
  } catch {
    return "";
  }
};

const ffprobeLuma = (filePath) => {
  const value = ffprobeValue(
    `movie=${filePath},signalstats`,
    "frame_tags=lavfi.signalstats.YAVG"
  );
  if (!value) return Number.NaN;
  const parsed = Number(value.split(/\r?\n/)[0]);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const main = async () => {
  const previews = await readJson(PREVIEWS_PATH);
  const entries = Array.isArray(previews.previews) ? previews.previews : [];
  const errors = [];
  const warnings = [];

  for (const entry of entries) {
    const repoKey = entry.repoKey || "";
    const fileBase = entry.fileBase || "";
    const key = `${repoKey}::${fileBase}`;

    if (entry.png) {
      const pngPath = path.join(ROOT, "docs", entry.png);
      if (!fsSync.existsSync(pngPath)) {
        errors.push(`${key}: missing png file (${entry.png})`);
      } else {
        try {
          const hasAlpha = pngHasAlphaChannel(pngPath);
          if (!hasAlpha) {
            const message = `${key}: png has no alpha channel (${entry.png})`;
            if (requireAlpha) {
              errors.push(message);
            } else {
              warnings.push(message);
            }
          }
        } catch (error) {
          errors.push(`${key}: failed to inspect png (${entry.png}): ${error.message}`);
        }

        const yavg = ffprobeLuma(pngPath);
        if (Number.isFinite(yavg) && yavg <= darkThreshold) {
          const message = `${key}: png looks very dark (YAVG=${yavg.toFixed(2)} <= ${darkThreshold})`;
          if (enforceDarkness) {
            errors.push(message);
          } else {
            warnings.push(message);
          }
        }
      }
    }

    if (entry.webm) {
      const webmPath = path.join(ROOT, "docs", entry.webm);
      if (!fsSync.existsSync(webmPath)) {
        errors.push(`${key}: missing webm file (${entry.webm})`);
      } else if (requireWebmAlpha) {
        const pixFmt = ffprobePixFmt(webmPath);
        if (!pixFmt || !pixFmt.includes("a")) {
          errors.push(`${key}: webm has no alpha pix_fmt (${pixFmt || "unknown"})`);
        }
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(`[validate-preview-media] warnings: ${warnings.length}`);
    for (const warning of warnings.slice(0, 40)) {
      console.warn(`- ${warning}`);
    }
    if (warnings.length > 40) {
      console.warn(`- ... ${warnings.length - 40} more warnings`);
    }
  }

  if (errors.length > 0) {
    console.error(`[validate-preview-media] errors: ${errors.length}`);
    for (const error of errors.slice(0, 80)) {
      console.error(`- ${error}`);
    }
    if (errors.length > 80) {
      console.error(`- ... ${errors.length - 80} more errors`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[validate-preview-media] OK");
};

main().catch((error) => {
  console.error("[validate-preview-media] Failed:", error);
  process.exitCode = 1;
});
