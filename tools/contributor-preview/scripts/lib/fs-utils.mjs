import fs from "node:fs/promises";
import path from "node:path";

export const ensureDir = async (dir) => {
  if (!dir) return;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
};

export const walkFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

export const readJsonFile = async (filePath, fallback = null) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeJsonFile = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
