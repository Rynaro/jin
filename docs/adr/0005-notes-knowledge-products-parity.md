# 0005 — Notes Knowledge Products Parity

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Product owner
- **Covers:** Recovered Discovery/03 Notes milestones M1–M5
- **Depends on:** ADR-0001 (stable links), ADR-0002 (canonical files +
  rebuildable SQLite), ADR-0003 (core/GUI boundary)
- **Provenance:** `discovery/03-notes-knowledge-products-parity.md`, recovered
  from unreachable Git blob `cd7340e9b9911737b993eb454e927d74a4855182`, then
  completed with the owner’s accepted M0 decisions.

## Context

Notes must become portable knowledge products without weakening Jin’s canonical
file boundary. The product needs links, property queries, attachments,
collections, recovery, and export/import integrity, but must not turn SQLite,
filesystem paths, labels, renderer HTML, or opaque query strings into hidden
sources of truth.

## Decision

### Canonical data and recovery

- Vault content remains plaintext Markdown/YAML. M1 relies on filesystem/OS
  protection and explicit export; it introduces no application encryption.
- Canonical writes use a same-directory temp file, fsync, rename, and directory
  sync where the platform permits. A journal records incomplete replacements.
- Revisions are monotonic; immutable snapshots support stale-write detection and
  restore as a new revision. Canonical recovery occurs before a derived-index
  rebuild.
- SQLite is a deterministic, discardable projection. Its FTS material is only
  note body, strict properties, and canonical-link labels.

### Links and properties

- Internal links have exactly one canonical form:
  `[[<ULID>|<label>]]`. The ULID is identity. Neither labels nor paths resolve
  targets.
- Existing typed `links[]` edges and backlinks remain valid. The existing
  `attach` operation continues to mean semantic graph attachment.
- Properties use strict portable scalar/list types: string, number, bool, date,
  string-list. `jin.*` is reserved. Unknown non-reserved frontmatter survives
  Jin rewrites.

### Attachments and Collections

- Assets are regular-file copies under a content-addressed immutable vault
  store, named by SHA-256 and described in a portable manifest.
- Export includes canonical Notes, Collections, assets, asset manifest, and
  audit data; it excludes derived SQLite, secrets, and device-local state.
- Import verifies every manifest entry and supported format version before it
  writes canonical content, then rebuilds the derived index.
- Collections are versioned JSON documents in `collections/` with a
  declarative AST. No persisted SQL or executable expression is allowed. Unknown
  JSON fields round-trip. Pins and recents are device-local and excluded.

### Renderer boundary

- No raw HTML, iframe, script, object, or network-loaded media is accepted from
  Markdown. The renderer may emit only inert hash-validated local-asset
  placeholders until a dedicated verified media resolver exists.

## Consequences

**Benefits**

- Vaults remain readable, diffable, portable, recoverable, and independently
  verifiable across Jin versions.
- Canonical IDs keep links stable across title and folder changes.
- Search/query acceleration remains replaceable; export/import is safe by
  construction rather than by convention.

**Costs**

- Rebuild and manifest verification add I/O on recovery/export paths.
- Rich web cards, active media playback, encryption, and presentation-colored
  links are intentionally deferred rather than implemented as unsafe shortcuts.

## Extension plan

1. Add a sandboxed, opt-in website-card fetch/cache service with a documented
   network policy and revocation semantics.
2. Add a Tauri-local media resolver that serves only manifest-verified,
   MIME-allowlisted immutable bytes to `<img>`/`<video>`.
3. Add themes for colored-link presentation only; canonical Markdown remains
   `[[ULID|label]]`.
