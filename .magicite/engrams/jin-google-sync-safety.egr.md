---
spec: engram/0.2
name: jin-google-sync-safety
id: egr_a44fad1e
version: 1
provenance: authored
intent:
  does: "Change Google Calendar sync without weakening credential, authority, conflict, audit, or offline-test boundaries"
  use_when: "modifying OAuth, Google API mapping, pull/push sync, conflict resolution, sync state, or export exclusions"
  not_when: "working on local-only calendar display with no Google or credential behavior"
triggers:
  positive:
    - "change Jin Google Calendar synchronization"
    - "modify OAuth token storage or authentication flow"
    - "handle etag conflict 410 reset or 412 precondition"
    - "preserve source authority and derived_from during sync"
  negative:
    - "render a local calendar grid without calling Google"
context_affinity: [jin-core, google, sync, oauth, conflicts]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-sovereign-storage-boundary, jin-rfc5545-time-discipline]
yields: [safe-google-sync-change]
composes: [jin-verification-gates]
inhibits: []
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in offline sync seams and secret handling"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
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
