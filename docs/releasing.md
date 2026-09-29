# Releasing Jin

The [Release Please workflow](../.github/workflows/release-please.yml) runs on
pushes to `main`. It maintains a release pull request, then creates a `vX.Y.Z`
tag and **draft** GitHub release after that pull request is merged. Only a new
Release Please release starts the macOS Apple Silicon, Linux x64, and Windows
x64 binary builds. When all three succeed, the same workflow attaches seven
files plus `SHA256SUMS` to its draft. A normal pull request, manual dispatch,
or separately pushed tag cannot build or serve binaries.

## Version and release pull request

Release Please owns version changes through `release-please-config.json` and
`.release-please-manifest.json`. Use Conventional Commit titles (`feat:`,
`fix:`, and `feat!:` for breaking changes) so it can choose the next version.
Configured TOML paths update `jin`, `jin-core`, `jin-gui/src-tauri`, and their
`Cargo.lock` entries. JSON paths update the Tauri and npm package versions,
including both root version fields in `package-lock.json`. The root Cargo
workspace has no package of its own, so version paths name each crate.

The manifest starts at `0.8.1`, the latest existing tag. The first release
change uses `Release-As: 1.0.0` in the migration commit to bridge to the
already aligned `1.0.0` package files. Preserve that footer when merging the
pipeline pull request. Later releases use normal version selection; do not
leave a permanent `release-as` setting in the config.

Review the generated release pull request and its version changes. Run
`python3 scripts/check-release-version.py`, `make verify`, and
`make verify-gui` on its head. With the default `GITHUB_TOKEN`, GitHub does not
automatically trigger pull request workflows for a Release Please-created PR;
the Release Please job explicitly dispatches `ci.yml` on that branch.
Repository Actions must be allowed to create pull requests in **Settings →
Actions → General**. If that setting is unavailable, configure a suitable
release token with the repository owner before expecting the automation to
open a PR.

## Binary validation and publication

Before merging a release pull request, check the existing platform build
evidence and run the [native GUI checklist](gui-testing.md) on macOS, Linux,
and Windows. Build jobs compile the CLI, run its version and help commands,
build the Tauri bundles, inspect formats and architecture, and upload their
artifacts. This automated check does not prove native installer launch or GUI
appearance.

Merge the release pull request when ready. Release Please creates the tag and
draft. The matrix checks out its release SHA, rejects package/tag version
disagreement, and builds three CLI archives, macOS DMG, Linux DEB and AppImage,
and Windows NSIS EXE. The final job requires exactly these seven files,
generates and verifies `SHA256SUMS`, and uploads them to the existing draft.
Review the files, checksums, installation notes, and native smoke results;
publish the draft in GitHub when ready.

If a build or upload fails, use **Re-run failed jobs** on that Release Please
workflow run. This keeps the original release output and repeats only failed
work; re-running all jobs after release creation may skip builds because no
new release is created. Do not move a published tag or reuse a failed asset.

## Signing and support

macOS uses Tauri's ad-hoc signing identity (`-`) and is not Apple notarized.
Windows packages are unsigned. Do not describe these builds as trusted or
notarized until real signing and notarization are implemented and verified.
The matrix intentionally does not produce Intel macOS, ARM Linux, or ARM
Windows artifacts.
