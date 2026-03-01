import meshFormatsConfig from "../../urdf-studio/pretty-urdf/src/mesh/meshFormats.constants.json" with { type: "json" };

const normalizeExtension = (value) => {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
};

const normalizeExtensionList = (values) =>
  Object.freeze(Array.from(new Set((values || []).map(normalizeExtension).filter(Boolean))));

export const SUPPORTED_MESH_EXTENSIONS = normalizeExtensionList(
  meshFormatsConfig.supportedMeshExtensions
);

const SUPPORTED_MESH_EXTENSION_SET = new Set(SUPPORTED_MESH_EXTENSIONS);

const stripQueryAndHash = (value) => String(value || "").split("?")[0]?.split("#")[0] || "";

export const extractMeshExtension = (value) => {
  const cleaned = stripQueryAndHash(value).trim().toLowerCase();
  const match = cleaned.match(/\.([a-z0-9]+)$/);
  if (!match) return "";
  return normalizeExtension(match[1]);
};

export const isSupportedMeshExtension = (value) => {
  const ext = extractMeshExtension(value);
  return Boolean(ext) && SUPPORTED_MESH_EXTENSION_SET.has(ext);
};
