# Preview Regeneration Guide

Use this flow when you only need to regenerate thumbnails/videos and do not need a metadata/mapping issue.

## When To Use

- Missing preview media for a full repo.
- Regenerate preview media for one or more specific robot files.

## Workflow

1. Fork this repository: https://github.com/urdf-studio/urdf-robot-gallery/fork
2. Open this workflow in your fork:
   https://github.com/urdf-studio/urdf-robot-gallery/actions/workflows/contributor-generate-previews.yml
3. Click `Run workflow`.

## Inputs

- `issue` (optional): existing issue number or URL for tracking context.
- `repo` (required if `issue` is empty): `owner/repo` or repo URL.
- `robot_targets` (optional): one target per line.
  - Supports full GitHub robot URLs, for example:
    `https://github.com/bulletphysics/bullet3/blob/HEAD/data/quadruped/minitaur.urdf`
  - Also supports copied gallery target lines with `fileBase`.
  - Leave empty to regenerate missing media repo-wide.

## Notes

- Workflow runs must happen in your fork (upstream is blocked by design).
- Open a PR from your fork after commits are generated.
