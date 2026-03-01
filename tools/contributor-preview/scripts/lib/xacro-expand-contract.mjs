export const XACRO_SUPPORT_EXTENSIONS = [
  ".xacro",
  ".urdf",
  ".xml",
  ".yaml",
  ".yml",
  ".srdf",
  ".sdf",
  ".gazebo",
  ".trans",
];

export const XACRO_EXPAND_EMPTY_URDF_ERROR = "xacro expansion returned empty URDF";

const normalizePath = (value) => String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");

export const isXacroPath = (value) => {
  const normalized = normalizePath(value).toLowerCase();
  return normalized.endsWith(".xacro");
};

export const isUrdfXacroPath = (value) => {
  const normalized = normalizePath(value).toLowerCase();
  return normalized.endsWith(".urdf.xacro");
};

export const isXacroSupportPath = (value) => {
  const normalized = normalizePath(value).toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith("/package.xml") || normalized === "package.xml") return true;
  return XACRO_SUPPORT_EXTENSIONS.some((ext) => normalized.endsWith(ext));
};

export const normalizeExpandedUrdfPath = (targetPath) => {
  const normalized = normalizePath(targetPath);
  if (!normalized) return "";
  if (/\.urdf\.xacro$/i.test(normalized)) {
    return normalized.replace(/\.urdf\.xacro$/i, ".urdf");
  }
  if (/\.xacro$/i.test(normalized)) {
    return normalized.replace(/\.xacro$/i, ".urdf");
  }
  return normalized;
};

export const buildXacroFilenameCandidates = (targetPath) => {
  const normalized = normalizePath(targetPath);
  const fileName = normalized.split("/").pop() || normalized;
  const lower = fileName.toLowerCase();
  const out = new Set();

  if (!lower) return [];
  out.add(lower);

  if (lower.endsWith(".urdf")) {
    out.add(lower.replace(/\.urdf$/i, ".urdf.xacro"));
    out.add(lower.replace(/\.urdf$/i, ".xacro"));
  } else if (lower.endsWith(".urdf.xacro")) {
    out.add(lower.replace(/\.urdf\.xacro$/i, ".xacro"));
    out.add(lower.replace(/\.urdf\.xacro$/i, ".urdf"));
  } else if (lower.endsWith(".xacro")) {
    out.add(lower.replace(/\.xacro$/i, ".urdf.xacro"));
    out.add(lower.replace(/\.xacro$/i, ".urdf"));
  } else {
    out.add(`${lower}.urdf.xacro`);
    out.add(`${lower}.xacro`);
  }

  return Array.from(out);
};

export const buildXacroExpandRequestPayload = ({ targetPath, files }) => ({
  target_path: normalizePath(targetPath),
  files: Array.isArray(files) ? files : [],
  args: {},
  use_inorder: true,
});

export const parseXacroExpandResponsePayload = (payload) => {
  const urdf = String(payload?.urdf || "").trim();
  if (!urdf) {
    throw new Error(XACRO_EXPAND_EMPTY_URDF_ERROR);
  }
  return urdf;
};
