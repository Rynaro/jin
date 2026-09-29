# Releasing Jin

The release workflow is [`.github/workflows/release.yml`](../.github/workflows/release.yml).
It builds both the CLI and Tauri desktop app on native macOS Apple Silicon,
Ubuntu 24.04 x64, and Windows x64 runners. It builds pull requests, accepts
manual runs, and responds to version tags.
Only a matching tag creates a GitHub **draft** release; publishing remains a
separate review step.

## Prepare

1. Update first-party versions together in `jin/Cargo.toml`,
   `jin-core/Cargo.toml`, `jin-gui/src-tauri/Cargo.toml`,
   `jin-gui/src-tauri/tauri.conf.json`, and `jin-gui/package.json`.
   Refresh `Cargo.lock` and `jin-gui/package-lock.json`.
2. Run `python3 scripts/check-release-version.py` and
   `python3 scripts/check-release-version.py --tag v1.0.0` (substitute the
   intended tag). The release workflow rejects tag/version disagreement.
3. Run `make verify` and `make verify-gui`, and inspect the pending changes.

## Dry run and validation

Open a pull request or trigger **Release binaries** with `workflow_dispatch` on
the commit intended for release. The three build jobs upload separate `release-*` workflow
artifacts. A manual run does not create a GitHub release.

Each job builds a release CLI, runs its version and help commands, builds the
native Tauri bundle, checks expected package formats and architecture, then
uploads the files. Download and inspect all artifacts. Extract each CLI archive
and run `jin --version` and a temporary-store `jin --root ... init` on its
target OS. Install and launch the GUI on all three OSes, including the
[native GUI checklist](gui-testing.md). Automated logic tests do not prove
native display or installer behavior.

Expected assets are three CLI archives, one macOS DMG, one Linux DEB, one Linux
AppImage, and one Windows NSIS setup EXE.

## Draft and publish

After a successful dry run and review, tag the same commit as `v1.0.0` and
push the tag. The tag-triggered workflow rebuilds all targets. Its final job
waits for all three builds, checks for exactly seven deliverables, generates
`SHA256SUMS`, verifies the checksums, and creates a draft GitHub release.

Review the draft's files, checksums, installation notes, and native smoke-test
results. Publish the draft through GitHub when the release is ready. If a build
fails, fix it on a new commit and repeat the dry run; do not reuse a failed
release artifact. Avoid moving a published tag.

## Signing and support

macOS uses Tauri's ad-hoc signing identity (`-`) and is not Apple notarized.
Windows packages are unsigned. Do not describe these builds as trusted or
notarized until real signing and notarization are implemented and verified.
The release matrix intentionally does not produce Intel macOS, ARM Linux, or
ARM Windows artifacts.
