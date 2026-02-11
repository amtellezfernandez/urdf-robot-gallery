# Scene Layers

This folder stores shared scene-layer JSON files for URDF Star and URDF Studio imports.

- `index.json`: curated list consumed by URDF Star `sync-world-gallery` script.
- `*.scene-layer.json`: importable scene payloads (public raw GitHub URLs).

Each entry in `index.json` should follow:

```json
{
  "id": "unique-id",
  "title": "Human name",
  "importUrl": "https://raw.githubusercontent.com/urdf-studio/urdf-robot-gallery/main/docs/scenes/file.scene-layer.json",
  "description": "Optional text",
  "owner": "urdf-studio",
  "tags": ["scene-layer"],
  "runtimeTargets": ["link"],
  "updatedAt": "2026-02-11T00:00:00Z"
}
```

Notes:
- Keep scene layers robot-agnostic (objects + environment only).
- Cameras remain robot/session-specific and should not be encoded here.
