# Wave 2 Change Narrative — Jin Notes Rebuild

**Version**: Wave 2 (shipped and verified, PRs #3 and #4 open)  
**Date**: 2026-06-28  
**Scope**: Track A – Real on-disk folders (nested subdirectories, empty-folder support); Track B – Obsidian-style live editor (per-block preview + autosave)  
**Test Coverage**: 784 vitest + Rust integ (cargo test --workspace) + clippy -D warnings + vite build + stylelint · All passing · Independent mutation tests on VG-MOVE link-integrity (Track A), XSS sanitize + controller autosave (Track B) · Adversarial code review (Track A) caught and fixed: hollow VG-MOVE test rewritten, Windows backslash traversal bypass plugged, `edit_note` data-loss bug fixed  
**Reference**: Full specs + AC breakdown → `.spectra/plans/2026-06-28-jin-notes-wave2-track-a-folders.md` and `.../track-b-editor.md` (don't duplicate here)

---

## Overview

Wave 2 ships two orthogonal expansions: **(1) Real folders (Track A)** — notes now live in on-disk subdirectories under `notes/<path>/<ULID>--<slug>.md` with arbitrary nesting, empty folders, and a 3-pane folder rail UI. The index gains a `folder_path` column (root = "") and `list_notes` picks up an optional folder filter. Schema migrates idempotently; existing flat notes stay put. Export sovereignty is preserved (subpaths in manifest, empty dirs reproduced). **(2) Obsidian-style live editor (Track B)** — each block renders as sanitized HTML when unfocused and swaps to a raw markdown textarea on focus, re-rendering and autosaving on blur. A single sanitization chokepoint (markdown-it + DOMPurify) gates all user content; a lossless block parser ensures `serializeBlocks(parseBlocks(body)) === body` by construction. Both tracks reuse the existing `edit_note` plumbing and leave deliberate seams for wikilinks, slash commands, and advanced editor UX.

---

## Changes

### Track A – Folders

#### Store (Recursion + Path Derivation)

- **Recursive path enumeration** — `fs::list_note_paths` (jin-core/src/store/fs.rs) now recurses into subdirectories under `notes/`, skipping hidden dirs and symlinks to avoid cycles. `find_note_path` retains stem-prefix matching and works with stored paths (not reconstructed flat paths).
  - **Index rebuild path derivation** — During rebuild (jin-core/src/index/rebuild.rs), `folder_path` is derived via `strip_prefix(notes_dir)` on each note's `file_path`, yielding a relative subdir path like `Projects/2026` or empty string for root. This mirrors the Wave 1 body-read pattern: stored paths are canonical, index is derived.
  - **Path validation** — New `validate_folder_path(path: &str) -> Result<()>` (jin-core/src/store/fs.rs) rejects backslashes, absolute paths, `..`, `.`, empty components, and trailing slashes; cross-platform traversal attacks and `.` self-references are blocked.

#### Schema + Migration

- **New `folder_path` column** — Added to `notes` table (jin-core/src/index/schema.rs:15-24, 123-133) as `TEXT NOT NULL DEFAULT ''`. Migrates from wave1-v1 to wave2-v1.
  - **Idempotent migration** — `schema::apply` includes a guarded `ALTER TABLE notes ADD COLUMN folder_path` (checks `PRAGMA table_info` to avoid duplicate-column error on re-application). Existing flat notes receive `folder_path=""` with zero file moves.
  - **Version sentinel** — `SCHEMA_VERSION = "wave2-v1"` in `schema_meta` gates a one-time full rebuild at `ops::init` to populate folder_path for pre-existing notes. Users experience a transparent re-index on first launch post-upgrade.

#### Operations (CRUD + Listing)

- **`create_note(folder, title, body) → Result<Note>`** — Validates folder_path, places the note in `notes/<folder>/<ULID>--<slug>.md`, updates the index. Callers must invoke `api::refresh` to sync the UI.
- **`move_note(note_id, new_folder) → Result<()>`** — Write-new/remove-old semantics: ensures the new path is distinct from the old before touching the filesystem, preserving ULID and link safety. Caller must `api::refresh`.
- **`list_folders() → Vec<Folder>`** — Returns folders with note counts. Implementation unions `SELECT DISTINCT folder_path FROM notes` (the index snapshot) with an on-disk recursive scan of `notes/` subdirs. This ensures empty folders show with `note_count=0` and no orphans hide.
- **`create_folder(path) → Result<()>`** — Creates the directory on disk and initializes it with `.gitkeep` for VCS visibility (Wave 2 decision). Validates the path.
- **Optional `folder_filter` on `list_notes`** — Query signature remains additive; callers can pass a folder path to restrict results, or omit it for the flat legacy behavior.

#### Data Export Sovereignty (P0)

- **Recursive walk** — `ops::export` (jin-core/src/ops/export.rs) now walks `notes/` recursively, preserves each note's relative subpath in the ZIP, and reproduces empty directories as `.gitkeep` files in the export manifest.
  - **Test round-trip** — `jin-core/tests/s8_export_sovereignty.rs` extended to verify: foldered notes export with their subpaths intact, empty folders appear in the manifest, and re-import preserves the structure.

#### UI (Folder Rail)

- **3-pane Notes view** — `NotesController` gains a folder rail (left pane) listing folders with note counts, a center list pane (filtered by selected folder), and the existing detail pane on the right.
  - **Wiring** — `loadFolders()` populates the rail on view entry; `selectFolder(folder_path)` filters the list and updates the route (optional query param). `newFolder()` opens a dialog, validates, and re-fetches.
  - **Router/ViewKind unchanged** — Still 5 views; folder navigation is internal to the Notes controller. No cross-view impact.

#### Bug Fixed (Adversarial Review)

- **`edit_note` data-loss on same-slug rename** — Found during independent review: if a note's title changed but the slug remained identical (e.g., title="Note 1" → title="Note 1 Again", both ULID-stamped), the rename path computation `path_new == path_old` was false in some cases due to whitespace/case differences in the slug derivation. The fix (jin-core/src/ops/notes.rs) now guards `new_path != old_path` before writing-new; if paths match, the operation is a no-op (title-only change in-place). Prevents a write-then-delete that deleted the only copy.

#### Deferred for Wave 3

- Folder rename/delete (requires orphan-handling, backlink rewrites).
- CLI folder awareness (stays root-only in Wave 2).
- Move/edit re-render frontmatter (future sovereignty pass; custom keys currently lost on move).

### Track B – Obsidian-style Live Editor

#### Per-Block Live Preview

- **Dual render modes** — Each markdown block renders as sanitized HTML when the textarea is unfocused (read mode), and swaps to a raw-markdown textarea on focus (edit mode). On blur, the block is re-rendered and the change is queued for autosave.
  - **Block model** — `jin-gui/src/lib/notes/blocks.ts` exports `parseBlocks(body: string): Block[]` and `serializeBlocks(blocks: Block[]): string`. By construction, `serializeBlocks(parseBlocks(body)) === body` (segment partition; terminators preserved in gaps; fences keep blank lines). Lossless round-trip is a hard guarantee, not a test.

#### Sanitization Chokepoint

- **Single module** — `jin-gui/src/lib/notes/markdown.ts` is the exclusive import point for markdown-it and DOMPurify. No other module in the codebase imports these libraries (verified by grep).
  - **Sanitize gate** — `sanitizeMarkdown(markdown: string): DocumentFragment` combines:
    - markdown-it (^14) with `html: false` to render markdown to HTML, blocking raw HTML tags.
    - DOMPurify (^3) with a tight allow-list: tags (p, ul, ol, li, blockquote, pre, code, br, strong, em, a), attributes (href/target for `<a>` only), URI whitelist (http, https, mailto).
    - Returns a `DocumentFragment` (safe DOM fragment, not a string).
  - **XSS prevention** — App code never assigns `innerHTML` from user content; all renders flow through the sanitize gate. No innerHTML in `editor.ts` or `NotesController`.

#### Wiring (Autosave)

- **Controller flow** — `NotesController.commitBody(body: string)` (jin-gui/src/lib/notes/editor.ts) applies a dirty-check: if the body has changed since last fetch, invoke `editNote(note_id, body)` (existing API).
  - **Reconciliation** — On success, `api::getNoteById(note_id)` re-fetches to ensure the server's latest state is in hand; front-end local edit is discarded in favor of the canonical disk version (prevents stale-state bugs).
  - **Error handling** — On `editNote` failure, dispatch `app:error` and preserve the local textarea content for manual recovery. Keeps the user's work safe.

#### Dependencies

- `markdown-it` ^14 — Renders markdown to HTML with raw-HTML blocking.
- `dompurify` ^3 — Sanitizes DOM before rendering.

#### Deferred for Wave 3+

- Wikilink autocomplete (`[[...`).
- Slash commands (`/table`, `/code`).
- Image paste detection and upload.
- Table cell edit UX.
- Task-list checkbox rendering (read-only task checkboxes in preview).
- Keyboard navigation (Tab, Shift+Tab, Ctrl+Enter, etc.).
- Syntax highlighting (prism or highlight.js).

---

## Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| New `folder_path` column on notes table | Pre-existing `index.sqlite` databases require migration on next app launch | Automatic: `schema::apply` guards and applies; version sentinel in `schema_meta` triggers one-time rebuild. Existing flat notes receive `folder_path=""` and zero file moves. |
| `NoteDto` gains `folder_path: Option<String>` field | Code expecting a flat `/all-notes` view must add optional folder filter to `list_notes` queries | Non-breaking if you omit the filter (defaults to all folders). Folder filter is opt-in. |
| Export format now preserves subpaths | ZIP structure changes from flat to nested `notes/<folder>/...` | Existing backups are still valid; new exports include folder structure in manifest and ZIP. Old ZIP consumers must handle the new path format. |

---

## Technical Notes

### Why Folders Are Real On-Disk Subdirectories

Folders are not a metadata tag (stored in the index only) but real filesystem subdirectories. This preserves **export sovereignty** — external tools (grep, rsync, git) can inspect and manipulate the notes corpus directly, and imports are lossless. Metadata-only folders would hide structure from users who edit files outside the app.

### Why Path Derivation, Not Stored Folder Field

The `folder_path` is derived from the `file_path` at index rebuild time (strip_prefix), not stored in the note's frontmatter. This makes folders a **schema property**, not a note property. If a user moves a file on disk, the index rebuild discovers the new folder on next app startup; the note's content doesn't need to change. Keeps the ATLAS constraint: canonical store is the filesystem, index is derived.

### Lossless Block Serialization Proof

The block parser enforces a **segment partition invariant**: each line is either inside a block or in a terminator gap (blank lines, fence markers). Terminators are preserved in the gap, and fence markers keep their internal blank lines. This ensures the round-trip is **deterministic and 1:1**, not probabilistic. Any test of `serializeBlocks(parseBlocks(body)) === body` is a unit test, not a property test; it succeeds by construction.

### Sanitization Hardening

DOMPurify's allow-list is **restrictive by default**: only semantic HTML (headings, lists, emphasis) and safe links (http, https, mailto). Event handlers are impossible (DOMPurify strips them). Scripts cannot run. The chokepoint design ensures that **every render path goes through the gate**; a code review can verify that no stray `.innerHTML` assignments exist. Mutation testing validates that if the sanitize function is broken, the XSS guard fails.

---

## Seams Deliberately Left for Wave 3

**Folder rename/delete, CLI folder awareness, and custom-key preservation are NOT in Wave 2:**

| Seam | Wave 2 | Wave 3 Hook-In |
|------|--------|---|
| Folder CRUD | Create/list folders; move notes between folders | Rename folder (requires backlink rewrite); delete (orphan handling) |
| CLI | Default to root folder only (`~/.jin/notes/`) | Extend CLI ops (new, list, edit) to accept `--folder` param |
| Frontmatter re-render | `move_note` writes-new/removes-old; custom keys lost | Future: preserve unmapped YAML keys across move + edit (full note model) |
| Wikilink preview | Editor and preview render plain text `[[...]]` | Wave 3+: `[[Note Name]]` autocomplete, link validation, rename propagation |
| Editor UX | Single-line focus/blur; bulk rendering for entire body | Multi-line keyboard nav, slash commands, image drop, table cell focus trap |

No Wave-2 code assumes a flat folder structure or a single root in a way that forces a rewrite. The folder rail, validation, and recursion are complete and tested.

---

## Validation & Test Coverage

**Rust integ gates** (cargo test --workspace):
- **VG-MOVE**: `create_note(folder="x") → move_note(folder="y") → list_folders` ⇒ folders updated, note in new folder, old folder empty (if no other notes)
- **VG-FOLD-EMPTY**: `create_folder("x/y/z") → list_folders` ⇒ empty folders appear with `note_count=0`
- **VG-EXPORT**: `create_note(folder), move_note, export → ZIP ⇒ subpaths preserved; re-import ⇒ folders recreated
- **VG-EDIT-GUARD**: `edit_note(same_slug) → old_path == new_path` ⇒ no write-then-delete; title-only change in-place

**Frontend gates** (784 vitest):
- **VG-SANITIZE**: `sanitizeMarkdown("<img src=x onerror=alert>") → DOMPurify filters it ⇒ no onerror attribute
- **VG-BLOCK-ROUNDTRIP**: `serializeBlocks(parseBlocks(body)) === body` for 30+ bodies (varied fences, blank lines, nesting)
- **VG-AUTOSAVE**: `commitBody(newText) → editNote call → getNoteById re-fetch → reconcile ⇒ UI shows server state
- **VG-FOLDER-RAIL**: `selectFolder("Projects") → list filtered by folder ⇒ note_count updates

**Project-level gates** (all passing):
- `cargo test --workspace` (Rust integ + bridge)
- `cargo clippy -D warnings`
- `npm test` (784 vitest)
- `tsc --noEmit` (TypeScript typecheck)
- `vite build` (production bundle)
- `stylelint` (CSS lint)

**Mutation testing** (highest-risk gates):
- **VG-MOVE link-integrity** — Mutate: remove `new_path != old_path` guard. Result: mutation test fails (data loss detected). Fix required.
- **VG-SANITIZE XSS** — Mutate: remove DOMPurify step. Result: mutation test fails (onerror attribute escapes). Fix required.
- **VG-AUTOSAVE controller** — Mutate: skip getNoteById re-fetch. Result: mutation test fails (stale local state persists). Fix required.

**Independent adversarial review** (Track A, fixed):
- **Hollow VG-MOVE test** — Original test only called `move_note`; did not verify that `list_folders` or `list_notes` reflected the change. Rewritten: now explicitly checks both index and on-disk state.
- **Windows backslash traversal bypass** — Validator `validate_folder_path` initially only rejected `..` but allowed `.\x` sequences. Added: reject all backslashes, reject `.` and empty components (cross-platform hardening).
- **`edit_note` data-loss bug** — Slug derivation inconsistency: whitespace normalization in one path but not another. Guard now explicitly compares `new_path` and `old_path` before any filesystem write.

---

## Files Changed (Summary)

### Rust Backend (Track A — Folders)
- `jin-core/src/store/fs.rs` — `list_note_paths` now recursive (skip hidden/symlinks); `find_note_path` unchanged; new `validate_folder_path`
- `jin-core/src/index/schema.rs:15-24, 123-133` — `folder_path TEXT NOT NULL DEFAULT ''`; guarded migration ALTER TABLE
- `jin-core/src/index/rebuild.rs` — Derive `folder_path` via `strip_prefix(notes_dir)`; populate column
- `jin-core/src/index/query.rs` — `folder_path` in SELECT; optional folder filter on `list_notes`
- `jin-core/src/dto/note.rs` — `NoteDto::folder_path: Option<String>`
- `jin-core/src/ops/init.rs` — Version-gated rebuild gate (wave2-v1)
- `jin-core/src/ops/notes.rs` — `edit_note` guards `new_path != old_path` before write (data-loss fix)
- `jin-core/src/ops/export.rs` — Recursive walk; preserve subpaths in ZIP + manifest; `.gitkeep` for empty dirs
- `jin-core/tests/s8_export_sovereignty.rs` — Round-trip test for folder + empty-folder export/import

### Rust Backend (Track B — Editor)
- `jin-core/src/ops/notes.rs` — `edit_note` unchanged (reused by Track B autosave)

### Frontend (Track B — Editor)
- `jin-gui/src/lib/notes/markdown.ts` — Single sanitize chokepoint: markdown-it + DOMPurify (only module importing these libs)
- `jin-gui/src/lib/notes/blocks.ts` — `parseBlocks`, `serializeBlocks` (lossless by construction)
- `jin-gui/src/lib/notes/editor.ts` — Wiring: block render on focus/blur, autosave on blur
- `jin-gui/src/lib/notes/render.ts` — Per-block HTML render (via sanitize gate)
- `jin-gui/src/controllers/NotesController.ts` — `loadFolders`, `selectFolder`, `newFolder`, `commitBody` (autosave hook)
- `jin-gui/src/styles/editor.css` — Textarea + preview toggle styles
- `jin-gui/index.html` — Editor block template with focus/blur handlers
- `jin-gui/src/__tests__/blocks.test.ts` — Roundtrip tests (30+ bodies)
- `jin-gui/src/__tests__/editor.test.ts` — Sanitize, autosave, reconciliation gates

### Frontend (Track A — Folders)
- `jin-gui/src/controllers/NotesController.ts` — `loadFolders`, folder rail wiring
- `jin-gui/src/lib/notes/render.ts` — Folder rail template + list filtering
- `jin-gui/src/styles/notes.css` — 3-pane layout (folders | list | detail)
- `jin-gui/src/__tests__/notes_controller.test.ts` — Folder rail selection, list filtering

### Dependencies
- `markdown-it` ^14 — Added to `package.json`
- `dompurify` ^3 — Added to `package.json`

---

## How to Onboard Wave 3

1. **Folder rename** — Start with the folder CRUD ops: `rename_folder(old, new)` must rewrite all backlinks in notes that reference the old folder. Use the existing backlink-index to find notes.
2. **CLI folder awareness** — Extend `jin note new/list/edit` commands to accept `--folder` param. Validate against `list_folders`.
3. **Custom-key preservation** — Implement a full note model (unmapped YAML keys stored in a `custom_frontmatter: String` field). Modify `move_note` and `edit_note` to preserve this field across operations.
4. **Wikilink linking** — Extend the editor's sanitize gate to recognize `[[...]]` syntax, resolve to note IDs, and validate that the target note exists. Update backlinks on rename/move.
5. **Advanced editor UX** — Layer on keyboard nav (Tab to next block, Shift+Tab to previous, Ctrl+Enter to save), slash commands (`/table`, `/code`), and image paste detection.

The folder foundation (recursion, derivation, validation, empty-folder support) is complete and mutation-tested. The editor sanitization and autosave are proven. Build on these seams; they are intentional.

---

## Validation Scorecard

| Category | Result | Status |
|----------|--------|--------|
| Rust tests (integ + bridge) | All passing | ✓ |
| TypeScript typecheck | No errors | ✓ |
| Vitest (784) | All passing | ✓ |
| Clippy (-D warnings) | No warnings | ✓ |
| Vite build | Clean | ✓ |
| Stylelint | Clean | ✓ |
| Mutation tests (VG-MOVE, VG-SANITIZE, VG-AUTOSAVE) | All fail when code is broken | ✓ |
| Adversarial review (Track A) | Data-loss bug fixed, traversal bypass patched, VG-MOVE test hardened | ✓ |

---

## Provenance

- **Document**: Wave 2 Change Narrative
- **Created**: 2026-06-28
- **Source**: Shipped Wave 2 build (verified all tests); synthesis from SPECTRA specs (`.spectra/plans/2026-06-28-jin-notes-wave2-track-a-folders.md` and `.../track-b-editor.md`), source code anchors, test suite, and independent adversarial review
- **Audience**: Future contributors (Wave 3 team, maintainers)
- **Status**: Final (Wave 2 shipped and verified green; PRs #3 and #4 open for review)
