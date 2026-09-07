# Discovery/03 — Jin Notes Knowledge Products Parity (Recovered)

- **Status:** Recovered requirements record
- **Date recovered:** 2026-08-20
- **Provenance:** Recovered from unreachable Git blob
  `cd7340e9b9911737b993eb454e927d74a4855182`; accepted M0 product decisions
  complete the previously unresolved contracts.
- **Scope:** Notes only. Tasks, events, Google synchronization, device-local
  recents, and pins are intentionally out of scope unless explicitly named.

## Non-negotiable substrate

1. The canonical vault is plaintext Markdown plus YAML frontmatter at rest. It
   is portable and human-readable; filesystem/OS protections and an explicit
   portable export are the M1 security posture. M1 adds **no app encryption**.
2. SQLite is derived and rebuildable. It may index note body, strict properties,
   and canonical-link labels, but it cannot become source-of-truth.
3. Existing source-side typed edges and derived backlinks remain supported.
   `attach` remains a semantic graph-edge operation, never an attachment-upload
   alias.

## Milestone requirements

### M1 — Retrieval and recovery safety

- Deterministic retrieval/rebuild must work after deleting the derived index.
- Canonical writes use temporary write + fsync + atomic rename as supported by
  the platform.
- Incomplete canonical operations are journaled and recovered before derived
  index rebuild.

### M2 — Internal knowledge links

- The only canonical internal-link syntax is `[[<ULID>|<label>]]`.
- ULID is identity. Label and path are presentation only and never target
  resolution inputs.
- Existing explicit typed edges/backlinks continue to function.
- Surface deterministic unlinked whole-title mentions as suggestions; never
  silently write links.

### M3 — Attachments and portability

- Attachments are vault-managed file copies, content-addressed, immutable, and
  self-contained in export.
- Import/copy accepts safe local regular files only; integrity manifests detect
  corruption and source path traversal.
- Provide manifest-driven orphan repair without deleting suspicious bytes.
- Rich representations are inert and allowlisted. Local images/video may be
  safely embedded only after content hash and MIME verification; otherwise
  render an inert placeholder.
- Website cards and network fetching are deferred.

### M4 — Typed properties and Collections

- Frontmatter property types: `string`, `number`, `bool`, `date`, and
  `string-list`. Invalid nested/null types yield diagnostics.
- `jin.*` is reserved. Unknown non-reserved frontmatter keys survive edits.
- Collections are portable vault content. Persisted query grammar is a versioned
  declarative AST—not opaque SQL or executable expressions. View JSON is
  versioned, adjacent to the vault, and preserves unknown fields.
- Pins and recents are device-local and never exported/synced.

### M5 — Revision-aware recovery and restore

- Note writes have monotonically increasing revisions and immutable revision
  snapshots.
- Restore detects stale expected revisions and restores a snapshot as a new
  revision.
- Disaster restore first verifies and restores canonical content, then rebuilds
  the derived index.
- Export/import performs integrity and cross-format-version verification.

## Deferred extension plan

- Secure authenticated website-card/network fetch service, cache policy, and
  revocation model.
- Rich locally verified image/video player rendering beyond inert placeholders.
- Presentation-only colored-link themes. Colors never enter canonical link
  identity or required Markdown syntax.
