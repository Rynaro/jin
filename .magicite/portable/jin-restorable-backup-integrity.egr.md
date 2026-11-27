---
spec: engram/1.0
name: jin-restorable-backup-integrity
id: egr_f12520d2
version: 1
intent:
  does: Preserve Jin backup and export promises through semantic restorability checks.
  use_when: Changing backup creation, verification, replacement, restoration, or export UI.
  not_when: Changing a normal record mutation with no export-directory boundary.
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
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - backup verification
  - restore export
  - replace export directory
  negative:
  - ordinary record mutation
  body_digest: cad3405609aabff1b31b6418cb68abf8d7e1af4e1901e371a85d3df15e9069af
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: cad3405609aabff1b31b6418cb68abf8d7e1af4e1901e371a85d3df15e9069af
assets: {}
extensions: {}
relations:
  requires:
  - id: egr_a81df514
    version: 1
---
## Procedure
1. Start in `jin-core/src/ops/export.rs` and retain the sovereign storage exclusions in `jin-sovereign-storage-boundary`.
2. Verify the staged export directory and manifest hashes, then inspect its canonical records for duplicate embedded identities before calling it restorable.
3. Complete verification before force-replacing an existing known-good export. After the old destination is moved aside, revalidate the prior directory, staged manifest, and identities before promotion. Preserve recoverable paths on failure.
4. Keep file-copy integrity separate from semantic restorability. Matching hashes alone cannot prove that rebuilding a vault will succeed.
5. Run `cargo test -p jin --test s8_export_sovereignty` and the focused export tests that exercise the changed path.

## Pitfalls
- A verified export directory with duplicate canonical IDs cannot be restored safely.
- Replacing a known-good backup before validation turns a recoverable failure into data loss.

## Examples
+ Reject a staged export containing two notes with one embedded ID before it replaces an export.
- Change local index query ranking → not this engram.

## Provenance
- Derived from `ops/export.rs`, canonical-scan behavior, `s8_export_sovereignty.rs`, and backup remediation work.
