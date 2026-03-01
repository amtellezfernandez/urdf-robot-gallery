#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";

const ROOT = path.resolve();
const ROBOTS_PATH = path.join(ROOT, "docs", "robots.json");

const parseArgs = () => {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
};

const args = parseArgs();
const token = args.get("token") || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const only = new Set(
  String(args.get("only") || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);
const limit = Number(args.get("limit") || 0);
const write = Boolean(args.get("write"));
const reportPath = args.get("report") || path.join(ROOT, "docs", "backfill-report.json");
const previewKeysPath =
  args.get("preview-keys") || path.join(ROOT, "docs", "backfill-preview-keys.txt");
const concurrency = Math.max(1, Number(args.get("concurrency") || 2));
const maxRetries = Math.max(0, Number(args.get("retries") || 3));
const retryDelayMs = Math.max(250, Number(args.get("retry-delay-ms") || 1000));
const metaPath = path.join(ROOT, "docs", "robots.meta.json");
const SUPPORTED_ROBOT_EXTENSIONS = [".urdf.xacro", ".xacro", ".urdf"];

const hasSupportedRobotExtension = (value) => {
  const normalized = String(value || "").toLowerCase();
  return SUPPORTED_ROBOT_EXTENSIONS.some((ext) => normalized.endsWith(ext));
};

const stripSupportedRobotExtension = (value) => {
  const normalized = String(value || "");
  const lowered = normalized.toLowerCase();
  for (const ext of SUPPORTED_ROBOT_EXTENSIONS) {
    if (lowered.endsWith(ext)) {
      return normalized.slice(0, normalized.length - ext.length);
    }
  }
  return normalized;
};

const slugify = (value) =>
  value
    .trim()
    .replace(/\.urdf\.xacro$/i, "")
    .replace(/\.xacro$/i, "")
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
  const normalized = stripSupportedRobotExtension(value.replace(/\\/g, "/"));
  const name = normalized.split("/").pop() || normalized;
  const slug = slugify(name) || "robot";
  return `${slug}--${hashString(normalized)}`;
};

const normalizeLicense = (licenseValue) => {
  const raw = String(licenseValue || "").trim();
  if (!raw || raw.toUpperCase() === "NOASSERTION") return "";
  return raw;
};

const normalizeRepoKey = (value) =>
  value
    ? value
        .replace(/^https?:\/\/github\.com\//, "")
        .split("/")
        .slice(0, 2)
        .join("/")
        .toLowerCase()
    : "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ERROR_BODY_BYTES = 4096;
const ABUSE_DETECTION_PATTERN = /abuse detection mechanism|secondary rate limit/i;

const getHeaderValue = (headers, key) => {
  const value = headers?.[key];
  if (Array.isArray(value)) return value[0];
  return value;
};

const parseRetryAfterMs = (headers) => {
  const raw = getHeaderValue(headers, "retry-after");
  if (raw == null) return null;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value * 1000);
  }
  return null;
};

const githubFetchOnce = (url) =>
  new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "urdf-robot-gallery-backfill",
          ...(token ? { Authorization: `token ${token}` } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (body.length >= MAX_ERROR_BODY_BYTES) return;
            body += String(chunk).slice(0, MAX_ERROR_BODY_BYTES - body.length);
          });
          res.on("end", () => {
            const reason = body ? `: ${body}` : "";
            const error = new Error(`GitHub API ${res.statusCode} for ${url}${reason}`);
            error.statusCode = res.statusCode;
            error.headers = res.headers;
            error.body = body;
            reject(error);
          });
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
  });

const githubFetch = async (url) => {
  let attempt = 0;
  const abuseRetries = maxRetries + 2;
  while (true) {
    try {
      return await githubFetchOnce(url);
    } catch (error) {
      attempt += 1;
      const status = error.statusCode || 0;
      const headers = error.headers || {};
      const responseBody = String(error.body || "");
      const remaining = Number(headers["x-ratelimit-remaining"] || "");
      const reset = Number(headers["x-ratelimit-reset"] || "");
      const retryAfterMs = parseRetryAfterMs(headers);
      if (status === 403 && Number.isFinite(remaining) && remaining === 0 && reset) {
        const waitMs = Math.max(reset * 1000 - Date.now() + 1000, retryDelayMs);
        console.warn(`[backfill] rate limit hit, waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      if (status === 403 && ABUSE_DETECTION_PATTERN.test(responseBody)) {
        if (attempt > abuseRetries) {
          throw error;
        }
        const fallbackMs = retryDelayMs * Math.pow(2, Math.min(attempt - 1, 5));
        const baseDelayMs = retryAfterMs ?? fallbackMs;
        const jitterMs = Math.floor(Math.random() * Math.max(250, Math.round(baseDelayMs * 0.2)));
        const waitMs = Math.max(retryDelayMs, baseDelayMs + jitterMs);
        console.warn(
          `[backfill] abuse throttle detected, waiting ${Math.ceil(waitMs / 1000)}s ` +
            `before retry ${attempt}/${abuseRetries}`
        );
        await sleep(waitMs);
        continue;
      }
      const retryable = [429, 500, 502, 503, 504].includes(status);
      if (!retryable || attempt > maxRetries) {
        throw error;
      }
      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[backfill] retry ${attempt}/${maxRetries} after ${delay}ms (${status || "err"})`);
      await sleep(delay);
    }
  }
};

const parseRepo = (repoUrl) => {
  if (!repoUrl) return null;
  const cleaned = repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/i, "");
  const [owner, repo] = cleaned.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
};

const pickBestPath = (paths, preferredPrefix) => {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  let candidates = paths;
  if (preferredPrefix) {
    const prefix = preferredPrefix.replace(/^\/+|\/+$/g, "");
    const scoped = paths.filter((p) => p.startsWith(`${prefix}/`));
    if (scoped.length) {
      candidates = scoped;
    }
  }
  return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
};

const main = async () => {
  const raw = await fs.readFile(ROBOTS_PATH, "utf8");
  const robotsJson = JSON.parse(raw);
  if (!Array.isArray(robotsJson)) {
    throw new Error("robots.json must be an array");
  }

  const report = {
    updated: 0,
    unchanged: 0,
    skipped: 0,
    missing: [],
    truncated: [],
    collisions: [],
    previewKeys: [],
  };

  const collisionMap = new Map();
  const previewKeySet = new Set();

  const entries = robotsJson.filter((entry) => {
    const repoKey = normalizeRepoKey(entry.repo || entry.repoKey);
    if (!repoKey) return false;
    if (only.size && !only.has(repoKey)) return false;
    return true;
  });

  const limitedEntries = limit > 0 ? entries.slice(0, limit) : entries;

  const processEntry = async (entry) => {
    const repoKey = normalizeRepoKey(entry.repo || entry.repoKey);
    if (!repoKey) {
      report.skipped += 1;
      return;
    }
    const repoInfo = parseRepo(entry.repo);
    if (!repoInfo) {
      report.skipped += 1;
      return;
    }

    let repoData;
    try {
      repoData = await githubFetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`);
    } catch (error) {
      report.skipped += 1;
      report.missing.push({
        repoKey,
        reason: `repo fetch failed: ${error.message}`,
      });
      return;
    }

    const detectedLicense = normalizeLicense(
      repoData?.license?.spdx_id || repoData?.license?.name || ""
    );
    const existingLicense = normalizeLicense(entry.license);
    entry.license = detectedLicense || existingLicense;

    const branch = repoData.default_branch || "main";
    let treeData;
    try {
      treeData = await githubFetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
      );
    } catch (error) {
      report.skipped += 1;
      report.missing.push({
        repoKey,
        reason: `tree fetch failed: ${error.message}`,
      });
      return;
    }

    if (treeData.truncated) {
      report.truncated.push(repoKey);
      report.skipped += 1;
      return;
    }

    const treePaths = (treeData.tree || [])
      .filter((node) => node?.path && node?.type === "blob")
      .map((node) => node.path);

    const normalizedPath = entry.path ? entry.path.replace(/^\/+|\/+$/g, "") : "";
    const hasPrefix = normalizedPath
      ? treePaths.some((p) => p.startsWith(`${normalizedPath}/`))
      : false;
    const normalizedTreePaths = normalizedPath && !hasPrefix
      ? treePaths.map((p) => `${normalizedPath}/${p}`)
      : treePaths;

    const urdfPaths = normalizedTreePaths.filter((p) => hasSupportedRobotExtension(p));
    const urdfByName = new Map();
    const urdfByPath = new Map();
    for (const p of urdfPaths) {
      urdfByPath.set(p.toLowerCase(), p);
      const name = path.posix.basename(p).toLowerCase();
      if (!urdfByName.has(name)) urdfByName.set(name, []);
      urdfByName.get(name).push(p);
    }

    const robots = Array.isArray(entry.robots) ? entry.robots : [];
    let changed = false;
    const updatedRobots = robots.map((robot) => {
      if (!robot) return robot;
      const isString = typeof robot === "string";
      const raw = (isString ? robot : robot.file || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!raw) return robot;
      const direct = urdfByPath.get(raw.toLowerCase());
      const nameKey = path.posix.basename(raw).toLowerCase();
      const candidate = direct || pickBestPath(urdfByName.get(nameKey), normalizedPath);
      if (!candidate) {
        report.missing.push({ repoKey, file: raw, reason: "not found in tree" });
      }
      const resolved = candidate || raw;
      const fileName = path.posix.basename(resolved);
      const fileBase = toPreviewBase(resolved);
      const name = !isString && robot?.name ? robot.name : stripSupportedRobotExtension(fileName);
      const prevFile = isString ? raw : robot.file || "";
      const prevBase = isString ? "" : robot.fileBase || "";
      if (isString || prevFile !== resolved || prevBase !== fileBase) {
        changed = true;
      }
      return {
        ...(isString ? {} : robot),
        name,
        file: resolved,
        fileBase,
      };
    });

    if (changed) {
      entry.robots = updatedRobots;
      report.updated += 1;
      for (const robot of updatedRobots) {
        const fileBase = typeof robot === "string" ? "" : robot?.fileBase;
        if (!fileBase) continue;
        const previewKey = `${repoKey}::${fileBase}`;
        previewKeySet.add(previewKey);
        const list = collisionMap.get(previewKey) || [];
        list.push(fileBase);
        collisionMap.set(previewKey, list);
      }
    } else {
      report.unchanged += 1;
    }
  };

  const queue = [...limitedEntries];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      await processEntry(entry);
    }
  });
  await Promise.all(workers);

  for (const [key, files] of collisionMap.entries()) {
    if (files.length > 1) {
      report.collisions.push({ key, files });
    }
  }

  report.previewKeys = Array.from(previewKeySet).sort();

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[backfill] Report written: ${reportPath}`);
  await fs.writeFile(previewKeysPath, report.previewKeys.join(","));
  console.log(`[backfill] Preview keys written: ${previewKeysPath}`);

  if (write) {
    await fs.writeFile(ROBOTS_PATH, JSON.stringify(robotsJson, null, 2));
    console.log(`[backfill] Updated ${ROBOTS_PATH}`);
    const meta = {
      version: 1,
      generatedAt: new Date().toISOString(),
      count: Array.isArray(robotsJson) ? robotsJson.length : 0,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    console.log(`[backfill] Updated ${metaPath}`);
  } else {
    console.log("[backfill] Dry run (use --write to apply changes).");
  }
};

main().catch((error) => {
  console.error("[backfill] Failed:", error);
  process.exitCode = 1;
});
