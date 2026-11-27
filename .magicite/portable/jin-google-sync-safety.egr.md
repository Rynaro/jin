---
spec: engram/1.0
name: jin-google-sync-safety
id: egr_a44fad1e
version: 1
intent:
  does: Change Google Calendar sync without weakening credential, authority, conflict, audit, or offline-test boundaries
  use_when: modifying OAuth, Google API mapping, pull/push sync, conflict resolution, sync state, or export exclusions
  not_when: working on local-only calendar display with no Google or credential behavior
capabilities:
  requires: []
  produces: []
  alternatives: []
  conflicts_with: []
relations:
  requires: []
  before: []
  supersedes: []
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
  - change Jin Google Calendar synchronization
  - modify OAuth token storage or authentication flow
  - handle etag conflict 410 reset or 412 precondition
  - preserve source authority and derived_from during sync
  negative:
  - render a local calendar grid without calling Google
  body_digest: 23239f49e3a9a5a2283c7e4fdb58cafaa4c69bb968fc3fb37a0a587f16b54e2c
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 23239f49e3a9a5a2283c7e4fdb58cafaa4c69bb968fc3fb37a0a587f16b54e2c
    content_sha256: 797b15e1455e31113debaa3134547f9ffbd9140b461be6c9eb418f83ba81468d
  journal:
  - version: 1
    timestamp: '2026-08-18T00:00:00Z'
    author: vivi
    event: authored
    note: Grounded in offline sync seams and secret handling
legacy:
  plasticity:
    storage_strength: 0.0
    exposure_count: 0
    outcome:
      success: 0
      failure: 0
    last_applied:
    excitability: 0.05
    last_checkpoint:
    status: nascent
  needs:
  - jin-sovereign-storage-boundary
  - jin-rfc5545-time-discipline
  yields:
  - safe-google-sync-change
  composes:
  - jin-verification-gates
  context_affinity:
  - jin-core
  - google
  - sync
  - oauth
  - conflicts
  exports:
    skill_md: true
---
## Procedure
1. Keep OAuth secrets behind `jin-core/src/google/secrets.rs`: OS keyring first, AEAD-encrypted file fallback, never plaintext.
2. Keep credentials, sync tokens, etags, dirty state, and outbox data under operational `.jin/sync/`, separate from canonical event files and export.
3. Preserve `EventSource`/authority rules when mapping remote objects in `google/mapping.rs` and orchestrating `google/sync.rs`.
4. Resolve conflicts with the existing policy in `jin-core/src/sync/conflict.rs`, preserving `source: jin` and `derived_from` when Google wins content.
5. Append conflict outcomes to the audit log; do not rewrite prior entries.
6. Test through scripted HTTP seams only—no real credentials or network—in `jin-core/tests/s61_auth.rs`, `jin/tests/s62_sync_seam.rs`, `s63_conflict_resolution.rs`, and `cli_sync.rs`.

## Pitfalls
- Reading a developer's real keyring in tests makes results nondeterministic and risks credential access.
- Treating a Google mirror and a Jin-promoted event as the same authority loses sovereignty rules.
- Exporting encrypted tokens is still a secret leak even if the bytes are unreadable.

## Examples
+ Force the file token backend in a temp root and drive a 412 response through the fake client seam.
- Add a live Google smoke test to the default test suite.

## Provenance
- Derived from `docs/adr/0004-google-calendar-sync.md`, Google/sync modules, and offline integration tests.
