export const toMeshReferenceKey = (value) => {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.startsWith("package://")) {
    const withoutScheme = raw.slice("package://".length).replace(/^\/+/, "");
    return "package://" + withoutScheme.toLowerCase();
  }

  if (lower.startsWith("file://")) {
    const withoutScheme = raw.slice("file://".length).replace(/^\/+/, "");
    return "file://" + withoutScheme.toLowerCase();
  }

  return raw.replace(/^\/+/, "").toLowerCase();
};

// Shared browser snippet used by preview-html to avoid logic drift.
export const TO_MESH_REFERENCE_KEY_SOURCE = `const toMeshReferenceKey = ${toMeshReferenceKey.toString()};`;
