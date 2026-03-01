#!/usr/bin/env node
/**
 * Sync previews.json by scanning docs/previews + docs/thumbnails in the gallery repo.
 */

import path from "node:path";
import { parseArgs } from "./lib/cli.mjs";
import { readJsonFile, walkFiles, writeJsonFile } from "./lib/fs-utils.mjs";
const args = parseArgs();
const galleryRoot = args.get("gallery");

if (!galleryRoot) {
  console.error("[sync-previews] --gallery is required");
  process.exit(1);
}

const previewsRoot = path.join(galleryRoot, "docs/previews");
const thumbsRoot = path.join(galleryRoot, "docs/thumbnails");
const manifestPath = path.join(galleryRoot, "docs/previews.json");
const PREVIEW_METADATA_FIELDS = [
  "sourceType",
  "meshCount",
  "linkCount",
  "jointCount",
  "armCount",
  "legCount",
  "wheelCount",
  "tags",
];

const buildDetectedTags = (entry) => {
  const tags = [];
  const appendCountTag = (label, value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      tags.push(`${label}:${Math.round(numeric)}`);
    }
  };

  appendCountTag("meshes", entry?.meshCount);
  appendCountTag("links", entry?.linkCount);
  appendCountTag("joints", entry?.jointCount);
  appendCountTag("arms", entry?.armCount);
  appendCountTag("legs", entry?.legCount);
  appendCountTag("wheels", entry?.wheelCount);

  if (typeof entry?.sourceType === "string" && entry.sourceType.trim().length > 0) {
    tags.push(`source:${entry.sourceType.trim().toLowerCase()}`);
  }

  return tags;
};

const main = async () => {
  const existingManifest = await readJsonFile(manifestPath, { previews: [] });
  const existingMetaByKey = new Map();
  const existingEntries = Array.isArray(existingManifest?.previews) ? existingManifest.previews : [];
  for (const entry of existingEntries) {
    const repoKey = entry?.repoKey || "";
    const fileBase = entry?.fileBase || "";
    if (!repoKey || !fileBase) continue;
    const metadata = {};
    for (const field of PREVIEW_METADATA_FIELDS) {
      const value = entry[field];
      if (value === undefined) continue;
      if (field === "tags") {
        if (!Array.isArray(value)) continue;
        const tags = value
          .filter((tag) => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => tag.trim());
        if (tags.length > 0) {
          metadata.tags = tags;
        }
        continue;
      }
      metadata[field] = value;
    }
    const existingTags = Array.isArray(metadata.tags) ? metadata.tags : [];
    const derivedTags = buildDetectedTags(metadata);
    const combinedTags = Array.from(new Set([...existingTags, ...derivedTags]));
    if (combinedTags.length > 0) {
      metadata.tags = combinedTags;
    }
    if (Object.keys(metadata).length > 0) {
      existingMetaByKey.set(`${repoKey}::${fileBase}`, metadata);
    }
  }

  const map = new Map();
  const withMetadata = (entry) => {
    const key = `${entry.repoKey}::${entry.fileBase}`;
    const metadata = existingMetaByKey.get(key);
    return metadata ? { ...entry, ...metadata } : entry;
  };

  try {
    const previewFiles = await walkFiles(previewsRoot);
    for (const filePath of previewFiles) {
      const rel = path.relative(previewsRoot, filePath).split(path.sep).join("/");
      const ext = path.extname(rel).slice(1);
      if (!["webp", "webm", "mp4"].includes(ext)) continue;
      const repoKey = path.posix.dirname(rel);
      const fileBase = path.posix.basename(rel, `.${ext}`);
      const key = `${repoKey}::${fileBase}`;
      const entry = map.get(key) ?? withMetadata({ repoKey, fileBase });
      entry[ext] = `previews/${repoKey}/${fileBase}.${ext}`;
      map.set(key, entry);
    }
  } catch {
    // Ignore missing previews directory.
  }

  try {
    const thumbFiles = await walkFiles(thumbsRoot);
    for (const filePath of thumbFiles) {
      const rel = path.relative(thumbsRoot, filePath).split(path.sep).join("/");
      const ext = path.extname(rel).slice(1);
      if (ext !== "png") continue;
      const repoKey = path.posix.dirname(rel);
      const fileBase = path.posix.basename(rel, ".png");
      const key = `${repoKey}::${fileBase}`;
      const entry = map.get(key) ?? withMetadata({ repoKey, fileBase });
      entry.png = `thumbnails/${repoKey}/${fileBase}.png`;
      map.set(key, entry);
    }
  } catch {
    // Ignore missing thumbnails directory.
  }

  const previews = Array.from(map.values()).sort((a, b) => {
    if (a.repoKey === b.repoKey) return a.fileBase.localeCompare(b.fileBase);
    return a.repoKey.localeCompare(b.repoKey);
  });

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    previews,
  };

  await writeJsonFile(manifestPath, manifest);
  console.log(`[sync-previews] wrote ${manifest.previews.length} entries`);
};

main().catch((error) => {
  console.error("[sync-previews] Fatal error:", error.message);
  process.exit(1);
});
