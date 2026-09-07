# ATLAS Scout Report — Jin ToDo/Tasks: close the loop to feature-complete

**MISSION-ID:** JIN-TODO-002 · **Date:** 2026-07-14 · **Repo:** repository root @ `43c824b`
**Consumer:** RAMZA (spec author). Plan from this file; do not re-read the codebase.
**Read-only mission.** No file in the product surface was modified.

---

## 1. Mission recap

Owner reports the Tasks section is UX-chaotic and functionally incomplete:
1. List vs board layouts "aren't divided properly, they confuse the user when switching"
2. "The ToDo list sidebar is out of functionality"
3. "Per item management is a mess, it changes pages or controls through the same page"
4. "Item management is incomplete and the UX is chaotic"

All four complaints are **reproduced in code** below, plus **three defects the owner did not report** — one of which is silent data loss.

---

## 2. Topology (the full Tasks surface)

**Rust core — `jin-core/`**
- `src/model/task.rs:100-134` — `TaskFrontmatter`: the ground-truth field set.
- `src/model/task.rs:42-62` — `TaskStatus::can_transition_to` — enforced 5-state machine.
- `src/model/task.rs:64-72` — `Priority` enum: **none | low | medium | high** (no "critical").
- `src/dto/task.rs:28-47` — `TaskDto`. **`body` is populated ONLY on `get_task`; `list_tasks` returns `body: ""`** (`dto/task.rs:104`).
- `src/ops/tasks.rs` — `create_task`, `get_task`, `list_tasks`, `transition_task`, `edit_task`, `delete_task` (soft), `move_task`, `reseed_positions`. **0 in-file unit tests.**
- `src/ops/lists.rs` (1050 L, 12 tests) — lists + sections. `src/ops/tags.rs` (347 L, 6 tests). `src/order.rs` (13 tests) — fractional ranks.
- `src/index/rebuild.rs:143` + `src/index/query.rs:253` — the SQLite `list_name` column actually stores the **list id**; filter is `list_name = '<id>'`.

**Tauri bridge — `jin-gui/src-tauri/src/commands/tasks.rs`** (+ `lists.rs`, `tags.rs`)
- 8 task commands, 5 list, 4 section, 2 tag — all registered in `src-tauri/src/lib.rs:25-64`.
- `EditTaskInput` (`commands/tasks.rs:50-69`) has **no `status` field** — status is a separate state-machine command.
- Bridge is **1:1 complete with core**. Every core capability has an invoke wrapper (`jin-gui/src/invoke.ts:119-309`). **The gap is entirely in the GUI layer.**

**GUI — `jin-gui/src/`**
- `controllers/tasks_controller.ts` (1267 L) — the god-controller: filters, view switch, sections, detail, modals, DnD, calendar.
- `controllers/lists_controller.ts` (347 L) — the sidebar rail.
- `lib/tasks/render.ts` (1785 L) — **three** renderers + **two different item renderers** (see §4).
- `lib/tasks/transform.ts` (324 L) · `lib/tasks/rank.ts` (99 L) · `lib/lists/{render,transform}.ts`
- `lib/ui/modal.ts` (367 L, `JinModal`) · `confirm_dialog.ts` · `select.ts` (`JinSelect` — cosmetic wrapper, native `<select>` stays source of truth).
- `index.html:716-1130` — the Tasks `<section>`: lists rail (730-917), filter bar (922-996), section dialogs (1001-1060), list panel (920-1093), detail panel (1095-1128).
- CSS: **all task classes live in `src/styles/browse.css`** (single file).

**Data flow:** `list_tasks` → `TaskDto[]` (body="") → `filterTasksList` → `sortTasksForMode` → one of 3 renderers → DOM. Detail is a *separate* fetch: `getTaskById` → full DTO (body populated) → `renderTaskDetail`.

---

## 3. THE GAP TABLE (heart of the mission)

Legend: **FULL** = exposed & correct · **PARTIAL** · **BROKEN** = exposed but errors/loses data · **DEAD** = core+bridge exist, zero GUI callers · **ABSENT** = not in core either.

| Capability | Core | Bridge | List row | Board card | Detail | Capture | Verdict |
|---|---|---|---|---|---|---|---|
| `title` | ✓ | ✓ | edit modal | display | inline edit | ✓ | **FULL** |
| `body` (notes) | ✓ | ✓ | **WIPES IT** | — | textarea ✓ | ✓ | **BROKEN — data loss (D1)** |
| `status` (5-state FSM) | ✓ | `set_task_status` | done↔todo toggle | toggle | 4-option select | ✗ | **BROKEN (D2)** |
| `priority` (4 values) | ✓ | ✓ | badge + filter | glyph | select w/ phantom 5th | ✓ | **BROKEN (D3)** |
| `due` (date/datetime) | ✓ | ✓ | chip + reschedule + calendar | chip | picker + clear | ✓ | **FULL** |
| `list` (id) | ✓ | ✓ | filter select | — | select | ✓ | FULL *(see D7)* |
| `section_id` | ✓ | ✓ | groups + add/rename/del | columns | select | ✗ | PARTIAL (no reorder) |
| `tags` | ✓ | ✓ | chips + filter | chips | tag editor | **✗ cannot tag** | PARTIAL |
| `position` (frac. rank) | ✓ | `move_task`/`reseed` | DnD ✓ | DnD ✓ | — | — | **FULL** |
| `reminders` | ✓ stored | ✓ | ✗ | ✗ | editor ✓ | ✗ | PARTIAL — **never fires** (no scheduler anywhere) |
| soft-delete | ✓ | ✓ | delete btn | **✗ none** | **✗ none** | — | PARTIAL (D4) |
| `completed_at` | ✓ | ✓ | ✗ | ✗ | ✗ | — | **IGNORED** (never surfaced) |
| `backlinks` / `links` | ✓ | ✓ | ✗ | ✗ | ✓ | — | detail-only |
| `list.view` (list/board) | ✓ | `edit_list` | toggle btn | — | — | — | **BROKEN (D5)** |
| `list.sort_mode` | ✓ | `edit_list` | select ✓ | **IGNORED** | — | — | PARTIAL (D6) |
| list reorder | ✓ | `reorderList` | **0 callers** | — | — | — | **DEAD** |
| section reorder | ✓ | `reorderSection` | **0 callers** | — | — | — | **DEAD** |
| tag color | ✓ | `setTagColor` | **0 callers** | — | — | — | **DEAD** |
| `list.parent_id` (nesting) | ✓ (`model/list.rs:34`) | ✓ | flat rail | — | — | — | **IGNORED** |
| tag create/rename/delete | ✗ (only implicit `ensure_tag`) | ✗ | — | — | — | — | **ABSENT from core** |
| subtasks | ✗ | ✗ | — | — | — | — | **ABSENT** |
| recurrence | ✗ (events only) | ✗ | — | — | — | — | **ABSENT** |

---

## 4. Defects, ranked

### D1 — Editing a task from the list row SILENTLY ERASES its notes/body. `[H]` **DATA LOSS**
The chain:
- `jin-core/src/dto/task.rs:104` — `list_tasks` path sets `body: String::new()`.
- `lib/tasks/render.ts:1336` — `onEditRequest(task.id, task.title, task.body ?? '', task.due ?? null)` — `task` came from `list_tasks`, so **body is always `""`**.
- `tasks_controller.ts:1001` — prefills the textarea with that `""`.
- `tasks_controller.ts:1034,1039` — reads it back and calls `editTask(id, { title, body, due })` with `body: ""`.
- `jin-core/src/ops/tasks.rs:194-197` — `if let Some(body) = params.body { task.body = body; }` → **overwrites the real body with empty**.

The edit modal never calls `getTaskById`. Renaming a task via the pencil button destroys its notes.
**Why tests miss it:** `tasks_controller.test.ts:741` asserts `onEditRequest` fires with `'Old notes'` — because the fixture hand-feeds a body the real `list_tasks` flow never carries. Green-but-shallow.

### D2 — Detail status select offers illegal transitions. `[H]`
`render.ts:899` offers all 4 statuses. Core rejects `done→doing`, `done→cancelled`, `cancelled→doing`, `cancelled→done` (`model/task.rs:49-61`; `transition_task` returns `InvalidStateTransition`, `ops/tasks.rs:136-141`). The Rust suite *proves* these are rejected (`jin/tests/s4_tasks_notes_crud.rs:206,237,261`). The detail callback `onSaveStatus` (`tasks_controller.ts:1152-1155`) has **no try/catch** → unhandled rejection, select silently snaps back.

### D3 — Phantom `critical` priority. `[H]`
`render.ts:921` — `PRIORITY_OPTIONS = ['none','low','medium','high','critical']`. `critical` exists **nowhere** in jin-core; `parse_priority` (`commands/tasks.rs:91-107`) hard-errors on it. `onSavePriority` (`tasks_controller.ts:1156-1158`) has no catch → picking "Critical" silently does nothing.

### D4 — Per-item management is three inconsistent surfaces. `[H]` (owner complaint #3, #4)
| Entry point | Mechanism | Fields |
|---|---|---|
| Row pencil btn (`render.ts:1332`) | **JinModal** overlay | title, body, due *(and wipes body — D1)* |
| Row click / card click (`render.ts:1294`, `580`) | **PAGE SWAP** — `loadDetail` hides `listPanel`, shows `detailPanel` (`tasks_controller.ts:1116-1117`); back via `showList()` (`:966-969`) | status, priority, due, list, section, tags, body, reminders, backlinks |
| Row hover trash (`render.ts:1340`) | `ConfirmDialog` | delete |
| Inline row controls | direct | status toggle, due chip reschedule, drag |

Two *different* editors for the same task, with **disjoint field sets**, reachable one click apart. The modal is a strict subset of the page-swap and is the one that corrupts data. **The detail (page-swap) view has no delete button at all** — `TaskDetailCallbacks` (`render.ts:129-150`) has no `onDelete`.

### D5 — Board view is unreachable from "All Lists"; view toggle is a dead button there. `[H]` (owner complaint #1)
`toggleView()` (`tasks_controller.ts:348-359`) starts with `if (!this.currentListId) return;`. `currentListId` is null whenever the list filter is "All Lists" (`index.html:958`). The toggle button (`index.html:987-995`) stays **visible and enabled** and does nothing. Same for `sortModeChange()` (`:367-368`).
Worse: **view is persisted per-list** (`ListDto.view`, written by `editList`). `loadList` re-reads it on every list change (`:816-828`), so **switching lists silently changes the layout** — list A is a board, list B is a list. That is precisely "they confuse the user when switching."

### D6 — List and Board are two different components, not two skins. `[H]` (owner complaint #1)
- List → `buildTaskRow` (`render.ts:1149`), built by **cloning an HTML `<template>`**, classes `task-row__*`.
- Board → `buildTaskCard` (`render.ts:479`), built by **imperative `createElement`**, classes `task-card__*`.

Divergences that change what the user can *do*:
| | List | Board |
|---|---|---|
| edit button | ✓ | **✗** |
| delete button | ✓ | **✗** |
| add-task row | ✓ (per section, `render.ts:328-330`) | **✗** (`buildBoardColumn:336-366` never adds one) |
| honors `sort_mode` | ✓ | **✗ hardcoded `'manual'`** (`render.ts:359`) |
| priority | badge + label | glyph only |

So switching to Board *silently removes* create/edit/delete. Shared: only `groupTasksBySection`, `buildSectionHeader`, `buildDueChipGroup`, `buildTagChips`, DnD callbacks.

### D7 — `task.list` id-vs-name: code is FIXED, data is NOT migrated. `[H code / L disk]` (verifies the known risk)
Code side is now **correct**: `listSelectOptions` emits `value: l.id` (`lib/lists/transform.ts:61-69`), capture uses id-valued selects (`capture_controller.ts:15,171-172,222`), detail looks sections up by id (`tasks_controller.ts:1136-1138`). Do not "fix" `filterTasksList` — it is correct by contract.
**Still live:** there is **no forward migration anywhere** — grep for migrate/orphan/repair across `ops/tasks.rs`, `ops/lists.rs`, `index/rebuild.rs` returns nothing. Any task written *before* the fix still holds a list **name** in `frontmatter.list`, so:
- it matches **no** id-based filter (`index/query.rs:253`) → invisible in every list view;
- it is excluded from `task_count` (`query.rs:400`);
- it is visible **only** under "All Lists" — and `connectAutoSelect` (`tasks_controller.ts:297-305`) **auto-selects Inbox on open**, so by default the user never sees it.
**Not verifiable from this machine** (no Jin store on this Linux box; owner runs macOS) — see GAPS.

### D8 — The sidebar rail is stateless and stale. `[H]` (owner complaint #2)
The rail **is** wired (`selectList` sets the filter select + dispatches `change` → `applyFilter`; `lists_controller.ts:181-185`). Its problems are that it never reflects or refreshes state:
- **No selected/active indicator.** `buildListRow` (`lib/lists/render.ts:105-146`) sets only `lists-rail__row--default`. No `aria-current`, no active class. The rail never shows which list you are in.
- **Counts go stale.** `loadLists()` runs on connect and after *list* CRUD only (`lists_controller.ts:135,219,266,300`). Nothing re-runs it after **task** create/delete/move → `task_count` badges are wrong until reload.
- **Two competing controls for one concept:** the rail *and* the `#tasks-list-filter` select (`index.html:951-959`, which is simultaneously `data-tasks-target="listFilter"` and `data-lists-target="filterSelect"`).
- **Missing:** no "All Lists" row, no smart views (Today/Upcoming/Completed), no list drag-reorder (`reorderList` has 0 callers), no nesting (`parent_id` ignored), no tag section.

### D9 — Modal convention violated by the section dialogs. `[M]`
`JinModal` is used for: task edit (`tasks_controller.ts:268`), task delete (`ConfirmDialog`, `:234`), and all three list dialogs (`lists_controller.ts:109,116,129`). But **add-section and delete-section remain raw `<dialog>` + Stimulus targets** (`index.html:1001,1042`; targets at `tasks_controller.ts:136-140`). They work only because they sit inside the `tasks` subtree — exactly the DT-2 foot-gun the convention exists to prevent.

### D10 — Silent failure everywhere in the detail editor. `[M]`
`onSavePriority`, `onSaveBody`, `onSaveSection`, `onSaveTags`, `onClearDue` (`tasks_controller.ts:1149-1186`) are bare `await editTask(...)` with **no try/catch and no `app:error` dispatch** — unlike `loadList`/`confirmDeleteTask`, which do dispatch. Any bridge error is an unhandled rejection; the UI shows nothing.

---

## 5. Test surface

| File | Size | Covers | Misses |
|---|---|---|---|
| `jin-gui/src/__tests__/tasks_controller.test.ts` | 2262 L, 38 describes | transforms, renderers, DnD, sections, board render, ITEM 5 detail fields, S6 id≠name, DT-4 board gate | **D1** (fixture-masked), **D2**, **D3**, board edit/delete absence, view-toggle no-op |
| `tasks_lists_modal_wiring.test.ts` | 654 L | mounts REAL `index.html`; modal wiring (anti-DT-2 gate) | section dialogs |
| `tasks_dnd_autoselect.test.ts` | 327 L | auto-select + drag | — |
| `lists_controller.test.ts` | 340 L | rail CRUD | active state, count refresh |
| `jin/tests/s4_tasks_notes_crud.rs` | 992 L, 36 tests | **CLI-driven**: full state machine incl. the 3 illegal transitions, edit title/priority/due/list, filters | sections, tags-on-task, reminders, `move_task`/`reseed` |
| `src-tauri/tests/bridge.rs` | 53 tests | promote/agenda hero flow | task command edit/status paths |
| `jin-core/src/ops/tasks.rs` | — | **0 in-file unit tests** | everything (only covered indirectly via CLI) |

**Immovable gate for any fix:** `s4_tasks_notes_crud.rs:206,237,261` already assert the illegal transitions are rejected — the GUI must not offer them.

---

## 6. Recommended next actions (ranked)

1. **→ APIVR-Δ (hotfix, ship alone):** D1 body-wipe. Make `openEditDialog` `await getTaskById(id)` before prefilling, **or** omit `body` from the `editTask` payload when the modal never loaded one. Add a test that drives the modal from a `list_tasks`-shaped DTO (`body: ''`). This is live data loss.
2. **→ SPECTRA:** D2 + D3 + D10 — "make the detail editor honest": derive `STATUS_OPTIONS` from the FSM's legal next-states for the current status; delete `'critical'`; wrap every detail save in the existing `app:error` dispatch path.
3. **→ SPECTRA:** D4 + D6 — **unify per-item management.** Decision needed: collapse to ONE task editor. Recommend: kill the row edit-modal, make the detail a **JinModal overlay** (not a page swap), and give board cards the same action cluster as list rows by extracting a shared `buildTaskItem(variant: 'row'|'card')`. This closes complaints #1, #3, #4 together.
4. **→ SPECTRA:** D5 — view/sort controls. Either disable+tooltip the toggle when "All Lists" is active, or (better) hoist view state to a per-*section* UI preference rather than a per-list persisted field, so switching lists does not silently reflow the layout.
5. **→ SPECTRA:** D8 — sidebar rail: active state + `aria-current`, refresh counts on task CRUD (dispatch a `jin:tasks-changed` event → `ListsController#loadLists`), add "All Lists" row, wire the **dead** `reorderList`.
6. **→ APIVR-Δ:** wire the 3 dead bridge fns — `reorderList`, `reorderSection`, `setTagColor`.
7. **→ human (owner decision):** D7 on-disk migration. A one-time idempotent forward migration (task frontmatter: dangling list *name* → id via current lists, else `"inbox"`) was deliberately never auto-run. **Ask before running.** Cheap interim probe: open the app, select "All Lists", and look for tasks that vanish under every specific list filter.
8. **→ human (scope):** subtasks, recurrence, and reminder *firing* are **absent from core**, not just the GUI. "Feature complete" for a Todoist-class app arguably needs subtasks + reminder notifications; both require a core model change (new frontmatter fields + a scheduler). Confirm whether these are in scope for this wave.
9. **→ APIVR-Δ (cleanup):** D9 — port the two section dialogs to `JinModal`.

---

## 7. Risks & gaps

- **GAP-1 `[L]`** — D7's on-disk half is **unverified**: no Jin store exists on this machine (owner runs the app on macOS). Only the owner's real store can confirm whether orphaned tasks exist. Everything asserted about the *code* path is `[H]`.
- **RISK-1 `[H]`** — Fixing D1 by "just calling `getTaskById`" without also fixing D4 preserves the two-editor confusion. Sequence D1 as a hotfix, then do D4 properly.
- **RISK-2 `[M]`** — `tasks_controller.ts` is a 1267-line god-controller and `render.ts` is 1785 lines. The D4/D6 unification is a real refactor; the anti-DT-2 gate (`tasks_lists_modal_wiring.test.ts`, mounts real `index.html`) must stay green throughout.
- **RISK-3 `[M]`** — All task CSS lives in one file (`browse.css`) and the project has a known "logic gates don't catch visual regressions" history. Any renderer unification needs an owner screenshot pass, not just green tests.
- **RISK-4 `[L]`** — `ops/tasks.rs` has zero in-file unit tests; core task behavior is only pinned by the CLI integration suite. Changes to `edit_task` semantics (D1) should add core-level tests.

## 8. Telemetry

`phases: A,T,L,A,S | tool_calls: 26 | probes_overflowed: 0 | sub_questions: 10/10 answered (9 at H, 1 GAP) | dead_ends: 0`
