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
const enforceDimensions =
  strict || hasArg("--enforce-dimensions") || !hasArg("--allow-dimension-mismatch");
const targetSize = Number(getArg("--target-size") || 0);
const warnMinFill = Number(getArg("--warn-min-fill") || 0);
const enforceMinFill = Number(getArg("--enforce-min-fill") || 0);
const warnMinEdgeMargin = Number(getArg("--warn-min-edge-margin") || 0);
const enforceMinEdgeMargin = Number(getArg("--enforce-min-edge-margin") || 0);
const onlyRepoKeys = new Set(
  (getArg("--only-repo-key") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBP_SIGNATURE_RIFF = "RIFF";
const WEBP_SIGNATURE_WEBP = "WEBP";

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

const pngDimensions = (filePath) => {
  const buffer = fsSync.readFileSync(filePath);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature");
  }

  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR" || ihdrLength < 13) {
    throw new Error("invalid PNG IHDR chunk");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const readUInt24LE = (buffer, offset) =>
  buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);

const webpDimensions = (filePath) => {
  const buffer = fsSync.readFileSync(filePath);
  if (buffer.length < 12) {
    throw new Error("invalid WEBP header");
  }
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff !== WEBP_SIGNATURE_RIFF || webp !== WEBP_SIGNATURE_WEBP) {
    throw new Error("invalid WEBP signature");
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > buffer.length) {
      throw new Error(`corrupt WEBP chunk (${chunk})`);
    }

    if (chunk === "VP8X" && chunkSize >= 10) {
      return {
        width: readUInt24LE(buffer, payloadOffset + 4) + 1,
        height: readUInt24LE(buffer, payloadOffset + 7) + 1,
      };
    }

    if (chunk === "VP8 " && chunkSize >= 10) {
      const startCode = buffer.readUIntBE(payloadOffset + 3, 3);
      if (startCode !== 0x9d012a) {
        throw new Error("invalid VP8 start code");
      }
      return {
        width: buffer.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(payloadOffset + 8) & 0x3fff,
      };
    }

    if (chunk === "VP8L" && chunkSize >= 5) {
      const bits = buffer.readUInt32LE(payloadOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("WEBP dimensions not found");
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

const ffprobeDimensions = (filePath) => {
  try {
    const value = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${filePath}"`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    if (!value) return null;
    const [widthRaw, heightRaw] = value.split("x");
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
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

const computePngAlphaBounds = (filePath, dimensions) => {
  try {
    const maxBuffer = Math.max(10 * 1024 * 1024, dimensions.width * dimensions.height * 2);
    const alpha = execSync(
      `ffmpeg -v error -i "${filePath}" -vf alphaextract -frames:v 1 -f rawvideo -pix_fmt gray -`,
      { stdio: ["ignore", "pipe", "ignore"], maxBuffer }
    );
    const pixelCount = dimensions.width * dimensions.height;
    if (alpha.length < pixelCount) return Number.NaN;

    let minX = dimensions.width;
    let minY = dimensions.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0, index = 0; y < dimensions.height; y += 1) {
      for (let x = 0; x < dimensions.width; x += 1, index += 1) {
        if (alpha[index] <= 2) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0 || maxY < 0) {
      return {
        fillCoverage: 0,
        minEdgeMarginPx: Math.floor(Math.min(dimensions.width, dimensions.height) / 2),
      };
    }
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const leftMargin = minX;
    const rightMargin = Math.max(0, dimensions.width - 1 - maxX);
    const topMargin = minY;
    const bottomMargin = Math.max(0, dimensions.height - 1 - maxY);
    return {
      fillCoverage: Math.max(boxWidth / dimensions.width, boxHeight / dimensions.height),
      minEdgeMarginPx: Math.min(leftMargin, rightMargin, topMargin, bottomMargin),
      margins: {
        left: leftMargin,
        right: rightMargin,
        top: topMargin,
        bottom: bottomMargin,
      },
    };
  } catch {
    return null;
  }
};

const main = async () => {
  const previews = await readJson(PREVIEWS_PATH);
  const entries = Array.isArray(previews.previews) ? previews.previews : [];
  const errors = [];
  const warnings = [];

  for (const entry of entries) {
    const repoKey = entry.repoKey || "";
    if (onlyRepoKeys.size > 0 && !onlyRepoKeys.has(String(repoKey).toLowerCase())) {
      continue;
    }
    const fileBase = entry.fileBase || "";
    const key = `${repoKey}::${fileBase}`;
    const mediaDimensions = {};
    let pngCoverage = Number.NaN;
    let pngMinEdgeMarginPx = Number.NaN;
    let pngMargins = null;

    if (entry.png) {
      const pngPath = path.join(ROOT, "docs", entry.png);
      if (!fsSync.existsSync(pngPath)) {
        errors.push(`${key}: missing png file (${entry.png})`);
      } else {
        const stat = fsSync.statSync(pngPath);
        if (stat.size <= 0) {
          errors.push(`${key}: png file is empty (${entry.png})`);
        }
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

        try {
          const dimensions = pngDimensions(pngPath);
          mediaDimensions.png = dimensions;
          if (
            enforceMinFill > 0 ||
            warnMinFill > 0 ||
            enforceMinEdgeMargin > 0 ||
            warnMinEdgeMargin > 0
          ) {
            const bounds = computePngAlphaBounds(pngPath, dimensions);
            if (bounds) {
              pngCoverage = Number(bounds.fillCoverage);
              pngMinEdgeMarginPx = Number(bounds.minEdgeMarginPx);
              pngMargins = bounds.margins || null;
            }
          }
        } catch (error) {
          errors.push(`${key}: failed to read png dimensions (${entry.png}): ${error.message}`);
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
      } else {
        const stat = fsSync.statSync(webmPath);
        if (stat.size <= 0) {
          errors.push(`${key}: webm file is empty (${entry.webm})`);
        }
        const dimensions = ffprobeDimensions(webmPath);
        if (!dimensions) {
          errors.push(`${key}: failed to read webm dimensions (${entry.webm})`);
        } else {
          mediaDimensions.webm = dimensions;
        }
        if (requireWebmAlpha) {
          const pixFmt = ffprobePixFmt(webmPath);
          if (!pixFmt || !pixFmt.includes("a")) {
            errors.push(`${key}: webm has no alpha pix_fmt (${pixFmt || "unknown"})`);
          }
        }
      }
    }

    if (entry.webp) {
      const webpPath = path.join(ROOT, "docs", entry.webp);
      if (!fsSync.existsSync(webpPath)) {
        errors.push(`${key}: missing webp file (${entry.webp})`);
      } else {
        const stat = fsSync.statSync(webpPath);
        if (stat.size <= 0) {
          errors.push(`${key}: webp file is empty (${entry.webp})`);
        } else {
          try {
            mediaDimensions.webp = webpDimensions(webpPath);
          } catch (error) {
            errors.push(`${key}: failed to inspect webp (${entry.webp}): ${error.message}`);
          }
        }
      }
    }

    if (entry.mp4) {
      const mp4Path = path.join(ROOT, "docs", entry.mp4);
      if (!fsSync.existsSync(mp4Path)) {
        errors.push(`${key}: missing mp4 file (${entry.mp4})`);
      } else {
        const stat = fsSync.statSync(mp4Path);
        if (stat.size <= 0) {
          errors.push(`${key}: mp4 file is empty (${entry.mp4})`);
        }
        const dimensions = ffprobeDimensions(mp4Path);
        if (!dimensions) {
          errors.push(`${key}: failed to read mp4 dimensions (${entry.mp4})`);
        } else {
          mediaDimensions.mp4 = dimensions;
        }
      }
    }

    const mediaPairs = Object.entries(mediaDimensions);
    if (enforceDimensions && mediaPairs.length > 1) {
      const [firstKind, firstDimensions] = mediaPairs[0];
      for (const [kind, dimensions] of mediaPairs.slice(1)) {
        if (
          dimensions.width !== firstDimensions.width ||
          dimensions.height !== firstDimensions.height
        ) {
          errors.push(
            `${key}: media dimension mismatch (${firstKind}=${firstDimensions.width}x${firstDimensions.height}, ${kind}=${dimensions.width}x${dimensions.height})`
          );
        }
      }
    }

    if (targetSize > 0 && mediaPairs.length > 0) {
      for (const [kind, dimensions] of mediaPairs) {
        if (dimensions.width !== targetSize || dimensions.height !== targetSize) {
          errors.push(
            `${key}: ${kind} dimensions are ${dimensions.width}x${dimensions.height}, expected ${targetSize}x${targetSize}`
          );
        }
      }
    }

    if (Number.isFinite(pngCoverage) && pngCoverage <= warnMinFill) {
      warnings.push(`${key}: png fill is low (${pngCoverage.toFixed(3)} <= ${warnMinFill})`);
    }
    if (Number.isFinite(pngCoverage) && pngCoverage <= enforceMinFill) {
      errors.push(`${key}: png fill is too low (${pngCoverage.toFixed(3)} <= ${enforceMinFill})`);
    }
    if (Number.isFinite(pngMinEdgeMarginPx) && pngMinEdgeMarginPx < warnMinEdgeMargin) {
      const marginDetails = pngMargins
        ? ` [l=${pngMargins.left}, r=${pngMargins.right}, t=${pngMargins.top}, b=${pngMargins.bottom}]`
        : "";
      warnings.push(
        `${key}: png edge margin is low (${pngMinEdgeMarginPx}px < ${warnMinEdgeMargin}px)${marginDetails}`
      );
    }
    if (Number.isFinite(pngMinEdgeMarginPx) && pngMinEdgeMarginPx < enforceMinEdgeMargin) {
      const marginDetails = pngMargins
        ? ` [l=${pngMargins.left}, r=${pngMargins.right}, t=${pngMargins.top}, b=${pngMargins.bottom}]`
        : "";
      errors.push(
        `${key}: png edge margin is too low (${pngMinEdgeMarginPx}px < ${enforceMinEdgeMargin}px)${marginDetails}`
      );
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
