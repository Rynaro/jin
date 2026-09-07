---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-07-14
change_id: todo-loop-closure
esl_tier: full
maker: vivi
checker: kupo
plan_state: .spectra/plans/todo-loop-closure.state.json
inputs:
  - discovery/01-todo-feature-complete-scout.md (ATLAS scout, JIN-TODO-002)
  - owner product decisions (verbatim, §1.2)
---

# Jin — ToDo Loop Closure (feature-complete wave)

**Status: DECISION-READY — S1, S2, S3 IMPLEMENTED. Spec amended from implementation feedback.**
Revision 1.5. **79 criteria** (77 original ids unchanged; AC-S4-09 and AC-S7-09 appended).
**[R5]** — a defect of a NEW kind: AC-S7-02's worked example was arithmetically impossible
(`{done, todo}` intersects to EMPTY, not `[todo]`), and a wrong example CONCEALS the case it
gets wrong — the empty-intersection case had no criterion at all. All 11 FSM-quoting criteria
were re-derived by parsing `can_transition_to` from the Rust source; one was false, and the
derivation surfaced an uncovered edge (a card dropped back into its own column would request
an illegal self-transition). See "THE WORKED-EXAMPLE RULE".
**[R4]** — a third `verify_method` defect of the same class (AC-S3-04 matched `ListsController`'s
correct, out-of-scope code) triggered a full audit of **all 9** command-based criteria. Five
were amended; two of those were failing in the *silent* direction — a gate that can never
FAIL. The rule that produced them is now written into the spec (see "THE GREP-GATE RULE").
D1, the wave's riskiest deletion, is **closed and verified** at S3.
**[R3]** — three defects found in the frozen criteria *by implementing them*: two
`verify_method` commands could NEVER pass (AC-X-01 and AC-S1-01 matched English prose, not
code — both replacements independently re-verified here, in both directions, on the real
tree); and the `AC-X-*` block was mis-scoped as a uniform per-story obligation when two of
its members cannot bind until S6/S8. AC-S1-04 gained an anti-vacuity CONSTRAINT after the
first implementation asserted a TS table against a TS table — a cross-language parity check
that reads only one language certifies the drift it exists to catch.
**[R1]** — amended after Kupo's independent critique (13 findings, 5 critical), which the
tier=full critic gate correctly blocked Assemble to obtain; all 13 closed.
**[R2]** — amended after ESL `tonberry.verify`: the dual-format `spec.yaml` is emitted
(C3, MUST), and all 39 trigger-less criteria gained a truthful `given`/`when` (C7), which
surfaced a second supersession pair (AC-S2-04 → AC-S4-08) that the critique had missed.
Criteria are frozen (`ramza-freeze --amend`); the hash is in the plan state file and in
`spec.yaml`. Every gate (RS, complexity, explore, refine ×2, structural + EARS lints,
critic, confidence) ran through `bin/ramza-*`.

---

## Scope

**Intent class:** CHANGE (a defined, owner-decided reshape of an existing surface).

**Complexity** (`ramza-score --rubric complexity`): **11/12 → human_loop.**
That verdict is honored literally, not overridden: the wave ships as **8 independent
PRs**, each with an owner test pass on macOS (version bump → PR → merge → pull → test).
No single mega-PR.

### In

1. **Per-item UX = a detail pane beside the list.** Selection drives it. One editor,
   not three.
2. **Board = Kanban by `TaskStatus`.** List = planning surface; Board = pushing work
   forward. Genuinely different tools.
3. **A real sidebar.** Smart views (Inbox / Today / Upcoming / Completed), per-list
   nav with LIVE counts, list create/rename/delete/reorder, active-selection indicator.
4. **Subtasks as real child tasks.** `parent: Option<String>` on `TaskFrontmatter` —
   the ONLY core model change in the wave.
5. **Full CRUD on every field core already supports**: title, body/notes, status,
   priority, due, list, section, tags, position, reminders (stored, not fired).
6. **Bulk multi-select + keyboard flow**: quick-add, arrow-nav, enter-to-open,
   delete-to-remove, escape-to-clear.
7. **The defect list**: phantom `critical` priority, illegal status transitions in the
   UI, silent failures, board missing CRUD, board ignoring `sort_mode`, stale sidebar
   counts, per-list view persistence, three dead bridge functions.

### Out (do not build; do not let scope creep in)

- **Recurrence** — absent from CORE, not just the GUI. Separate wave.
- **Reminder *firing* / any scheduler** — reminders are stored and editable today and
  stay that way. Nothing fires them. Separate wave. (The pane keeps the existing
  reminder editor; it must not grow a "notify me" promise the app cannot keep.)
- **Tag create/rename/delete** — absent from core (`ensure_tag` is implicit-only).
  `setTagColor` IS wired (S8) because the bridge already exists.
- **List nesting** (`ListDto.parent_id`) — core supports it; the rail stays flat.
- **Cross-list manual ordering on the board** — `position` is scoped to
  `(list_id, section_id)`; inventing a cross-list rank is out.
- **The `list`-id-vs-name on-disk migration (ATLAS D7)** — see Deferred.

### Deferred (owner decision required, NOT spec'd here)

- **D7 forward migration.** Tasks written before the id/name fix still carry a list
  *name* in `frontmatter.list`; they match no id-based filter and are invisible under
  every specific list. The code path is correct; the on-disk half is unverified (ATLAS
  GAP-1 — the owner's macOS store is the only witness). A one-time idempotent
  migration (dangling name → id, else `inbox`) is cheap but destructive-adjacent.
  **Ask the owner before running it.** Interim probe (30 seconds, no code): open the
  app, pick the "All Tasks" scope, and look for tasks that vanish under every specific
  list.

### Assumptions (with risk-if-wrong)

- **A1 — RESOLVED into a hard dependency [R1].** D1 (notes erased on edit) is **shipped
  fixed**: PR **#30**, v0.14.1 — `openEditDialog` hydrates via `getTaskById`, plus a guard
  that omits `body` from the `editTask` payload when the notes field was never touched;
  both regression tests were verified to fail against the pre-fix code. This is no longer
  an assumption but a **gate: PR #30 MUST be merged to main before S3 starts.** S3 deletes
  the very editor that PR #30 repairs, so starting S3 on an unmerged main would either lose
  the fix in a rebase or silently re-open the hole in the one editor that survives.
  Structurally, AC-S3-05 forbids the pane from ever reading `body` from a `list_tasks`
  projection, which makes D1 unrepresentable in the end state.
- **A2** — The core FSM (`TaskStatus::can_transition_to`) is immovable
  (`jin/tests/s4_tasks_notes_crud.rs:206,237,261` already pin the three illegal
  transitions). The UI adapts to the FSM; the FSM never adapts to the UI.
  *Risk if wrong:* none — this is the conservative direction.
- **A3** — `task.list` is a list **id**. `filterTasksList` is correct by contract.
  *Risk if wrong:* nothing in this wave "fixes" it, by design (AC-X-06 guards it).
- **A4** — Personal-scale data (hundreds, not 10⁵ tasks), so computing sidebar counts
  and smart views client-side from one `list_tasks()` fetch is cheap and correct.
  *Risk if wrong:* counts recompute cost grows; swap to an indexed core query later
  (no GUI contract change — `computeSidebarCounts` is a pure seam).

---

## Approach

**Selected hypothesis: H-B — "one item, two skins; selection drives one pane; status
drives the board"** (`ramza-score --rubric explore` = **82 / solid**; next best 68).

Six architectural decisions carry the whole wave.

### 1. One item renderer, two skins (kills the drift at the root)

Today `buildTaskRow` (template-clone, `task-row__*`) and `buildTaskCard` (imperative
`createElement`, `task-card__*`) are two components pretending to be two views. That is
why Board silently lost create/edit/delete and why it ignores `sort_mode`.

Replace both with **`buildTaskItem(task, variant, ctx, callbacks)`** (new module
`jin-gui/src/lib/tasks/item.ts`), cloning ONE `<template id="tmpl-task-item">`. Row and
card get **the same DOM and the same affordances**; only the root modifier class differs
(`.task-item--row` / `.task-item--card`) and CSS does the layout. A drift can no longer
be expressed in TypeScript — it would have to be a CSS-only difference, which is exactly
what a "skin" should be.

### 2. Selection drives ONE pane (kills the three-editor mess)

A single `selectedTaskId` in `TasksController`. Clicking an item selects it; the
right-hand `.tasks-detail-pane` fills in beside the list. The list never disappears, so
moving between tasks is one click.

Both of today's editors die:
- the page-swapping `loadDetail` path (`listPanel.hidden` ⇄ `detailPanel`) — deleted,
  along with the back button and `showList()`;
- the row pencil → `#jin-task-edit-dialog` JinModal — deleted, along with
  `openEditDialog` / `saveEditTask` / `pendingEditId`.

The pane **always** hydrates through `getTaskById(id)` — never from the `list_tasks`
projection, whose `body` is always `""` (`jin-core/src/dto/task.rs:104`). That is the
structural cure for D1, and the reason it cannot come back.

### 3. Board = Kanban by status (makes List and Board different *tools*)

`renderBoardView` groups by **`TaskStatus`**, not by section: **Todo / Doing / Done**.
Cancelled is **not** a column — it is a filter (and lives in the Completed smart view,
struck through). Dragging a card between columns is one `setTaskStatus` call.

**Illegal drops are impossible, not merely refused.** At `dragstart` the board computes
`legalNextStatuses(task.status)` (a pure mirror of `TaskStatus::can_transition_to`) and
marks every non-legal column `aria-disabled="true"` + `.tasks-board__column--drop-disabled`;
those columns do **not** `preventDefault()` on `dragover`, so the browser refuses the
drop and **no bridge call is ever made**. Core rejects `done→doing`, `done→cancelled`,
`cancelled→doing`, `cancelled→done`; the board therefore offers Done → Todo ("Reopen")
and the user re-drags to Doing. Two honest clicks beat one lying one.

Within-column dragging does **not** reorder (no `position` semantics on a status axis).
Card order follows the active sort mode — which the board now honors instead of
hardcoding `'manual'` (`render.ts:359`).

### 4. Scope model: the sidebar is the single source of truth

```ts
type TaskScope =
  | { kind: 'smart'; id: 'inbox' | 'today' | 'upcoming' | 'completed' }
  | { kind: 'list';  id: string };   // list id, never a name
```

The rail owns scope. The duplicate `#tasks-list-filter` select (simultaneously
`data-tasks-target="listFilter"` and `data-lists-target="filterSelect"` — two controls
for one concept, ATLAS D8) is **removed** from the filter bar; the filter bar keeps
status / priority / tag / sort. `ListsController` dispatches `jin:scope-changed`;
`TasksController` sets scope and reloads.

Smart views are **pure functions** over the fetched `TaskDto[]`
(`jin-gui/src/lib/tasks/scopes.ts`): `inbox` = open tasks in the default list; `today` =
open + due ≤ today; `upcoming` = open + due > today; `completed` = status `done` or
`cancelled`. Counts come from a pure `computeSidebarCounts(tasks, lists)` — **open**
tasks only (`todo` | `doing`), because `ListDto.task_count` counts `done` too
(`index/query.rs:398`) and a badge that never goes down is noise. `Completed` shows no count.

**Live counts** = `TasksController` dispatches `jin:tasks-changed` after **every** task
mutation; `ListsController` listens and recomputes. Today `loadLists()` only runs on
connect and on *list* CRUD, which is why the badges lie.

### 5. View persistence is GLOBAL, sort stays per-list

`ListDto.view` is per-list, so switching lists silently reflows the layout — "they
confuse the user when switching," verbatim. The GUI stops reading and writing
`list.view` (the core field stays; it simply has no GUI consumer) and persists the
view in `localStorage` under `jin.tasks.view` (the pattern already used by
`lib/appearance/state.ts`). One user, one view preference, every scope.

`sort_mode` stays per-list and persisted through `editList` — "this project sorts by
priority" is a legitimate per-list fact. In non-list scopes (smart views), `manual` is
unavailable (drag-reorder needs a `(list, section)` rank) and the sort select's
`manual` option is disabled.

### 6. Subtasks: one field in core, threaded through EVERY projection

`parent: Option<String>` on `TaskFrontmatter` with `#[serde(default)]` (legacy files
parse unchanged — the same guarantee already tested in
`model/task.rs::serde_default_p2_fields_on_legacy_task_file`).

**The trap, stated once, loudly:** `list_tasks` is **index-backed**
(`ops/api.rs:62` → `query::list_tasks_by_tag` → `TaskDto::from_row`), and so is
`get_task` (index row + a fresh disk read for `body` only). A `parent` that exists on
the model but not in the SQLite index is `None` on **every read path in the app** while
every model-level unit test stays green. This is the exact shape of the shipped Notes
`body_markdown` bug. `parent` must therefore land in **all six** places in one story:
`model/task.rs` → `index/schema.rs` (column + guarded `ALTER TABLE` + `SCHEMA_VERSION`
bump) → `index/rebuild.rs` (insert) → `index/query.rs` (`TaskRow` + both SELECT lists)
→ `dto/task.rs` (`from_model` **and** `from_row`) → `types/dto.ts`.

**Rollup rules (core-enforced, in `ops/tasks.rs`):**

| Event | Effect on children |
|---|---|
| parent → `done` | every child in `todo`/`doing` → `done` (cascade) |
| parent → `cancelled` | every child in `todo`/`doing` → `cancelled` |
| parent → `todo` (reopen) | **nothing** — no reverse cascade; reopen children by hand |
| parent soft-deleted | children soft-deleted (cascade) |
| all children `done` | **nothing** — no upward auto-complete; the parent shows `3/3` |
| parent's `list` / `section_id` changes | children follow (a subtask lives with its parent) |

Depth is **exactly one**: a task with a `parent` may not itself be a parent. Core rejects
self-parenting, cycles, and depth ≥ 2 with a validation error. A subtask keeps its own
due / priority / tags / body and therefore surfaces independently in Today and Upcoming —
which is the whole point.

### 7. The error rule (no more silent failures)

`onSavePriority`, `onSaveBody`, `onSaveSection`, `onSaveTags`, `onClearDue`
(`tasks_controller.ts:1149-1186`) are bare `await`s with no `catch`: the bridge rejects,
the promise floats away, and the UI shows nothing.

**Rule:** every bridge call in the tasks/lists surface goes through one helper —
`private async guarded<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined>` —
which catches, dispatches `app:error` (the channel `error_controller.ts` already
listens on), and returns `undefined`. **Zero bare `await <bridgeFn>(…)` in any
callback.** Grep-checkable, and checked (AC-X-05).

### 8. The mutation chokepoint — where `jin:tasks-changed` is dispatched [R1]

The refresh event is **a mutation-layer hook, not a per-callback obligation.** Stories
must not have to *remember* to dispatch it — that is precisely how the sidebar counts went
stale in the first place (`loadLists()` runs on connect and on list CRUD only).

S1 introduces **two** wrappers, and every later story inherits them for free:

```ts
private async guarded<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined>
// reads  — catches, dispatches app:error, returns undefined

private async mutate<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined>
// writes — guarded(op), and on success dispatches `jin:tasks-changed` exactly once
```

Every task-mutating bridge call (`createTask`, `editTask`, `setTaskStatus`, `moveTask`,
`deleteTask`, `reseedPositions`) goes through `mutate()`. Consequences that stories rely on
rather than re-implement:

- **S4's board drag** is a `mutate(() => setTaskStatus(...))` — it inherits the dispatch;
  its action plan does not (and must not) add a bespoke one.
- **S7's bulk loop** is the one deliberate exception to "once per call": the batch runs its
  N calls through `guarded()` and dispatches `jin:tasks-changed` **exactly once after the
  batch settles** (including on partial failure) — N dispatches would thrash the rail.
- **S6's rollup cascade** is one bridge call from the GUI's point of view (core does the
  cascade), so it dispatches once.

Checked mechanically by AC-X-08 and AC-S7-08.

---

## Stories

Eight stories, each an independently shippable PR (bump version → PR → merge → owner
pulls and tests on macOS). Sequenced so the highest-relief UX lands first and every
later story builds on a surface that already tells the truth.

### Story S1 — Honest controls, honest errors, honest view state

As a user, I want the task controls to offer only things that actually work, and to see
it when something fails, so that the app stops lying to me quietly.

Timebox: **2d** · Risk tag: **P0** · Executor hint: **mid** tier — explicit steps below.

Action plan:
1. Delete `'critical'` from `PRIORITY_OPTIONS` (`lib/tasks/render.ts:921`). It exists
   nowhere in core and hard-errors at `parse_priority` (`commands/tasks.rs:91-107`).
2. Add pure `legalNextStatuses(current: string): string[]` to `lib/tasks/transform.ts`,
   mirroring `TaskStatus::can_transition_to` (`model/task.rs:49-61`) exactly:
   `todo → [doing, done, cancelled]`, `doing → [todo, done, cancelled]`,
   `done → [todo]`, `cancelled → [todo]`, `deleted → []`. The status select renders
   the current status plus its legal successors — nothing else.
3. Add the `guarded()` **and** `mutate()` helpers to `TasksController` (and `guarded()` to
   `ListsController`) — the chokepoint of Approach §8 **[R1]**. Route every detail-editor
   callback, DnD, status toggle, create, delete and list call through them: reads via
   `guarded()`, writes via `mutate()` (which additionally dispatches `jin:tasks-changed`
   on success). Non-`JinErrorDto` rejections are wrapped into a synthetic dto so the toast
   still fires. Every later story inherits the dispatch — no story re-implements it.
4. View persistence → `localStorage['jin.tasks.view']` (`'list' | 'board'`), read on
   `connect`. Remove every GUI call to `editList({ view })`. While no single list is
   selected, the toggle is `disabled` + `aria-disabled="true"` + `title="Board view
   needs a list"` (S4 lifts that restriction; until then the button must not be a lie).
5. `sortModeChange` keeps persisting per-list `sort_mode`, now through `guarded()`.

Files: `lib/tasks/render.ts`, `lib/tasks/transform.ts`, `controllers/tasks_controller.ts`,
`controllers/lists_controller.ts`, `index.html` (toggle button attrs),
`__tests__/tasks_controller.test.ts`.

**Green-but-shallow watch:** a test that only calls `legalNextStatuses('done')` proves
nothing. The test must **render the detail status select for a `done` task and assert
the DOM contains no `doing`/`cancelled` `<option>`**.

### Story S2 — One task item, two skins

As a user, I want the board to do everything the list does, so that switching view never
silently removes my ability to create, edit or delete.

Timebox: **4d** · Risk tag: **P0** · Executor hint: **frontier** tier — this is the
refactor that decides whether the two views can ever drift again.

Action plan:
1. New `lib/tasks/item.ts`: `buildTaskItem(task, variant: 'row' | 'card', ctx, cbs)`.
   One `<template id="tmpl-task-item">` in `index.html`; root class
   `task-item task-item--row` / `task-item--card`; `data-task-id`; `aria-selected`.
2. Identical children in both variants: drag handle, status toggle, title, due chip
   group, priority badge, tag chips, action cluster (delete), subtask-progress slot
   (populated in S6).
3. Delete `buildTaskRow` (`render.ts:1149`) and `buildTaskCard` (`render.ts:479`).
   `renderTasksList`, `renderListViewWithSections` and `renderBoardView` all call
   `buildTaskItem`. Retire `#tmpl-task-row` and its `TasksTemplates.taskRow` entry.
4. Board columns get the add-task row (`buildAddTaskRow`) that only the list had
   (`render.ts:328-330` vs `buildBoardColumn:336-366`).
5. Delete the hardcoded `sort_mode: 'manual'` at `render.ts:359`; the board sorts with
   `sortTasksForMode(tasks, activeSortMode)` like the list.
6. CSS: `.task-item`, `.task-item--row`, `.task-item--card` in `styles/browse.css`;
   retire `.task-row__*` / `.task-card__*`. No raw hex, tokens only (stylelint gate).

Files: `lib/tasks/item.ts` (new), `lib/tasks/render.ts`, `index.html`,
`styles/browse.css`, `__tests__/tasks_controller.test.ts`.

**Green-but-shallow watch — HIGHEST in the wave.** Two distinct traps:
(a) a parity test that compares class names proves nothing about behavior — it must
assert the **same callback fires** for row and card (delete, status toggle, select);
(b) jsdom cannot see CSS. This story is a visual rewrite of the task item. **Requires an
owner screenshot pass** (`docs/gui-testing.md §5`) — logic-green is not ship-green here.

### Story S3 — The detail pane replaces both editors

As a user, I want to click a task and edit it right beside the list, so that managing
items stops swapping pages and stops scattering fields across two different editors.

Timebox: **5d** · Risk tag: **P0** · Executor hint: **frontier** tier.
**Hard dependency [R1]: PR #30 (D1 hotfix, v0.14.1) must be merged to main before S3
starts.** S3 deletes the editor that PR #30 repairs; starting earlier risks losing the fix
in the rebase.

Action plan:
1. `.tasks-main` becomes a two-column grid (content | `.tasks-detail-pane`), pane
   collapsed to `0` width until a task is selected (`.tasks-main--detail-open`).
   Reuse the Notes 3-pane layout idiom already in the codebase.
2. `TasksController.selectedTaskId`. Item click → select (`aria-selected="true"`,
   `.task-item--selected`, exactly one at a time) → `guarded(() => getTaskById(id))`
   → render the pane. **Never** read `body` from the list projection.
3. The pane carries the full field set: title (inline edit), status (legal-only, S1),
   priority (4 real values), due (picker + clear), list, section, tags, notes/body
   (textarea, commit on blur), reminders (existing editor, storage only), backlinks,
   promote, **Delete**, and a close (X) button that clears the selection.
4. Delete the page-swap: `loadDetail`'s `listPanel.classList.add('hidden')` /
   `detailPanel.classList.remove('hidden')` (`tasks_controller.ts:1116-1117`),
   `showList()` (`:966-969`), the back button (`index.html:1096-1104`).
5. Delete the row edit modal: the pencil button (`render.ts:1332`),
   `#jin-task-edit-dialog`, `openEditDialog`, `saveEditTask`, `pendingEditId`, and the
   `onEditRequest` callback in `TaskRowCallbacks`. One editor remains.
6. `jin:open-detail` (router deep-link) selects into the pane; if the task is outside
   the current scope, switch scope to the task's list first, then select — the list
   must stay visible and clickable.
7. Every save refreshes the pane and the affected row in place, and dispatches
   `jin:tasks-changed` (consumed in S5).

Files: `lib/tasks/render.ts` (`renderTaskDetail` → `renderTaskPane`),
`controllers/tasks_controller.ts`, `index.html`, `styles/browse.css`,
`__tests__/tasks_controller.test.ts`, `__tests__/tasks_lists_modal_wiring.test.ts`.

**Green-but-shallow watch:** the notes-preservation test **must** build its task list
from a `list_tasks`-shaped DTO (`body: ''`) — hand-feeding a body in the fixture is
precisely how the original D1 stayed green (`tasks_controller.test.ts:741`).

### Story S4 — Board becomes a Kanban by status

As a user, I want the board to be a *different tool* from the list — columns I push work
across — so that switching views stops feeling like the same screen rearranged.

Timebox: **3d** · Risk tag: **P0** · Executor hint: **frontier** tier.

Action plan:
1. `renderBoardView` groups by status: **Todo / Doing / Done**. Cancelled tasks never
   appear on the board; they live in the status filter and the Completed smart view.
2. Column header: name + live count. Add-task row in the **Todo** column only (core
   always creates at `todo`; an add row under Done would be a lie).
3. Cross-column drop → `mutate(() => setTaskStatus(id, targetStatus))` — the S1 chokepoint
   (Approach §8), so the board drag inherits the `jin:tasks-changed` dispatch **[R1]**. Do
   not add a bespoke dispatch here.
4. `dragstart` computes `legalNextStatuses(task.status)`; illegal columns get
   `aria-disabled="true"` + `.tasks-board__column--drop-disabled` and do **not**
   `preventDefault()` on `dragover` — the drop is refused by the browser and **no
   bridge call happens**.
5. Done cards expose a **Reopen** action (`done → todo`, legal) so a mis-completed task
   has a one-click way back.
6. Within-column drag does not reorder. Cards follow the active sort mode.
7. The board now renders in every scope (list, All Tasks, smart views) → the view toggle
   is never disabled (finishes S1 step 4 / ATLAS D5).
8. **Retire two earlier criteria [R2].** Re-keying the columns from sections to statuses
   legitimately invalidates two S1/S2-era guarantees. The S4 PR MUST DELETE both tests and
   name both retirements in its description: `view_toggle_disabled_without_list_scope`
   (AC-S1-08 → superseded by AC-S4-07) and `board_columns_have_add_task_row`
   (AC-S2-04 → superseded by AC-S4-08).

Files: `lib/tasks/render.ts`, `lib/tasks/transform.ts`, `controllers/tasks_controller.ts`,
`styles/browse.css`, `__tests__/tasks_controller.test.ts`.

**Green-but-shallow watch:** an illegal-drop test that merely asserts "an error toast
appeared" is backwards — it would mean the call *was* made. Assert `setTaskStatus` was
**never invoked** (spy call-count 0) for a `done → doing` drag.

### Story S5 — A sidebar that actually works

As a user, I want a sidebar with real views, live counts, and an obvious indication of
where I am, so that the rail is navigation instead of decoration.

Timebox: **5d** · Risk tag: **P0** · Executor hint: **frontier** tier.

Action plan:
1. New `lib/tasks/scopes.ts` (pure): `TaskScope`, `applyScope(tasks, scope, lists)`,
   smart views inbox / today / upcoming / completed as defined in Approach §4.
2. New `lib/lists/counts.ts` (pure): `computeSidebarCounts(tasks, lists)` → open-task
   counts per smart view and per list. `Completed` renders no count.
3. Rail markup: a Smart Views group (Inbox, Today, Upcoming, Completed) above the Lists
   group. Active row gets `.lists-rail__row--active` + `aria-current="true"`; exactly
   one active row at any time (`buildListRow`, `lib/lists/render.ts:105-146`, has none today).
4. Remove `#tasks-list-filter` from the filter bar. `ListsController` dispatches
   `jin:scope-changed { scope }`; `TasksController.setScope` consumes it. One control,
   one concept.
5. Live counts: **consume** the `jin:tasks-changed` event that S1's `mutate()` chokepoint
   already dispatches on every task mutation (Approach §8) **[R1]** — `ListsController`
   re-runs `loadLists()` + recomputes counts on that event. S5 adds the *listener*, not the
   dispatch; the dispatch is the mutation layer's job so no future story can forget it.
6. List drag-reorder: wire the **dead** `reorderList(id, position)` with `rank.between()`.
7. List create / rename / delete stay `JinModal` + `ConfirmDialog` (already compliant).

Files: `lib/tasks/scopes.ts` (new), `lib/lists/counts.ts` (new), `lib/lists/render.ts`,
`controllers/lists_controller.ts`, `controllers/tasks_controller.ts`, `index.html`,
`styles/browse.css`, `__tests__/lists_controller.test.ts`,
`__tests__/tasks_controller.test.ts`.

**Green-but-shallow watch:** a count-refresh test that calls `loadLists()` directly is
worthless — it tests the function that already worked. The test must **create/delete a
task through the controller** and assert the rail badge changed.

### Story S6 — Subtasks are real tasks

As a user, I want to break a task into subtasks that have their own due dates and show up
in Today, so that real work decomposes instead of living in a checklist inside a note.

Timebox: **5d** · Risk tag: **P1** · Executor hint: **frontier** tier — the only core
change in the wave; the projection chain is unforgiving.

Action plan:
1. **Core model** — `parent: Option<String>` on `TaskFrontmatter` (`#[serde(default)]`).
   `CreateTaskParams.parent`; `EditTaskParams.parent: Option<Option<String>>`
   (`Some(None)` = detach, mirroring the existing `due` idiom).
2. **Core validation** — reject self-parent, cycles, and depth ≥ 2 (a task that has a
   parent may not be a parent) with a validation error, not a panic.
3. **Core rollup** — implement the table in Approach §6 inside `transition_task` and
   `delete_task`; parent `list`/`section_id` edits cascade to children.
4. **Index chain (all of it, or the field is a ghost):** `index/schema.rs` — add
   `parent TEXT` to `CREATE TABLE tasks`, add a guarded
   `ALTER TABLE tasks ADD COLUMN parent TEXT` next to the P2 guards (`schema.rs:186-198`),
   bump `SCHEMA_VERSION` (`"wave3-tasks-v1"` → `"wave3-tasks-v2"`) so stale indexes
   rebuild; `index/rebuild.rs` — write it; `index/query.rs` — `TaskRow.parent` + both
   task SELECT lists; `dto/task.rs` — populate `parent` in `from_model` **and**
   `from_row`; `types/dto.ts` — `parent?: string | null`.
5. **Bridge** — `CreateTaskInput.parent`, `EditTaskInput.parent` + `clear_parent`
   (`src-tauri/src/commands/tasks.rs`), `invoke.ts` wrappers.
6. **GUI** — pane gets a Subtasks section (add inline, toggle status, delete, click a
   child to select it in the pane); `buildTaskItem` shows a `2/5` progress chip when a
   task has children; list view in a list scope nests children under their parent
   (indented, collapsible, children not draggable in v1); board and smart views show
   children as standalone items with a parent breadcrumb chip.
7. A subtask's list/section selects are **disabled** in the pane with the hint "moves
   with parent".
8. **Core unit tests [R1].** `ops/tasks.rs` has **zero** in-file unit tests today; task
   behavior is pinned only indirectly through the CLI suite. Every rollup rule in the
   Approach §6 table gets an in-file `#[cfg(test)]` unit test in `ops/tasks.rs`
   (AC-S6-02, -03, -05, -05b, -06, -07, -08, -09). This is a story deliverable, not a
   nice-to-have — the cascades are the part of this wave most likely to be silently wrong.

**Owner screenshot gate [R1].** S6 ships indented + collapsible child items, a `2/5`
progress badge, and a parent breadcrumb chip — all of them new CSS in `browse.css`, and
jsdom cannot see CSS (this repo has a documented "logic gates don't catch visual
regressions" history). **S6 requires an owner screenshot sign-off before merge, exactly
like S2** (`docs/gui-testing.md §5`). Logic-green is not ship-green here either.

Files: `jin-core/src/model/task.rs`, `jin-core/src/ops/tasks.rs`,
`jin-core/src/dto/task.rs`, `jin-core/src/index/{schema,rebuild,query}.rs`,
`jin-gui/src-tauri/src/commands/tasks.rs`, `jin-gui/src/invoke.ts`,
`jin-gui/src/types/dto.ts`, `jin-gui/src/lib/tasks/{item,render,transform}.ts`,
`jin-gui/src/controllers/tasks_controller.ts`, `jin/tests/s4_tasks_notes_crud.rs`,
`jin-core/src/ops/tasks.rs` (in-file unit tests — currently **zero**).

**Green-but-shallow watch — LOUDEST in the wave.** A serde round-trip test on
`TaskFrontmatter` will pass while `list_tasks` and `get_task` both return
`parent: null` forever, because both read `TaskDto::from_row` off the SQLite index.
This is the *same* bug class that shipped in Notes (`body_markdown` absent from the
index). AC-S6-04 requires an integration test that goes **through the index**:
create a subtask → rebuild → `list_tasks` → assert `parent` survives.

### Story S7 — Bulk multi-select and keyboard flow

As a power user, I want to select many tasks and act on them, and to drive the list from
the keyboard, so that triage stops being one click per field per task.

Timebox: **4d** · Risk tag: **P1** · Executor hint: **mid** tier.

Action plan:
1. Multi-select: cmd/ctrl+click toggles, shift+click selects a range. List container
   `role="listbox"` + `aria-multiselectable="true"`; items `role="option"` +
   `aria-selected`.
2. With ≥2 selected, the pane switches to a bulk panel ("N tasks selected") offering:
   set status, set priority, set due, move to list, add tag, remove tag, delete.
   The status choices are the **intersection** of `legalNextStatuses` across the
   selection — an option is offered only if it is legal for every selected task.
3. Bulk ops run sequentially and collect per-item results; a partial failure surfaces
   "3 of 5 updated" through `app:error` and the list reloads to the truth (never an
   optimistic lie). The batch runs its N calls through `guarded()` and dispatches
   `jin:tasks-changed` **exactly once after the batch settles** — including on partial
   failure, so the sidebar counts can never go stale behind a bulk op (Approach §8) **[R1]**.
4. Keyboard (inert while an `input` / `textarea` / contenteditable has focus):
   `n` = quick-add focus · `ArrowUp` / `ArrowDown` = move selection (roving tabindex) ·
   `Enter` = open the pane and focus the title · `Delete` / `Backspace` = delete confirm ·
   `Escape` = clear selection and close the pane · `Shift+V` = toggle view (existing).

Files: `controllers/tasks_controller.ts`, `lib/tasks/item.ts`, `lib/tasks/render.ts`,
`lib/tasks/bulk.ts` (new, pure), `styles/browse.css`,
`__tests__/tasks_controller.test.ts`.

**Green-but-shallow watch:** the bulk test must inject a rejection **mid-array** (item 3
of 5 fails) and assert both the partial-success report and that items 4-5 were still
attempted. A test where every stubbed call resolves proves nothing about the failure path.

### Story S8 — Free wins and convention cleanup

As a maintainer, I want the three dead bridge functions wired and the last raw `<dialog>`s
ported, so that the surface has no capability that exists in the backend but nowhere in
the UI.

Timebox: **3d** · Risk tag: **P2** · Executor hint: **mid** tier.

Action plan:
1. Wire the dead `reorderSection(listId, sectionId, position)` — drag section headers,
   rank with `rank.between()`.
2. Wire the dead `setTagColor(slug, color)` — a tag color picker (reuse the list color
   picker) opened from a tag chip, in a `JinModal`.
3. Port `#addSectionDialog` and `#deleteSectionDialog` (`index.html:999-1062`) from raw
   `<dialog>` + Stimulus targets to `JinModal` / `ConfirmDialog` (ATLAS D9 — they work
   today only because they happen to sit inside the tasks subtree; that is the DT-2
   foot-gun the convention exists to prevent).
4. Sweep: every `data-lucide` name introduced anywhere in the wave is registered in
   `src/lib/icons/index.ts`.

Files: `controllers/tasks_controller.ts`, `lib/tasks/render.ts`, `lib/ui/modal.ts`
(consumer only), `src/lib/icons/index.ts`, `index.html`, `styles/browse.css`,
`__tests__/tasks_lists_modal_wiring.test.ts`.

---

## Acceptance Criteria

Mechanically checkable, one assertion each. `AC-X-*` are cross-cutting: they apply to
**every** story in the wave and are re-checked at each PR.

**[R5] — THE WORKED-EXAMPLE RULE.** The grep-gate rule below catches checks that match
more than their defect. It cannot catch **a criterion whose prose is self-consistent and
confident, and whose arithmetic is wrong** — which is what AC-S7-02 was. It claimed
`{done, todo}` intersects to `[todo]`; the true intersection is EMPTY, because a status is
never its own successor. Nothing in the criterion looked wrong. The only thing that caught
it was an implementer *computing the example against the real FSM* instead of trusting it.

**The rule: a criterion that states a worked example — a concrete input mapped to a concrete
expected output — is not frozen until that example has been COMPUTED against the real source
of truth. Never asserted from memory.** And note the second-order damage, which is worse
than the first: a wrong worked example *conceals the edge case it gets wrong*. Because
AC-S7-02 asserted a non-empty result for the one pair that intersects to empty, the
empty-intersection case — the most natural mixed selection a user can make — had no
criterion at all (now AC-S7-09).

All 11 criteria in this spec that quote a concrete FSM result were re-derived at R5 by
parsing `can_transition_to` out of `jin-core/src/model/task.rs` (8 arms, anti-vacuity
asserted) and evaluating each claim mechanically:

| Criteria audited | Result |
|---|---|
| AC-S1-02, AC-S1-03, AC-S1-04, AC-S4-03, AC-S4-04, AC-S4-05, AC-S4-06, AC-S6-05, AC-S6-05b, AC-S6-06 | **all TRUE** against the parsed FSM |
| Approach §3 prose ("core rejects `done→doing`, `done→cancelled`, `cancelled→doing`, `cancelled→done`") | **TRUE** |
| **AC-S7-02** | **FALSE** — corrected to `{done, doing}`; the concealed empty-intersection case becomes AC-S7-09 |
| *(new finding)* the FSM has no self-transitions, so a card dropped back into its **source** column would call `setTaskStatus(id, <same>)` → `InvalidStateTransition` | uncovered → **AC-S4-09**; AC-S4-05 clarified |

**[R4] — THE GREP-GATE RULE (learned three times, the hard way).** Every `rg`-based
`verify_method` I froze that named an identifier by bare string was WRONG, in the same
direction: **it matched more than the defect.** AC-X-01 matched a comment; AC-S1-01 matched
the English word "critical"; AC-S3-04 matched a sibling controller doing the right thing.
Each produced a gate that could never pass — and *a permanently-red gate teaches everyone to
ignore the light, which is worse than having no gate at all.*

The rule, now binding on every command-based criterion in this spec and on anyone who adds
one: **a grep gate is not frozen until it has been run in BOTH directions against the real
tree** — (a) it is clean now, or its RED is the real, intended, named defect; and (b) an
injected violation makes it go red. Both, recorded in the criterion's NOTE.

All 9 command-based criteria were audited under that rule at R4. Results:

| Criterion | Verdict before audit | Fix |
|---|---|---|
| AC-X-01 | red forever (matched a comment) | fixed at R3 |
| AC-S1-01 | red forever (matched English "critical") | fixed at R3; **R4** narrowed scope so an anti-regression *test* naming the literal cannot re-redden it |
| AC-S3-04 | red forever (matched `ListsController`, which S5 KEEPS) | **R4** scoped to the task-edit surface |
| AC-S1-07 | **permissive** — a multi-line call defeats a line-based regex entirely | **R4** `-U` + scoped away from `invoke.ts`, which legitimately *declares* `view?` |
| AC-S2-06 | sound, but unaudited | **R4** verified NON-VACUOUS against the pre-S2 source; `-U` + comment-excluded |
| AC-S2-01 | sound, but a future comment or test naming the builders would re-redden it | **R4** comment- and test-excluded |
| AC-S5-07 | sound, same latent risk | **R4** comment- and test-excluded |
| AC-S8-03 | **too weak** — would pass with the dead Stimulus targets still declared | **R4** scope EXTENDED to `tasks_controller.ts` |
| AC-X-04 | not a grep (`make verify`) | unchanged |

Note the two directions are not symmetric. A gate that can never PASS is loud and gets
fixed (three times). A gate that can never FAIL — AC-S1-07's line-based regex, AC-S8-03's
too-narrow scope — is silent, and would have certified the defect it exists to catch. Those
are the ones this audit was actually for.

**[R3] — the `AC-X-*` block is NOT a uniform per-story obligation.** R1/R2 said the
cross-cutting criteria "apply to every story in the wave and are re-checked at each PR",
which made Vivi nominally answerable during S1 for criteria that cannot exist yet: AC-X-03
(icon registry) names a test file **S8's own action plan owns**, and S1 introduces zero
icons; AC-X-07 (legacy `parent` parsing) has nothing to bind to until **S6** ships the core
change. Vivi correctly declined to create S8's test during S1 rather than expand scope.
The block splits three ways, and a checker must know which class a criterion is in:

| Class | Criteria | When it is checked |
|---|---|---|
| **Per-PR gate** | **AC-X-01** (no webview-illegal dialogs), **AC-X-04** (`make verify` + `make verify-gui` green), **AC-X-05** (bridge rejection → `app:error`), **AC-X-08** (mutations go through the `mutate()` chokepoint) | every PR, no exceptions |
| **Per-PR regression gate** | **AC-X-02** (modals are `JinModal`), **AC-X-06** (`filterTasksList` stays id-based) | every PR — both tests EXIST today and must stay green; the *new-modal* half of AC-X-02 binds only on the stories that introduce one (S5, S8) |
| **Story-bound, else wave-exit** | **AC-X-03** (binds when a story introduces a `data-lucide` name; S8 owns the sweep and creates the test), **AC-X-07** (binds at S6, the first core change) | at the binding story, and once more at wave exit |

**AC-X-04 stays a per-PR gate and is not negotiable down to wave-exit** — a PR that does
not build cannot merge, so deferring it would be a fiction. The other five relaxations are
real: a criterion that cannot be satisfied at story N is not a gate at story N, it is
scope creep with a checklist.

**[R2] — every criterion carries a truthful GIVEN and WHEN.** Revision 1 left 39 criteria
in the `ubiquitous` / `state-driven` forms, which have no trigger by construction; ESL's
C7 check (`ears_acceptance_complete`) warned on all 39 as `missing: given,when`. Rather
than fabricate preconditions to silence it, each was re-examined for a *real* locus — and
each had one, of exactly three kinds:

| Locus | Trigger | Example |
|---|---|---|
| a source-tree scan the gate actually runs every PR | "the verification gate scans it with `rg …`" | AC-X-01, AC-S2-01, AC-S5-07 |
| a pure-function call | "`legalNextStatuses` is called with it" | AC-S1-04, AC-S5-06, AC-X-06 |
| a render or a DOM event | "the detail pane renders its status select"; "the card's `dragstart` handler runs" | AC-S1-02, AC-S4-05 |

Those 39 are now `event-driven`, and **zero criteria in this spec rely on an empty
`given`/`when`** — C7 is expected to come back clean. No precondition below was invented:
if a criterion had had no honest trigger it would have stayed `ubiquitous` with an empty
`given`/`when` and an accepted C7 warning, because an honest advisory beats a dishonest
green.

### Cross-cutting

### AC-X-01 (event-driven) [R3] — PER-PR GATE
GIVEN the tasks surface source tree (`jin-gui/src`) at any story boundary in this wave
WHEN  the verification gate scans it for webview-illegal dialog *call sites*
THEN the tasks surface SHALL contain no call to `window.prompt`, `window.alert` or `window.confirm` (they are no-ops in the Tauri webview)
NOTE [R3]: the R2 command (`rg -n "window\.(prompt|alert|confirm)" jin-gui/src`) was DEFECTIVE — it could never pass. It matched English prose in comments on the unmodified tree (`lists_controller.ts` header; `notes_controller.ts:390`, which *documents* that `window.prompt()` is a Tauri no-op), in files no story touches. A permanently-red gate trains everyone to ignore it, which is worse than no gate. The replacement requires an opening paren (a call site, not a mention) and drops comment lines. Verified in BOTH directions on the real tree: clean on the current tree, and it still catches an injected `const x = window.confirm("really?")`. It fails CLOSED — a violation hidden in a *trailing* comment (`foo(); // window.confirm(`) still trips it, which is the safe direction.
VERIFY: command: `rg -n "window\.(prompt|alert|confirm)\s*\(" jin-gui/src | rg -v ':\s*(\*|//|/\*)'` returns no match

### AC-X-02 (event-driven) [R3] — PER-PR REGRESSION GATE
GIVEN a modal introduced by this wave, in the tasks surface mounted from the real `index.html`
WHEN  the modal is opened
THEN every modal introduced by this wave SHALL be a `JinModal` instance hosted at `#jin-modal-root`, never a Stimulus-targeted raw `<dialog>`
VERIFY: test: jin-gui/src/__tests__/tasks_lists_modal_wiring.test.ts (anti-DT-2 gate, mounts the real index.html)

### AC-X-03 (event-driven) [R3] — STORY-BOUND, ELSE WAVE-EXIT
GIVEN a story that introduces a new `data-lucide` name, or the wave-exit gate after S8 (which owns the icon sweep and creates the test file)
WHEN  `initIcons()` runs against the rendered tasks surface
THEN every `data-lucide` icon name rendered by the tasks surface SHALL be registered in `jin-gui/src/lib/icons/index.ts`
NOTE [R3]: does NOT bind on a story that introduces no icon (S1 introduces none). An unregistered icon renders nothing, silently — hence the gate; but the gate lives where the icons do.
VERIFY: test: jin-gui/src/__tests__/icons_registry.test.ts#every_task_icon_is_registered (created by S8)

### AC-X-04 (event-driven) [R3] — PER-PR GATE
GIVEN the working tree at any story boundary in this wave
WHEN  `make verify` and `make verify-gui` are run (fmt, clippy, cargo test, tsc, vitest, stylelint, vite build)
THEN the repository SHALL pass `make verify` and `make verify-gui` (fmt, clippy, cargo test, tsc, vitest, stylelint, vite build) at every story boundary
VERIFY: command: `nvm use v24.18.0 && make verify && make verify-gui`

### AC-X-05 (unwanted-behavior) [R3] — PER-PR GATE
GIVEN any task or list bridge call in the tasks surface
WHEN the bridge rejects
THEN an `app:error` event SHALL be dispatched on the bubbling channel `error_controller.ts` listens to, with no unhandled promise rejection
VERIFY: test: jin-gui/src/__tests__/tasks_error_surfacing.test.ts#every_bridge_callback_surfaces_rejection

### AC-X-06 (event-driven) [R3] — PER-PR REGRESSION GATE
GIVEN a task whose `list` is a list id, and a filter carrying that same id
WHEN  `filterTasksList` is called
THEN `filterTasksList` SHALL keep matching `task.list` against a list **id** (never a name)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#S6_filter_is_id_based

### AC-X-07 (event-driven) [R3] — BINDS AT S6, ELSE WAVE-EXIT
GIVEN a task file written before this wave (no `parent` key in its frontmatter), at S6 or later — no core change lands before S6
WHEN  the current core parses it
THEN it SHALL parse without error, with every new frontmatter field taking its `#[serde(default)]` value
NOTE [R3]: not applicable to S1..S5, which touch no Rust. Binds the moment S6 adds `parent`, and again at wave exit.
VERIFY: test: jin-core/src/model/task.rs#serde_default_legacy_task_file_parses_without_parent (created by S6)

### AC-X-08 (event-driven) [R1] [R3] — PER-PR GATE
GIVEN any task-mutating bridge call in the tasks surface (`createTask`, `editTask`, `setTaskStatus`, `moveTask`, `deleteTask`, `reseedPositions`)
WHEN the call resolves successfully
THEN a `jin:tasks-changed` event SHALL be dispatched by the `mutate()` chokepoint (Approach §8), never by a per-callback bespoke dispatch
VERIFY: test: jin-gui/src/__tests__/tasks_error_surfacing.test.ts#every_task_mutation_dispatches_tasks_changed — the test drives each mutating callback and asserts the event fires; a story that adds a mutating call outside `mutate()` fails this criterion

### Story S1 — honest controls

### AC-S1-01 (event-driven) [R3]
GIVEN the GUI source tree after S1
WHEN  the verification gate scans it for a `critical` priority *literal*
THEN the priority options offered anywhere in the GUI SHALL be exactly `none`, `low`, `medium`, `high`
NOTE [R3]: the R2 command (`rg -n "critical" jin-gui/src`) was DEFECTIVE — it could never pass. It matched the ordinary English word in `settings_controller.ts`, `settings.css`, `livePreview.ts` and `today_controller.test.ts` ("the critical caveat", "non-critical", "critical for…"). The defect was never the word; it was a phantom `'critical'` **`Priority` option** (`render.ts:921`) that hard-errors at `parse_priority`. The replacement matches the quoted literal only. Verified in BOTH directions on the real tree: clean on the S1 tree (the phantom option is genuinely gone from `render.ts`), and it catches a reintroduced `PRIORITY_OPTIONS = [… ,'critical']`.
NOTE [R4]: scope narrowed to exclude `__tests__` — an anti-regression test that asserts the literal is ABSENT (`expect(PRIORITY_OPTIONS).not.toContain('critical')`) would otherwise turn this gate permanently red, which is the exact class of defect it is being fixed for. Audited: clean on the S1 tree.
VERIFY: command: `rg -n "'critical'|\"critical\"" jin-gui/src/lib jin-gui/src/controllers jin-gui/index.html` returns no match

### AC-S1-02 (event-driven)
GIVEN a task whose status is `done`
WHEN  the detail pane renders its status select
THEN the detail status select SHALL render exactly two options — `done` (current) and `todo` (the only legal successor)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#status_select_offers_only_legal_transitions_for_done

### AC-S1-03 (event-driven)
GIVEN a task whose status is `cancelled`
WHEN  the detail pane renders its status select
THEN the detail status select SHALL NOT render a `done` option
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#status_select_hides_done_for_cancelled

### AC-S1-04 (event-driven) [R3]
GIVEN each of the five `TaskStatus` values in turn
WHEN  `legalNextStatuses` is called with it
THEN `legalNextStatuses` SHALL return, for each of the five statuses, exactly the successor set encoded by `TaskStatus::can_transition_to` in `jin-core/src/model/task.rs:49-61`
NOTE [R3]: this is a CROSS-LANGUAGE PARITY criterion and it is satisfiable-while-useless by the obvious implementation. A TS test asserting a TS table against a second TS table is both-sides-TypeScript: changing `can_transition_to` in **Rust** would not fail it, which is the entire failure mode this criterion exists to prevent. The test MUST therefore derive its expected map by PARSING the Rust source (`jin-core/src/model/task.rs`, the `matches!` arms of `can_transition_to`) — not by re-typing the pairs in TypeScript. It MUST carry an ANTI-VACUITY GUARD: assert the parse found exactly 8 arms (todo→doing, todo→done, todo→cancelled, doing→done, doing→cancelled, doing→todo, done→todo, cancelled→todo) and fail LOUDLY if it finds zero — a parser that silently matches nothing turns this into a test that passes against an empty expectation. Same reasoning as AC-S6-04's anti-mock clause: when the bug class is "the two sides drift apart", a test that reads only one side certifies the drift.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#legal_next_statuses_mirrors_core_fsm — derived from the Rust source, with the 8-arm anti-vacuity guard

### AC-S1-05 (unwanted-behavior)
GIVEN the detail editor's priority save
WHEN `editTask` rejects
THEN the controller SHALL dispatch `app:error` rather than swallow the rejection
VERIFY: test: jin-gui/src/__tests__/tasks_error_surfacing.test.ts#priority_save_rejection_dispatches_app_error

### AC-S1-06 (event-driven)
GIVEN the view is set to `board`
WHEN the user switches from one list to another
THEN the view SHALL remain `board` (view is a global preference in `localStorage['jin.tasks.view']`)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#view_persists_globally_across_list_switch

### AC-S1-07 (event-driven)
GIVEN the GUI source tree after S1 (view state now lives in `localStorage['jin.tasks.view']`)
WHEN  the verification gate scans it for `editList` calls carrying a `view` key
THEN the GUI SHALL make no call to `editList` with a `view` key
NOTE [R4]: the R2 command was DEFECTIVE IN THE PERMISSIVE DIRECTION — the opposite of the other three, and the more dangerous one for a removal gate. `rg` is line-based by default, so a reintroduced call formatted across lines (`editList(id, {\n  view: newView,\n })`) MISSES entirely; verified against an injected probe. `-U` (multiline) closes that hole, but an unscoped `-U` regex is then permanently RED on `invoke.ts:237`, where the bridge wrapper legitimately DECLARES `view?: string` in its input type — the core keeps the field; only the GUI stops calling it. Hence: multiline AND scoped to call sites. Audited both directions: clean on the tree, catches the multi-line injection.
VERIFY: command: `rg -nU "editList\([^)]*view" jin-gui/src/controllers jin-gui/src/lib` returns no match

### AC-S1-08 (event-driven) [R1] — S1-ONLY, RETIRED BY S4
GIVEN main is at S1..S3 (S4 not yet merged) and no single list is the active scope
WHEN  the filter bar renders
THEN the view-toggle button SHALL be `disabled` with `aria-disabled="true"`
NOTE: this criterion is scoped to S1 through S3 and is SUPERSEDED by AC-S4-07, which requires the opposite (the board renders in every scope, so the toggle is never disabled). The two do not conflict: they hold at different points on main. The S4 PR MUST DELETE the `view_toggle_disabled_without_list_scope` test — not "update" it — and MUST name AC-S1-08 as retired in its description. A checker seeing this test still present after S4 has found a defect.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#view_toggle_disabled_without_list_scope (deleted by the S4 PR)

### Story S2 — one item, two skins

### AC-S2-01 (event-driven)
GIVEN the GUI source tree after S2
WHEN  the verification gate scans it for the two retired item builders
THEN `buildTaskRow` and `buildTaskCard` SHALL no longer exist; `buildTaskItem` SHALL be the only task-item builder
NOTE [R4]: comment lines dropped (a comment NAMING the retired builders is not a builder) and `__tests__` excluded (a test asserting their removal would name them). A test still *calling* a deleted export cannot compile, so the `tsc` half of AC-X-04 covers that hole — defense in depth, not a gap. Audited: clean on the S2 tree.
VERIFY: command: `rg -n "buildTaskRow|buildTaskCard" jin-gui/src/lib jin-gui/src/controllers | rg -v ':\s*(\*|//|/\*)'` returns no match

### AC-S2-02 (event-driven) [R1]
GIVEN the same `TaskDto` rendered by `buildTaskItem` as both a row and a card
WHEN  each corresponding action is activated on each variant (select, status toggle, delete, drag start)
THEN both variants SHALL fire the identical callback with identical arguments for that action
NOTE: the test MUST render BOTH variants and assert, per action, that the SAME spy fires with the same arguments. Comparing class names, selectors, `outerHTML`, or DOM shape is explicitly FORBIDDEN as the assertion for this criterion — a class-name parity test proves nothing about behavior and fails this AC by construction.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#row_and_card_fire_identical_callbacks

### AC-S2-03 (event-driven)
GIVEN a task rendered as a board card
WHEN the user activates the card's delete control
THEN the same `onDeleteRequest` callback SHALL fire that the list row fires
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#card_delete_fires_same_callback_as_row

### AC-S2-04 (event-driven) [R2] — S2-ONLY, RETIRED BY S4
GIVEN a board rendered at S2 or S3 (columns are still section-keyed; S4 re-keys them to status)
WHEN  the board renders
THEN every board column SHALL contain an add-task row when the list variant would have one
NOTE [R2]: a SECOND supersession pair, of the same class as AC-S1-08/AC-S4-07 (which Kupo caught) — found while re-deriving the triggers. At S2 the board is still section-keyed, so every column gets the add row that only the list had. AC-S4-08 REPLACES this criterion the moment S4 re-keys the columns to status, where an add row under Done would be a lie (core always creates at `todo`). The S4 PR MUST DELETE the `board_columns_have_add_task_row` test — not "update" it — and MUST name AC-S2-04 as retired in its description. A checker seeing this test still present after S4 has found a defect.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_columns_have_add_task_row (deleted by the S4 PR)

### AC-S2-05 (event-driven)
GIVEN the active sort mode is `priority`
WHEN the board renders
THEN the cards within a column SHALL be ordered by `sortTasksForMode(tasks, 'priority')`, not by `position`
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_honors_active_sort_mode

### AC-S2-06 (event-driven)
GIVEN the board renderer after S2 (it now honors the active sort mode)
WHEN  the verification gate scans `render.ts` for a hardcoded `'manual'` sort argument
THEN the board renderer SHALL contain no hardcoded `'manual'` sort argument
NOTE [R4]: audited for VACUITY — the opposite risk from the other greps. A gate that can never FIRE is as worthless as one that can never pass, and it fails silently. Verified against the PRE-S2 source (`e1c16ea:render.ts:360`, `const sorted = sortTasksForMode(group.tasks, 'manual');`): the regex DOES fire on the real defect, so the gate is not vacuous. `-U` closes the multi-line-formatting escape; comment lines are dropped because `render.ts`'s own doc comments now narrate the retired hardcode (lines 236, 343) and would otherwise re-redden it.
VERIFY: command: `rg -nU "sortTasksForMode\([^)]*'manual'\)" jin-gui/src/lib/tasks/render.ts | rg -v ':\s*(\*|//|/\*)'` returns no match

### Story S3 — the detail pane

### AC-S3-01 (event-driven)
GIVEN the task list is rendered
WHEN the user clicks a task item
THEN the list SHALL remain visible in the DOM (no `hidden` class added to the list panel)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#selecting_a_task_keeps_the_list_visible

### AC-S3-02 (event-driven)
GIVEN a task is selected and its pane is open
WHEN the user clicks a different task item
THEN the pane SHALL re-hydrate for the newly clicked task in a single click (no intermediate back navigation)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#pane_switches_task_in_one_click

### AC-S3-03 (event-driven)
GIVEN a task is selected
WHEN  the list renders
THEN exactly one rendered item SHALL carry `aria-selected="true"`
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#exactly_one_item_is_aria_selected

### AC-S3-04 (event-driven)
GIVEN the GUI source tree and `index.html` after S3 (the pane is the only editor)
WHEN  the verification gate scans them for the retired row-edit-modal path
THEN the pencil/edit modal path SHALL be gone — no `#jin-task-edit-dialog`, no `openEditDialog`, no `onEditRequest`
NOTE [R4]: the R2 command was UNSCOPED (`… jin-gui/src jin-gui/index.html`) and could never pass — it matched `ListsController`'s legitimate, correct, out-of-scope list-editing code (`lib/lists/render.ts:19,165-169`; `lists_controller.ts:181,252`; `lists_controller.test.ts`), which S5 explicitly KEEPS ("already compliant"). The replacement is scoped to the task-edit surface and drops comment lines. Audited in both directions on the S3 tree: clean, and it still catches an injected `private openEditDialog(id) { … }`.
VERIFY: command: `rg -n "jin-task-edit-dialog|openEditDialog|onEditRequest" jin-gui/src/controllers/tasks_controller.ts jin-gui/src/lib/tasks jin-gui/index.html | rg -v ':\s*(\*|//|/\*)'` returns no match

### AC-S3-05 (unwanted-behavior)
GIVEN a task whose stored notes are non-empty, rendered from a `list_tasks` projection where `body` is `""`
WHEN the user renames that task from the detail pane
THEN the stored notes SHALL be unchanged after the save (the pane hydrates via `getTaskById`, never from the list projection)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#renaming_from_pane_never_erases_notes_D1_regression

### AC-S3-06 (event-driven)
GIVEN a task is open in the detail pane
WHEN  the pane renders
THEN the detail pane SHALL expose an editable control for every field core supports: title, status, priority, due, list, section, tags, body, reminders
NOTE [R1]: this criterion covers the EDITABLE FIELDS only. The pane's three non-field surfaces are gated separately and are NOT optional: Delete (AC-S3-07), backlinks (AC-S3-10), promote (AC-S3-11). A pane that satisfies AC-S3-06 while missing any of those three fails the story.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#pane_exposes_every_core_field

### AC-S3-07 (event-driven)
GIVEN a task is open in the pane
WHEN the user activates the pane's Delete control and confirms
THEN `deleteTask` SHALL be called for that task id (the old page-swap detail had no delete at all)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#pane_delete_calls_delete_task

### AC-S3-08 (event-driven)
GIVEN a deep link arrives as a `jin:open-detail` event for a task outside the active scope
WHEN the controller handles it
THEN the scope SHALL switch to that task's list before the task is selected
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#deep_link_switches_scope_then_selects

### AC-S3-09 (event-driven)
GIVEN the pane is open
WHEN the user presses Escape or activates the pane's close control
THEN the selection SHALL be cleared and the pane collapsed
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#escape_clears_selection_and_closes_pane

### AC-S3-10 (event-driven) [R1]
GIVEN a task with at least one backlink is open in the pane
WHEN  the pane renders
THEN the pane SHALL render that backlink in a backlinks section (parity with the retired page-swap detail, which had one)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#pane_renders_backlinks_section

### AC-S3-11 (event-driven) [R1]
GIVEN a task is open in the pane
WHEN  the pane renders
THEN the pane SHALL expose the promote-to-event action, which dispatches `jin:open-promote` for that task id
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#pane_exposes_promote_action

### Story S4 — Kanban by status

### AC-S4-01 (event-driven)
GIVEN any scope with tasks in it
WHEN  the board renders
THEN the board SHALL render exactly three columns — Todo, Doing, Done — keyed by `TaskStatus`
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_renders_three_status_columns

### AC-S4-02 (event-driven)
GIVEN a task whose status is `cancelled` is in the active scope
WHEN  the board renders
THEN a task whose status is `cancelled` SHALL NOT appear on the board
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_excludes_cancelled_tasks

### AC-S4-03 (event-driven)
GIVEN a task with status `todo` on the board
WHEN the user drops its card into the Doing column
THEN `setTaskStatus(id, 'doing')` SHALL be called exactly once
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#legal_board_drop_calls_set_task_status

### AC-S4-04 (unwanted-behavior)
GIVEN a task with status `done` (core rejects `done → doing`)
WHEN the user drags its card over the Doing column
THEN `setTaskStatus` SHALL NOT be called even once — the Doing column refuses the drop
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#illegal_board_drop_never_calls_bridge

### AC-S4-05 (event-driven) [R5] — CLARIFIED
GIVEN a `done` card (whose only legal successor is `todo`, so the Doing column is an illegal target)
WHEN  the card's `dragstart` handler runs
THEN every column that is neither the card's own current-status column nor a legal successor SHALL carry `aria-disabled="true"`
NOTE [R5]: the R1..R4 wording said "every column that is not a legal successor", which — since the FSM has NO self-transition arms (`can_transition_to(X, X)` is false for every X) — literally required greying out the card's OWN column mid-drag. That is safe but visually wrong: a user dragging a Done card would see the Done column go dead. The card's home column is not an illegal *target*; it is the place the card already is. It stays enabled, and a drop into it is a no-op cancel (AC-S4-09).
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#illegal_columns_are_aria_disabled_during_drag

### AC-S4-09 (unwanted-behavior) [R5] — NEW, from the FSM re-derivation
GIVEN a card being dragged on the board, and an FSM with no self-transition arms (`can_transition_to(X, X)` is false for every status X)
WHEN  the user drops the card back into the column it was dragged from
THEN `setTaskStatus` SHALL NOT be called (the gesture is a no-op cancel, not a transition request)
NOTE [R5]: found by re-deriving the FSM from `can_transition_to` rather than trusting the spec's own prose. A handler that treats every drop as a transition would fire `setTaskStatus(id, <same status>)`, which core REJECTS as `InvalidStateTransition` — so the most innocent gesture on the board (pick a card up, change your mind, put it back) would raise an error toast. Neither the drop-refusal criteria (AC-S4-04/05) nor the legal-drop criterion (AC-S4-03) covered the source column, because the source column is neither illegal nor a successor.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#dropping_a_card_back_into_its_source_column_makes_no_bridge_call

### AC-S4-06 (event-driven)
GIVEN a `done` task on the board
WHEN the user activates its Reopen action
THEN `setTaskStatus(id, 'todo')` SHALL be called (the legal way back)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#reopen_action_transitions_done_to_todo

### AC-S4-07 (event-driven) [R1] — SUPERSEDES AC-S1-08
GIVEN the active scope is a smart view (no single list)
WHEN  the board renders
THEN the board SHALL still render, with the view toggle enabled (never `disabled`, never `aria-disabled`)
NOTE: this criterion RETIRES AC-S1-08. The S4 PR deletes the S1 test `view_toggle_disabled_without_list_scope`.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_renders_in_smart_view_scope

### AC-S4-08 (event-driven) [R2] — SUPERSEDES AC-S2-04
GIVEN a board rendered after S4 (columns are status-keyed)
WHEN  the board renders
THEN the add-task row on the board SHALL exist only in the Todo column
NOTE [R2]: this criterion RETIRES AC-S2-04. The S4 PR deletes the S2 test `board_columns_have_add_task_row`. Both supersession pairs in this wave (AC-S1-08 → AC-S4-07, AC-S2-04 → AC-S4-08) exist for the same reason: S4 re-keys the board's columns from sections to statuses, which legitimately invalidates two S2/S1-era guarantees. Neither is a contradiction; each holds at a different point on main.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#board_add_row_only_in_todo_column

### Story S5 — the sidebar

### AC-S5-01 (event-driven)
GIVEN the tasks surface is mounted
WHEN  the sidebar rail renders
THEN the sidebar SHALL render four smart views — Inbox, Today, Upcoming, Completed — above the user lists
VERIFY: test: jin-gui/src/__tests__/lists_controller.test.ts#sidebar_renders_four_smart_views

### AC-S5-02 (event-driven)
GIVEN a scope is active
WHEN  the sidebar rail renders
THEN exactly one sidebar row SHALL carry `aria-current="true"`
VERIFY: test: jin-gui/src/__tests__/lists_controller.test.ts#exactly_one_row_is_aria_current

### AC-S5-03 (event-driven)
GIVEN the Inbox scope shows a badge count of N
WHEN the user creates a task in Inbox through the controller
THEN the badge SHALL read N+1 without a page reload
VERIFY: test: jin-gui/src/__tests__/lists_controller.test.ts#counts_refresh_after_task_create

### AC-S5-04 (event-driven)
GIVEN a task is deleted through the controller
WHEN the deletion resolves
THEN a `jin:tasks-changed` event SHALL be dispatched
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#task_mutations_dispatch_tasks_changed

### AC-S5-05 (event-driven)
GIVEN a task set mixing `todo`, `doing`, `done` and `cancelled` tasks
WHEN  `computeSidebarCounts` is called
THEN sidebar counts SHALL count only open tasks (status `todo` or `doing`)
VERIFY: test: jin-gui/src/__tests__/lists_controller.test.ts#counts_exclude_done_and_cancelled

### AC-S5-06 (event-driven)
GIVEN a task set mixing due dates (overdue, today, future, none) and statuses
WHEN  the Today scope is applied via `applyScope`
THEN the Today smart view SHALL contain exactly the open tasks whose due date is today or earlier
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#today_scope_selects_open_overdue_and_due_today

### AC-S5-07 (event-driven)
GIVEN `index.html` and the GUI source tree after S5 (the rail is the only scope control)
WHEN  the verification gate scans them for the retired list-filter select
THEN the duplicate list-filter select `#tasks-list-filter` SHALL be gone from the filter bar (the rail is the only scope control)
NOTE [R4]: comment lines dropped and `__tests__` excluded — S5's own PR migrates those tests to `jin:scope-changed` and will inevitably NAME the removed id while doing so. Audited: 2 hits today, both the real markup (`index.html:956,958`) — the intended RED, since S5 has not shipped. No CSS rule references the id, so nothing else can keep it red after removal.
VERIFY: command: `rg -n "tasks-list-filter" jin-gui/index.html jin-gui/src/controllers jin-gui/src/lib jin-gui/src/styles | rg -v ':\s*(\*|//|/\*)'` returns no match

### AC-S5-08 (event-driven)
GIVEN two lists in the rail
WHEN the user drags the second list above the first
THEN `reorderList` SHALL be called with a rank key strictly less than the first list's position
VERIFY: test: jin-gui/src/__tests__/lists_controller.test.ts#list_drag_reorder_calls_reorder_list

### AC-S5-09 (event-driven) [R1]
GIVEN the `#tasks-list-filter` select has been removed from the filter bar (AC-S5-07) and list L2 is not the active scope
WHEN the user activates L2's row in the rail
THEN the rendered task items SHALL be exactly L2's tasks (scope switching still works through `jin:scope-changed`, with the removed select gone)
NOTE: AC-S5-07 is a grep for the removal; this criterion is the functional half. A PR that deletes the select and breaks scope switching passes AC-S5-07 and fails here.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#rail_scope_switch_renders_target_list_without_filter_select

### Story S6 — subtasks

### AC-S6-01 (event-driven)
GIVEN a task file whose frontmatter carries no `parent` key
WHEN  `parse_fm` parses it
THEN a task file with no `parent` key SHALL parse with `parent == None`
VERIFY: test: jin-core/src/model/task.rs#serde_default_legacy_task_file_parses_without_parent

### AC-S6-02 (unwanted-behavior)
GIVEN a task B whose parent is task A
WHEN a caller attempts to create task C with `parent = B` (depth 2)
THEN `create_task` SHALL return a validation error rather than write the file
VERIFY: test: jin-core/src/ops/tasks.rs#subtask_depth_is_capped_at_one

### AC-S6-03 (unwanted-behavior)
GIVEN task A
WHEN a caller attempts to set A's parent to A
THEN `edit_task` SHALL return a validation error
VERIFY: test: jin-core/src/ops/tasks.rs#self_parenting_is_rejected

### AC-S6-04 (event-driven) [R1]
GIVEN a subtask created with `parent = A` through the real `create_task` op against a temp store, with the SQLite index rebuilt from the files on disk
WHEN `api::list_tasks` returns its `TaskDto`
THEN `parent` SHALL equal `A` (the field survives the index projection, not merely the model)
NOTE: the test MUST drive the REAL pipeline end to end — `create_task` writes a task file → `index::rebuild` reads that file → `api::list_tasks` queries the index → `TaskDto::from_row` projects it. Mocking or stubbing `from_row`, the index, or the store, and hand-feeding a `TaskDto`/`TaskRow`/frontmatter fixture, are explicitly FORBIDDEN and fail this criterion. This is the exact shape of the shipped Notes `body_markdown` defect; a mocked test here is worse than no test, because it certifies the bug.
VERIFY: test: jin/tests/s4_tasks_notes_crud.rs#parent_survives_index_rebuild_and_list_tasks (CLI-driven, real temp store, no mocks)

### AC-S6-05 (event-driven)
GIVEN parent A has children B (todo) and C (doing)
WHEN A transitions to `done`
THEN B and C SHALL both be `done` (completion cascades down)
NOTE [R1]: the cascade writes N files with no transaction. Children are written first and the parent last, so a crash mid-cascade leaves the parent open (recoverable by re-completing) rather than a completed parent with open children. Crash-recovery behavior is MANUAL-TEST-ONLY (kill the process mid-cascade); this AC covers the happy path only, and the ordering guarantee is what makes the unhappy path survivable.
VERIFY: test: jin-core/src/ops/tasks.rs#parent_completion_cascades_to_open_children

### AC-S6-05b (event-driven) [R1]
GIVEN parent A has children B (todo) and C (doing)
WHEN A transitions to `cancelled`
THEN B and C SHALL both be `cancelled` (cancellation cascades down exactly as completion does)
NOTE: `done` and `cancelled` are parallel cascade cases in the Approach §6 rollup table. An implementation that cascades on `done` and forgets `cancelled` stays green against AC-S6-05 alone; this criterion is what makes that impossible.
VERIFY: test: jin-core/src/ops/tasks.rs#parent_cancellation_cascades_to_open_children

### AC-S6-06 (event-driven)
GIVEN parent A is `done` with children B and C `done`
WHEN A transitions to `todo` (reopen)
THEN B and C SHALL remain `done` (no reverse cascade)
VERIFY: test: jin-core/src/ops/tasks.rs#parent_reopen_does_not_reopen_children

### AC-S6-07 (event-driven)
GIVEN parent A has children B and C, and all children complete
WHEN C transitions to `done`
THEN A SHALL remain in its current status (no upward auto-complete)
VERIFY: test: jin-core/src/ops/tasks.rs#children_completion_never_auto_completes_parent

### AC-S6-08 (event-driven)
GIVEN parent A in list L1 with child B
WHEN A is edited to list L2
THEN B's list SHALL become L2 (a subtask lives with its parent)
VERIFY: test: jin-core/src/ops/tasks.rs#child_list_follows_parent_list_change

### AC-S6-09 (event-driven)
GIVEN parent A with child B
WHEN A is soft-deleted
THEN B SHALL be soft-deleted as well
VERIFY: test: jin-core/src/ops/tasks.rs#parent_delete_cascades_to_children

### AC-S6-10 (event-driven)
GIVEN a subtask whose own due date is today
WHEN  the Today smart view renders
THEN it SHALL appear in the Today smart view as a standalone item carrying a parent breadcrumb chip
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#subtask_surfaces_independently_in_today

### AC-S6-11 (event-driven)
GIVEN a parent task with 5 children of which 2 are done
WHEN  its item renders
THEN its rendered item SHALL show a `2/5` progress indicator
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#parent_item_shows_subtask_progress

### AC-S6-12 (event-driven)
GIVEN a subtask is open in the detail pane
WHEN  the pane renders
THEN the pane's list and section selects SHALL be disabled
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#subtask_pane_disables_list_and_section

### AC-S6-13 (event-driven) [R1]
GIVEN a list scope in list view, where parent A (expanded) has children B and C
WHEN  the list renders
THEN B and C SHALL render as child items directly beneath A, each carrying the child modifier class `task-item--child`, and SHALL NOT also render as top-level items
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#children_render_nested_under_parent_not_top_level

### AC-S6-14 (event-driven) [R1]
GIVEN parent A is expanded with children B and C visible
WHEN the user activates A's collapse caret
THEN B's and C's items SHALL no longer be present in the rendered list
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#collapsing_parent_hides_child_items

### AC-S6-15 (event-driven) [R1]
GIVEN a child item in list view (child reorder is out of scope for v1)
WHEN  the list renders
THEN a child item SHALL expose no drag handle and SHALL NOT be `draggable` (child reorder is out of scope for v1)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#child_items_are_not_draggable

### Story S7 — bulk and keyboard

### AC-S7-01 (event-driven)
GIVEN three tasks are rendered
WHEN the user cmd/ctrl-clicks all three
THEN all three SHALL carry `aria-selected="true"`
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#ctrl_click_multi_selects

### AC-S7-02 (event-driven) [R5] — WORKED EXAMPLE CORRECTED
GIVEN a multi-selection containing one `done` task and one `doing` task
WHEN  the bulk panel renders its status control
THEN the bulk status control SHALL offer only `todo` — the intersection of the two tasks' legal successors: `legalNextStatuses('done')` = `[todo]`, `legalNextStatuses('doing')` = `[todo, done, cancelled]`, so `[todo] ∩ [todo, done, cancelled]` = `[todo]`
NOTE [R5]: the R1..R4 example was `{done, todo}` and claimed it yields `[todo]`. That is ARITHMETICALLY IMPOSSIBLE. A status is never its own successor (the FSM has no self-transition arms), so `legalNextStatuses('done')` = `[todo]` and `legalNextStatuses('todo')` = `[doing, done, cancelled]` — their intersection is **EMPTY**. No correct implementation of "the intersection" produces `[todo]` from that pair; an implementer who trusted the example and reverse-engineered logic to satisfy it would have built something WRONG that passed its own test. The pair that actually yields `[todo]` — and that matches this criterion's stated intent — is `{done, doing}`. Re-derived mechanically from `can_transition_to`, not from memory. The intersection MUST be computed from S1's `legalNextStatuses` (one FSM mirror, parsed from Rust per AC-S1-04), never from a second hand-typed table.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#bulk_status_offers_only_intersection_of_legal_transitions

### AC-S7-03 (unwanted-behavior)
GIVEN a bulk delete of five tasks where the third bridge call rejects
WHEN the operation completes
THEN the controller SHALL report "4 of 5" through `app:error` and SHALL still have attempted items four and five
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#bulk_partial_failure_reports_and_continues

### AC-S7-04 (event-driven)
GIVEN focus is on the task list and no input is focused
WHEN the user presses ArrowDown
THEN the selection SHALL move to the next item
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#arrow_down_moves_selection

### AC-S7-05 (event-driven)
GIVEN an item is selected via keyboard
WHEN the user presses Enter
THEN the detail pane SHALL open for that item
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#enter_opens_pane

### AC-S7-06 (event-driven)
GIVEN an item is selected via keyboard
WHEN the user presses Delete
THEN the delete confirmation SHALL open for that item
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#delete_key_opens_confirm

### AC-S7-07 (unwanted-behavior)
GIVEN the caret is inside the quick-add input
WHEN the user types the letter `n`
THEN the quick-add shortcut SHALL NOT fire (shortcuts are inert inside text inputs)
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#shortcuts_inert_in_inputs

### AC-S7-09 (unwanted-behavior) [R5] — NEW, uncovered by the AC-S7-02 correction
GIVEN a multi-selection containing one `done` task and one `todo` task — the most natural mixed selection a user can make, and one whose legal-successor intersection is EMPTY (`[todo]` ∩ `[doing, done, cancelled]` = `{}`)
WHEN  the bulk panel renders its status control
THEN the panel SHALL render an explicit "no status change is valid for every selected task" message in place of the status control, never a dead empty select
NOTE [R5]: this case had NO criterion at all, and the reason is instructive: AC-S7-02's broken example asserted a NON-empty result for the one pair that intersects to empty, so the empty case looked like it could not arise. A wrong worked example does not merely mislead — it CONCEALS the edge case it gets wrong. The behavior exists in the S7 implementation already; this criterion is what stops a future change from regressing it back to an empty dropdown.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#bulk_empty_intersection_explains_itself_never_empty_select

### AC-S7-08 (event-driven) [R1]
GIVEN a bulk operation over five selected tasks, of which one bridge call rejects
WHEN the batch settles
THEN exactly one `jin:tasks-changed` event SHALL be dispatched for the whole batch (never zero, never N)
NOTE: zero dispatches leaves the sidebar counts stale behind every bulk op — the exact defect S5 exists to kill. N dispatches thrash the rail. The count assertion is the point of this criterion.
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#bulk_dispatches_tasks_changed_exactly_once

### Story S8 — free wins

### AC-S8-01 (event-driven)
GIVEN two sections in a list
WHEN the user drags the second section above the first
THEN `reorderSection` SHALL be called with a rank key strictly less than the first section's position
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#section_drag_calls_reorder_section

### AC-S8-02 (event-driven)
GIVEN a tag chip
WHEN the user picks a new color in the tag color modal
THEN `setTagColor(slug, color)` SHALL be called
VERIFY: test: jin-gui/src/__tests__/tasks_controller.test.ts#tag_color_picker_calls_set_tag_color

### AC-S8-03 (event-driven)
GIVEN `index.html` after S8
WHEN  the verification gate scans it for the two retired raw `<dialog>` section targets
THEN the add-section and delete-section dialogs SHALL be `JinModal`-hosted, with no `data-tasks-target="addSectionDialog"` or `deleteSectionDialog` remaining
NOTE [R4]: scope EXTENDED to `tasks_controller.ts` — a STRENGTHENING, the only one in this audit. The R2 check looked at `index.html` alone, so it would have gone green while the controller still declared the dead Stimulus targets (`'addSectionDialog'`, `declare addSectionDialogTarget`, `tasks_controller.ts:139-175`) — leaving in place exactly the subtree-scoping foot-gun (DT-2) that porting these dialogs to `JinModal` exists to remove. 10 hits across both files today (the intended RED); S8 must clear all of them.
VERIFY: command: `rg -n "addSectionDialog|deleteSectionDialog" jin-gui/index.html jin-gui/src/controllers/tasks_controller.ts | rg -v ':\s*(\*|//|/\*)'` returns no match

## Confidence

**Revision 1 (post-critique):** `ramza-score --rubric confidence` → **87.5% → AUTO_PROCEED**
(`pattern_match 85`, `requirement_clarity 88`, `decomposition_stability 85`,
`constraint_compliance 92`).

*Revision 0 (pre-critique) scored 84.25% → VALIDATE.* The gain is earned, not asserted:
Kupo's independent critique landed 13 findings and **not one of them moved a story
boundary** — every fix was a criterion becoming harder to fake (`decomposition_stability`
85), plus 13 resolved ambiguities in what "done" means (`requirement_clarity` 88), plus
explicit confirmation that the pattern recall (the Notes `body_markdown` index-projection
bug, serde defaults, JinModal, `rank`, `app:error`) is the right prior art
(`pattern_match` 85). `refine` cycle 1 scored `{clarity 4, completeness 4, actionability 4,
efficiency 4, testability 5}` — pass.

Self-consistency check (T-layer, full tier): three decompositions — by defect
(D2+D3+D10 / D4+D6 / D5 / D8 / subtasks / bulk / dead-fns), by layer (core+bridge /
render / controller / sidebar / CSS), and by owner complaint (#1 / #2 / #3+#4 / cleanup)
— produce the same eight atoms with ~82% grouping overlap. Above the 70% floor. The
critique independently re-derived the same eight and challenged none of them.

---

## Rejected Alternatives

- **H-A — patch in place** (`ramza-score --rubric explore` = **56, weak**). Keep
  `buildTaskRow` and `buildTaskCard` as separate components, bolt the missing buttons
  onto the card, add the pane as a third panel. Cheapest and least risky *this month*;
  it scores 3/10 on maintainability because it re-creates exactly the condition that
  produced the defect list — two components for one concept, drifting apart on their own
  schedules. The owner's complaint #1 is a *symptom* of that drift, so this fixes
  symptoms only.
- **H-C — port the Notes 3-pane wholesale** (**68, weak**). Reuse the Notes Wave-2
  rail/list/editor structure for Tasks. Strong on layout, but it is a *layout* answer to
  a *tooling* problem: it says nothing about the board, subtasks, or bulk ops, and the
  Notes block-based live editor is far heavier than a task's notes field needs. **Partly
  adopted:** H-B reuses its 3-pane grid idiom for the detail pane (Approach §2) — the
  pattern earns its keep as a component, not as a plan.
- **H-D — state-container rewrite** (**62, weak**). Replace the 1267-line god-controller
  with a store/reducer and a virtual re-render. Best maintainability score (9) and the
  most honest long-term answer, but simplicity 3 / risk 3: a rewrite cannot ship
  incrementally, and this owner ships one PR at a time and tests on macOS between each.
  The `buildTaskItem` seam (S2) plus the pure `scopes.ts` / `counts.ts` / `bulk.ts`
  modules capture most of the maintainability win without the blast radius. Revisit when
  `tasks_controller.ts` next crosses a pain threshold.
- **H-E — core-first smart views** (**62, weak**). Push scopes, counts and board
  semantics into jin-core (saved views, indexed counts, a status-grouped query). Correct
  in the abstract, but it violates the owner's explicit constraint (`parent` is the only
  core model change) and buys nothing at personal data scale. `computeSidebarCounts` is
  a pure seam: if counts ever get slow, they move to core behind an unchanged GUI contract.

---

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| **S2 is a visual rewrite of the task item; jsdom cannot see CSS.** The repo has a documented "logic gates don't catch visual regressions" history (all task CSS in one `browse.css`). | **P0** | Owner screenshot pass on S2 before merge (`docs/gui-testing.md §5`); `css_tokens.test.ts` + stylelint keep tokens honest; ship S2 alone in its own PR. |
| **S6 `parent` lands in the model but not the index** → `list_tasks`/`get_task` return `parent: null` forever while every model test stays green. Same bug class as the shipped Notes `body_markdown` defect. | **P0** | AC-S6-04 is an integration test through the index (create → rebuild → `list_tasks`); the story lists all six projection sites; `SCHEMA_VERSION` bump forces stale indexes to rebuild. |
| ~~**D1 (notes erasure) reintroduced by the new pane**~~ — **CLOSED AT S3 [R4]** | ~~P0~~ | **VERIFIED, not merely mitigated.** The D1 guard survived the deletion of the modal it lived in: re-pointed at the pane as `renaming_from_pane_never_erases_notes_D1_regression`, with an honest `body: ''` fixture, and confirmed to go RED when the bug is reintroduced. Better than the spec asked for — the pane saves **per-field** (`onSaveTitle` sends only `{title}`), so the body is never in the payload at all. That is *structurally immune*, not defensively patched: the class of bug is now unrepresentable rather than merely tested-against. The wave's riskiest deletion is done. |
| **S6 is also a visual change** — nested/collapsible children, the `2/5` badge, the parent breadcrumb chip — and jsdom cannot see any of it. Same exposure as S2, originally ungated. | **P0** | **Owner screenshot sign-off before merge [R1]**, identical to S2 (`docs/gui-testing.md §5`). AC-S6-13/14/15 pin the DOM structure; the screenshot pins the pixels. |
| **The anti-DT-2 wiring gate** (`tasks_lists_modal_wiring.test.ts`, mounts the real `index.html`) breaks during the S3/S5 markup surgery. | **P1** | Keep it green at every story boundary (AC-X-02); it is the canary for Stimulus subtree-scoping regressions. |
| **S5 removes `#tasks-list-filter`**, which several existing tests drive as the scope control. | **P1** | The story owns the test migration to `jin:scope-changed`; AC-S5-07 makes the removal explicit rather than incidental. |
| **Bulk ops are non-atomic** (N sequential bridge calls; no transaction in core). A mid-run failure leaves a partial result. | **P1** | AC-S7-03: report "4 of 5" honestly through `app:error` and reload from truth. Never an optimistic UI lie. Atomic bulk ops would need a core change — out of scope. |
| **D7 orphaned tasks** (pre-fix files holding a list *name*) stay invisible under every list scope, and S5's Inbox smart view will not surface them either. | **P1** | Deferred, owner decision. Interim probe in the Deferred section. If the owner confirms orphans exist, a one-time migration becomes S0 and must run **before** S5. |
| **Subtask rollup cascades write N files** (parent + children) with no transaction; a crash mid-cascade leaves children inconsistent. | **P2** | Cascade writes children first, parent last, so a crash leaves the parent open (recoverable by re-completing) rather than a completed parent with open children. Covered by AC-S6-05. |
| **Timebox realism:** 31d of estimate across 8 PRs, one owner test pass each. | **P2** | The sequence is strictly ordered by relief, not by size: S1-S4 (14d) already close complaints #1, #3 and #4. S5-S8 can slip without losing the core cure. |

---

## Sequencing and ship plan

| # | Story | Timebox | Closes | Depends on |
|---|---|---|---|---|
| S1 | Honest controls, honest errors, honest view state | 2d | D2, D3, D10, half of D5 | — |
| S2 | One task item, two skins | 4d | D6, board CRUD parity | S1 (`legalNextStatuses`, `guarded`) |
| S3 | Detail pane replaces both editors | 5d | **#3, #4**, D4, structural cure for D1 | S2 (`buildTaskItem` selection hook) **+ PR #30 merged to main [R1]** |
| S4 | Board = Kanban by status | 3d | **#1**, rest of D5 | S2, S3 |
| S5 | A sidebar that works | 5d | **#2**, D8 | S1 (`guarded`); benefits from S3 |
| S6 | Subtasks are real tasks | 5d | subtask scope item | S2, S3 (item + pane surfaces) |
| S7 | Bulk multi-select and keyboard flow | 4d | bulk/keyboard scope item | S3 (selection model) |
| S8 | Free wins and convention cleanup | 3d | D9, three dead bridge fns | — (independent) |

**S5 is dependency-light** — it needs only S1's `guarded()` helper. If the owner wants
sidebar relief before the item/pane surgery, S5 can be pulled to position 2 with no
rework; the rest of the order is load-bearing.

Each story = version bump → PR → merge to main → owner pulls and tests on macOS.
**S2 and S6 additionally require an owner screenshot sign-off before merge [R1]** — both
ship new CSS that no logic gate in this repo can see (`docs/gui-testing.md §5`).
**S3 must not start until PR #30 (D1 hotfix, v0.14.1) is merged to main [R1].**

---

## Preflight (gate log)

- [x] **RS** ran — `files-est 22 --public-api --migration --stakes high` → score 6 → **full**
- [x] **S** — complexity 11/12 → `human_loop`; honored as 8 owner-gated PRs
- [x] **P** — patterns recalled (CRYSTALIUM: the Notes `body_markdown` index-projection
      bug is the direct precedent for the S6 trap) and in-repo (JinModal, `rank.between`,
      `app:error`, `lib/appearance/state.ts` localStorage idiom, serde-default guard)
- [x] **E** — 5 hypotheses scored via `ramza-score`; H-B selected (82); rejects documented
- [x] **C** — 8 stories, EARS criteria, timeboxes, executor hints
- [x] **T** — `ramza-lint` + `ramza-ears-lint` green (77 criteria); self-consistency ~82%
      across three decompositions
- [x] **CRITIC (maker != checker)** — `ramza-gate critic --author ramza --checker kupo`.
      Kupo returned 13 findings (5 critical); the Assemble gate DENIED on the missing critic
      record, which is exactly what produced them. All 13 closed in revision 1 — every
      change is marked **[R1]** in the criteria above. Summary of what the critique bought:
      AC-S6-04 and AC-S2-02 can no longer be satisfied by mocks or class-name comparison;
      the `cancelled` cascade, the bulk `jin:tasks-changed` dispatch, subtask nesting/collapse,
      the pane's backlinks/promote surfaces, and post-removal scope switching all gained
      criteria; the S1/S4 view-toggle contradiction is now an explicit supersession; the
      dispatch layer is a mutation chokepoint (Approach §8) rather than a per-callback
      obligation; S6 gained core unit tests and a screenshot gate; PR #30 became a hard
      dependency of S3.
- [x] **R** — refine cycle 1/3 (Kupo's 13 findings), `ramza-score --rubric refine` all dims
      ≥ 3 (pass). The **[R2]** amendment (ESL `tonberry.verify` C3 + C7) was scored
      (`--rubric refine --cycle 2`, all dims ≥ 4, pass) but its phase transition was
      **DENIED** — `ramza-gate refine` is enterable from T only, and the plan was already
      at A. That DENY is correct: post-Assemble, the sanctioned amendment path is
      `ramza-freeze --amend --reason`, which records a hash chain rather than re-opening
      the cycle. R2 therefore rides the amendment chain in `state.amendments[]`, and the
      plan's `refine_cycles` legitimately reads **1**, not 2.
- [x] **ESL verify (tonberry)** **[R2]** — C3 `tier_artifacts_present`: `spec.yaml` emitted
      (dual-format, tier=full). C7 `ears_acceptance_complete`: all 39 trigger-less criteria
      given a truthful `given`/`when`; zero criteria now rely on an empty one. No
      precondition was fabricated to silence the linter — see the note under
      `## Acceptance Criteria`.
- [x] **A** — `ramza-drift --declare` (17 globs), `ramza-freeze --criteria` then
      `--amend` (hash chain in the state file), `ramza-verify-emit` green.
- [x] **POST-S7-REVIEW [R5]** — all 11 FSM-quoting criteria re-derived mechanically from
      `can_transition_to` (8 arms, anti-vacuity asserted). AC-S7-02 was FALSE → corrected;
      AC-S7-09 (empty intersection) and AC-S4-09 (self-drop) added — both were cases the
      broken example concealed. Criteria count 77 → **79**; no existing id renumbered.
- [x] **POST-S3 [R4]** — full audit of all 9 command-based `verify_method`s in both
      directions against the real tree (see "THE GREP-GATE RULE" under
      `## Acceptance Criteria`). 5 amended: AC-S3-04 (red forever — matched `ListsController`),
      AC-S1-01 (scope), AC-S1-07 (**permissive** — line-based regex missed a multi-line call),
      AC-S2-06 (verified non-vacuous against pre-S2 source), AC-S2-01/AC-S5-07 (comment/test
      exclusions), AC-S8-03 (**strengthened** — would have passed with the dead Stimulus
      targets still declared). D1 closed and verified at S3.
- [x] **POST-S1 [R3]** — three criteria defects found by implementation, amended and
      re-frozen: AC-X-01 + AC-S1-01 `verify_method` (unpassable greps → verified
      replacements), AC-S1-04 (anti-vacuity CONSTRAINT), and the `AC-X-*` scope split
      (per-PR / per-PR-regression / story-bound-else-wave-exit). **This is the drift-watch
      working as designed:** a frozen criterion that cannot pass is tamper-evident the
      moment someone tries to satisfy it, and the amendment chain records why it moved.

*RAMZA — plan state: `.spectra/plans/todo-loop-closure.state.json`*
