# URDF Robot Gallery Submissions

This repository collects robot showcase submissions for URDF Studio.

## How to submit

Use the submission form:
https://github.com/urdf-studio/urdf-robot-gallery/issues/new?template=robot-repo-submission.yml

To update an existing gallery entry:
https://github.com/urdf-studio/urdf-robot-gallery/issues/new?template=robot-entry-update.yml

For shared scenes, use:
https://github.com/urdf-studio/urdf-robot-gallery/issues/new?template=scene-submission.yml

Auto-ingest policy:
- Auto-ingest runs only when the submitter has write access to the repo or is a URDF Studio maintainer. Otherwise, submissions are reviewed manually.
- Repeated failed submissions (including missing URDFs) from the same author may be throttled and routed to manual review.
- If no URDF/Xacro files are detected in the repo, the entry is not added.
  Mesh assets (`.stl`, `.dae`, `.obj`, etc.) are supported, but they must be referenced by a URDF/Xacro root file.
- Robot mapping accepts both `RobotName — file.urdf` and `RobotName — subdir/file.urdf`.
  If a filename is ambiguous across folders, use the path form.
- Auto-ingest posts a comment with the detected URDF/Xacro file list and a suggested mapping block.
  It also includes suggested per-file tags (heuristic) and a repo-level macro tag suggestion.
  If `Tags (optional)` is empty, detected macro tags are applied automatically (fallback: `Other`).
  If `Tags (optional)` is provided, those corrected tags override the detection.
  Auto-ingest publishes detected vs corrected vs applied tags in a reconciliation comment.
  Ingest runs immediately; you can optionally edit mapping/tags and save the issue to refresh.
- Issue titles are updated automatically to include the repo name for easier tracking.
- Existing-entry updates use `robot-entry-update.yml`:
  `Metadata only` and `Mapping change` are auto-applied and closed;
  `Regenerate previews/thumbnails` stays open for contributor preview PR tracking.

## Tag taxonomy

Use the controlled tag list in `docs/tags.json`. Submissions with unknown tags are rejected.

## Validation

`docs/robots.json` is validated against `docs/robots.schema.json` in CI.
`docs/previews.json` is validated against `docs/previews.schema.json` in CI.
Preview entries may also include optional metadata fields:
`sourceType`, `meshCount`, `linkCount`, `jointCount`, `armCount`, `legCount`, `wheelCount`.

Robot entries store the full URDF path in the `file` field to avoid filename collisions.

Metadata is stored in `docs/robots.meta.json` (version + counts).

## Scene layers

Shared scene links for URDF Star live in `docs/scenes/`.

- `docs/scenes/index.json`: curated public scene list
- `docs/scenes/*.scene-layer.json`: importable scene layer payloads
- `docs/scenes.schema.json`: schema validated in CI (`npm run validate:scenes`)

## Manifests

Optional per-robot manifests live in `docs/manifests/<repoKey>/<fileBase>.json`.
Generate stubs with:

```sh
node tools/generate-manifests.mjs
```

## Cleanup previews

Find orphaned preview/thumbnail files (not referenced by `docs/previews.json`) and missing files:

```sh
node tools/cleanup-previews.mjs
```

Delete orphaned files:

```sh
node tools/cleanup-previews.mjs --write
```

## Backfill existing entries

To rescan existing repos and convert filename-only entries to full paths:

```sh
node tools/backfill-urdf-paths.mjs --token $GITHUB_TOKEN
node tools/backfill-urdf-paths.mjs --token $GITHUB_TOKEN --write
```

## Refresh robots list

To rescan repos, remove entries with no URDFs, and add missing URDFs:

```sh
node tools/refresh-robots.mjs --token $GITHUB_TOKEN
node tools/refresh-robots.mjs --token $GITHUB_TOKEN --write
```

Or trigger `refresh-robots.yml` from the GitHub Actions UI with `write=true`.

The script writes a report to `docs/backfill-report.json` with preview keys that should be
regenerated and also saves a comma-separated list in `docs/backfill-preview-keys.txt`.
Use those keys to regenerate previews:

```sh
# from /home/albamwsl/studio/urdf-robot-gallery
node tools/rebuild-previews.mjs \
  --studio /path/to/urdf-star-studio \
  --gallery /path/to/urdf-robot-gallery
```

## Contributor-generated previews (fork workflow)

If you submitted a repo and want to generate previews using your own GitHub API quota and runner minutes:

1. Fork this repository.
2. Open `https://github.com/<your-github-username>/urdf-robot-gallery/actions/workflows/contributor-generate-previews.yml` and click **Run workflow**.
3. Use one of these inputs:
   - tracked mode: enter `issue_number` (recommended), or
   - direct mode: paste `repo` (`owner/repo` or GitHub URL) if you do not have an issue handy.
4. The workflow processes previews for that repo and pushes to:
   - `contrib/previews-issue-<number>` when using `issue_number`
   - `contrib/previews-repo-<owner>-<repo>` when using direct `repo`
   Generated media is normalized to `800x800`, and preview framing is tuned so robots fill cards more consistently.
5. If the run stops early (timeout/cancel), run it again with the same input (`issue_number` or `repo`) and it resumes from the same branch.
6. Open the compare URL shown in the workflow summary to create the PR (this acts as the lock).
7. If the workflow says another open PR already exists for that branch, pick a different issue/repo run.

Target only specific robots (fast path):

1. Open the gallery card and use each robot row `Copy` button (copies `name + URDF path + fileBase + tags`).
2. In `robot-entry-update.yml`, choose `Regenerate previews/thumbnails` and paste those lines into `Robots to regenerate (optional)`.
3. Run the same `contributor-generate-previews.yml` workflow in your fork with that `issue_number`.
4. The workflow resolves pasted lines and regenerates only those robots (forced refresh), then pushes to the same `contrib/previews-issue-<number>` branch.

## Maintainer manual ingest

For manual review, open the `ingest-robot-repos.yml` workflow in GitHub Actions, click **Run workflow**, and enter the issue number.

## Where the gallery is displayed

The public gallery is displayed on https://www.urdfstudio.com (not via GitHub Pages).

## CDN cache refresh

When `docs/` gallery assets change on `main` (thumbnails, previews, manifests, scenes, and key json indexes),
GitHub Actions now automatically purges the matching jsDelivr cache paths so updates become visible without manual purge.
