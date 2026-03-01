const normalizeExtension = (value) => {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
};

export const SUPPORTED_MESH_EXTENSIONS = Object.freeze([
  ".stl",
  ".dae",
  ".obj",
  ".gltf",
  ".glb",
  ".ply",
  ".fbx",
  ".3ds",
]);

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
