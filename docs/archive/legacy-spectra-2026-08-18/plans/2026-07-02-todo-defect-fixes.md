# SPECTRA Spec — Jin GUI Tasks/ToDo: 4 defect fixes + 2 reusable UI components

- **methodology:** SPECTRA 4.10.0 · single-pass S→P→E→C→T→R→A (standard tier)
- **date:** 2026-07-02
- **repo:** `jin-gui/` (Tauri + Stimulus + TypeScript, "ink-and-seal")
- **producer:** SPECTRA · **consumer:** Vivi (Builder/coder)
- **inputs:** ATLAS scout report `.eidolons/scout/todo-defects-scout-report.md` + orchestrator corrections (verified against jin-core + user runtime observation)
- **status:** AUTO_PROCEED — confidence 88% (breakdown in §10)
- **conventions:** no `.spectra/setup/spectra-conventions.md` present → generic SPECTRA defaults, enriched by the project facts gathered in CLARIFY.

---

## 1. CLARIFY (intent, skip-justified)

CLARIFY questions were **not** asked: intent is unambiguous, constraints are explicit, and all root causes were independently re-verified against the live source and jin-core (§4). The orchestrator corrections resolve every scout GAP.

- **WHO** — Requester: project owner (macOS). Executor: Vivi. Reviewer: owner (visual sign-off) + drift-checker (identity-distinct).
- **WHAT** — Fix 4 defects in the Tasks suite (DT-1 broken New List modal, DT-2 dead edit/delete task buttons, DT-3 list filter + "amateur" selects, DT-4 board toggle no-op) AND ship 2 reusable UI primitives (a `JinModal` OOP base + `ConfirmDialog` subclass; a `JinSelect` component) so the DT-1/DT-2 class of bug becomes **impossible by construction**.
- **WHY** — The suite has no reusable modal/select primitives; every `<dialog>`/`<select>` is hand-duplicated, which is the shared root cause of the inconsistent scoping (DT-2), missing CSS (DT-1), and stripped-affordance selects (DT-3a). The owner wants correct-by-construction components with SOLID lifecycle.
- **CONSTRAINTS (hard):**
  1. No `window.prompt/alert/confirm` — webview no-ops (memory-confirmed). Native `<dialog>` + `showModal()` only.
  2. Every Lucide glyph must be import+export+map-registered in `src/lib/icons/index.ts` or it renders nothing. `chevron-down` **is** registered; plain `check` is **not**.
  3. Verify gate is **`make verify-gui`** (parent Makefile): `cargo fmt --check` + `cargo clippy -p jin-gui --all-targets -D warnings` + `cargo test -p jin-gui` + (`nvm use --lts`) `npm ci` + `tsc --noEmit` + `npm test` (**vitest**, not jest) + `npm run lint:css` (stylelint token discipline) + `vite build`.
  4. Node: latest LTS via `nvm use --lts` (pinned `v24.18.0`) before any build/test/lint.
  5. CSS must use defined design tokens only — `css_tokens.test.ts`/`token_discipline.test.ts` fail on undefined tokens; stylelint bans raw hex.
  6. Preserve the existing architecture: `transform.ts` (pure) → `render.ts` (DOM via `createElement` + callbacks) → thin Stimulus controller; native `<dialog>`+`showModal`; icon registry.
  7. **Canonicalize on list `id` as identity; resolve to `name` only for display.** Do **not** rewrite the filter (it is already correct-by-contract).

---

## 2. Scope

**Intent classification:** `BUG_SPEC` (DT-1..DT-4) ⊕ `REQUEST` (2 new components) → treated as a bounded `CHANGE` with two new-primitive sub-projects.

**In scope**
- `JinModal` base class + `ConfirmDialog` subclass; complete `.action-dialog__*` CSS (incl. the missing `__footer`/`__message`/`__body`).
- Adopt `JinModal` for: task delete, task edit, due-date (shared), New List.
- `JinSelect` component; replace the filter-bar native selects; keep id-valued options.
- List `id`/`name` canonicalization: detail pre-select, detail label display, and **all** task-create/move writers persist the `id`; the id≠name acceptance test.
- Board view for sectionless lists.

**Out of scope / Deferred**
- Fully-custom `role="listbox"` widget for `JinSelect` (rejected — §5, a11y risk). Deferred visual-richness follow-up only.
- Adopting `JinSelect` inside the detail editor selects and the capture list select — allowed but **deferred** to a visual follow-up; S5/S6 keep them native to stay parallelizable.
- One-time on-disk reconciliation of tasks whose `frontmatter.list` already holds a stale **name** (RISK-2) — flagged to owner, not auto-executed.
- Any change to jin-core (all fixes are GUI-side; jin-core already stores `frontmatter.list` as the id).

**Assumptions (risk-if-wrong)**
- A1: `frontmatter.list` is the list **id** for all correctly-written tasks. *Verified* — jin-core `create_task` stores `params.list` raw, defaulting to `"inbox"`; `rebuild.rs:143` binds it into the `list_name` column; `delete_list` reassigns by id-match. Risk-if-wrong: none (verified).
- A2: `showModal()` works in the webview (DT-1 modal *does* open, just unstyled). *Confirmed by user runtime observation.* Risk-if-wrong: low.
- A3: Relocating a callback-wired `<dialog>` to a body-level modal root does not break its behavior, because buttons are JS-wired (not Stimulus `data-action`) and the controller holds a direct reference (not a Stimulus target). *Design-guaranteed* (§5). Risk-if-wrong: medium → covered by the real-index.html wiring gate (§8, RISK-1).

**Complexity: 9/12** (extended tier). Scope breadth 3 (≈12 files, 2 new primitives, 7 stories) · Technical depth 2 (Stimulus + native dialog + OOP, well-understood) · Integration/coupling 3 (multi-consumer components, shared due-date dialog nesting a `calendar` controller + used by `capture`) · Uncertainty 1 (root causes confirmed).

---

## 3. Runtime-verified root causes (authoritative)

| Defect | Root cause (verified anchor) | Fix direction | Story |
|---|---|---|---|
| **DT-1** New List modal renders as an unstyled slab | Modal opens (`lists#openCreate → createDialogTarget.showModal()`), but markup uses bare `<form>` + `.action-dialog__footer` (`index.html:760,784`) and `.action-dialog__message` (`:855`), and **`.action-dialog__footer`/`__message`/`__body` have NO CSS rule** (`forms.css` defines only `.action-dialog`/`__inner`/`__header`/`__title`/`__form`, `:278-307`). | Complete the `.action-dialog__*` CSS in `JinModal` (S1) and adopt it for New List (S4) so styling is correct-by-construction. | S1 → S4 |
| **DT-2** Task row pen/trash (and due picker) do nothing | `editTaskDialog` (`index.html:2611`), `deleteTaskDialog` (`:2564`), `dueDateDialog` (`:2087`) live **outside** `<section data-controller="tasks">` (section = `index.html:719-1088`). Stimulus resolves targets only within the controller subtree, so `hasEditTaskDialogTarget`/`hasDeleteTaskDialogTarget`/`hasDueDateDialogTarget` are `false` and the handlers early-return (`tasks_controller.ts:921,976,436`). | Adopt `JinModal` (controller holds a direct reference + JS-wired buttons; self-hosts at a modal root) → target-scoping dependency removed entirely. | S1 → S2 (delete), S3 (edit + due) |
| **DT-3** List filter misbehaves; selects look "amateur" | (a) `.tasks-filter-bar select { appearance:none }` with **no** replacement chevron (`browse.css:1573-1586`). (b) The filter itself is **correct-by-contract** (`transform.ts:42` compares `task.list === filter.list` = id===id; option value = `l.id`). The real fault is that `task.list` is sometimes written as a **name** by buggy writers and displayed as a raw id. | (a) `JinSelect` supplies the chevron + ink-and-seal styling (S5). (b) Canonicalize on id: fix name-assuming writers + display (S6). **Do NOT touch the filter.** | S5, S6 |
| **DT-4** Board toggle blinks loading, no view change | Board render is gated on `if (selectedListId && this.currentSections.length > 0)` (`tasks_controller.ts:838`). A list with 0 sections (default Inbox, auto-selected on connect) always falls through to the flat `renderTasksList` branch (`:850-859`) which ignores `currentView`. `renderBoardView` (`render.ts:265`) already works when sections exist. | Render board view for sectionless lists (single default/"No Section" column) — relax the gate, not the renderer. | S7 |

**Correction the spec enforces (do NOT regress):** the status/priority/tag/**list** filter comparison in `filterTasksList` (`transform.ts:42`) is correct (id===id). Rewriting it to compare names would break the currently-correct path. The id/name bugs are exclusively in the *name-assuming* code — see S6.

---

## 4. Additional verified findings (beyond the scout)

1. **`render.ts:989`** detail list-select pre-select uses `if (l.name === task.list)` — wrong when id≠name (option value is already `l.id` at `:987`). → S6.
2. **`render.ts:796` / `:804`** render `task.list` (the raw id/ULID) as the detail label + `aria-label`. → S6 (resolve id→display name).
3. **`tasks_controller.ts:1048`** (loadDetail) `lists.find((l) => l.name === task.list)` — a *second* name-based lookup that leaves `availableSections` empty for user lists (id≠name). → S6 (fold in).
4. **`tasks_controller.ts:1010`** `handleCreateTask` calls `createTask({ title, due })` with **no list** → new in-list tasks always default to `"inbox"`, ignoring the selected list. → S6 (pass `currentListId`).
5. **`capture_controller.ts:202,271`** submit `list: this.captureListTarget.value` / `taskListTarget.value` where both targets are free-text `<input type="text">` for a list **name** (declared `HTMLInputElement`, `:109,124`). jin-core `create_task` (`tasks.rs:76`) stores this string **raw** — so capturing to "Inbox" (capital I) writes `frontmatter.list="Inbox" ≠ id "inbox"`, orphaning the task from the Inbox filter. → S6 (persist an id, never a free name/empty string).
6. **Shared `dueDateDialog` (`index.html:2087`)** carries BOTH `data-tasks-target` and `data-capture-target`, and **nests** `data-controller="calendar"` (`:2107`). `capture` (shell-scoped) already reaches it; `tasks` (section-scoped) cannot. → S3 handles this as the one dialog kept **in place** (id-based access), not relocated.
7. **Test harness truth:** runner is **vitest** (`vitest run`), jsdom is opt-in per file via `// @vitest-environment jsdom`. jsdom does **not** implement `showModal()`/`close()`; tests stub them (`notes_controller.test.ts:1459-1477`: `dialog.showModal = vi.fn(() => dialog.setAttribute('open',''))`). Any modal test must adopt this stub.
8. **Green-but-shallow proof:** `tasks_controller.test.ts:1352-1417` "wiring" tests parse hand-written inline HTML fragments via `parseHTML(...)` — they never load the real `index.html`, which is exactly why DT-2's mis-scoping shipped green (RISK-1).

---

## 5. Architecture decisions + rejected alternatives

### 5.1 `JinModal` — reusable modal base (OOP + SOLID)

**Decision:** a TypeScript class `JinModal` in a new `src/lib/ui/` primitives folder. Controllers hold a **direct reference** (composition) and call `.open()`/`.close()`; the modal **self-hosts** its `<dialog>` at a singleton modal root and **wires its own buttons via JS callbacks** — never via Stimulus `data-target`/`data-action`. This severs the modal from Stimulus subtree-scoping, which is the exact mechanism that broke DT-2, and matches the established `render.ts` callback convention.

- **Host:** `ensureModalRoot()` creates `#jin-modal-root` once (appended to `document.body`); every `JinModal` appends its dialog there → one stacking/backdrop context, scoping-independent.
- **Two acquisition modes** (both callback-wired):
  - `new JinModal(opts)` — builds a fresh dialog skeleton (`createElement`): `.action-dialog__inner > [__header(title + `.modal-close-btn`), __body slot, __footer slot]`. Used by `ConfirmDialog` and any new dialog.
  - `JinModal.fromElement(dialogEl, opts)` — adopts an existing markup `<dialog>`, strips its `data-action` button wiring, re-wires the primary/secondary buttons to injected callbacks, and (default) **relocates** it to the modal root. Option `host: 'in-place'` keeps it where it is — used **only** for the shared `dueDateDialog` (so `capture` + the nested `calendar` controller keep working).
- **Lifecycle (template-method / OCP):** `open()` → `beforeOpen()` hook → `dialog.showModal()` → focus first focusable → `onOpen()`. `close()` → `onClose()` → `dialog.close()` → restore prior focus. Backdrop click (`e.target === dialog`) and Escape (`cancel` event) both route through `close()`; each individually suppressible via `closeOnBackdrop`/`closeOnEscape` opts.
- **SOLID mapping:**
  - **SRP** — `JinModal` owns *only* the shell + lifecycle + a11y; content is a subclass/consumer concern.
  - **OCP** — subclasses override `buildBody()`/`buildFooter()`/`onConfirm()` template methods; the base is never edited to add a dialog.
  - **LSP** — every subclass honors the same `open()/close()/destroy()` contract and is drop-in wherever a `JinModal` is expected.
  - **ISP** — narrow surface (`open`,`close`,`destroy`,`setBody`,`setFooter` + lifecycle hooks); consumers depend only on what they use.
  - **DIP** — controllers depend on the `JinModal` abstraction, not on concrete dialog DOM or Stimulus targets.
- **CSS:** S1 also closes the CSS gap — canonical rules for `.action-dialog__body`, `.action-dialog__footer`, `.action-dialog__message` (tokens only), and reconciles `.form-actions` → treat `.action-dialog__footer` as the canonical footer (keep `.form-actions` as an alias selector so nothing else regresses).

**Rejected alternatives**
- *R-A1 — move the mis-scoped `<dialog>`s inside the tasks section, keep `data-action`.* Fixes DT-2 but leaves the shared due-date/capture coupling and the missing CSS; does not deliver the reusable primitive the owner asked for. Rejected (under-delivers, no reuse).
- *R-A2 — keep dialogs as Stimulus targets but co-locate.* Still couples every future modal to controller-subtree placement — the foot-gun persists. Rejected (OCP violation of intent).

### 5.2 `JinSelect` — Jin-customized select

**Decision:** `JinSelect` is an OOP wrapper (composition) over a **native `<select>`** kept as the source of truth: values stay `l.id`, the native `change` event still drives `tasks#applyFilter`, native keyboard/a11y are preserved. The wrapper adds the ink-and-seal chevron (`<i data-lucide="chevron-down">` — already registered) + seal-accent focus ring + consistent sizing via a `.jin-select`/`.jin-select__chevron` shell, and exposes a small API (`getValue`,`setValue`,`onChange`). This fully fixes DT-3a (missing affordance) with zero a11y regression and no id/value change.

**Rejected alternative**
- *R-S1 — fully-custom `role="listbox"` popup.* Richer visuals but must re-implement keyboard nav, focus trap, outside-click, ARIA, and positioning — a large a11y liability that re-introduces "reinvent native semantics" risk for a defect that is purely cosmetic. Rejected as over-engineering; documented as a deferred visual-richness path if the owner later wants swatch-rich option rows.

### 5.3 List id/name canonicalization

**Decision:** id is the identity everywhere; name is display-only. Fix the three name-assuming readers (render.ts:989 pre-select, render.ts:796/804 label, tasks_controller.ts:1048 section lookup) and the three writers (in-list create passes `currentListId`; capture persists an id, not a free name; detail `onSaveList` already persists id — keep). A display resolver `listNameById(lists, id)` renders the human name. The filter (`transform.ts:42`) is **untouched**.

---

## 6. Stories

Each story: user story · timebox · action plan · GIVEN/WHEN/THEN · files/anchors · validation gate · risk tag · deps. All stories pass INVEST.

### S1 — `JinModal` base component + complete `.action-dialog__*` CSS  · P0 · ≤3d · **foundational**
> As a Jin developer, I want one reusable modal primitive with a SOLID lifecycle and complete styling, so every modal shares look/feel/behavior and the scoping/CSS class of bug is impossible.

**Action plan:** Create `src/lib/ui/modal.ts` (`JinModal` + `ensureModalRoot()`); Create the `.action-dialog__body/__footer/__message` CSS in `src/styles/forms.css` (append after `:307`, tokens only) + reconcile `.form-actions`; Test in `src/__tests__/ui_modal.test.ts`.

- **GIVEN** a `new JinModal({ title, ariaLabel })`, **WHEN** `.open()` is called, **THEN** exactly one `<dialog class="action-dialog">` exists under `#jin-modal-root`, `dialog.open === true` (with the jsdom `showModal` stub), and focus lands on the first focusable element.
- **GIVEN** an open modal, **WHEN** the backdrop is clicked (`e.target === dialog`) or Escape fires, **THEN** `.close()` runs and `dialog.open === false` — unless `closeOnBackdrop`/`closeOnEscape` is `false`.
- **GIVEN** a subclass overriding `buildFooter()`, **WHEN** it opens, **THEN** the base shell is unchanged and only the footer differs (OCP proof).
- **GIVEN** the rendered dialog, **WHEN** styles are applied, **THEN** `.action-dialog__body`, `.action-dialog__footer`, `.action-dialog__message` all resolve to a defined CSS rule using design tokens (no raw hex).

**Files/anchors:** NEW `src/lib/ui/modal.ts`; `src/styles/forms.css` (`.action-dialog` block `:278-307` → append `__body/__footer/__message`); `src/lib/icons/index.ts` (verify `x` registered — it is).
**Validation gate:** `ui_modal.test.ts` green (stubs `HTMLDialogElement.prototype.showModal/close` per `notes_controller.test.ts:1459-1477`); `npm run lint:css` + `css_tokens.test.ts` pass; `tsc --noEmit` clean. **Owner visual sign-off** (VG-GUI-8) for the styled shell.
**Risk:** P0. **Deps:** none (start immediately).

### S2 — `ConfirmDialog` subclass + adopt for task delete → fixes DT-2 (delete)  · P0 · ≤2d
> As a user, I want the trash icon on a task row to open a styled confirm dialog and actually delete, so destructive actions work and look consistent.

**Action plan:** Create `src/lib/ui/confirm_dialog.ts` (`ConfirmDialog extends JinModal`: message + Cancel/Confirm, `variant:'danger'`, `onConfirm` callback); Modify `tasks_controller.ts` to instantiate a `ConfirmDialog` in `connect()` and open it from `openDeleteDialog` (remove the `hasDeleteTaskDialogTarget` guard + the mis-scoped `<dialog>` dependency); Delete/retire the `index.html:2560-2600` markup; Test in `ui_confirm_dialog.test.ts` + real-index wiring.

- **GIVEN** the tasks section rendered, **WHEN** a task row trash button is clicked, **THEN** a `ConfirmDialog` opens (`dialog.open === true`) showing `Delete "<title>"? This cannot be undone.` — regardless of DOM placement.
- **GIVEN** the confirm dialog open, **WHEN** Confirm is clicked, **THEN** `deleteTask(id)` is invoked once and the list reloads; **WHEN** Cancel/backdrop/Escape, **THEN** it closes and `deleteTask` is NOT called.
- **GIVEN** no `window.confirm` is used, **WHEN** the flow runs, **THEN** no native prompt/confirm is invoked (webview-safe).

**Files/anchors:** NEW `src/lib/ui/confirm_dialog.ts`; `tasks_controller.ts` `openDeleteDialog:975-981`, `closeDeleteTask:983-987`, `confirmDeleteTask:989-1004`, targets `:129-130,164-166`, `connect:232`; retire `index.html:2560-2600`.
**Validation gate:** delete works in `ui_confirm_dialog.test.ts` AND the real-index wiring test (S1-hosted, see §8) proves the trash button opens the dialog when mounted from the actual `index.html`; `make verify-gui` green.
**Risk:** P0. **Deps:** S1.

### S3 — Adopt `JinModal` for edit-task + due-date → fixes DT-2 (edit) + shared due-date nuance  · P0 · ≤3d
> As a user, I want the pencil (edit) and the due-date picker to open working, styled modals, without breaking the capture form's shared due-date dialog.

**Action plan:** Modify `tasks_controller.ts`: wrap `editTaskDialog` via `JinModal.fromElement` (relocate to modal root, callback-wire Save/Cancel), removing the `hasEditTaskDialogTarget` guard; wrap the shared `dueDateDialog` via `JinModal.fromElement(el, { host:'in-place' })` and access it by **id** (`document.getElementById('jin-due-date')`) so `openCalendarDialog` no longer depends on `hasDueDateDialogTarget` — the nested `calendar` controller and `capture`'s use are preserved. Keep `#jin-due-date` markup in place (`index.html:2087`); relocate/retire only the edit dialog markup (`:2607-2692`).

- **GIVEN** the tasks section, **WHEN** a task row pencil is clicked, **THEN** the edit modal opens with title/body/due prefilled; **WHEN** Save, **THEN** `editTask(id,{title,body,due})` runs and the list reloads.
- **GIVEN** the edit modal, **WHEN** "Pick due date" is clicked, **THEN** the shared due-date dialog opens with a working calendar; **WHEN** a date is chosen, **THEN** it applies to the edit form.
- **GIVEN** the `capture` form (shell-scoped), **WHEN** it opens the same `#jin-due-date`, **THEN** it still works (no regression from the tasks adoption) — asserted explicitly.

**Files/anchors:** `tasks_controller.ts` `openEditDialog:920-936`, `saveEditTask:944-971`, `openDuePicker:422-426`, `openCalendarDialog:435-517` (guard `:436`), `dueDateDialog` target `:145,186`; `index.html` editTaskDialog `:2607-2692`, dueDateDialog `:2087-2145`, nested `calendar` `:2107`.
**Validation gate:** edit opens+saves and due-date opens in tests mounted from real `index.html`; a **capture-regression test** confirms `#jin-due-date` still opens from the capture path; `make verify-gui` green.
**Risk:** P0. **Deps:** S1. (RISK-5 — shared dialog; see §8.)

### S4 — Adopt `JinModal` for New List (+) with complete styling → fixes DT-1  · P1 · ≤2d
> As a user, I want the New List modal to render as a proper ink-and-seal dialog (not an unstyled slab).

**Action plan:** Modify `lists_controller.ts` to open the create/edit/delete list dialogs via `JinModal` (or `.fromElement`), inheriting the S1 CSS; normalize the lists dialog markup (`index.html:755-870`) to `.action-dialog__inner/__body/__footer` so `__footer`/`__message` now resolve.

- **GIVEN** the lists rail, **WHEN** the `+` (New list) button is clicked, **THEN** a fully-styled modal opens (header, body, footer all styled; no unstyled slab).
- **GIVEN** the modal, **WHEN** a name + color is entered and Create is clicked, **THEN** `create_list` runs and the rail refreshes; **WHEN** Cancel/backdrop/Escape, **THEN** it closes with no write.
- **GIVEN** edit-list and delete-list, **WHEN** opened, **THEN** they share the same styled shell (`.action-dialog__footer`/`__message` resolve).

**Files/anchors:** `lists_controller.ts` `openCreate:140-150`, `openEdit:~185`, `openDelete:~230`; `index.html` create `:755-797`, edit `:800-845`, delete `:848-870`.
**Validation gate:** lists dialogs render with resolved `.action-dialog__footer`/`__message` rules; `lists_controller.test.ts` still green; **owner visual sign-off** the New List modal renders correctly (VG-GUI-8). `make verify-gui` green.
**Risk:** P1. **Deps:** S1.

### S5 — `JinSelect` component; replace filter-bar natives → fixes DT-3(a)  · P1 · ≤2d · **independent**
> As a user, I want the filter selects to look like polished ink-and-seal controls with a clear dropdown affordance, while filtering exactly as before.

**Action plan:** Create `src/lib/ui/select.ts` (`JinSelect` wraps a native `<select>`: `.jin-select` shell + `.jin-select__chevron` ChevronDown + seal focus ring; `getValue/setValue/onChange`); add CSS in `forms.css`/`browse.css` replacing the bare `appearance:none` (`browse.css:1573-1586`) with the chevron affordance; enhance the 4 filter selects (`index.html:881-926`) + sort-mode (`:930-941`). **Values remain `l.id`; `change→tasks#applyFilter` unchanged.**

- **GIVEN** the filter bar, **WHEN** rendered, **THEN** each select shows a visible chevron affordance and ink-and-seal styling (not a raw box).
- **GIVEN** a `JinSelect`, **WHEN** the user changes the value, **THEN** the native `change` event still fires and `tasks#applyFilter` re-filters; the emitted value is the option `value` (list `id` for the list filter).
- **GIVEN** keyboard users, **WHEN** they focus and operate the select, **THEN** native keyboard behavior + ARIA are preserved (no custom listbox).

**Files/anchors:** NEW `src/lib/ui/select.ts`; `browse.css:1573-1586` (`.tasks-filter-bar select`); `forms.css:139-169` (`.form-select`); `index.html:879-953`; `src/lib/icons/index.ts` (`chevron-down` already registered — no new import needed unless a selected-tick glyph is added, then register `Check`).
**Validation gate:** `ui_select.test.ts` proves `change` still fires + value pass-through; `lint:css`/`css_tokens.test.ts` pass (chevron via token-defined styling, no raw hex); **owner visual sign-off**. `make verify-gui` green.
**Risk:** P1. **Deps:** none (parallel with S1/S6/S7).

### S6 — List id/name canonicalization + writers persist id + id≠name test → fixes DT-3(b)  · P0 · ≤3d · **independent**
> As a user, I want the List filter, detail pre-select, and list labels to work for user lists whose id≠name, and every created/moved task to land in the intended list.

**Action plan (readers):** `render.ts:989` pre-select `l.name === task.list` → `l.id === task.list`; `render.ts:796/804` label → `listNameById(availableLists, task.list)` (new pure helper in `lib/lists/transform.ts`, id→name, falling back to the id if unknown); `tasks_controller.ts:1048` `lists.find(l => l.name === task.list)` → `l.id === task.list` (pass `availableLists` into the detail renderer so the resolver has data).
**Action plan (writers):** `tasks_controller.ts:1010` `handleCreateTask` → `createTask({ title, due, list: this.currentListId ?? undefined })` (never empty string); `capture_controller.ts:202,271` → persist an **id** (convert the free-text list `<input>` to an id-valued native `<select>` populated via `populateListFilter`, OR resolve name→id before submit; MUST NOT send a free name or empty string). `onSaveList` (`tasks_controller.ts:1085`) already persists id — keep.

- **GIVEN** a user list `{id:'proj-1', name:'Project One'}` and Inbox `{id:'inbox', name:'Inbox'}` (id≠name; case differs), a task with `list:'proj-1'`, **WHEN** the List filter is set to `proj-1`, **THEN** the task appears (filter unchanged, still correct).
- **GIVEN** that task's detail, **WHEN** the detail renders, **THEN** the list `<select>` pre-selects "Project One" (via `l.id === task.list`) and the read-only label shows **"Project One"**, not `proj-1`.
- **GIVEN** the List filter set to `proj-1`, **WHEN** a task is created via the in-list add row, **THEN** it persists `list:'proj-1'` (not `inbox`, not `''`).
- **GIVEN** capture with a chosen list, **WHEN** submitted, **THEN** `frontmatter.list` is the list **id** (never a display name or empty string).

**Files/anchors:** `render.ts:796,804,987-989`; NEW `listNameById()` in `lib/lists/transform.ts`; `tasks_controller.ts:1010,1042-1048,1085`; `capture_controller.ts:202,271` + list-target markup (`index.html` capture form); jin-core context (read-only): `tasks.rs:76`, `rebuild.rs:143`, `lists.rs:19-20`.
**Validation gate:** NEW `describe('id≠name canonicalization')` in `tasks_controller.test.ts` using the `{proj-1/Project One}` + `{inbox/Inbox}` fixtures — asserts filter, detail pre-select, label, in-list create list, and capture create list. **This test MUST break the existing id==name fixture pattern** (`:62,206-234`). `make verify-gui` green.
**Risk:** P0. **Deps:** none (parallel). Soft link to S5: capture list select MAY adopt `JinSelect` later (visual-only follow-up) — keep native here to stay independent.

### S7 — Board view for sectionless lists → fixes DT-4  · P1 · ≤1d · **independent**
> As a user, I want the List/Board toggle to actually switch to board view even for a list with no sections (e.g. default Inbox).

**Action plan:** Modify `tasks_controller.ts:838` — when `currentView === 'board'` render board even when `currentSections.length === 0`, synthesizing a single default/"No Section" column. Ensure `renderBoardView` (`render.ts:265`) tolerates an empty sections array (render a single default column). Keep the flat-list branch for list view.

- **GIVEN** a sectionless list (Inbox) with the view set to board, **WHEN** `loadList` runs, **THEN** `renderBoardView` renders a single "No Section" column of that list's tasks (not the flat list).
- **GIVEN** the toggle button, **WHEN** clicked from list→board on a sectionless list, **THEN** the view visibly changes to board (not just a loading blink) and the preference persists via `editList(id,{view})`.
- **GIVEN** a list with ≥1 section, **WHEN** board is selected, **THEN** existing multi-section board behavior is unchanged (no regression).

**Files/anchors:** `tasks_controller.ts:838-859` (gate + branches), `toggleView:293-304` (guard `:294`); `render.ts:265` `renderBoardView` (+ empty-sections handling).
**Validation gate:** unit test: given `currentView='board'` and `currentSections=[]`, `loadList` calls the board renderer with a single default column (spy/branch assertion); regression test for the ≥1-section path; `make verify-gui` green.
**Risk:** P1. **Deps:** none (parallel).

---

## 7. Build order & parallelization

```
Wave A (parallel, start now):   S1 ─┐        S5      S6      S7
                                    │  (independent of each other)
Wave B (after S1):                  ├─ S2 ── (delete)
                                    ├─ S3 ── (edit + due-date)
                                    └─ S4 ── (New List)
```

- **S1 is the only blocker** — S2/S3/S4 inherit from `JinModal`, so S1 must land first. S2, S3, S4 are independent of each other → parallelizable within Wave B.
- **S5, S6, S7 are fully independent** of the modal chain and of each other → run in Wave A alongside S1.
- **Vivi dispatch recommendation:** dispatch S1+S5+S6+S7 in parallel first; on S1 merge, dispatch S2+S3+S4 in parallel. S3 carries the shared-dialog nuance (RISK-5) — give it the diagnostic-class agent + the capture-regression gate.

**Independent (parallel):** S1, S5, S6, S7. **Dependent (need S1):** S2, S3, S4.

---

## 8. Risk register

| ID | Risk | Tier | Mitigation (acceptance-anchored) |
|---|---|---|---|
| **RISK-1** | Green-but-shallow tests: existing "wiring" tests parse inline HTML fragments (`tasks_controller.test.ts:1352-1417`) and use id==name fixtures — they masked DT-2 and DT-3(b). | **H** | S2/S3/S4 gates REQUIRE a real-index wiring test: `readFileSync('index.html')` → mount the tasks `<section>` + `#jin-modal-root`, start a Stimulus `Application`, register `tasks`/`lists`/`capture`, **stub `HTMLDialogElement.prototype.showModal/close`**, then assert the pen/trash/due buttons actually open their modal (`dialog.open === true`). S6 gate REQUIRES the id≠name fixture. |
| **RISK-2** | Migration: tasks already on disk (e.g. created via the buggy capture path) may hold a **name** in `frontmatter.list`; the fix is forward-only so those remain orphaned from the id-based filter. `delete_list` only reassigns by id-match (`lists.rs:300`). | **M** | Do NOT silently auto-migrate. Flag to owner; propose an optional one-time reconciliation (map dangling `frontmatter.list` names → ids, else → `inbox`) as a separate, owner-approved task. Document in the PR. |
| **RISK-3** | Visual-only verification gap (VG-GUI-8: logic verified, visuals NOT). Logic gates don't prove the modal/select actually *look* right (memory: Jin GUI CSS/visual gap). | **M** | S1/S4/S5 gates REQUIRE owner screenshot sign-off per `docs/gui-testing.md §5`. New CSS uses tokens only (guarded by `css_tokens.test.ts` + stylelint). |
| **RISK-4** | jsdom lacks `showModal()`/`close()` → naive modal tests throw. | **M** | All modal tests stub `showModal/close` per the `notes_controller.test.ts:1459-1477` pattern; spec calls this out in S1/S2/S3 gates. |
| **RISK-5** | Shared `dueDateDialog` (`index.html:2087`) is used by `capture` and nests a `calendar` controller; relocating it would break both. | **M** | S3 keeps it **in place** (`JinModal.fromElement(..., {host:'in-place'})`) + id-based access; adds an explicit **capture-regression** assertion that `#jin-due-date` still opens from capture. |
| **RISK-6** | Unregistered Lucide glyph renders nothing. | **L** | `chevron-down` already registered. If S5 adds a selected-option tick, register `Check` (import+export+map in `icons/index.ts`); prefer a CSS-drawn chevron to avoid new registry surface. |
| **RISK-7** | New CSS violates token discipline (raw hex / undefined token). | **L** | `npm run lint:css` (stylelint) + `css_tokens.test.ts` in every visual story's gate. |

---

## 9. TEST-phase verification (6 layers)

- **Structural:** 7 stories, hierarchy intact, no orphaned tasks; S1 foundational, S2/S3/S4 depend only on S1, S5/S6/S7 independent — clean DAG.
- **Self-consistency:** three decompositions (by-defect, by-component, by-file) converge on the same 7 units (>70% overlap) — decomposition stable.
- **Dependency:** every touched file/anchor validated against live source (§3-§4); call sites for the id/name change enumerated (readers ×3, writers ×3); migration path (RISK-2) defined.
- **Constraint:** no `window.*` prompts; icon-registry rule honored; `make verify-gui` gate wired into every story; tokens-only CSS; vitest+jsdom+showModal-stub reality captured.
- **Process-reward:** S1-before-derivatives ordering minimizes rework; parallelization maximizes throughput; the "do NOT touch the filter" guard prevents a correctness regression.
- **Adversarial:** the two highest-value skeptical challenges — "your tests will pass without proving anything" (RISK-1 → real-index wiring gate) and "you'll break the currently-working list filter" (§3 guard) — are both pinned with explicit gates.

---

## 10. Confidence report

**AUTO_PROCEED — 88%.** Factors (25% each):
- **Pattern match — 80%:** dialog/select patterns are well-inventoried, but `JinModal`/`JinSelect` are GENERATE (new primitives), not template-reuse.
- **Requirement clarity — 96%:** orchestrator corrections + independent verification resolved every scout GAP; root causes confirmed at the line level.
- **Decomposition stability — 90%:** 3 decompositions converge; stories INVEST-clean; timeboxes ≤3d.
- **Constraint compliance — 90%:** all hard constraints identified and gate-anchored; residual is the irreducible visual-verification gap (RISK-3), mitigated by owner sign-off.

---

## 11. Preflight checklist

- [x] CLARIFY ran (skip of questions justified) · [x] conventions absent → generic defaults documented · [x] complexity 9/12, extended tier · [x] 3+ distinct hypotheses per component with rejected alternatives (§5) · [x] all stories INVEST · [x] timeboxes valid (≤3d, no points) · [x] hierarchy uses Project/Story (no "Epic") · [x] GIVEN/WHEN/THEN on every story · [x] agent hints + context files + gates per story · [x] dual output (this .md + `.yaml` sibling) · [x] confidence with factor breakdown · [x] artifact under `.spectra/` · [x] no code produced (spec only) · [x] rejected alternatives documented.
