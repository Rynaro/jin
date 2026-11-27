---
spec: engram/1.0
name: jin-release-acceptance-evidence
id: egr_6b216f5e
version: 1
intent:
  does: Review Jin Release Please draft artifacts and native acceptance evidence without publishing releases.
  use_when: Preparing a release, checking a release pull request, validating draft assets, or following a failed
    release job.
  not_when: Publishing a GitHub release or changing ordinary feature code.
compatibility: {}
capabilities:
  requires: []
  produces:
  - kind: artifact
    id: artifact.jin-release-acceptance-report
    version: 1.0.0
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
    - pnpm
    - python3
    - make
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - Jin release acceptance
  - Release Please draft
  - release asset checksums
  negative:
  - publish release
  body_digest: 8d4fc24d155c4bda116b13c6da7db05cab3faa34651925f5cfb120f7a5fc819c
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 8d4fc24d155c4bda116b13c6da7db05cab3faa34651925f5cfb120f7a5fc819c
assets: {}
extensions: {}
---
## Procedure
1. Read `docs/releasing.md` and `.github/workflows/release-please.yml`; review supplied or locally available draft metadata, artifacts, and smoke reports rather than manually changing version files or fetching external job state.
2. Run `python3 scripts/check-release-version.py`, `make verify`, and `make verify-gui` on the release candidate where its prerequisites are available.
3. Verify the draft has three CLI archives, DMG, DEB, AppImage, NSIS EXE, and `SHA256SUMS`, with the intended release SHA and matching package versions. Verify `SHA256SUMS` against all seven expected files.
4. Review package installation notes and platform-native smoke evidence. Keep draft versus published state explicit, and record that macOS uses ad-hoc signing and Windows packages are unsigned.
5. For a failed release job, record that the workflow's failed-job retry should be used while keeping the original draft output. Do not rerun jobs, publish, move tags, or reuse a failed asset as part of this review.

## Pitfalls
- A merged release PR is distinct from a completed draft artifact set.
- Re-running all jobs after release creation can skip platform builds.

## Examples
+ Report a draft release's complete seven-file asset set and pending publication decision.
- Publish a GitHub release → not this engram.

## Provenance
- Derived from `docs/releasing.md`, the Release Please workflow, and packaged acceptance work.
