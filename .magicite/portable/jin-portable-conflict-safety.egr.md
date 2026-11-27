---
spec: engram/1.0
name: jin-portable-conflict-safety
id: egr_f21e0fad
version: 1
intent:
  does: Protect canonical Jin records when a cloud-folder provider preserves conflicting copies.
  use_when: Changing canonical scans, shared-folder writes, index rebuilds, or conflict diagnostics.
  not_when: Changing remote provider protocol synchronization.
compatibility: {}
capabilities:
  requires: []
  produces: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - canonical file conflict
  - cloud folder duplicate identity
  - shared write safety
  negative:
  - remote provider synchronization
  body_digest: 0a886296e1cd6da168ce9dce80d62248a33f5aa2f0c256f395e8d60da14d641b
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 0a886296e1cd6da168ce9dce80d62248a33f5aa2f0c256f395e8d60da14d641b
assets: {}
extensions: {}
---
## Procedure
1. Read `jin-core/src/store/canonical_scan.rs`, `jin-core/src/store/history.rs`, `jin-core/src/config.rs`, and portable workspace handling before changing a scan or write path.
2. Treat the embedded canonical identity as authoritative. A provider-renamed conflicted filename can still duplicate a note, task, event, list ID, or tag slug.
3. Detect duplicate identities before rebuild clears the derived index. Shared recoverable operations scan under their lock. Keep every file available for user resolution.
4. Keep owner data under the synchronized root while resolving operational state outside it through `Config::jin_dir()`. `JIN_STATE_DIR` for isolated tests must be absolute and outside the portable root.
5. Build Workspace Check from one read-only inventory. Missing folders or duplicate identities pause Refresh, and a stale health response must not replace a newer result.
6. Return involved locations in diagnostics and preserve the prior index and canonical bytes on scan failure. Do not introduce a write path that clears or replaces the projection before required duplicate detection.
7. Run focused canonical-scan and history tests, `cargo test -p jin --test portable_folder_sync`, and `pnpm --dir jin-gui exec vitest run src/__tests__/workspace_sync_controls.test.ts` for exposed portable-folder behavior.

## Pitfalls
- Filename uniqueness does not establish canonical identity.
- Replacing the index before duplicate detection can erase a usable projection after a provider conflict.

## Examples
+ A cloud provider writes `note--conflicted copy.md` with the same embedded ID → reject and report both paths.
- Change a network sync adapter's retry schedule → not this engram.

## Provenance
- Derived from `canonical_scan.rs`, `history.rs`, and Jin conflict-resolution coverage.
