# Wave 1 Change Narrative — Jin Notes Rebuild

**Version**: Wave 1 (shipped and verified)  
**Date**: 2026-06-27  
**Scope**: Notes module bug fix + excerpt system + Apple-Notes–style list redesign  
**Test Coverage**: 637 vitest + Rust bridge tests (vg1_1, vg1_3, vg2_2, vg2_3, K1) + controller-driven round-trip (vg1_4) · All passing  
**Reference**: Full spec + AC breakdown → `.spectra/plans/jin-notes-wave1.md` (don't duplicate here)

---

## Overview

Wave 1 shipped three coordinated changes: (1) **fixed the title-only bug** — notes now load their body from disk instead of projecting an empty field from the index; (2) **added an excerpt system** — a 200-char UTF-8–safe text snippet derived at rebuild time, enabling list previews; (3) **redesigned the list UI** to Apple-Notes style (title + 2-line snippet + date) replacing bubble cards. All changes are backward-compatible; one schema migration is included. Deliberate seams are left for Wave 2 (folders + Obsidian editor).

---

## Changes

### Fixed

- **Title-only note detail bug** — Root cause: `NoteDto` had no `body_markdown` field; `api::get_note` projected from the SQLite index which has no body column, so the frontend always received `undefined`. 
  - **Fix**: Added `body_markdown: Option<String>` to `NoteDto` (jin-core/src/dto/note.rs:12); modified `api::get_note` (jin-core/src/ops/api.rs:26-40) to read the body fresh from disk via `fs::read_note(row.file_path)` after fetching the index row, keeping index-derived title/status/tags/backlinks.
  - **Behavior change (flagged)**: `get_note` now returns an error if the on-disk file is unreadable/missing instead of silently succeeding with an empty body. This surfaces real inconsistency (index row stale) and prevents reintroducing the empty-body symptom. See [R5](§6).

### Added

- **Excerpt column + schema migration** — Notes list now carries content snippets for preview.
  - **Schema**: Added `excerpt TEXT NOT NULL DEFAULT ''` to the `notes` table (jin-core/src/index/schema.rs:15-24, 123-133). Migration path: `schema::apply` includes a guarded idempotent `ALTER TABLE notes ADD COLUMN excerpt` to retrofit existing DBs; a version sentinel in `schema_meta` gates a one-time full rebuild on first launch so pre-existing notes get excerpts populated (jin-core/src/ops/init.rs:53-75).
  - **Derivation**: Pure `derive_excerpt(body: &str) -> String` collapses whitespace, trims, truncates to 200 chars on a UTF-8 boundary, never splits a character (jin-core/src/index/rebuild.rs:323-347). Markdown-syntax stripping is a Wave-2 polish seam.
  - **Projection**: `excerpt` flows through `NoteRow` → list/get `SELECT` queries (jin-core/src/index/query.rs:78-100, 125-143) → `NoteDto.excerpt: Option<String>` (jin-core/src/dto/note.rs:14).
  - **Frontend**: TS `NoteDto` gains `excerpt?: string | null` (jin-gui/src/types/dto.ts); list rows populated via `textContent` (XSS-safe) in `buildNoteRow` (jin-gui/src/lib/notes/render.ts).

- **Apple-Notes–style list redesign** — Flat rows (title + snippet + date) replacing elevated bubble cards.
  - **Layout**: Production template `#tmpl-note-row` (jin-gui/index.html:1268-1280) restructured to title line + 2-line snippet + date, retaining class hooks (`.browse-row__inner`, `.browse-row__title`, `.note-row__status*`, `.note-row__tags`) and adding `.note-row__snippet` and `.note-row__date`.
  - **Styling**: CSS refactored under `.note-row` scope to avoid blast radius on Tasks/Events rows (jin-gui/src/styles/browse.css); bubble cards removed (elevated bg, radius, border); hairline separators added (`border-block-end: 0.5px solid var(--separator)`).
  - **Date formatting**: Pure `formatNoteDate(iso: string, now?: number): string` (jin-gui/src/lib/notes/transform.ts) displays `Today` / `Yesterday` / `MMM D` / `MMM D, YYYY` based on day-of-year and year.
  - **Template parity**: Test fixture template in `notes_controller.test.ts:115-130` updated in lock-step with production HTML to prevent divergence (risk R2 mitigated by K2 parity gate).

---

## Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| `get_note` returns error if file is unreadable/missing | Code relying on silent-success for missing files now catches an error | Catch and handle `Err` from `getNoteById`; index consistency was implicit; now explicit |
| Schema migration (idempotent `ALTER TABLE`) | Pre-existing `index.sqlite` databases require the migration on first `schema::open` | Automatic: `schema::apply` guards and applies; version sentinel in `schema_meta` triggers one-time rebuild at `init` to populate excerpts. Users experience a one-time index rebuild on next launch. |

---

## Technical Notes

### Why Excerpt at Rebuild, Not List-Time

Reading every note file during `list_notes` is O(N) cost per request. The excerpt is derived **at rebuild time** (jin-core/src/index/rebuild.rs:35-40) where the body is already in scope, adding zero extra IO. List queries then return `excerpt` in a single cheap SQL SELECT, matching Apple Notes' architecture.

### Why Body Reads From Disk, Not Index

The index is a fully derived, disposable artifact; the canonical store is markdown files. Storing full bodies in the index would (a) duplicate data, violating the ATLAS constraint, and (b) make the detail view stale if a user edits the file externally. Reading from `row.file_path` keeps the detail always current and is folder-safe already (stored paths, not reconstructed flat paths). This is the hook that Wave 2's Obsidian editor will reuse.

### Migration Safety (Risk R1)

`CREATE TABLE IF NOT EXISTS` will NOT add a column to an existing table. The fix:
1. Extend the `CREATE TABLE` statement to include `excerpt` (backward-compatible; new DBs have it from the start).
2. Guard-applied `ALTER TABLE notes ADD COLUMN excerpt` in `schema::apply` (checks `PRAGMA table_info` to avoid duplicate-column error on re-application).
3. Version sentinel in `schema_meta` (`SCHEMA_VERSION = "wave1-v1"`) gates a one-time `rebuild` at `ops::init` (runs on every launch anyway) to populate excerpts for pre-existing notes.

Existing users are safe: the first app launch after upgrade triggers the migration (no crash) and then the rebuild (seconds, one-time).

### CSS Scoping for Tasks/Events Separation (Risk R4)

The flat Apple-Notes redesign is scoped under `.note-row` selectors to avoid retyling Tasks/Events rows (which share the base `.browse-row__inner` class). The intent: Apple-Notes flat look for notes in Wave 1; Tasks/Events styling deferred.

---

## Seams Deliberately Left for Wave 2

**Folders (real on-disk subdirectories) are NOT in Wave 1, but the code is ready:**

| Seam | Wave 1 | Wave 2 Hook-In |
|------|--------|---|
| `get_note` source | Reads stored `NoteRow.file_path` (not reconstructed flat path) | Folder-safe already; no rework needed |
| Query signatures | `api::list_notes(root, include_deleted, tag)` positional but additive | Add optional `folder_filter` param; no row assumptions about flatness |
| Store recursion | `fs::list_note_paths` non-recursive (fs.rs:83-97); `find_note_path` stem-prefix match | Make `list_note_paths` recursive; excerpt/rebuild flow unchanged |
| NoteDto/table shape | Additive superset (id, title, dates, status, tags, backlinks, body, excerpt) | Add `folder_path`; render a breadcrumb on the existing `.note-row__meta` line |
| Obsidian editor | Detail reads fresh body per `get_note`; no stale caching | Uses existing `edit_note` + sanitization; no Wave-1 blocker |

No Wave-1 code assumes a flat namespace in a way that forces a rewrite; only `fs.rs` isolation point needs recursion.

---

## Validation & Test Coverage

**Rust round-trip gates** (bridge.rs):
- **VG1.1**: `create_note(body) → api::refresh → get_note_fn` ⇒ body non-empty
- **VG1.3**: Edit file on disk, don't rebuild, call `get_note` ⇒ returns new body (disk-read proof)
- **VG2.2**: `create_note(multi-line) → refresh → list_notes_fn` ⇒ excerpt populated from `derive_excerpt(body)`
- **VG2.3**: Open pre-existing schema, `schema::apply` ⇒ no crash, idempotent, `list_notes` works

**Frontend anti-shallow gates** (notes_controller.test.ts, vitest):
- **VG1.4**: Mock `getNoteById` to return a body, drive `loadDetail` ⇒ `.note-detail__body` shows it (not hand-fed)
- **VG2.4**: Render a list with excerpt/date ⇒ `.note-row__snippet` and `.note-row__date` populated
- **VG2.5**: `formatNoteDate` with injected `now` ⇒ Today/Yesterday/MMM D/MMM D, YYYY
- **K2**: Parse production `#tmpl-note-row` ⇒ contains `.note-row__snippet` and `.note-row__date` (parity guard)

**Project-level gates (all passing)**:
- `cargo test -p jin-core` (Rust integ)
- `cargo test` (Tauri bridge, VG*)
- `cargo clippy -D warnings`
- `npm test` (vitest, 637 passing)
- TypeScript typecheck/build

---

## Risk Flags (Summary)

| ID | Risk | Severity | Status |
|----|------|----------|--------|
| R1 | Schema migration on pre-existing DB → no such column crash | **P0** | **Mitigated**: Guarded ALTER + version sentinel + rebuild gate (VG2.3 proof) |
| R2 | Test fixture diverges from production template | P1 | **Mitigated**: K2 parity guard parses production HTML; test fixture updated in lock-step (S3 step 3) |
| R3 | Stale-empty excerpts for pre-existing notes | P1 | **Mitigated**: K1 version-gated one-time rebuild at `init` |
| R4 | Restyling `.browse-row__inner` breaks Tasks/Events rows | P1 | **Mitigated**: Apple-Notes styling scoped under `.note-row` selectors |
| R5 | `get_note` error instead of silent-success for missing files | P2 | **Documented**: Surfaces real inconsistency; index row implies file existed at last rebuild |

---

## Files Changed (Summary)

### Rust Backend
- `jin-core/src/dto/note.rs` — Added `body_markdown` and `excerpt` fields
- `jin-core/src/ops/api.rs:26-40` — `get_note` now reads body from disk
- `jin-core/src/ops/init.rs:53-75` — Version-gated one-time rebuild
- `jin-core/src/index/schema.rs:15-24, 123-133` — Excerpt column + guarded migration
- `jin-core/src/index/rebuild.rs:323-347` — `derive_excerpt` + excerpt population
- `jin-core/src/index/query.rs:78-100, 125-143` — Excerpt in SELECTs
- `jin-core/src/store/fs.rs:72-80` — `read_note` reused from disk-read path

### Frontend
- `jin-gui/src/types/dto.ts` — TS `NoteDto` gains `excerpt` and body comment updated
- `jin-gui/src/lib/notes/transform.ts` — `formatNoteDate` helper added
- `jin-gui/src/lib/notes/render.ts` — `buildNoteRow` populates snippet + date
- `jin-gui/index.html:1268-1280` — Template restructured for Apple-Notes layout
- `jin-gui/src/__tests__/notes_controller.test.ts:115-130` — Fixture template updated
- `jin-gui/src/styles/browse.css` — Flat row styling, bubble cards removed

### Tests
- `jin-core/src-tauri/tests/bridge.rs` — VG1.1, VG1.3, VG2.2, VG2.3
- `jin-gui/src/__tests__/notes_controller.test.ts` — VG1.4, VG2.4, VG2.5, K2

---

## How to Onboard Wave 2

1. **Read the seams table above** — understand which abstractions are already folder-safe (storage paths) vs. which need recursion (fs.rs).
2. **Reference the SPECTRA spec** (`.spectra/plans/jin-notes-wave1.md`) for the original decisions, constraints, and full AC breakdown.
3. **Start with folder DTO/table columns** — add `folder_path` to `NoteRow` and `NoteDto`; it's purely additive.
4. **Make `fs::list_note_paths` recursive** — the only flatness assumption that matters; excerpt/rebuild already work per-path.
5. **Test: folder grouping in the list** — existing render pipeline (`buildNoteRow`) already reads `.note-row__meta`; add a breadcrumb there.
6. **Obsidian editor** — reuse `get_note`'s disk-read + existing `edit_note` + sanitization; no Wave-1 blocker.

The code is architected to absorb Wave 2 without major rewrites. Commit to the seams; they are intentional.

---

## Provenance

- **Document**: Wave 1 Change Narrative
- **Created**: 2026-06-27
- **Source**: Shipped Wave 1 build (verified all tests); synthesis from SPECTRA spec (`.spectra/plans/jin-notes-wave1.md`), source code anchors, and test suite
- **Audience**: Future contributors (Wave 2 team)
- **Status**: Final (Wave 1 shipped and verified green)
