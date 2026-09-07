# Jin Notes QoL — "New Note" from the sidebar + inline-editable note title

- **Methodology:** SPECTRA 4.10.0 · tier `standard` · intent `CHANGE`
- **Complexity:** 7/12 · **Confidence:** 0.92 → **AUTO_PROCEED**
- **Handoff:** spectra → apivr · **executor: Vivi**
- **Scope:** FRONTEND-ONLY (`jin-gui`). No Rust, no new Tauri commands, no schema. Reuses
  existing `create_note` + `edit_note`.
- **Base:** branch off `main` (= **v0.4.0**, verified `git describe`). `main` already
  contains the CM6 editor, folder tree, `createNote`, `editNote` — all dependencies present.
- **Node:** frontend gates require **Node ≥ 20** (engines `>=20.0.0`). System node is
  v16.20.2 and **crashes vitest** — use nvm (v24.x) to run the suite.

---

## 0. Firsthand verification (every anchor re-read this session)

| Fact | Anchor | Verified |
|---|---|---|
| `createNote({title,body?,tags?,folder?})` → `create_note`; `folder` default `""`=root | `jin-gui/src/invoke.ts:53-61` | ✅ returns `NoteDto` |
| `editNote(id,{title?,body?,add_tags?,rm_tags?})` → `edit_note` | `jin-gui/src/invoke.ts:68-78` | ✅ |
| `editNote` already imported in controller; **`createNote` NOT** | `notes_controller.ts:44` | ✅ must add `createNote` |
| Controller state: `currentFolder?` (undefined=all), `currentNoteId`, `lastSavedBody`, `editorHandle` | `notes_controller.ts:107,110,113,120` | ✅ |
| `loadDetail(id)` mounts CM6 via `renderNoteDetail`, sets `currentNoteId`/`lastSavedBody` | `notes_controller.ts:442-498` | ✅ |
| `onSave` body-only autosave + **targeted-DOM list-row date update** (the pattern to mirror) | `notes_controller.ts:517-551` (DOM at 531-539) | ✅ |
| `loadList(filter:{tag?,folder?})` | `notes_controller.ts:387-416` | ✅ |
| Detail title = static `<h2 class="browse-detail__title text-title2">`, `textContent=note.title` | `render.ts:350-353` | ✅ |
| `renderNoteDetail(...)` returns `EditorHandle` (from `mountEditor`) | `render.ts:338-466` | ✅ |
| List-row title `.browse-row__title`; row btn `.browse-row__inner[data-note-id]` | `render.ts:478-496` | ✅ |
| `EditorHandle.getView():EditorView` (identity seam); handle on `parent._cmHandle` | `editor.ts:74,839,845-850` | ✅ |
| `NoteDto`: `title, updated, body_markdown?, excerpt?, folder_path?`; create returns folder_path (no body/excerpt) | `types/dto.ts:29-59` | ✅ |
| List pane `.notes-list-pane [data-notes-target="listPanel"]`; **no header today** (reveal-btn, loading, empty, `<ul>`) | `index.html:333-370` | ✅ |
| Folder-rail "New Folder" btn `.notes-folder-rail__new-btn` (`click->notes#newFolder`) | `index.html:321-329` | ✅ |
| `#tmpl-note-row` has `.browse-row__title` / `.note-row__date` | `index.html:1414-1431` | ✅ |
| **`slugify("")` → `"untitled"`** ⇒ empty title backend-safe (create + edit) | `jin-core/src/store/fs.rs:23-54` | ✅ |
| `edit_note` title-change preserves `frontmatter.id`; renames file, same folder; body-save routes by ULID via `find_note_path` | `jin-core/src/ops/notes.rs:81-137,56-59` | ✅ |
| Test harness: `vi.mock('../invoke')` w/ vi.fn() (no `createNote` yet); controller gates = inject `BODY_CONTENT` + `Application.start`+`register('notes',...)`; open via `jin:open-detail` CustomEvent; `_cmHandle`+`getView()` for identity | `notes_controller.test.ts:60-72,657-728,1564-1708` | ✅ |
| Existing detail-title assertion reads `.textContent` (breaks if `<h2>`→`<input>`) | `notes_controller.test.ts:452-453` | ✅ migrate to `.value` |
| Immovable XSS gate | `notes_controller.test.ts:511-528` | ✅ keep green |

**Memory note (recurring Jin fact, carried forward):** ATLAS Wave-2 episodic crystals do
not surface via `crystalium_recall` on the `jin` scope — only Wave-1 `5216e65c` returns.
Every anchor above was re-verified firsthand; do not trust stale scout/ATLAS line numbers.

---

## 1. Owner-locked requirements (restated)

1. A **"New Note"** action in the Notes sidebar creates a note and **OPENS** it in the editor.
2. **Folder rule:** new note's folder = currently-selected folder; when NO folder selected,
   create in the **default folder** (root `""` = "Notes").
3. **Inline-editable title:** new note opens immediately; the detail-header title is
   **click-to-edit**, saves via `edit_note`. Same UI **renames ANY existing note** (fills the
   current rename gap — no title-edit UI exists today).

---

## 2. Decisions (decision-ready)

### D-BUTTON-PLACEMENT — **list-pane header (Apple-Notes compose)**
Add a `.notes-list-pane__header` as the first child of `.notes-list-pane`, holding an optional
left label and a right-aligned compose icon-button `.notes-new-note-btn`
(`data-action="click->notes#newNote"`, `aria-label="New note"`, Lucide **`square-pen`**).
- **Why:** Apple Notes places compose in the note-list column toolbar; it is contextual to the
  list it populates, and the new note appears in that very list. The folder rail already owns
  **New Folder** — putting **New Note** there conflates two different create scopes (folder vs
  note). The list pane is always visible (survives `rail-collapsed`), where the rail can be hidden.
- **Reject** folder-rail placement (scope confusion) and a global app header (too far from the list).
- The existing `.notes-rail-reveal` button stays the first interactive element; the new header
  sits alongside/after it (Kupo owns exact flex layout).

### D-DEFAULT-TITLE — **empty `""`** (+ "Untitled" fallback + placeholder + select-all)
New note created with `title: ''`. **Verified backend-safe:** `slugify("")="untitled"` →
file `<ULID>--untitled.md`, no validation error (`fs.rs:49-50`).
- New note opens; the title input is **focused with select-all** so the first keystroke
  overwrites. (Empty value ⇒ select() is visually a no-op for new notes but is load-bearing
  when the same UI renames an existing note.)
- **Reject** literal `"New Note"`: pollutes filenames/slugs and forces select-all+delete.

### D-TITLE-COMPONENT — **styled `<input type="text">`** (replaces the static `<h2>`)
`<input type="text" class="browse-detail__title browse-detail__title--input text-title2"
placeholder="Untitled" aria-label="Note title">`, `value = note.title` (raw).
- Always-editable: a click places the caret (= "click-to-edit", no swap state machine).
- **XSS-safe:** user text only ever flows through `.value` (and list `.textContent`) — never
  `innerHTML`. Mirrors the project's no-`innerHTML`-of-user-text rule.
- **Keep the class `browse-detail__title`** so the caret-safe node-identity selector
  (`notes_controller.test.ts:1679,1700`) keeps resolving.
- **Reject** `contenteditable` (innerHTML/selection complexity, weaker XSS posture).
- **Consequence (test migration):** `notes_controller.test.ts:453` reads `.textContent` of the
  detail title → must become `(titleEl as HTMLInputElement).value`.

### D-TITLE-SAVE-TRIGGER — **commit on blur AND Enter; Escape reverts**
Interaction state is owned by `renderNoteDetail`'s input wiring (DOM-local), persistence by the
controller (mirrors the editor.ts module/controller split, H2):
- On **focus**: capture `titleBaseline = input.value`.
- On **commit** (blur or Enter): dirty-check `input.value !== titleBaseline`; if changed AND not
  already committing, call `onTitleSave(input.value)`; on resolve set `titleBaseline = input.value`.
- **Enter**: `preventDefault()` (no form submit / newline) then `input.blur()`.
- **Escape**: `input.value = titleBaseline`, `preventDefault()`, `input.blur()` — **no `onTitleSave`**.
- **No per-keystroke debounce** (title is short; renaming the file per keystroke churns the FS).
- **Allow empty** title (do not force a value); display "Untitled" fallback (D-EMPTY-TITLE-DISPLAY).
- **`committing` guard:** while an `onTitleSave` promise is in flight, ignore re-entrant commits;
  combined with the baseline advance this makes the Enter→blur sequence a single network call.

### D-CARET-SAFE (critical) — title commit MUST NOT remount the body editor
`renderNoteDetail` gains an optional `onTitleSave?: (title: string) => Promise<void>` param
(mirroring `onSave`). On title commit the controller's handler:
1. (defensive) `await this.editorHandle?.flush()` — drain any pending body autosave first
   (serialize against the rename; see R-RENAME-INTERACTION).
2. `await editNote(id, { title })` — title-only edit. Backend renames the file but **keeps the
   ULID** (`ops/notes.rs:117-128`), so `currentNoteId` stays valid and subsequent body saves
   (`editNote(id,{body})` → `find_note_path` by id) keep working.
3. **Targeted DOM only** — mirror the existing `onSave` pattern (`notes_controller.ts:531-539`):
   `document.querySelector('.browse-row__inner[data-note-id="${id}"]')` →
   `.closest('.browse-row')` → set `.browse-row__title`.textContent = `noteDisplayTitle(title)`
   and `.note-row__date`.textContent = `formatNoteDate(updated)` and the inner `aria-label`.
4. **Never** call `renderNoteDetail` and **never** touch `editorHandle` on this path. The
   `EditorView` instance (and `.cm-editor` DOM node) is therefore identical before/after —
   caret preserved.
- On `editNote` rejection: dispatch `app:error` (isJinErrorDto), keep the input value as typed,
  do **not** advance `titleBaseline` (next blur retries). Mirrors `onSave` error semantics.

### D-NEW-NOTE-FLOW — create → refresh list → open → focus+select title
`newNote()` controller action:
1. `const created = await createNote({ title: '', body: '', folder: this.currentFolder ?? '' })`.
2. `await this.loadList({ folder: this.currentFolder })` — refresh so the row appears
   (it matches the active filter because its folder == currentFolder).
3. `await this.loadDetail(created.id)` — opens detail, mounts CM6, sets `currentNoteId`/`lastSavedBody`.
4. `const t = this.detailContentTarget.querySelector('.browse-detail__title') as HTMLInputElement;
   t?.focus(); t?.select();`
- Errors: `isJinErrorDto(err)` → `this.dispatch('error', { detail: err, prefix:'app', bubbles:true })`.
- Folder mapping confirmed against the owner rule: `'Work'`→`'Work'`; root selected `''`→`''`;
  no selection `undefined`→`''` (default folder).

### D-EMPTY-TITLE-DISPLAY — "Untitled" in the list; placeholder in the detail
New pure helper in `transform.ts`:
`export function noteDisplayTitle(title: string): string { return title.trim() === '' ? 'Untitled' : title; }`
- **List row** `.browse-row__title` (+ `.browse-row__inner` aria-label) use `noteDisplayTitle(note.title)`.
- **Detail input** shows the **raw** value (`""`) with `placeholder="Untitled"` — never the literal
  word "Untitled" as the value (otherwise the user would edit the placeholder text). This is the
  Apple-Notes behavior: list shows "Untitled", the editor shows an empty field with a hint.
- The targeted list-row update on title commit also uses `noteDisplayTitle`.

---

## 3. Story hierarchy

```
PROJECT: Jin GUI Notes — create & rename QoL
└── FEATURE: Sidebar New Note + inline-editable title
    ├── STORY NN-1: Inline-editable note title (+ rename any note)   [≤2d]
    └── STORY NN-2: "New Note" button → create-in-target-folder → open → focus title [≤2d]
        (depends on NN-1)
```

Build order: **NN-1 → NN-2** (NN-2 focuses the input NN-1 introduces).

---

### STORY NN-1 — Inline-editable note title (+ rename any note)

> As a Jin user, I want to click the note's title and rename it inline so that I can name new
> notes and fix titles of any existing note, without losing my place in the body editor.

**Timebox:** ≤2d · **Risk:** P0 (caret-safety / data loss)

**Action plan**
- **Modify** `render.ts:renderNoteDetail` — replace the `<h2>` (lines 350-353) with the editable
  `<input class="browse-detail__title browse-detail__title--input text-title2">`,
  `value = note.title`, `placeholder="Untitled"`, `aria-label="Note title"`. Add optional
  `onTitleSave?: (title:string)=>Promise<void>` param; wire focus(baseline)/blur/Enter/Escape +
  dirty-check + `committing` guard per D-TITLE-SAVE-TRIGGER. Title node stays the first child of
  `detailContent` (above the body), flex-shrink:0.
- **Modify** `transform.ts` — add `noteDisplayTitle`.
- **Modify** `render.ts:buildNoteRow` — `.browse-row__title`.textContent + `.browse-row__inner`
  aria-label use `noteDisplayTitle(note.title)`.
- **Modify** `notes_controller.ts` — pass `onTitleSave` closure into `renderNoteDetail`
  (`loadDetail`, ~477-485); add private `async onTitleSave(id, title)`: defensive
  `editorHandle?.flush()` → `editNote(id,{title})` → targeted list-row DOM update
  (mirror `onSave` 531-539) → on error `app:error`. **No `renderNoteDetail` / no `editorHandle`
  mutation on this path.**
- **Test** (controller-driven, real Stimulus): gates below.
- **Migrate** `notes_controller.test.ts:453` `.textContent`→`.value`.

**Acceptance — GIVEN/WHEN/THEN**

- **AC-NN1.1 (G-TITLE-EDIT-SAVE, caret-safe — TOP):**
  GIVEN a note opened via the controller (CM6 mounted; capture `handleBefore`,
  `viewBefore=handle.getView()`, `cmEditorBefore=document.querySelector('.cm-editor')`)
  WHEN the `.browse-detail__title` input value is set to `"Renamed"` and a real `blur` event fires
  THEN `editNote` is called exactly once with `(id, { title: 'Renamed' })`
  AND the list row `.browse-row__title` for that `data-note-id` reads "Renamed" (targeted DOM)
  AND the body editor is **not** remounted: `getHandle() === handleBefore`,
  `handle.getView() === viewBefore`, and `document.querySelector('.cm-editor') === cmEditorBefore`.
  *(Mutation: a full `renderNoteDetail` on commit creates a new `EditorView`/`.cm-editor` → fails;
  dropping the targeted row update → row-title assertion fails; disabling `editNote` → call-count fails.)*

- **AC-NN1.2 (G-TITLE-EDIT-ENTER):** GIVEN the title input focused WHEN value set to "Via Enter"
  and a `keydown` `Enter` dispatched THEN `editNote` called with `{title:'Via Enter'}` AND default
  is prevented (no form submit) AND no second `editNote` from the follow-on blur (guard + baseline).

- **AC-NN1.3 (G-TITLE-EDIT-ESCAPE):** GIVEN the input focused with baseline "Orig" WHEN value set
  to "Discard" and `keydown` `Escape` dispatched THEN input value reverts to "Orig" AND `editNote`
  is **not** called.

- **AC-NN1.4 (G-TITLE-DIRTY-NOOP):** GIVEN the input focused, value unchanged WHEN `blur` fires
  THEN `editNote` is **not** called.

- **AC-NN1.5 (G-TITLE-EMPTY-ALLOWED + DISPLAY):** GIVEN a note with a non-empty title WHEN the
  title is cleared to `""` and committed THEN `editNote` called with `{title:''}` AND the list row
  `.browse-row__title` shows "Untitled" (`noteDisplayTitle`) AND the detail input value is `""`
  with `placeholder="Untitled"`.

- **AC-NN1.6 (G-TITLE-RENAME-BODY-SAVE-STILL-WORKS, rename interaction):** GIVEN a note opened and
  its title committed to a new value (file renamed) WHEN the body is then edited and `flush()`ed
  THEN `editNote` is called with `{body: ...}` for the **same** id (ULID), i.e. body autosave still
  routes correctly after the rename. *(Guards the rename-moves-file interaction.)*

- **AC-NN1.7 (preserve G-SAVE-CARET-SAFE):** the existing body-save caret gate
  (`notes_controller.test.ts:1671`) stays green; the title node-identity assertion (now an
  `<input>`) still holds across a body save.

---

### STORY NN-2 — "New Note" button → create in target folder → open → focus title

> As a Jin user, I want a New Note button in the Notes sidebar that creates a note in the
> folder I'm viewing and drops me straight into it with the title ready to type.

**Timebox:** ≤2d · **Risk:** P1 · **Depends on:** NN-1

**Action plan**
- **Extend** `index.html` — add `.notes-list-pane__header` + `.notes-new-note-btn`
  (`data-action="click->notes#newNote"`, `aria-label="New note"`, `<i data-lucide="square-pen">`)
  inside `.notes-list-pane` (K-NN-1).
- **Modify** `notes_controller.ts` — add `createNote` to the invoke import (line 44); add public
  `async newNote()` per D-NEW-NOTE-FLOW.
- **Test** — gates below + (recommended) a K2-style production-template/markup parity guard for the
  new button.
- **Test harness** — add `createNote: vi.fn()` to the `vi.mock('../invoke')` block
  (`notes_controller.test.ts:60-66`) and to the import (line 70).

**Acceptance — GIVEN/WHEN/THEN**

- **AC-NN2.1 (G-NEWNOTE-DEFAULT-FOLDER):** GIVEN the controller connected with **no folder
  selected** (`currentFolder === undefined`) WHEN the real `.notes-new-note-btn` is clicked
  (real `MouseEvent` through Stimulus) THEN `createNote` is called with
  `{ title:'', body:'', folder:'' }` AND the new note opens (detail shown, `.note-detail__body`
  + `.cm-editor` present, `currentNoteId` set). *(Mutation: passing `folder: undefined` instead of
  `''` → exact-arg assertion fails; disabling `createNote` → fails.)*

- **AC-NN2.2 (G-NEWNOTE-SELECTED-FOLDER):** GIVEN folder "Work" selected (`currentFolder='Work'`)
  WHEN New Note clicked THEN `createNote` called with `folder:'Work'`.

- **AC-NN2.3 (G-NEWNOTE-IN-LIST):** GIVEN the post-create `listNotes` mock returns the new note
  WHEN New Note completes THEN `loadList` re-runs with `{folder: currentFolder}` AND a list row
  with the new id is rendered.

- **AC-NN2.4 (G-NEWNOTE-OPENS-EDITABLE-TITLE):** GIVEN New Note completes THEN the
  `.browse-detail__title` input exists, is **focused** (`document.activeElement === input`) and
  editable (not disabled/readonly); AND typing a value into it + blur calls `editNote` with the
  typed title (end-to-end new-note → rename, exercising NN-1 through NN-2).

- **AC-NN2.5 (error path):** GIVEN `createNote` rejects with a `JinErrorDto` WHEN New Note clicked
  THEN an `app:error` event is dispatched AND the detail is not left in a broken half-open state.

---

## 4. Kupo micro-tasks (UI/markup/CSS)

- **K-NN-1 — New Note button + header markup** (`index.html` inside `.notes-list-pane` ~333):
  `.notes-list-pane__header` containing `.notes-new-note-btn`
  (`type=button`, `data-action="click->notes#newNote"`, `aria-label="New note"`,
  `<i data-lucide="square-pen" aria-hidden="true">` + optional sr label). Must live in the real
  `index.html` so the controller-driven gates (which inject `BODY_CONTENT`) wire the action.
- **K-NN-2 — Editable-title CSS** (`browse.css`; title rule today at `:178`):
  `.browse-detail__title--input` — full-width, transparent/borderless background, inherit
  `text-title2` size/weight/line, padding aligned with the old `<h2>` margin, focus ring via token
  (`--accent`/`--separator`), placeholder color `--label-tertiary`. Plus `.notes-list-pane__header`
  flex layout (label start, compose btn end; hairline `--separator`) and `.notes-new-note-btn`
  ghost-icon styling (tokens only, no raw hex), `tap-target` sizing, hover via `--fill-*`. Keep
  the existing `.notes-rail-reveal` positioning intact.

---

## 5. Risks

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R-CARET | Title commit re-rendering/remounting the body editor → lost edits + caret jump | **P0** | D-CARET-SAFE: no `renderNoteDetail`/`editorHandle` touch on commit; targeted DOM only; **G-TITLE-EDIT-SAVE** asserts `EditorView` + `.cm-editor` identity |
| R-RENAME-INTERACTION | `edit_note` title-change renames file (write-new/remove-old); a mid-flight body autosave could read a stale snapshot | **P1** | Focus transitions naturally serialize (CM6 blur→flush before title gains focus; title blur→commit before CM6 regains); each `edit_note` is a full read-modify-write touching only its own field (verified `ops/notes.rs:81-137`); D-CARET-SAFE adds a defensive `flush()` before the title `editNote`; ULID preserved so body saves still target the file (**G-TITLE-RENAME-BODY-SAVE-STILL-WORKS**) |
| R-LIST-ROW-SYNC | List row title stale after rename | **P1** | Targeted-DOM row update mirroring `onSave` (531-539); asserted in G-TITLE-EDIT-SAVE |
| R-EMPTY-TITLE-DISPLAY | Empty title rendered as "" / "undefined" | **P2** | `noteDisplayTitle` "Untitled" fallback (list) + placeholder (detail); G-TITLE-EMPTY-ALLOWED |
| R-DOUBLE-SAVE | Enter then blur firing `editNote` twice | **P2** | `committing` guard + baseline advance + dirty-check no-op; AC-NN1.2 |
| R-TEST-MIGRATION | Suite breaks / new gates can't run | **P1** | Add `createNote` to mock+import; migrate line 453 `.textContent`→`.value` (called out in NN-1/NN-2) |
| R-NODE | vitest crashes on system node v16 | **P1** | Run gates under Node ≥20 (nvm v24.x) |

---

## 6. Preserve (do not regress)

G-XSS (immovable, `notes_controller.test.ts:511-528`), G-SAVE-CARET-SAFE / G-SAVE-DIRTY /
G-AUTOSAVE / G-SAVE-DEBOUNCE / G-SAVE-ERROR, VG1.4, VG2.4/2.5, VG-FE, VG-FE-FOLDER-OPEN, folder
tree gates (G-TREE-*), live-preview + code gates, K2 template parity. Node ≥20.

---

## 7. Confidence

| Factor (25% ea.) | Score | Note |
|---|---|---|
| Pattern match | 0.92 | Mirrors `onSave` targeted-DOM + editor.ts module/controller split + existing controller-driven gate harness |
| Requirement clarity | 0.95 | Owner-locked decisions + firsthand-verified facts |
| Decomposition stability | 0.90 | 2 clean stories; NN-2 depends on NN-1 |
| Constraint compliance | 0.90 | Frontend-only confirmed; empty-title backend-safe confirmed; Node constraint known |

**Weighted ≈ 0.92 → AUTO_PROCEED.**
