#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";

const ROOT = path.resolve();
const SCENES_PATH = path.join(ROOT, "docs", "scenes", "index.json");
const SCHEMA_PATH = path.join(ROOT, "docs", "scenes.schema.json");

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const normalizeUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const main = async () => {
  const [scenes, schema] = await Promise.all([readJson(SCENES_PATH), readJson(SCHEMA_PATH)]);

  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  if (!validate(scenes)) {
    console.error("[validate-scenes] Schema validation failed.");
    for (const error of validate.errors || []) {
      console.error(`- ${error.instancePath || "(root)"} ${error.message || "invalid"}`);
    }
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  scenes.forEach((entry, index) => {
    const id = entry.id || "";
    const normalizedUrl = normalizeUrl(entry.importUrl || "");
    if (!normalizedUrl) {
      errors.push(`Entry ${index} (${id || "unknown"}): importUrl must be a valid http(s) URL.`);
      return;
    }

    if (seenIds.has(id)) {
      errors.push(`Entry ${index}: duplicate id "${id}".`);
    } else {
      seenIds.add(id);
    }

    if (seenUrls.has(normalizedUrl)) {
      errors.push(`Entry ${index}: duplicate importUrl "${normalizedUrl}".`);
    } else {
      seenUrls.add(normalizedUrl);
    }
  });

  if (errors.length) {
    console.error("[validate-scenes] Validation errors:");
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[validate-scenes] OK");
};

main().catch((error) => {
  console.error("[validate-scenes] Failed:", error);
  process.exitCode = 1;
});
