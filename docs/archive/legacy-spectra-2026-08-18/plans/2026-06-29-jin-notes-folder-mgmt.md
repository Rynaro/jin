# Jin Notes — Folder Management (rename / delete-to-parent / drag-note-into-folder)

- **Spec ID:** `2026-06-29-jin-notes-folder-mgmt`
- **Author:** SPECTRA → hand-off to **Vivi** (apivr / Builder)
- **Intent type:** CHANGE (extend the shipped Wave-2 folder tree with mutating folder ops)
- **Base:** `main` = v0.5.0 (full Notes rebuild + folder tree-view sidebar + new-note / editable-title). **Branch off `main`.**
- **Complexity:** 9/12 — full-stack (Rust core + Tauri + TS/Stimulus), data-touching (moving/deleting note files), anti-shallow round-trip mandate. → extended reasoning applied.
- **Confidence:** 90% — AUTO_PROCEED.
- **ECL:** no `ECL_VERSION` in install root → no envelope sidecar emitted (correct).
- **Memory:** CRYSTALIUM recall ran. Recurring Jin fact confirmed firsthand — Wave-2 episodic crystals do **not** surface on `jin` scope; all anchors below were read directly from source, not trusted from memory.

---

## 1. Scope

### In scope
1. **Backend `rename_folder`** (jin-core) — move every note under `old_path` (incl. nested subfolders) so its prefix becomes `new_path`, via the `move_note` write-new/remove-old mechanic; recreate empty descendant subdirs under the new prefix; remove the emptied old dir tree. Validate, refuse root, refuse collision, refuse renaming into own descendant. Links survive (ULID-based).
2. **Backend `delete_folder` (MOVE-TO-PARENT, non-destructive)** (jin-core) — for every note under `path` (incl. all subfolders), `move_note` → `parent_of(path)` (top-level parent = root `""`); remove the emptied dir tree; return the moved count. Refuse deleting root.
3. **Tauri commands** `rename_folder_fn` / `delete_folder_fn` + registration in `lib.rs`; each calls `api::refresh`. `invoke.ts` bindings `renameFolder` / `deleteFolder`. No new Tauri capability.
4. **Drag note → folder** (frontend-only) — note-list rows draggable; folder tree rows are drop targets; drop → existing `moveNote(noteId, folderPath)` → refresh. No-op on the note's current folder.
5. **Per-folder-row actions UI** — focusable kebab "⋯" button (ARIA menu, keyboard-reachable) per tree row with **Rename / Delete / New Subfolder**, each driven by a native `<dialog>` (never `window.prompt`). Current-folder / expanded-set / focus state kept in sync after each op.

### Out of scope / Deferred
- **Folder → folder re-nesting via drag** (DEFERRED — owner-locked; drag scope is NOTE→FOLDER only).
- **Merge-on-collision** for rename (v1 refuses; merge is a later feature).
- **Right-click `contextmenu`** handler (OPTIONAL alias of the kebab; kebab is the primary, a11y-required affordance — contextmenu may be added but is not required for acceptance).
- **Soft-delete of folders** (`delete_note`'s soft-delete is explicitly NOT the mechanism — delete-folder is non-destructive move-to-parent).
- Renaming/moving tasks or events folders (Notes only).

---

## 2. Owner-locked decisions (baked in)

- **D-DELETE-POLICY = MOVE-TO-PARENT.** Deleting `F` moves EVERY note under `F` and all its subfolders to **`F`'s parent** (a top-level folder's parent = root `""` "Notes"), then removes the now-empty directories. Notes flatten into the parent. Nothing soft-deleted/lost.
- **D-DRAG-SCOPE = NOTE → FOLDER ONLY.** Reuses the existing `move_note`. Folder→folder drag deferred.

---

## 3. Decisions resolved (owner-flagged open questions)

| ID | Decision | Rationale |
|----|----------|-----------|
| **D-RENAME-MECHANISM** | Per-note `move_note` (write-new/remove-old), looping a **snapshot** of `(id, current_folder)` taken BEFORE any mutation. Compute `dest = new_path + current_folder[old_path.len()..]`. | Reuses the link-integrity-proven mechanic (edges are ULID-based — `move_note` never touches frontmatter). Snapshot-first avoids re-scanning a mutating tree. |
| **D-RENAME-COLLISION** | **Refuse** if `notes_dir.join(new_path)` already exists (dir present, empty or not). Merge is deferred. Also refuse `new_path == old_path` and `new_path` inside `old_path`'s subtree (`new_path.starts_with(old_path + "/")`). | Simplest safe v1; no silent merges; blocks pathological self-nesting that would lose data. Trade-off: cannot rename onto a pre-existing empty dir — user deletes it first. Documented under risk R-PARTIAL. |
| **D-RENAME-EMPTY-SUBDIRS** | Recreate empty descendant subfolders under the new prefix (enumerate `list_note_folders` under `old_path`, `create_dir_all` each under `new_path`). | Per-note move only recreates note-bearing paths; without this, an empty `Work/Empty` silently vanishes on rename. Cheap to preserve; surprising to drop. |
| **D-DELETE-PARENT** | `parent_of(path)` = substring before the last `/`, or `""` for a top-level folder. ALL notes in the subtree flatten to that single parent (not each note's own parent). | Matches owner spec ("…to F's parent"). One helper, deterministic, unit-testable. |
| **D-DELETE-COUNT** | `delete_folder` returns `usize` = number of notes moved. Frontend may surface it; the confirm dialog computes its own pre-count from `cachedTree`. | Gives the UI an accurate post-hoc count and a testable return value. |
| **D-AFFORDANCE** | Focusable kebab `<button>` per row (`aria-haspopup="menu"`, `aria-expanded`) opening a `role="menu"` with 3 `role="menuitem"`s; Enter/Space opens, Escape/outside-click closes. `contextmenu` is an OPTIONAL alias. | Keyboard + SR reachable (the `.folder-row__btn` is a non-focusable div — a right-click-only menu would be inaccessible). Kebab click `stopPropagation` so it never triggers row-select or chevron-toggle. |
| **D-CURRENT-FOLDER-SYNC** | After rename `old→new`: if `currentFolder === old` → `new`; if `currentFolder` startsWith `old + "/"` → `new + currentFolder.slice(old.length)`; remap `expandedFolders` + `focusedFolderPath` the same way. After delete `path`: if `currentFolder === path` or startsWith `path + "/"` → `parent_of(path)`; drop `path` + descendants from `expandedFolders`. Then `loadFolders()` + `loadList({folder: currentFolder})`. | Prevents the selected/expanded view pointing at a path that no longer exists. |
| **D-DRAG-DATA** | `dataTransfer.setData('application/x-jin-note-id', note.id)` (custom MIME so external drags can't spoof it; also set `text/plain` mirror for robustness). Drop target adds `.folder-row__btn--drop-target` on `dragover` (with `preventDefault`), removes on `dragleave`/`drop`. On `drop`, read the id; if `targetFolder === sourceNoteFolder` → no-op (don't call `moveNote`). | Explicit MIME avoids accidental text-drop moves; highlight gives the drop affordance; same-folder guard avoids a redundant write + refresh. |
| **D-NEW-SUBFOLDER-REUSE** | Reuse the existing New Folder `<dialog>` + `submitNewFolder`; a `newFolderParent` field set by `newSubfolder(parent)` makes submit compose `parent ? parent + "/" + name : name`. `newFolder()` resets it to `undefined`. | One dialog, one validation path; matches the shipped Tauri-no-`window.prompt` rule. |

---

## 4. Approach + rationale (Explore summary)

**Selected strategy: ADAPT** — both backend ops are thin compositions over the existing, link-integrity-proven `move_note`; the frontend extends the established `renderFolderTree` callback pattern and the shipped `<dialog>` + Stimulus harness. No new architecture.

**Why per-note `move_note` (not a raw `fs::rename` of the directory):**
- A single `std::fs::rename(old_dir, new_dir)` would be faster and atomic, BUT the index (`folder_path` column) is rebuilt from disk via `api::refresh`, so either way the index self-heals. The decisive factor: the anti-shallow mandate requires proving **link integrity survives** and the codebase already proves that property for `move_note` (`bridge.rs:251`). Reusing `move_note` inherits that proof and keeps one code path for "a note changed folders." A raw dir-rename is a viable optimization but is NOT recommended for v1 (it bypasses the validated per-note path and complicates the empty-subdir + collision handling).

**Rejected alternatives:**
- **`fs::rename` directory move** — rejected for v1 (above): different code path from `move_note`, no existing link-integrity proof, still needs the same validation/collision/empty-subdir logic. Revisit only if rename perf on large vaults becomes a problem (it is O(n²) via repeated `find_note_path`).
- **Soft-delete folder (reuse `delete_note`)** — rejected: owner-locked to non-destructive move-to-parent; soft-delete would lose the notes' placement and is the opposite of the requirement.
- **Index-side `UPDATE notes SET folder_path` SQL rename** — rejected: violates the canonical-files-are-truth invariant (the index is derived; files on disk are authoritative). The folder lives in the file path, not in frontmatter.
- **Right-click-only context menu** — rejected as primary: inaccessible (`.folder-row__btn` is a non-focusable div). Allowed only as an optional alias.

---

## 5. Verified anchors (file:line — read firsthand this session)

**Backend (jin-core):**
- `store/fs.rs` — `validate_folder_path` (127), `folder_path_of` (103), `list_note_paths` (173, recursive), `list_note_folders` (214, incl. empty dirs), `find_note_path` (268), `write_note_in` (67).
- `ops/notes.rs` — `move_note` (147-162, write-new/remove-old, ULID/links/frontmatter preserved, **does not remove emptied source dir**, caller must refresh), `create_note` (32), `delete_note` (165, soft-delete — NOT used here), `EditNoteParams`/`CreateNoteParams`.
- `ops/api.rs` — `list_folders` (122, index counts ∪ on-disk subdir scan), `create_folder` (160), `refresh` (176 → `rebuild::rebuild`), `list_notes` (15, `folder_filter`), `get_note` (28, backlinks).
- `index/rebuild.rs` — `rebuild` (14, full wipe+repopulate; `folder_path` derived via `folder_path_of` at line 40), edges from `links[]` (165), backlinks (204), dangling detection (234).
- `index/query.rs` — `NoteRow.folder_path` (21), `list_notes` folder filter (96), `folder_counts` (159), `get_backlinks` (298).
- `dto/folder.rs` — `FolderDto { path, name, note_count }`; `dto/note.rs` — `NoteDto.folder_path` (29), `from_model` folder_path=None (73), `with_folder` (103).

**Tauri bridge (jin-gui/src-tauri):**
- `commands/folders.rs` — `list_folders_fn` (13), `create_folder_fn` (17) + `#[tauri::command]` wrappers. **(add `rename_folder_fn` / `delete_folder_fn` here.)**
- `commands/notes.rs` — `move_note_fn` (96, calls `api::refresh`), `NoteInput`/`EditNoteInput`.
- `lib.rs` — `invoke_handler!` registry (25-67); folders block at 35-37. **(register the two new commands here.)**
- `tests/bridge.rs` — anti-shallow template `vg_move_link_integrity_after_folder_move` (251); `vg_folders_list_reports_correct_counts` (552); `attach::attach_note(root, src, tgt, None)` seeds a real note→note "references" edge.

**Frontend (jin-gui/src):**
- `invoke.ts` — `moveNote` (64), `createFolder` (92), `listFolders` (87). **(add `renameFolder` / `deleteFolder`.)**
- `lib/notes/folderTree.ts` — `buildFolderTree` (54), `flattenVisible` (131), `resolveTreeKey` (163), `TreeNode`.
- `lib/notes/render.ts` — `renderFolderTree` (77, builds treeitems via `#tmpl-folder-row`, `cb.onSelect`/`cb.onToggle`), `buildNoteRow` (510, `.browse-row__inner[data-note-id]`), `setTreeItemExpanded` (184), `focusTreeItem` (212).
- `controllers/notes_controller.ts` — `loadFolders` (167), `selectFolder` (204, returns-to-list teardown), `toggleFolder` (231), `newFolder`/`submitNewFolder`/`closeNewFolder` (334-379), `loadList` (387), tree state fields `expandedFolders`/`currentFolder`/`focusedFolderPath`/`cachedTree` (107-134), `saveTreePrefs` (322).
- `lib/notes/folderTreePrefs.ts` — `loadFolderTreePrefs`/`saveFolderTreePrefs` (`{ expanded, paneCollapsed }`).
- `index.html` — `#tmpl-folder-row` (508), folder rail + New Folder `<dialog id="jin-new-folder-modal" class="action-dialog">` (434), `#tmpl-note-row` (1425), `.action-dialog` pattern (forms.css:282).
- `lib/icons/index.ts` — Lucide registry (must add new glyphs).
- `styles/browse.css` — `.folder-row__btn` (1153), `.notes-folder-rail__new-btn` (1008) (drop-highlight + kebab/menu CSS land here).
- `__tests__/notes_controller.test.ts` — `vi.mock('../invoke')` (61), `BODY_CONTENT` from index.html (87), Application.start harness (1260), `stubDialogMethods` (1407), VG-FE folder-click (1273), VG-NEW-FOLDER (1386), VG-FE-TMPL parity (1298). `__tests__/folderTree.test.ts` — pure-builder gates.

---

## 6. Algorithms (decision-ready pseudocode)

### `rename_folder(notes_dir, old_path, new_path) -> Result<()>` (ops/notes.rs)
```
if old_path == ""                          -> Err(InvalidInput "cannot rename the root folder")
validate_folder_path(new_path)
if new_path == ""                          -> Err(InvalidInput "new folder path must not be empty")
if new_path == old_path                    -> Err(InvalidInput "new path equals old path")
if new_path.starts_with(old_path + "/")    -> Err(InvalidInput "cannot rename a folder into its own descendant")
if notes_dir.join(new_path).exists()       -> Err(InvalidInput "destination folder already exists")   // D-RENAME-COLLISION

// snapshot BEFORE mutation
notes  = [ (read_note(p).id, folder_path_of(notes_dir,p))
           for p in list_note_paths(notes_dir)
           if f == old_path || f.starts_with(old_path + "/") ]
subdirs = [ d for d in list_note_folders(notes_dir)
            if d == old_path || d.starts_with(old_path + "/") ]   // for D-RENAME-EMPTY-SUBDIRS

for (id, f) in notes:
    dest = new_path + &f[old_path.len()..]            // "" suffix for exact match; "/Sub" for nested
    move_note(notes_dir, &id, &dest)?                  // ULID/links/frontmatter preserved

for d in subdirs:                                      // recreate empty descendant dirs
    create_dir_all(notes_dir.join(new_path + &d[old_path.len()..]))?

// DEFENSIVE anti-data-loss guard
if any *.md remain under notes_dir.join(old_path)      -> Err(Integrity "rename left notes behind")
if notes_dir.join(old_path).exists()                   -> remove_dir_all(notes_dir.join(old_path))?
Ok(())
```

### `delete_folder(notes_dir, path) -> Result<usize>` (ops/notes.rs)
```
if path == ""                              -> Err(InvalidInput "cannot delete the root folder")
validate_folder_path(path)                 // defensive
parent = parent_of(path)                    // "Work" -> "" ; "Work/Projects" -> "Work"

ids = [ read_note(p).id
        for p in list_note_paths(notes_dir)
        if f == path || f.starts_with(path + "/") ]

for id in ids:
    move_note(notes_dir, &id, parent)?      // flatten ALL to F's parent

if any *.md remain under notes_dir.join(path) -> Err(Integrity "delete left notes behind")
if notes_dir.join(path).exists()              -> remove_dir_all(notes_dir.join(path))?
Ok(ids.len())
```

### `parent_of(path: &str) -> &str` (fs.rs, pure, unit-tested)
```
path.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
```

> NOTE: getting the ULID per path — prefer `read_note(p).frontmatter.id` (robust) over filename parsing. `move_note` re-finds by id (O(n) scan) → rename/delete are O(n²); acceptable for v1, flagged R-PERF.

---

## 7. Story hierarchy

> Project: **Notes Folder Management.** Execution order is dependency-driven: S1 → S2 → S3 → (S4 ∥ S5).

### S1 — Backend `rename_folder` core op + helpers (jin-core)
**As** a notes user, **I want** to rename a folder, **so that** every note under it (and nested) moves to the new name with links intact.
- **Timebox:** ≤1d · **Risk:** P0 (data-touching)
- **Files:** `jin-core/src/ops/notes.rs` (add `rename_folder`), `jin-core/src/store/fs.rs` (add `parent_of`).
- **Action:** Implement §6 `rename_folder` + `parent_of`. Reuse `move_note`, `folder_path_of`, `validate_folder_path`, `list_note_paths`, `list_note_folders`. Add Rust `#[cfg(test)]` unit tests in `ops/notes.rs` + `fs.rs`.
- **Acceptance (GIVEN/WHEN/THEN):**
  - G: notes in `Work` and `Work/Projects`; W: `rename_folder(dir,"Work","Job")`; T: `Work` notes physically under `notes/Job/`, `Work/Projects` notes under `notes/Job/Projects/`; `notes/Work` no longer exists.
  - G: an empty subdir `Work/Empty`; W: rename `Work→Job`; T: `notes/Job/Empty` exists (D-RENAME-EMPTY-SUBDIRS).
  - G: a folder `Existing` already on disk; W: `rename_folder(dir,"Work","Existing")`; T: `Err` (collision), `Work` untouched.
  - G: any state; W: `rename_folder(dir,"","X")`; T: `Err` (refuse root).
  - G: folder `Work`; W: `rename_folder(dir,"Work","Work/Sub")`; T: `Err` (own-descendant).
  - G: `parent_of`; W: inputs `"Work"`, `"Work/Projects"`, `""`; T: `""`, `"Work"`, `""`.
- **Gate VG-RENAME-CORE** (Rust unit, mutation-aware): the nested-move + old-dir-removed + collision + root-refuse + empty-subdir + `parent_of` cases above. Disabling the remove-old-dir step OR the nested-suffix recompute must fail a test.
- **Agent hints:** Reasoner/Builder. Context: `ops/notes.rs`, `store/fs.rs`. `cargo fmt` before commit (CI fmt gate).

### S2 — Backend `delete_folder` (move-to-parent) core op (jin-core)
**As** a notes user, **I want** to delete a folder non-destructively, **so that** its notes flatten into the parent and nothing is lost.
- **Timebox:** ≤1d · **Risk:** P0 (data-touching) · **Depends:** S1 (`parent_of`)
- **Files:** `jin-core/src/ops/notes.rs` (add `delete_folder`).
- **Action:** Implement §6 `delete_folder`. Returns moved count.
- **Acceptance:**
  - G: notes in `Work` + `Work/Projects` + 1 in root; W: `delete_folder(dir,"Work")`; T: all former `Work*` notes have `folder_path == ""`, `notes/Work` removed, root note untouched, return == count moved.
  - G: a note in `A/B/C`; W: `delete_folder(dir,"A/B")`; T: that note's `folder_path == "A"` (flattened to parent of the DELETED folder), `notes/A/B` removed, `notes/A` remains.
  - G: any state; W: `delete_folder(dir,"")`; T: `Err` (refuse root).
- **Gate VG-DELETE-CORE** (Rust unit, mutation-aware): the flatten + nested-parent + count + root-refuse cases. Disabling the dir-removal OR the parent-flatten must fail a test.
- **Agent hints:** as S1.

### S3 — Tauri commands + invoke bindings + anti-shallow bridge round-trips
**As** the frontend, **I want** `rename_folder` / `delete_folder` commands that refresh the index, **so that** the UI can call them and reads stay consistent.
- **Timebox:** ≤2d · **Risk:** P0 (data-touching, integration) · **Depends:** S1, S2
- **Files:** `jin-gui/src-tauri/src/commands/folders.rs` (`rename_folder_fn`/`delete_folder_fn` + `#[tauri::command]`), `jin-gui/src-tauri/src/lib.rs` (register), `jin-gui/src/invoke.ts` (`renameFolder`/`deleteFolder`), `jin-gui/src-tauri/tests/bridge.rs` (gates).
- **Action:**
  - `rename_folder_fn(root, old_path, new_path) -> Result<(), JinErrorDto>`: `notes::rename_folder(&cfg.notes_dir(), …)?; api::refresh(root)?; Ok(())`.
  - `delete_folder_fn(root, path) -> Result<usize, JinErrorDto>`: `let n = notes::delete_folder(&cfg.notes_dir(), &path)?; api::refresh(root)?; Ok(n)`.
  - Register `commands::folders::rename_folder`, `commands::folders::delete_folder` in the Folders block of `invoke_handler!`.
  - `invoke.ts`: `renameFolder(oldPath, newPath): Promise<void> => invoke('rename_folder', { old_path: oldPath, new_path: newPath })`; `deleteFolder(path): Promise<number> => invoke('delete_folder', { path })`. (snake_case keys match Rust params — same convention as `attach_note`'s `{ note_id }`.)
- **Acceptance / Gate VG-RENAME-BRIDGE** (bridge.rs, mirrors `vg_move_link_integrity_after_folder_move`):
  - GIVEN note `W1` in `Work` (non-empty body), `P1` in `Work/Projects`, note `B` in root with a REAL `attach::attach_note(root, B, W1, None)` edge, all refreshed; AND PRE-asserted `get_note(W1).backlinks` contains `B`.
  - WHEN `rename_folder_fn(root,"Work","Job")` then `api::refresh`.
  - THEN `notes/Job/` exists AND `notes/Work/` is gone; `list_notes(folder="Job")` returns `W1` with `folder_path=="Job"`; `list_notes(folder="Job/Projects")` returns `P1` with `folder_path=="Job/Projects"`; `get_note(W1).backlinks` STILL contains `B` (ULID survived); `list_dangling` is empty.
  - AND collision: with an `Existing` folder present, `rename_folder_fn(root,"Job","Existing")` → `Err`. AND root refuse: `rename_folder_fn(root,"","X")` → `Err`.
- **Acceptance / Gate VG-DELETE-BRIDGE** (bridge.rs):
  - GIVEN `W1` in `Work`, `P1` in `Work/Projects`, note `B` in root with REAL `attach` edge `B→W1`, refreshed; PRE-asserted `W1` backlink from `B`.
  - WHEN `moved = delete_folder_fn(root,"Work")` then refresh.
  - THEN `W1.folder_path == ""` AND `P1.folder_path == ""`; `notes/Work` gone; `get_note(W1).backlinks` contains `B`; `moved == 2`; `list_dangling` empty.
  - AND nested-parent: a note in `A/B/C`, `delete_folder_fn(root,"A/B")` → that note `folder_path == "A"`. AND root refuse: `delete_folder_fn(root,"")` → `Err`.
- **Agent hints:** Reasoner. Context: `bridge.rs` (read `vg_move_link_integrity_after_folder_move` first), `commands/folders.rs`, `commands/notes.rs`, `lib.rs`, `invoke.ts`. `cargo fmt` before push.

### S4 — Drag note → folder (frontend-only)
**As** a notes user, **I want** to drag a note onto a folder, **so that** it moves there without opening a menu.
- **Timebox:** ≤2d · **Risk:** P1 · **Depends:** S3 not required (uses existing `moveNote`); independent of S1-S3.
- **Files:** `lib/notes/render.ts` (`buildNoteRow` → `draggable=true` + `dragstart`; `renderFolderTree`/`buildNode` → drop handlers on `.folder-row__btn`), `controllers/notes_controller.ts` (drop → `moveNote` + refresh), `index.html` (`#tmpl-note-row` optional `draggable` hint), `styles/browse.css` (`.folder-row__btn--drop-target`), `__tests__/notes_controller.test.ts` (gates).
- **Action (D-DRAG-DATA):**
  - `buildNoteRow`: set `row`/`.browse-row__inner` `draggable=true`; on `dragstart` → `e.dataTransfer.setData('application/x-jin-note-id', note.id)` + `text/plain` mirror; `effectAllowed='move'`.
  - `renderFolderTree.buildNode`: on `.folder-row__btn` `dragover` → `e.preventDefault()` + add `.folder-row__btn--drop-target`; `dragleave` → remove class; `drop` → `e.preventDefault()`, read id from `dataTransfer`, remove class, call `cb.onDropNote(node.path, id)`.
  - Controller: add `onDropNote(folderPath, noteId)` callback → if the note's current folder === folderPath, no-op; else `await moveNote(noteId, folderPath); await this.loadFolders(); await this.loadList({ folder: this.currentFolder })`.
- **Acceptance / Gate VG-DND** (controller-driven, real DOM events, mutation-aware):
  - GIVEN a rendered list with note `N` (current folder `""`) and a folder row `Work`; WHEN a real `dragstart` on `N`'s `.browse-row__inner` followed by `drop` on `Work`'s `.folder-row__btn` (with a real `DataTransfer` carrying the id); THEN `moveNote('N','Work')` is called (assert exact args) and the rail refreshes.
  - GIVEN note `N` already in `Work`; WHEN dropped on `Work`; THEN `moveNote` is NOT called (same-folder no-op).
  - MUTATION: removing the `drop` listener wiring must fail the first case.
- **Agent hints:** Builder. Context: `render.ts`, `notes_controller.ts`, `notes_controller.test.ts` (study VG-FE harness). Node ≥20 via nvm (system node v16 crashes vitest). NOTE: jsdom `DataTransfer` is limited — construct a `DragEvent` with a hand-rolled `dataTransfer` stub `{ getData, setData, data:{} }` if the native one is unavailable (mirror `stubDialogMethods`).

### S5 — Per-row kebab menu: Rename / Delete / New Subfolder (frontend)
**As** a notes user, **I want** a keyboard-reachable per-folder menu, **so that** I can rename, delete, or add a subfolder.
- **Timebox:** ≤3d · **Risk:** P1 (a11y + state sync) · **Depends:** S3 (invoke bindings), Kupo K1-K4.
- **Files:** `index.html` (`#tmpl-folder-row` kebab button + menu; rename `<dialog>`; delete-confirm `<dialog>`), `lib/notes/render.ts` (`renderFolderTree` cb `onRename`/`onDelete`/`onNewSubfolder` + menu open/close), `controllers/notes_controller.ts` (dialog methods + invoke + D-CURRENT-FOLDER-SYNC), `lib/icons/index.ts` (K2), `styles/browse.css` (K3), `__tests__/notes_controller.test.ts` (gates + extend invoke mock).
- **Action:**
  - `#tmpl-folder-row`: add a focusable `<button class="folder-row__menu-btn" aria-haspopup="menu" aria-expanded="false">` (kebab) inside `.folder-row__btn`, plus a `role="menu"` element with 3 `role="menuitem"`s (Rename / Delete / New Subfolder). Keep `.folder-row__btn[data-folder-path]` and all existing hooks intact (VG-FE / VG-FE-FOLDER-OPEN parity).
  - `renderFolderTree.buildNode`: wire kebab `click` (`stopPropagation` → never selects/toggles) to open the row menu (toggle `aria-expanded` + `hidden`); menuitem clicks call `cb.onRename(node.path)` / `cb.onDelete(node.path)` / `cb.onNewSubfolder(node.path)` then close; Escape + outside-click close the menu.
  - Controller dialog methods:
    - `renameFolder(path)` → open `#jin-rename-folder-modal`, prefill input with the **leaf** name (`path.split('/').pop()`); store `renameTarget=path`. `submitRenameFolder` → `newPath = parentPrefix(path) + input`; `await renameFolder(path, newPath)`; on success apply D-CURRENT-FOLDER-SYNC (rename remap) + `loadFolders` + conditional `loadList`; on `JinErrorDto` show inline error (don't close).
    - `deleteFolder(path)` → open `#jin-delete-folder-modal`; message `Move {N} notes to "{parentLabel}" and delete?` where `N` = subtree note_count sum from `cachedTree`, `parentLabel` = `parent_of(path)` or "Notes". `confirmDeleteFolder` → `await deleteFolder(path)`; apply D-CURRENT-FOLDER-SYNC (delete remap) + `loadFolders` + conditional `loadList`.
    - `newSubfolder(path)` → set `newFolderParent=path`, open the EXISTING New Folder dialog; `submitNewFolder` composes `parent ? parent + "/" + name : name` (D-NEW-SUBFOLDER-REUSE); `newFolder()` resets `newFolderParent=undefined`.
- **Acceptance / Gates** (controller-driven, real Stimulus + real DOM; `stubDialogMethods` for `<dialog>`):
  - **VG-KEBAB-RENAME:** click kebab on `Work` → click Rename → dialog opens prefilled `"Work"` → set `"Job"` → submit → `renameFolder('Work','Job')` called (exact args); rail refreshes (`loadFolders`/`listFolders` re-invoked).
  - **VG-KEBAB-RENAME-NESTED:** rename leaf of `Work/Projects` to `Tasks` → `renameFolder('Work/Projects','Work/Tasks')` (parent prefix preserved).
  - **VG-KEBAB-DELETE:** click kebab on `Work` → Delete → confirm dialog shows the note count + parent label → confirm → `deleteFolder('Work')` called; rail refreshes.
  - **VG-SUBFOLDER:** kebab on `Work` → New Subfolder → New Folder dialog → enter `Sub` → submit → `createFolder('Work/Sub')` called.
  - **VG-CURRENT-SYNC:** with `currentFolder='Work'` selected, rename `Work→Job` → `currentFolder` becomes `Job` and `listNotes({folder:'Job'})` is reloaded; delete `Job` → `currentFolder` becomes `''` and list reloads.
  - **VG-A11Y-KEBAB:** the kebab is a `<button>` (focusable, reachable by keyboard); `aria-haspopup="menu"`; opening sets `aria-expanded="true"`; Escape closes (`aria-expanded="false"`). Kebab click does NOT fire `selectFolder` (stopPropagation).
  - **MUTATION:** unwiring the Rename menuitem → `renameFolder` callback must fail VG-KEBAB-RENAME.
  - **PRESERVE (immovable):** VG-FE (folder click → `listNotes({folder})`), VG-FE-FOLDER-OPEN, VG-FE-TMPL parity, folderTree pure gates, VG-NEW-FOLDER, **G-XSS** (`notes_controller.test.ts:486-499`) all stay green.
- **Test-harness edits (REQUIRED — call out to Vivi):** extend `vi.mock('../invoke', …)` in `notes_controller.test.ts` to add `moveNote`, `renameFolder`, `deleteFolder` (and import them); update the in-test `folderRowTmpl` and `#tmpl-folder-row` parity test to include the kebab/menu hooks.
- **Agent hints:** Builder/Reasoner (a11y nuance). Context: `notes_controller.ts`, `render.ts`, `index.html` (study `jin-new-folder-modal` + `stubDialogMethods`), `folderTreePrefs.ts`. Node ≥20.

---

## 8. Kupo micro-tasks (speed-class)

| ID | Task | File | Owning story |
|----|------|------|--------------|
| **K1** | `renameFolder(oldPath,newPath)` + `deleteFolder(path)` invoke bindings (snake_case keys `old_path`/`new_path`/`path`). | `jin-gui/src/invoke.ts` | S3 |
| **K2** | Register Lucide glyphs: `MoreVertical` (kebab), `Pencil` (rename), `Trash2` (delete). `FolderPlus` already present (new-subfolder). Add to import + export + `initIcons()` (3 places). | `jin-gui/src/lib/icons/index.ts` | S5 |
| **K3** | CSS: `.folder-row__menu-btn` (kebab, focusable, hover/focus-visible ring), `.folder-row__menu` (`role=menu` popover, `[hidden]` toggle) + `.folder-row__menuitem`, `.folder-row__btn--drop-target` (drop highlight). Mirror `.notes-folder-rail__new-btn` / `.folder-row__btn` styles. | `jin-gui/src/styles/browse.css` | S4 (drop) / S5 (menu) |
| **K4** | `index.html`: add kebab button + menu to `#tmpl-folder-row`; add `<dialog id="jin-rename-folder-modal" class="action-dialog">` and `<dialog id="jin-delete-folder-modal" class="action-dialog">` mirroring `#jin-new-folder-modal` (header, `data-notes-target`s, form, `data-action` wiring); add `draggable` hint to `#tmpl-note-row` (optional — `render.ts` can set it). | `jin-gui/index.html` | S4 / S5 |

---

## 9. Risk flags

| ID | Risk | Sev | Mitigation |
|----|------|-----|------------|
| **R-PARTIAL** | Partial rename/delete on mid-loop FS failure (some notes moved, some not) → a partially-renamed folder; a retry then hits the collision guard because `new_path` now exists. | **P0** | `move_note` is write-new-then-remove-old per note, so on-disk state stays consistent (no note lost) even on partial failure; only the folder is half-renamed. After failure, the index self-heals on the next `refresh` (reflects the mix). Propagate the error; the DEFENSIVE "*.md left behind" guard prevents the dir from being removed while notes remain. Document that a partial-rename retry may need manual cleanup of the partial `new_path` (acceptable for v1). |
| **R-ORPHAN-DIR** | `remove_dir_all` runs while a `.md` still lives in the subtree → data loss. | **P0** | The §6 guard scans the subtree for `*.md` and returns `Err` (never removes) if any remain. `move_note` does not delete the emptied source dir, so removal is an explicit, guarded final step. |
| **R-LINK** | Rename/delete breaks the link graph. | P1 | Reuses `move_note` (ULID-based, frontmatter untouched) — proven by `bridge.rs:251`. VG-RENAME/DELETE-BRIDGE re-prove backlink survival + empty `list_dangling` with a REAL `attach` edge. |
| **R-CURRENT-SYNC** | Selected/expanded folder renamed/deleted leaves the UI pointing at a dead path. | P1 | D-CURRENT-FOLDER-SYNC remaps `currentFolder`/`expandedFolders`/`focusedFolderPath`; VG-CURRENT-SYNC gate. |
| **R-DND-A11Y** | Drag-only move is inaccessible to keyboard/SR users. | P1 | The kebab menu (S5) provides a fully keyboard-reachable equivalent path (no folder op is drag-exclusive). Drag is an enhancement, not the only route. |
| **R-COLLISION** | Rename onto an existing folder silently merges/overwrites. | P1 | D-RENAME-COLLISION refuses when `new_path` exists; VG-RENAME-CORE + VG-RENAME-BRIDGE assert the `Err`. |
| **R-EMPTY-SUBDIR** | Empty descendant folders silently vanish on rename. | P2 | D-RENAME-EMPTY-SUBDIRS recreates them; VG-RENAME-CORE asserts. |
| **R-PERF** | Rename/delete are O(n²) (`move_note` re-scans via `find_note_path`). | P2 | Acceptable for personal-vault scale; a future `fs::rename` fast-path is the documented optimization. |
| **R-NODE** | Frontend gates crash on system node v16. | P1 | Run vitest under Node ≥20 (nvm v24.18.0). `cargo fmt` before push (CI fmt gate). |

---

## 10. Test verification (6-layer summary)

- **Structural:** 5 stories, INVEST-clean, dependency-ordered (S1→S2→S3→S4∥S5); no orphaned tasks (Kupo mapped to stories).
- **Self-consistency:** three decompositions (by-layer / by-feature / by-risk) converge on the same 5 units (≥70% overlap) — stable.
- **Dependency:** every touched file anchored at file:line and read firsthand; the required `vi.mock` + template-parity edits are called out explicitly (the silent-break trap).
- **Constraint:** non-destructive delete honored; ULID link integrity preserved; a11y (kebab) mandated; no new Tauri capability; read-only spec.
- **Process-reward:** backend-first ordering lets the anti-shallow bridge gates (S3) lock data safety before any UI is wired.
- **Adversarial:** addressed orphaned-dir data loss (R-ORPHAN-DIR guard), partial-failure retry (R-PARTIAL), collision merge (R-COLLISION), DnD inaccessibility (R-DND-A11Y), green-but-shallow tests (mutation clauses on every data-touching gate, REAL `attach` edges, REAL DOM drag/drop events).

---

## 11. Confidence report

| Factor (25% each) | Score | Note |
|---|---|---|
| Pattern match | 0.92 | `move_note` + `bridge.rs` round-trip + `renderFolderTree`/`<dialog>` harness all exist; ADAPT, not GENERATE. |
| Requirement clarity | 0.95 | Owner-locked delete policy + drag scope; all open decisions resolved in §3. |
| Decomposition stability | 0.88 | 3 decompositions converge. |
| Constraint compliance | 0.88 | Non-destructive, ULID-safe, a11y, no new capability — all baked into gates. |
| **Overall** | **0.90** | **AUTO_PROCEED → hand off to Vivi.** |

**Hand-off:** Vivi (apivr / Builder) executes S1→S5 in order; backend gates (VG-RENAME-CORE, VG-DELETE-CORE, VG-RENAME-BRIDGE, VG-DELETE-BRIDGE) must be green before frontend stories. Branch off `main`.
</content>
</invoke>
