# Jin Notes — Wave 2, Track A: Notes Folders (real on-disk subdirectories) — Spec (decision-ready)

- **Methodology:** SPECTRA 4.10.0 · standard tier · single-pass cycle
- **Date:** 2026-06-28
- **Intent type:** CHANGE (multi-component: Rust store/index/ops/dto + Tauri bridge + TS/Stimulus frontend + migration + P0 export gate)
- **Complexity:** 9/12 → extended thinking (2× depth)
- **Confidence:** 88% → AUTO_PROCEED
- **Hand-off:** spectra → apivr (**Vivi**, coder)
- **Conventions file:** none present (`.spectra/setup/spectra-conventions.md` absent) → generic defaults
- **Upstream scout:** ATLAS Wave-2 report, Track A (episodic crystal `0ca90347`, **not surfaced by recall**; findings supplied inline by owner and re-verified firsthand below).

> Scope is **Wave 2, Track A (Folders) ONLY**. The Obsidian editor (Track B) and CLI folder-awareness (ATLAS F6) are **out of scope**. Every ATLAS anchor in this spec was re-read in source before speccing; corrections/confirmations are noted per item.

---

## 1. CLARIFY (skip-justified)

Intent is unambiguous and the owner has **locked the product decisions** (folders = real subdirs; empty folders supported; folder rail inside the Notes view; RouterController untouched). No blocking questions. The five delegated decisions (D-EMPTY, D-MOVE, D-NESTING, D-UI-NEWNOTE, plus filter/edit/path-sep micro-decisions) are resolved in §3 with firsthand evidence. CRYSTALIUM recall returned only the Wave-1 episodic crystal (`5216e65c`); the ATLAS Wave-2 crystal `0ca90347` did not surface, so all ATLAS anchors were verified directly in the tree.

| Axis | Value |
|---|---|
| WHO | Owner (product) → Vivi (executor). This spec is the handoff. |
| WHAT | Real on-disk note folders: create folders, create notes in folders, move notes between folders, list folders (incl. empty), filter the note list by folder via a folder rail inside the Notes view. |
| WHY | Apple-Notes-faithful organization. Wave 1 left the seams (recursive store, additive DTO/query); Wave 2A fills them. |
| CONSTRAINTS | Folders = real subdirs (`<root>/notes/<Folder>/.../<ULID>--<slug>.md`); root (`folder_path=""`) = default "Notes" folder; empty folders MUST appear; folder rail is intra-Notes state (no 6th view, `router.ts`/`RouterController` untouched); P0 export sovereignty gate is blocking; anti-shallow round-trip tests mandatory; frontend tests need Node ≥20; anchor every change at file:line. |

---

## 2. SCOPE

**In scope**
- **Store:** make `fs::list_note_paths` recursive; add `fs::list_note_folders` (empty-dir-aware subdir scan); add a folder-aware write helper; add `fs::folder_path_of` + `validate_folder_path`.
- **Index/migration:** bump `SCHEMA_VERSION` `wave1-v1`→`wave2-v1`; add `folder_path TEXT NOT NULL DEFAULT ''` to the `notes` table (CREATE + guarded idempotent ALTER); re-arm the existing version-gated one-time rebuild; derive `folder_path` at rebuild via `strip_prefix`.
- **Query/DTO:** `NoteRow.folder_path` + SELECTs; `NoteDto.folder_path`; folder filter on `list_notes`; `folder_counts` query; new `FolderDto`.
- **Ops:** `create_note` accepts a folder (mkdir); **`edit_note` folder-preservation fix**; `move_note`; `list_folders` (index UNION on-disk scan); `create_folder`.
- **Bridge:** Tauri commands `move_note` / `list_folders` / `create_folder` + folder args on `create_note` / `list_notes`; register in `lib.rs`; `invoke.ts` + `dto.ts`.
- **Frontend:** folder rail inside the Notes `<section>` (3-pane: folder rail │ list │ detail); selection → `NotesController.loadList({folder})`; create-note-in-selected-folder plumbing; new `#tmpl-folder-row`.
- **P0 export gate:** export walks `notes/` recursively, preserves each note's relative subpath in output + manifest, preserves empty dirs; fix the non-recursive `s8` test + add a foldered/empty-folder round-trip.
- **Tests:** anti-shallow Rust round-trips (create-in-folder→list, move→link-integrity, empty-folder→list_folders, export round-trip), migration safety, controller-driven frontend folder-rail test.

**Out of scope (this track)** — Obsidian live editor (Track B); CLI folder-awareness (ATLAS F6); folder **rename** and **delete** (deferred — D-MOVE); a folder tree-widget with expand/collapse (nesting is supported at the data layer; the v1 rail is a flat list — D-NESTING); moving tasks/events into subdirs (notes only).

**Deferred / seams** — folder rename/delete ops; folder tree UI; index-`file_path` lookup to replace the O(N) recursive `find_note_path` (F3).

**Assumptions (risk-if-wrong)**
- **A1:** The index is a fully derived, disposable artifact; canonical store = markdown files; `rebuild` wipes+repopulates (`rebuild.rs:19-30`). Risk-if-wrong: migration strategy invalid. **Confirmed.**
- **A2:** Edges/backlinks are rebuilt from **frontmatter ULIDs**, never from path (`rebuild.rs:162-179` build edges from `note.frontmatter.links[].target`; `:201-229` derive backlinks from edges). `folder_path` is **path-derived only** — `NoteFrontmatter` has no folder field (`model/note.rs:25-40`). Risk-if-wrong: a move would break links. **Confirmed — this is the link-integrity load-bearing fact.**
- **A3:** `NoteRow.file_path` (`query.rs:18`) is the real path written at rebuild (`rebuild.rs:51`, `path.to_string_lossy()`); `api::get_note` reads the body from it (`api.rs:35`). Risk-if-wrong: get_note errors after a move. **Confirmed; mitigated by F2 (move calls refresh).**
- **A4:** `find_note_path` (`fs.rs:100-109`) loops over `list_note_paths`, so making the latter recursive makes the former recursive too — required for edit/delete/get(ops)/infer_kind on foldered notes. **Confirmed.**

---

## 3. DECISIONS

### D-FOLDER-MODEL — folder = on-disk subdir, derived at rebuild; NOT in frontmatter. [LOCKED, reinforced]
`folder_path` is computed at rebuild from `path.strip_prefix(notes_dir).parent()` and stored only in the index column. `NoteFrontmatter` (`model/note.rs:25-40`) is **untouched**. **Consequence (good):** moving a note rewrites only its on-disk location; its frontmatter (id, links[], created/updated) is byte-identical, so ULID links/backlinks are trivially preserved when the index is rebuilt. **Rejected:** storing `folder`/`parent` in frontmatter — duplicates the path, risks divergence between the YAML and the real location, and would force a frontmatter migration. Rejected.

### D-NESTING — arbitrary nesting supported at the data layer; v1 rail is a flat list; exact-match filter. [DECIDED]
`strip_prefix(...).parent()` yields the full relative path (`Work`, `Work/Projects`) for free; the recursive scan + recursive export handle nesting at **zero extra code cost**. For v1 the folder rail renders the **flat set of distinct relative folder paths** (label = full relative path, e.g. `Work/Projects`); selecting a folder filters **exactly** that `folder_path` (Apple-Notes-faithful: a folder shows its own notes, subfolders are their own rail entries). A collapsible tree widget is a **polish seam**, not v1. **Justification:** nesting costs nothing to support and over-building a tree UI now is premature; exact-match filtering keeps the query and the rail trivial and correct.

### D-EMPTY — `list_folders` unions index folders with an on-disk recursive subdir scan; `FolderDto` carries a count. [DECIDED — load-bearing for empty folders]
`list_folders(root) -> Vec<FolderDto>` where:
```
FolderDto { path: String, name: String, note_count: usize }
```
- `path` = relative folder path; `""` = the root "Notes" folder.
- `name` = last path component, or `"Notes"` when `path == ""`.
- `note_count` = count of **non-deleted** notes with that exact `folder_path`.
- **Union:** `DISTINCT folder_path` from the index (via a new `query::folder_counts`) **UNION** the recursive on-disk subdir scan (`fs::list_note_folders`). The on-disk scan is what makes **empty folders appear** (they have no index rows). `""` is **always** present even with zero notes.
- **Empty folder dir that exists but holds no `.md`** → appears with `note_count: 0`.
- Deterministic order (collect into a `BTreeSet<String>`; `""`/Notes sorts first).

**Rejected:** index-only `SELECT DISTINCT folder_path` — would silently drop empty folders (the explicit Apple-Notes-faithful requirement). Rejected.

### D-MOVE — `move_note(root, id, dest_folder) -> NoteDto`; v1 = create + move + list; rename/delete deferred. [DECIDED]
Signature (core op): `notes::move_note(notes_dir: &Path, id: &str, dest_folder: &str) -> Result<Note>`. Reuses `edit_note`'s **write-new-then-remove-old** mechanic (`notes.rs:110-114`), folder-aware:
1. `let old_path = fs::find_note_path(notes_dir, id)?;` (now recursive — A1).
2. read note; reject if deleted.
3. `let new_path = fs::write_note_in(notes_dir, dest_folder, &note)?;` (mkdir_all + write).
4. `if new_path != old_path { std::fs::remove_file(&old_path)?; }`.
5. Command wrapper calls **`api::refresh`** (like every other mutation — `notes.rs` commands all refresh, `commands/notes.rs:60,77,84`). This closes F2.
- **Move does NOT mutate frontmatter** (no `updated` bump): a folder is a path, not content. This makes the link-integrity proof trivial and matches "rebuild edges from ULIDs." (If product later wants "modified on move," that's a one-line follow-up.)
- **Folder RENAME / DELETE are deferred.** Justification: rename = "move every note in folder A to folder B + move empty subdirs"; delete = "where do the notes go?" (trash vs reparent) — both are distinct UX decisions with their own destructive-action confirmations. v1 ships **create + move + list**, which is the minimum coherent folder feature, and rename/delete layer on top cleanly later (rename ≈ batched `move_note`; delete ≈ policy + `move_note` to `""`).

### D-UI-NEWNOTE — create-note-in-selected-folder plumbing end-to-end. [DECIDED — confirmed]
`create_note` gains a folder: core `notes::create_note(notes_dir, params)` writes via `fs::write_note_in(notes_dir, &folder, &note)` (mkdir_all). The Tauri `NoteInput` (`commands/notes.rs:16-23`) gains `#[serde(default)] folder: String`; `create_note_fn` (`:49-62`) passes it; `invoke.ts createNote` gains `folder?`. The controller passes the **currently-selected** folder. The create-response DTO carries the folder via `NoteDto::with_folder` (since `from_model` cannot infer a path; see D-DTO). **Confirmed end-to-end.** (Wiring a literal "new note" button into the Notes view is optional polish — the read-only Wave-1 Notes view has none today; the **plumbing** is the deliverable and is proven by the bridge test.)

### D-FILTER — folder filter is SQL-level exact-match; tags stay post-fetch. [DECIDED]
`api::list_notes(root, include_deleted, tag_filter, folder_filter: Option<&str>)` — additive optional param. Because `folder_path` is a **first-class column**, filter it in SQL (`WHERE folder_path = ?1`), unlike tags which are a JSON-array string filtered post-fetch in Rust (`query.rs:108-125`). **Justification:** cheaper, indexable, exact-match matches D-NESTING. Mirrors the *spirit* of the tag-filter seam (additive optional param) while using the right mechanism for a real column.

### D-EDIT-PRESERVE — `edit_note` must keep a foldered note in its folder on title-change. [DECIDED — fixes a latent bug]
**Firsthand finding (not in the ATLAS list):** `edit_note` (`notes.rs:74-123`) finds the note via `find_note_path` but, on a title change, writes via `fs::write_note(notes_dir, &note)` which **hardcodes the root `notes_dir`** (`fs.rs:63-69`) and then removes the old file — so editing the title of a foldered note would **silently relocate it to the root "Notes" folder.** `edit_note_fn` is already wired and registered (`commands/notes.rs:64-79`, `lib.rs:32`). Fix: in the title-change branch, derive the note's current folder from `old_path` via `fs::folder_path_of(notes_dir, &old_path)` and write via `fs::write_note_in(notes_dir, &folder, &note)`. Proven by VG-EDIT-PRESERVE.

### D-PATHSEP — store `folder_path` with `/` separators. [DECIDED]
`fs::folder_path_of` joins path components with `'/'` (not the OS separator) so `folder_path` is portable and stable across platforms (sovereignty: an exported tree must rebuild identically on any OS). Empty/root → `""`.

### D-VALIDATE — guard folder paths against traversal. [DECIDED]
`fs::validate_folder_path(folder: &str) -> Result<()>` rejects: absolute paths, any `..` component, empty components (e.g. `a//b`), and (recommended) leading/trailing slashes. Called by `create_folder`, `create_note(folder)`, and `move_note(dest)`. **Justification:** these strings flow from the GUI into `notes_dir.join(folder)`; without a guard, `../../etc` escapes the store (P1 security).

### D-MIGRATION — version bump + `folder_path` column + guarded ALTER + re-armed rebuild. [DECIDED — load-bearing, mirrors Wave-1 R1]
`schema::apply` uses only `CREATE TABLE IF NOT EXISTS` (`schema.rs:124`), so adding `folder_path` to the CREATE alone will **NOT** alter a pre-existing `index.sqlite` → `SELECT ... folder_path` crashes existing users. Required (exactly mirroring the Wave-1 excerpt migration at `schema.rs:127-131`):
1. Add `folder_path TEXT NOT NULL DEFAULT ''` to the `notes` CREATE TABLE (`schema.rs:19-29`).
2. Add a guarded idempotent `ALTER TABLE notes ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''` in `schema::apply`, gated on `!has_column(conn, "notes", "folder_path")` (`schema.rs:158-165`).
3. Bump `SCHEMA_VERSION` `"wave1-v1"` → `"wave2-v1"` (`schema.rs:8`) to **re-arm** the existing `version_gate_rebuild` (`init.rs:53-75`) so pre-existing flat notes get `folder_path` populated (= `""`) on first launch.
- **Existing flat notes are NOT moved**: they get `folder_path=""` and the recursive scan picks them up unchanged.

---

## 4. STORIES (ordered, with dependencies)

```
S1 (recursive store + folder helpers)
  ├─▶ S2 (P0 EXPORT sovereignty)            [must land WITH/BEFORE folders become user-creatable]
  └─▶ S4 (rebuild+index+DTO+filter) ── needs S3 (schema)
S3 (schema migration)  ─▶ S4
S4 ─▶ S5 (create folder-aware + edit-preserve + move)
   └─▶ S6 (list_folders + create_folder + FolderDto)
S5, S6 ─▶ S7 (Tauri bridge + invoke.ts + dto.ts) ─▶ S8 (folder-rail UI)
Kupo: K1 (migration-safety test) dep S3/S4 · K2 (folder-row template parity) dep S8 · K3 (dto drift) dep S7
```

**Build order:** S1 → S3 → S4 → S2 → S5 → S6 → S7 → S8, with K1 after S4, K2 after S8, K3 after S7. S2 (P0 export) is sequenced right after the recursion+schema land and **before** S5/S6 make folders user-creatable, so the sovereignty invariant holds the moment a foldered note can exist.

---

### STORY S1 — Recursive note store + folder helpers · P0 · ≤1.5d
**Depends on:** none. **Blocks:** S2, S4, S5, S6.

**As a** Jin maintainer, **I want** the note store to walk subdirectories and expose folder primitives, **so that** foldered notes are discoverable by every read/rebuild/find path.

**Action plan**
1. **Modify** `fs::list_note_paths` (`fs.rs:83-97`) to recurse into subdirectories (walk all nested dirs, collect `*.md`, keep the deterministic `sort()`). This automatically makes `fs::find_note_path` (`fs.rs:100-109`, loops over `list_note_paths`) recursive too — required for `edit_note`/`delete_note`/`ops::get_note`/`api::infer_kind` on foldered notes.
2. **Create** `fs::list_note_folders(notes_dir: &Path) -> Result<Vec<String>>`: recursively enumerate **every directory** under `notes/` (including empty ones), returning each as a `/`-joined relative path, plus `""` for the root. Empty-dir-aware (D-EMPTY).
3. **Create** `fs::folder_path_of(notes_dir: &Path, path: &Path) -> String`: `path.strip_prefix(notes_dir).ok().and_then(|p| p.parent())` → `/`-joined components, `""` for root (D-PATHSEP). Shared by rebuild (S4) and `edit_note` (S5).
4. **Create** `fs::write_note_in(notes_dir: &Path, folder: &str, note: &Note) -> Result<PathBuf>`: `create_dir_all(notes_dir.join(folder))`, then write `note_filename(id,title)` into it; `folder==""` ⇒ root. **Refactor** `fs::write_note` (`fs.rs:63-69`) to delegate to `write_note_in(notes_dir, "", note)` (zero behavior change for existing callers).
5. **Create** `fs::validate_folder_path(folder: &str) -> Result<()>` (D-VALIDATE): reject absolute, `..`, and empty components.

**Files/anchors:** `jin-core/src/store/fs.rs:58-69,83-97,100-109` (+ new fns)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S1.1 GIVEN** `notes/A/<ulid>--x.md` and `notes/<ulid>--y.md`, **WHEN** `list_note_paths(notes_dir)` runs, **THEN** both paths are returned (recursion proven).
- **AC-S1.2 GIVEN** a note physically at `notes/A/<id>--x.md`, **WHEN** `find_note_path(notes_dir, id)` runs, **THEN** it returns that subdir path (not NotFound).
- **AC-S1.3 GIVEN** `notes/Empty/` (no `.md`) and `notes/Work/Projects/`, **WHEN** `list_note_folders` runs, **THEN** the result contains `""`, `"Empty"`, `"Work"`, `"Work/Projects"`.
- **AC-S1.4 GIVEN** `write_note_in(notes_dir, "Work", note)`, **WHEN** it runs, **THEN** the file exists at `notes/Work/<id>--<slug>.md` and `notes/Work/` was created.
- **AC-S1.5 GIVEN** `validate_folder_path`, **WHEN** called with `"../x"`, `"/abs"`, or `"a//b"`, **THEN** each returns `Err`; `"Work/Projects"` returns `Ok`.

**Validation gates** — VG-A1, VG-VALIDATE. **Risk:** P0 (load-bearing for all foldered reads). F3 (recursive `find_note_path` is O(N) at scale) — accepted for v1, flagged §7.

---

### STORY S2 — P0 Export sovereignty: recursive notes export + empty dirs + tests · **P0 (blocking)** · ≤1.5d
**Depends on:** S1. **Blocks:** (must precede folders becoming user-creatable — S5/S6).

**As a** Jin user, **I want** export to include every foldered note and preserve my folder tree (incl. empty folders), **so that** a backup never silently drops data (sovereignty).

**Root cause (confirmed firsthand):** `ops::export::export` (`export.rs:62-91`) does a **non-recursive** `read_dir` per subdir and hardcodes the manifest path `format!("{}/{}", subdir, entry.file_name())` (`export.rs:81`). Foldered notes would be **silently dropped** from the copy AND the manifest. Worse, `s8_export_sovereignty.rs` iterates the source non-recursively in both the byte-identical check (`:202-234`, esp. `:205`) and the round-trip copy (`:339-351`), so the current tests **cannot catch** the drop.

**Action plan**
1. **Modify** `export` so the **`notes/`** subtree is walked **recursively** (reuse `fs::list_note_folders` + `fs::list_note_paths`, or an inline recursive walk): for each `.md` under `notes/…`, compute its relative subpath, `create_dir_all` the destination parent, copy, and push the **relative** manifest entry `notes/<rel/subpath>.md` (not just `notes/<file>`). `tasks/`/`events/` stay flat (out of scope). Keep deterministic ordering.
2. **Preserve empty dirs:** for every folder from `fs::list_note_folders(notes/)`, `create_dir_all(dest/notes/<folder>)` even when it has no `.md`.
3. **Keep** the `.jin/sync/audit.jsonl` include + the secrets/derived-cache exclusions unchanged (`export.rs:93-104`; the `s8_secrets_and_derived_caches_excluded` test must stay green).
4. **Fix the tests** (`s8_export_sovereignty.rs`): make the byte-identical walk (`:202-234`) and the round-trip copy (`:339-351`) **recursive** over `notes/`. **Add** a new test: seed a foldered note (`notes/Work/…`) + an empty folder (`notes/Empty/`), export, assert (a) the foldered note exists at `dest/notes/Work/…` and is byte-identical, (b) the manifest `files` contains `notes/Work/…`, (c) `dest/notes/Empty/` exists, (d) re-`init` a fresh root from the export, `api::refresh`, and `list_notes(folder="Work")` returns the note with `folder_path="Work"`.

**Files/anchors:** `jin-core/src/ops/export.rs:44-113` (esp. `:62-91`, `:81`) · `jin/tests/s8_export_sovereignty.rs:202-234,339-351` (+ new test) · uses `jin-core/src/store/fs.rs` helpers from S1

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S2.1 GIVEN** a note at `notes/Work/<id>--x.md`, **WHEN** `export(root, dest, false)` runs, **THEN** `dest/notes/Work/<id>--x.md` exists, is byte-identical, and `summary.files` contains `"notes/Work/<id>--x.md"`.
- **AC-S2.2 GIVEN** an empty `notes/Empty/`, **WHEN** export runs, **THEN** `dest/notes/Empty/` exists (empty dir preserved).
- **AC-S2.3 GIVEN** the exported tree copied into a fresh `init`'d root + `api::refresh`, **WHEN** `list_notes(folder="Work")` runs, **THEN** the foldered note is returned with `folder_path="Work"` (round-trip).
- **AC-S2.4 (regression)** secrets/derived caches still excluded; `audit.jsonl` still included (`s8_secrets_and_derived_caches_excluded` green).

**Validation gates** — VG-EXPORT (P0). **Risk:** **F1, P0** — this is the blocking sovereignty gate; it must land with/before S1's recursion makes foldered notes possible to create.

---

### STORY S3 — Schema migration: `folder_path` column + version bump + guarded ALTER · P0 · ≤1d
**Depends on:** none (parallel to S1). **Blocks:** S4, K1.

**As an** existing Jin user, **I want** my pre-existing `index.sqlite` to gain the folder column without crashing, **so that** the upgrade is seamless.

**Action plan (per D-MIGRATION)**
1. **Modify** the `notes` CREATE TABLE (`schema.rs:19-29`): add `folder_path TEXT NOT NULL DEFAULT ''`.
2. **Modify** `schema::apply` (`schema.rs:123-133`): add a second guarded ALTER mirroring the excerpt guard — `if !has_column(conn, "notes", "folder_path")? { ALTER TABLE notes ADD COLUMN folder_path TEXT NOT NULL DEFAULT '' }`.
3. **Modify** `SCHEMA_VERSION` (`schema.rs:8`): `"wave1-v1"` → `"wave2-v1"` (re-arms `version_gate_rebuild`, `init.rs:53-75`).
4. (No new scaffolding — `is_current_version`/`set_version`/`has_column` already exist, `schema.rs:137-165`.)

**Files/anchors:** `jin-core/src/index/schema.rs:8,19-29,123-133,158-165` · `jin-core/src/ops/init.rs:53-75`

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S3.1 GIVEN** a `wave1-v1` index (has `excerpt`, no `folder_path`), **WHEN** `schema::apply` runs, **THEN** no error and `PRAGMA table_info(notes)` shows `folder_path`.
- **AC-S3.2 GIVEN** `schema::apply` applied twice, **WHEN** re-applied, **THEN** idempotent (no duplicate-column error).
- **AC-S3.3 GIVEN** an index at `wave1-v1`, **WHEN** `ops::init` runs, **THEN** `is_current_version` was false → `version_gate_rebuild` ran a one-time `refresh` and set the sentinel to `wave2-v1`.

**Validation gates** — VG-MIG (extends the existing `vg2_3_*` style at `schema.rs:184-257`). **Risk:** **P0** — omitting the guarded ALTER crashes existing users (Wave-1 R1 class). Mitigated.

---

### STORY S4 — Rebuild derives `folder_path` + index/DTO/filter plumbing · P1 · ≤2d
**Depends on:** S1 (recursive paths + `folder_path_of`), S3 (column). **Blocks:** S5, S6.

**As a** Jin user, **I want** each note's folder to flow from disk → index → DTO and to be filterable, **so that** the folder rail can scope the list.

**Action plan**
1. **Modify** rebuild note-insert (`rebuild.rs:33-57`): compute `folder_path = fs::folder_path_of(&notes_dir, path)` and write it into the new column (extend the INSERT column list + `params!`). `notes_dir` is already in scope (`rebuild.rs:15`).
2. **Extend** `NoteRow` (`query.rs:10-20`): add `pub(crate) folder_path: String`.
3. **Modify** every `notes` SELECT + row-mapper to include `folder_path`: base `list_notes` (`query.rs:79-102`) and `get_note` (`query.rs:127-146`).
4. **Add** folder filter (D-FILTER): extend `api::list_notes` (`api.rs:14-24`) signature with `folder_filter: Option<&str>`; push a SQL `WHERE folder_path = ?1` predicate into the base `list_notes` query when `Some` (combine with the existing `status != 'deleted'`). Keep `list_notes_by_tag` (`query.rs:108-125`) post-fetch for tags.
5. **Add** `query::folder_counts(conn) -> SqlResult<Vec<(String, usize)>>`: `SELECT folder_path, COUNT(*) FROM notes WHERE status != 'deleted' GROUP BY folder_path`. (Used by S6.)
6. **Extend** `NoteDto` (`note.rs:8-26`): add `pub folder_path: Option<String>`. `from_row` (`note.rs:72-87`) → `Some(row.folder_path.clone())`; `from_model` (`note.rs:45-69`) → `None`; add `pub(crate) fn with_folder(mut self, f: String) -> Self` mirroring `with_body` (`note.rs:90-93`). `api::get_note` (`api.rs:37-39`) already routes through `from_row` so detail carries `folder_path` automatically.

**Files/anchors:** `jin-core/src/index/rebuild.rs:15,33-57` · `jin-core/src/index/query.rs:10-20,79-102,108-125,127-146` (+ `folder_counts`) · `jin-core/src/ops/api.rs:14-24` · `jin-core/src/dto/note.rs:8-26,45-69,72-93`

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S4.1 GIVEN** a note at `notes/Work/Projects/<id>--x.md` and `api::refresh`, **WHEN** the row is read, **THEN** `NoteRow.folder_path == "Work/Projects"`.
- **AC-S4.2 GIVEN** a root note, **WHEN** refreshed, **THEN** its `folder_path == ""`.
- **AC-S4.3 GIVEN** notes in `"Work"` and `""`, **WHEN** `api::list_notes(root, false, None, Some("Work"))`, **THEN** only the `"Work"` note(s) return.
- **AC-S4.4 GIVEN** `from_row(row)`, **WHEN** projected, **THEN** `folder_path == Some(row.folder_path)`; `from_model` → `None`; `with_folder("X")` → `Some("X")`.
- **AC-S4.5 GIVEN** `api::get_note(id)` for a foldered note, **WHEN** called, **THEN** `NoteDto.folder_path == Some("Work")` and `body_markdown` is still read from disk.

**Validation gates** — VG-REBUILD, VG-LIST-FILTER, VG-DTO (unit). **Risk:** P1. Signature change to `api::list_notes` ripples to `commands/notes.rs:42` and tests — additive, surface it.

---

### STORY S5 — `create_note(folder)` + `edit_note` folder-preserve fix + `move_note` · P1 · ≤2d
**Depends on:** S1, S4. **Blocks:** S7.

**As a** Jin user, **I want** to create a note in a folder, move a note between folders without breaking its links, and edit a foldered note without it jumping to the root, **so that** organization is safe.

**Action plan**
1. **Modify** `notes::create_note` (`notes.rs:27-47`): accept a folder (add `pub folder: String` to `CreateNoteParams`, `notes.rs:9-13`), validate via `fs::validate_folder_path`, and write via `fs::write_note_in(notes_dir, &params.folder, &note)` instead of `fs::write_note` (A7, D-UI-NEWNOTE).
2. **Fix** `edit_note` (`notes.rs:110-114`, D-EDIT-PRESERVE): in the title-change branch, derive `folder = fs::folder_path_of(notes_dir, &old_path)` and write via `fs::write_note_in(notes_dir, &folder, &note)`, then remove `old_path`. (The same-title branch at `:115-118` overwrites in place — already folder-safe.)
3. **Create** `notes::move_note(notes_dir, id, dest_folder) -> Result<Note>` (A8, D-MOVE): validate `dest_folder`; `find_note_path`; read; reject deleted; `write_note_in(notes_dir, dest_folder, &note)`; remove old if path differs; **do not** mutate frontmatter. Return the note.

**Files/anchors:** `jin-core/src/ops/notes.rs:9-13,27-47,74-123` (+ new `move_note`) · `jin-core/src/store/fs.rs` (S1 helpers)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S5.1 GIVEN** `create_note(folder="Work")`, **WHEN** it runs, **THEN** the file exists under `notes/Work/` and (after refresh) `list_notes(folder="Work")` returns it.
- **AC-S5.2 GIVEN** a note at `notes/Work/<id>--old.md` with a backlink from another object, **WHEN** `move_note(id, "Archive")` + `api::refresh`, **THEN** the file is at `notes/Archive/<id>--old.md`, `notes/Work/<id>--old.md` is gone, `get_note(id)` returns the body, **AND** the pre-existing backlink still resolves (link-integrity).
- **AC-S5.3 GIVEN** a note at `notes/Work/<id>--old.md`, **WHEN** `edit_note(id, title="New")`, **THEN** the file is at `notes/Work/<id>--new.md` (folder preserved, NOT root).
- **AC-S5.4 GIVEN** `move_note` with `dest_folder="../escape"`, **WHEN** called, **THEN** it returns `Err` (validation).

**Validation gates** — VG-MOVE (anti-shallow, link-integrity), VG-EDIT-PRESERVE, VG-VALIDATE. **Risk:** F2 (stale `file_path`) — mitigated by the command wrapper calling `api::refresh` in S7; F-EDIT (P1) — fixed here.

---

### STORY S6 — `list_folders` (index UNION on-disk scan) + `create_folder` + `FolderDto` · P1 · ≤1.5d
**Depends on:** S1, S4. **Blocks:** S7.

**As a** Jin user, **I want** to create an empty folder and see all folders (incl. empty) with note counts, **so that** the rail reflects my organization like Apple Notes.

**Action plan (per D-EMPTY)**
1. **Create** `jin-core/src/dto/folder.rs`: `FolderDto { path: String, name: String, note_count: usize }`; export via `dto/mod.rs` (`pub mod folder; pub use folder::FolderDto;`).
2. **Create** `api::list_folders(root) -> Result<Vec<FolderDto>>`: open index → `query::folder_counts` (index side, S4) → `fs::list_note_folders(notes_dir)` (disk side, S1) → union keys into a `BTreeSet<String>` always including `""` → build `FolderDto` per key (`name` = last component or `"Notes"` for `""`; `note_count` from the counts map, default 0). Deterministic order.
3. **Create** `api::create_folder(root, folder_path) -> Result<FolderDto>`: `validate_folder_path` (reject empty here — root always exists); `std::fs::create_dir_all(notes_dir.join(folder_path))`; return `FolderDto { path, name, note_count: 0 }`. (No index write needed; the dir is enough — `list_folders`'s disk scan surfaces it.)

**Files/anchors:** `jin-core/src/dto/folder.rs` (new) · `jin-core/src/dto/mod.rs:7-16,18-23` · `jin-core/src/ops/api.rs` (new `list_folders`/`create_folder`) · `jin-core/src/index/query.rs` (`folder_counts` from S4) · `jin-core/src/store/fs.rs` (`list_note_folders` from S1)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S6.1 GIVEN** `create_folder("Empty")`, **WHEN** then `list_folders` runs, **THEN** the result contains `{path:"Empty", name:"Empty", note_count:0}`.
- **AC-S6.2 GIVEN** 2 notes in `"Work"` and 1 in `""`, **WHEN** `list_folders` runs, **THEN** it returns `{path:"", name:"Notes", note_count:1}` and `{path:"Work", name:"Work", note_count:2}`.
- **AC-S6.3 GIVEN** a store with zero notes and zero subdirs, **WHEN** `list_folders` runs, **THEN** it still returns `{path:"", name:"Notes", note_count:0}` (root always present).
- **AC-S6.4 GIVEN** `create_folder("../x")`, **WHEN** called, **THEN** `Err`.

**Validation gates** — VG-FOLDERS-EMPTY (anti-shallow). **Risk:** P1.

---

### STORY S7 — Tauri bridge: commands + folder args + invoke.ts + dto.ts · P1 · ≤1.5d
**Depends on:** S5, S6. **Blocks:** S8, K3.

**As a** frontend, **I want** typed commands for folders and folder-aware note ops, **so that** the rail can call them.

**Action plan**
1. **Modify** `commands/notes.rs`: `NoteInput` (`:16-23`) gains `#[serde(default)] folder: String`; `create_note_fn` (`:49-62`) passes it to `CreateNoteParams` and returns `NoteDto::from_model(&note).with_folder(input.folder)`. `list_notes_fn` (`:37-43`) + the `list_notes` command (`:91-97`) gain `folder: Option<String>` passed to `api::list_notes(..., folder.as_deref())`. **Add** `move_note_fn(root, id, folder)` → `notes::move_note` + `api::refresh` + return DTO `.with_folder(folder)`, and the `#[tauri::command] move_note` wrapper.
2. **Create** `commands/folders.rs` (or extend notes): `list_folders_fn(root) -> Vec<FolderDto>`, `create_folder_fn(root, path) -> FolderDto`, + `#[tauri::command]` wrappers; add `pub mod folders;` to `commands/mod.rs:16-27` (if new file).
3. **Register** in `lib.rs` `invoke_handler!` (`lib.rs:25-63`): `commands::notes::move_note`, `commands::folders::list_folders`, `commands::folders::create_folder`.
4. **Modify** `invoke.ts` (`:35-71`): `listNotes({folder?})`, `createNote({folder?})`, new `moveNote(id, folder)`, `listFolders()`, `createFolder(path)`.
5. **Modify** `types/dto.ts`: `NoteDto` (`:29-52`) gains `folder_path?: string | null`; add `FolderDto { path: string; name: string; note_count: number }`.

**Files/anchors:** `jin-gui/src-tauri/src/commands/notes.rs:16-23,37-43,49-62,91-97` (+ move) · `jin-gui/src-tauri/src/commands/folders.rs` (new) · `jin-gui/src-tauri/src/commands/mod.rs:16-27` · `jin-gui/src-tauri/src/lib.rs:25-63` · `jin-gui/src/invoke.ts:35-71` · `jin-gui/src/types/dto.ts:29-52`

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S7.1 GIVEN** `create_note_fn(root, {title, folder:"Work"})` + `list_notes_fn(root, false, None, Some("Work"))`, **WHEN** called, **THEN** the created note is returned with `folder_path=="Work"` (full bridge round-trip).
- **AC-S7.2 GIVEN** a note + a backlink to it, **WHEN** `move_note_fn(root, id, "X")`, **THEN** the file is under `notes/X/`, `get_note_fn(id)` returns the body, and the backlink resolves (bridge-level link-integrity).
- **AC-S7.3 GIVEN** `create_folder_fn(root, "Empty")`, **WHEN** then `list_folders_fn(root)`, **THEN** `"Empty"` appears with `note_count==0`.
- **AC-S7.4 GIVEN** the registered handler set, **WHEN** the app builds, **THEN** `move_note`/`list_folders`/`create_folder` are invocable (no `generate_handler!` omission).

**Validation gates** — VG-MOVE, VG-LIST-FILTER, VG-FOLDERS-EMPTY (all at the bridge `*_fn` level), VG-DTO-DRIFT (K3). **Risk:** P1.

---

### STORY S8 — Folder rail inside the Notes view (3-pane) + selection → `loadList({folder})` · P1 · ≤2.5d
**Depends on:** S7. **Blocks:** K2.

**As a** Jin user, **I want** a folder rail inside the Notes view that scopes the list and lets me create folders and create notes in the selected folder, **so that** notes feel like Apple Notes — without changing global navigation.

**Action plan**
1. **Modify** `index.html` Notes `<section>` (`index.html:289-363`): add a **folder-rail pane** as the first column **inside** the existing `data-controller="notes"` section (3-pane: folder rail │ `listPanel` │ `detailPanel`). New targets: `data-notes-target="folderRail"` (container) and `data-notes-target="folderList"` (`<ul>`). Add a "New Folder" control (`data-action="click->notes#newFolder"`) and (optionally) a "New Note" control (`data-action="click->notes#newNote"`). **Do NOT** add a `data-router-target="section"` or a new `data-section-name` — the rail is intra-Notes (locked).
2. **Add** a `#tmpl-folder-row` template near `#tmpl-note-row` (`index.html:1268-1283`): a button with `.folder-row__name`, `.folder-row__count`, `data-folder-path`, and `data-action="click->notes#selectFolder"`.
3. **Modify** `NotesController` (`notes_controller.ts`): add `folderRailTarget`/`folderListTarget`; track `currentFolder = ""`; add `loadFolders()` (calls `listFolders()` → renders rail, highlights active); `selectFolder(event)` reads `data-folder-path` → set `currentFolder` → `loadList({folder})` + re-highlight; `newFolder()` prompts → `createFolder(path)` → `loadFolders()`; (optional) `newNote()` → `createNote({title, folder: currentFolder})` → `loadList({folder})`. `connect()` (`:71-73`) calls `loadFolders()` then `loadList({folder:""})`.
4. **Modify** `loadList` (`notes_controller.ts:81-110`): pass `folder` to `listNotes({tag, folder})` and into `filterNotesList`.
5. **Modify** `lib/notes/transform.ts`: `NotesFilter` (`:14-17`) gains `folder?: string`; `filterNotesList` (`:23-29`) optionally narrows by `folder` (defense-in-depth; the backend already exact-filters).
6. **Create** rail rendering in `lib/notes/render.ts`: `renderFolderRail(el, templates, folders, activePath, onSelect)` cloning `#tmpl-folder-row` (textContent only — XSS-safe, same discipline as `buildNoteRow` at `render.ts:264-270`).
7. **Add** CSS for the 3-pane layout + rail/active state (`styles/browse.css`), scoped so Tasks/Events views are unaffected.

**Files/anchors:** `jin-gui/index.html:289-363,1268-1283` · `jin-gui/src/controllers/notes_controller.ts:34-44,71-73,81-110` · `jin-gui/src/lib/notes/transform.ts:14-17,23-29` · `jin-gui/src/lib/notes/render.ts` (new `renderFolderRail`) · `jin-gui/src/invoke.ts` (S7) · `jin-gui/src/styles/browse.css` · **untouched:** `jin-gui/src/lib/router.ts:13`, `jin-gui/src/controllers/router_controller.ts`

**Acceptance — GIVEN/WHEN/THEN**
- **AC-S8.1 GIVEN** the Notes view connects, **WHEN** `loadFolders` resolves with `[{path:"",name:"Notes",..},{path:"Work",..}]`, **THEN** the rail shows both rows with counts.
- **AC-S8.2 GIVEN** the rail rendered, **WHEN** the user clicks the `"Work"` row, **THEN** `listNotes` is called with `{folder:"Work"}` and the list re-renders with the returned notes (controller-driven, real Stimulus Application — NOT a hand-fed render).
- **AC-S8.3 GIVEN** folder `"Work"` is selected, **WHEN** `newNote()`/create fires, **THEN** `createNote` is called with `folder:"Work"`.
- **AC-S8.4 GIVEN** `createFolder` resolves, **WHEN** `newFolder()` runs, **THEN** the rail reloads and includes the new (empty) folder.
- **AC-S8.5 (regression)** `router.ts` `ViewKind` is still `'today'|'notes'|'tasks'|'events'|'settings'` (no 6th view); `RouterController` is unmodified; existing notes list/detail tests stay green.

**Validation gates** — VG-FE (anti-shallow, controller-driven), VG-FE-TMPL (K2), VG-ROUTER-UNTOUCHED. **Frontend tests require Node ≥20** (system default node is v16 → vitest crashes). **Risk:** P1; R2-class template/fixture divergence (K2 guards it).

---

### Kupo micro-tasks

- **K1 — Migration-safety + folder-populate test** (≤0.5d, dep S3/S4). Mirror the Wave-1 K1 test (`init.rs:115-181`): a `wave1-v1` index (excerpt, no `folder_path`) opens, ALTERs, and `list_notes` succeeds; after one `init` cycle the version-gated rebuild sets `wave2-v1` and pre-existing notes have `folder_path=""`. **Gate VG-MIG.**
- **K2 — `#tmpl-folder-row` parity guard** (≤0.25d, dep S8). Parse production `index.html`'s `#tmpl-folder-row` and assert it carries `.folder-row__name`, `.folder-row__count`, `data-folder-path` (and the test fixture matches in lock-step). Prevents the known green-but-shallow template-divergence trap. **Gate VG-FE-TMPL.**
- **K3 — DTO drift test** (≤0.25d, dep S7). Extend `dto_shapes.test.ts:143-223` `NoteDto` block for `folder_path` and add a `FolderDto` shape block, so silent Rust↔TS drift is caught. **Gate VG-DTO-DRIFT.**

---

## 5. VALIDATION GATES

Anti-shallow mandate (owner): **real round-trips, never hand-fed DTOs or core-only happy paths.** VG-EXPORT, VG-MOVE, VG-LIST-FILTER, VG-FOLDERS-EMPTY, VG-FE are the load-bearing anti-shallow gates.

| Gate | Story | Type | Assertion | Where |
|---|---|---|---|---|
| **VG-A1** | S1 | Rust unit | recursive `list_note_paths` returns a `notes/A/x.md`; `find_note_path` finds a foldered note | `jin-core/src/store/fs.rs` tests |
| **VG-VALIDATE** | S1/S5/S6 | Rust unit | `validate_folder_path` rejects `..`/absolute/empty; accepts `Work/Projects` | `fs.rs` tests |
| **VG-EXPORT** | S2 | Rust integ (P0, anti-shallow) | export reproduces a foldered note (copy + manifest `notes/Work/…`) AND an empty `notes/Empty/`; fresh-root round-trip lists it with `folder_path="Work"`; secrets still excluded | `jin/tests/s8_export_sovereignty.rs` (recursive fix `:202-234,:339-351` + new test) |
| **VG-MIG** | S3/K1 | Rust integ (migration) | `wave1-v1` index → `apply` adds `folder_path` (idempotent); version-gated rebuild populates `folder_path` for pre-existing notes; sentinel → `wave2-v1` | `jin-core` schema/init tests (mirror `schema.rs:184-257`, `init.rs:115-181`) |
| **VG-REBUILD** | S4 | Rust integ | note at `notes/Work/Projects/x.md` → `folder_path="Work/Projects"` after refresh; root note → `""` | `jin-core` rebuild/index test |
| **VG-LIST-FILTER** | S4/S7 | Rust integ (anti-shallow) | create note in `"X"` → `list_notes(folder="X")` returns it with `folder_path="X"`; `folder=""` excludes it | `jin-gui/src-tauri/tests/bridge.rs` |
| **VG-MOVE** | S5/S7 | Rust integ (anti-shallow, **link-integrity**) | pre-existing backlink → `move_note(id,"X")` → file under `notes/X/` AND `get_note` returns body AND backlink resolves | `bridge.rs` (new) |
| **VG-EDIT-PRESERVE** | S5 | Rust integ | title-edit a foldered note → file stays under `notes/X/` (not root) | `jin-core` notes test or `bridge.rs` |
| **VG-FOLDERS-EMPTY** | S6/S7 | Rust integ (anti-shallow) | `create_folder("Empty")` → `list_folders` includes `{path:"Empty",note_count:0}`; `""`/Notes always present | `bridge.rs` (new) |
| **VG-DTO** | S4 | Rust unit | `from_row`→`Some`; `from_model`→`None`; `with_folder`→`Some` | `dto/note.rs` tests |
| **VG-FE** | S8 | Frontend (anti-shallow, controller-driven) | real Stimulus `Application`; mock `listFolders`/`listNotes`; click `"Work"` rail row → `listNotes` called `{folder:"Work"}` AND list updates | `notes_controller.test.ts` (new describe) |
| **VG-FE-TMPL** | S8/K2 | Frontend | production `#tmpl-folder-row` carries `.folder-row__name`/`.folder-row__count`/`data-folder-path` | new test parsing `index.html` |
| **VG-DTO-DRIFT** | S7/K3 | Frontend drift | `dto_shapes` asserts `NoteDto.folder_path` + `FolderDto` shape | `dto_shapes.test.ts:143-223` |
| **VG-ROUTER-UNTOUCHED** | S8 | Structural | `router.ts` `ViewKind` unchanged (5 kinds); `RouterController` unmodified; no new `data-section-name` | `router.test.ts` / diff review |

**Project-level command gates (all must pass):** `cargo test -p jin-core` · `cargo test` (jin-gui bridge) · `cargo clippy --all-targets -- -D warnings` · `npm test` (vitest, **Node ≥20**) · TS typecheck/build. No `#[ignore]`, no `it.skip` on the gates above.

---

## 6. EXPLORE — selected approach + rejected alternatives

**Selected:** ADAPT the Wave-1 column-add pattern + the ATLAS A1-A15 decomposition (verified firsthand). Folder is a path-derived index column; recursion is isolated to `fs.rs`; migration reuses the existing version-gate machinery; the rail is intra-Notes Stimulus state. This maximizes pattern-fit and minimizes blast radius (RouterController/router.ts untouched).

**Rejected alternatives (prevents re-exploration):**
- **Folder in frontmatter** (`folder:` YAML field) — duplicates the canonical path, risks YAML↔disk divergence, forces a frontmatter migration, and complicates the link-integrity story. Rejected for D-FOLDER-MODEL.
- **Index-only `list_folders`** (`SELECT DISTINCT folder_path`) — silently drops empty folders (the explicit Apple-Notes-faithful requirement). Rejected for D-EMPTY (union with disk scan).
- **Post-fetch folder filter** (mirror tags exactly) — works, but `folder_path` is a real column; SQL exact-match is cheaper and indexable. Rejected for D-FILTER (SQL).
- **`move_note` via index `file_path` lookup** (instead of recursive `find_note_path`) — would avoid the F3 O(N) scan, but couples move to index freshness and mixes two location-resolution mechanisms. Deferred (F3 is a v1-acceptable scale concern).
- **A 6th router view / `ViewKind='folders'`** — explicitly forbidden by the owner; folders are intra-Notes. Rejected.
- **Folder tree widget (expand/collapse) in v1** — over-build; flat rail of relative paths covers nesting at the data layer. Deferred (D-NESTING).
- **Bumping `updated` on move** — a folder is a path, not content; not bumping keeps the link-integrity proof trivial. Deferred as a product call.

---

## 7. RISK FLAGS

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| **F1** | Export does a non-recursive `read_dir` + hardcodes `notes/<file>` manifest (`export.rs:62-91,81`) → foldered notes **silently dropped** from backups; current `s8` tests iterate non-recursively (`:205,:339-351`) so they can't catch it. | **P0** | S2: recursive notes export + relative subpath in copy & manifest + empty-dir preservation + recursive `s8` fix + new foldered/empty round-trip (VG-EXPORT). Lands with/before folders become user-creatable. |
| **R-MIG** | `CREATE TABLE IF NOT EXISTS` won't add `folder_path` → `no such column` crash on pre-existing `index.sqlite`. | **P0** | S3: guarded idempotent ALTER + `SCHEMA_VERSION` bump + re-armed version-gate rebuild (VG-MIG). Mirrors Wave-1 R1. |
| **F-EDIT** | `edit_note` title-change writes via `fs::write_note` (root-hardcoded, `fs.rs:63-69`) → editing a foldered note's title **relocates it to root** (`edit_note_fn` already wired, `commands/notes.rs:64-79`). | **P1** | S5 step 2: preserve folder via `folder_path_of` + `write_note_in` (VG-EDIT-PRESERVE). |
| **F2** | A `move_note` not followed by `refresh` leaves `NoteRow.file_path` stale → `get_note` errors (Wave-1 R5 window). | **P1** | Move's command wrapper calls `api::refresh` like every mutation (S7); VG-MOVE proves get_note + backlink post-move. |
| **R-VALIDATE** | Folder strings flow GUI→`notes_dir.join(folder)`; `../../` could escape the store. | **P1** | `validate_folder_path` on create_folder / create_note(folder) / move_note(dest) (VG-VALIDATE). |
| **R-PATHSEP** | OS-native separators would make `folder_path` non-portable (sovereignty: export must rebuild identically cross-OS). | **P1** | `folder_path_of` joins components with `/` (D-PATHSEP). |
| **R-SHALLOW** | This repo has repeatedly shipped green-but-shallow tests (incl. Wave 1). | **P1** | Anti-shallow gates VG-EXPORT/VG-MOVE/VG-LIST-FILTER/VG-FOLDERS-EMPTY/VG-FE are mandatory round-trips, not hand-fed DTOs. |
| **R-NODE** | vitest crashes on Node 16 (system default). | **P1** | Frontend gates require **Node ≥20** — note in CI/run instructions. |
| **F3** | Recursive `find_note_path` scans all subdirs/files (O(N)) for edit/delete/move/infer_kind. | **P2** | Accepted for v1 (note counts small). Future: resolve location via index `file_path` by id. |
| **R-DTO** | Silent Rust↔TS `NoteDto`/`FolderDto` drift. | **P2** | K3 `dto_shapes` extension (VG-DTO-DRIFT). |

---

## 8. CONFIDENCE REPORT

| Factor (25%) | Score | Note |
|---|---|---|
| Pattern match | 0.90 | ADAPT of the verified Wave-1 column-add + migration machinery; ATLAS A1-A15 confirmed firsthand at every anchor. |
| Requirement clarity | 0.90 | Owner locked the product decisions; all delegated decisions resolved with evidence. |
| Decomposition stability | 0.85 | 3 decompositions (by layer / by concern / by ATLAS A#) converge on the same files + the same store→index→ops→bridge→UI spine (≥70%). |
| Constraint compliance | 0.88 | P0 export gate, migration, anti-shallow gates, RouterController/router.ts untouched, Node-≥20 note, path-traversal guard all specified. |
| **Overall** | **0.88** | **AUTO_PROCEED.** Residual risk = frontend 3-pane CSS/UX polish (owner-verified visually) + F3 scale (deferred). |

**Recommended build order:** S1 → S3 → S4 → **S2 (P0)** → S5 → S6 → S7 → S8, with K1 after S4, K3 after S7, K2 after S8. Start with S1 (unblocks everything) and land S2 before any folder becomes user-creatable.
