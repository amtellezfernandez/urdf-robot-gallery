const normalizeProbeValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .split("?")[0]
    .split("#")[0];

const extractExtension = (value) => {
  const idx = value.lastIndexOf(".");
  if (idx <= 0 || idx === value.length - 1) return "";
  return value.slice(idx + 1);
};

export const detectRobotSourceType = (value) => {
  const normalized = normalizeProbeValue(value);
  if (!normalized) return "";
  if (normalized === "urdf.xacro" || normalized === ".urdf.xacro") return "urdf.xacro";
  if (normalized === "xacro" || normalized === ".xacro") return "xacro";
  if (normalized === "urdf" || normalized === ".urdf") return "urdf";
  if (normalized.endsWith(".urdf.xacro")) return "urdf.xacro";
  if (normalized.endsWith(".xacro")) return "xacro";
  if (normalized.endsWith(".urdf")) return "urdf";
  return extractExtension(normalized);
};

export const stripRobotSourceExtension = (value) =>
  String(value || "").replace(/(\.urdf)?\.xacro$/i, "").replace(/\.urdf$/i, "");
