# SPECTRA Spec — Jin ToDo/Tasks Suite Augmentation (v1)

**Status:** decision-ready · **Delivery:** ONE PR, internally phased (P0–P10) · **Confidence:** 0.88
**Grounding:** `todo-spec-inputs.md` (locked decisions), `todo-scout-report.md` (ground-truth map), `todo-research-report.md` (feature/UX reference). Do not re-derive what those establish.
**Governing constraints:** files-first source of truth; SQLite is a derived, rebuildable index; **no migration files**; native `.action-dialog` (no `window.prompt`); Lucide icons registered in all 3 places; behavior-meaningful tests; Node `v24.18.0` for GUI builds.

---

## 0. Phasing & build order (inside the one PR)

Each phase is independently testable; riskiest storage change is front-loaded after the two zero-schema phases that establish the GUI mutation/test patterns every later phase reuses.

| Phase | Epic | Why here / depends on |
|---|---|---|
| **P0** | Priority vocabulary reconciliation | Precondition. Pure transform + markup; zero schema. Unblocks every priority UI surface and fixes a live bug. |
| **P1** | Interactive core wiring | Zero schema — reuses existing `set_task_status`/`edit_task`/`delete_task`/`create_task`. Makes the read-only view live, and establishes the dialog + optimistic-update + mutation-test harness that P3–P10 reuse. |
| **P2** | Data-model foundation (frontmatter + schema + new tables + `SCHEMA_VERSION` bump + rebuild + DTO) | The single riskiest, irreversible-ish storage change; everything downstream builds on it. Backend-only. |
| **P3** | First-class Lists (registry + CRUD + sidebar + populate filter) | Depends on P2 (`lists` table). |
| **P4** | Tags (registry + chips + assignment + filter) | Depends on P2 (`tags`/`task_tags`). Parallel to P3/P5. |
| **P5** | Sections (per-list Kanban columns) | Depends on P3 (sections live in the List file). |
| **P6** | Views: List ↔ Board toggle (persisted per list) | Depends on P5 (sections are the columns/headers). |
| **P7** | Reusable Stimulus calendar component | Independent widget; sequenced before its first consumer (P8). |
| **P8** | Due date + time (overdue styling, quick reschedule) | Depends on P7. No schema change — reuses existing `DueDate::DateTime`. |
| **P9** | Drag-and-drop manual reorder (`move_task`, fractional `position`) | Depends on P2 (`position`), P5 (sections), P6 (board). |
| **P10** | Multiple reminders (stored only, no firing) | Depends on P2 (`reminders`), P7 (absolute-time picker), P8 (relative resolution vs due). |

**Deviation from the brief's suggested order, justified:** the brief listed "data-model + Lists" before "interactive core." I move **interactive core (P1) ahead of the data-model foundation (P2)** because P1 has *zero* schema dependency (it only wires commands that already exist), delivers the headline "make the read-only view interactive" value immediately, and de-risks the dialog/optimistic-update/mutation-test patterns that the schema-heavy phases then build on. The schema rebuild (P2) is idempotent, so running it after P1 costs nothing. All other ordering matches the brief.

---

## 1. Data-model delta (the contract Vivi builds against)

### 1.0 Governing rebuild rule (read first — critical)

A `SCHEMA_VERSION` bump forces `rebuild()` (`is_current_version()==false`). But `rebuild.rs:27` does `DELETE FROM tasks` (**not** `DROP`), and `CREATE TABLE IF NOT EXISTS` (`schema.rs:126`) will **not** add columns to a `tasks` table that already exists in a user's `index.sqlite`. Therefore **every new column on an existing table (`tasks`) MUST also get a guarded `ALTER TABLE` in `schema.rs::apply()`**, mirroring the existing `excerpt`/`folder_path` precedent (`schema.rs:129-135`). New *tables* (`lists`, `sections`, `tags`, `task_tags`) are fine with `CREATE TABLE IF NOT EXISTS` alone. Sequence in `apply()`: run `SCHEMA_SQL`, then `has_column` guards for each new `tasks` column. The `SCHEMA_VERSION` bump then repopulates everything from disk.

- **`SCHEMA_VERSION`:** `"wave2-v1"` → **`"wave3-tasks-v1"`** (`schema.rs:9`).

### 1.1 Priority vocabulary reconciliation (P0 — no schema change)

Canonical vocabulary = core's **`none | low | medium | high`** (`task.rs:56-62`; `commands/tasks.rs:39-54`). No model/schema change — this is a GUI-layer reconciliation only.

| Layer | File | Change |
|---|---|---|
| GUI labels/glyphs/sort | `jin-gui/src/lib/tasks/transform.ts:45,105-133` | Replace `high/normal/low` maps with `none/low/medium/high`. Sort weight `high=3 > medium=2 > low=1 > none=0`. Label map: None/Low/Medium/High. |
| Filter `<select>` | `jin-gui/index.html:749-753` | Options become `""`=All Priorities, `low`, `medium`, `high`, (`none` optional). Remove `normal`. |
| Capture form `<select>` | `jin-gui/index.html:1950-1953` | Same option set; empty default = "None" (sends `undefined` → core default `none`). Remove `value="normal"`. |
| Capture payload | `jin-gui/src/lib/capture/transform.ts:136` | Passes value through unchanged once options are fixed (no code change beyond option values). |

**Glyph decision (look-and-feel, see §5):** render priority as a **`Flag` glyph tinted with Jin tokens** — `high`=danger, `medium`=warning/accent, `low`=muted, `none`=no flag. (Alternative kept for the team: reuse the already-registered `ArrowUp`/`Minus`/`ArrowDown` for high/medium/low and no glyph for none — zero new icon. Flag is the recommendation; flagged in §7.) Either way: **do not introduce Todoist red** — use Jin's own `--color-danger`/accent tokens.

### 1.2 First-class Lists (P2 storage + P3 surface)

**On-disk (source of truth):** one file per List, mirroring the notes/tasks/events convention — `<root>/lists/<id>.md` with `type: list` YAML frontmatter and an (empty) body.
- New `Config::lists_dir()` → `self.root.join("lists")` (`config.rs`, beside `tasks_dir()`:54).
- New `fs` I/O: `write_list` / `read_list` / `list_list_paths` / `find_list_path` (`store/fs.rs`, mirror the Task block `fs.rs:295-339`).
- **Default list seeding:** `ops::lists::ensure_default_list(lists_dir)` creates `lists/inbox.md` if absent with **stable id `"inbox"`** (NOT a ULID), `name:"Inbox"`, default color/icon, first `position`. Called by `list_lists`/app init. **Backward-compat win:** existing tasks already carry `list: "inbox"` (`task.rs:103`, `ops/tasks.rs:42`), so they keep resolving with **zero task rewrites**. User-created lists get ULID ids.
- Renamable (name mutable) but **not deletable** (id `"inbox"` special-cased). Tasks whose `list` value matches no registry entry are bucketed under the default at render time (no rewrite).

**`ListFrontmatter` (new, `jin-core/src/model/list.rs`):**
```
id: String           // "inbox" for default, else ULID
kind: String         // "list"
name: String
color: String        // Jin swatch token name, e.g. "accent" | "sky" | ...
icon: String         // registered Lucide name, e.g. "inbox" | "list"
position: String     // fractional rank among lists (sidebar order)
parent_id: Option<String>  // grouping/folder (nullable; v1 flat OK, field reserved)
view: String         // "list" | "board"  (persisted per-list view — §1.6)
sort_mode: String    // "manual" | "due" | "priority" | "title" | "created"
sections: Vec<SectionEntry>   // §1.4 — list OWNS its columns
archived_at: Option<DateTime<FixedOffset>>
created / updated: DateTime<FixedOffset>
```

**Index table (new, `schema.rs` SCHEMA_SQL):**
```sql
CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    icon       TEXT NOT NULL,
    position   TEXT NOT NULL,
    parent_id  TEXT,
    view       TEXT NOT NULL DEFAULT 'list',
    sort_mode  TEXT NOT NULL DEFAULT 'manual',
    archived_at TEXT,
    created    TEXT NOT NULL,
    updated    TEXT NOT NULL,
    file_path  TEXT NOT NULL
);
```
**Rebuild (`rebuild.rs`):** add `DELETE FROM lists; DELETE FROM sections;` to the clear batch (`rebuild.rs:22-30`); walk `list_list_paths(&lists_dir)`, `INSERT OR REPLACE` each list, and for each `SectionEntry` insert into `sections` (§1.4). Task-count is a query-time `COUNT` join, not stored.

**DTOs (`jin-core/src/dto/list.rs`, new):**
```
ListDto    { id, name, color, icon, position, parent_id: Option<String>, view, sort_mode,
             is_default: bool, task_count: u32, sections: Vec<SectionDto> }
SectionDto { id, list_id, name, position, task_count: u32 }
```

**Tauri commands (`jin-gui/src-tauri/src/commands/lists.rs`, new):**
| Command | Params | Returns |
|---|---|---|
| `list_lists` | — | `Vec<ListDto>` |
| `create_list` | `input: {name, color, icon, parent_id?}` | `ListDto` |
| `edit_list` | `id, input: {name?, color?, icon?, view?, sort_mode?, parent_id?}` | `ListDto` |
| `reorder_list` | `id, position: String` | `ListDto` |
| `delete_list` | `id` | `()` — refuses id `"inbox"`; reassigns its tasks to default list |

**JS invoke wrappers (`jin-gui/src/invoke.ts`, after the Tasks block ~`:114-163`):** `listLists()`, `createList(input)`, `editList(id, input)`, `reorderList(id, position)`, `deleteList(id)`.

### 1.3 Tags (P2 storage + P4 surface)

**On-disk (two-part, mirroring Notes):**
- **Membership (the join, source of truth):** `tags: Vec<String>` added to `TaskFrontmatter` — exact mirror of `NoteFrontmatter.tags` (`note.rs:37`). Values are tag slugs.
- **Tag metadata (color):** one file per tag — `<root>/tags/<slug>.md` (`type: tag` frontmatter: `slug`, `name`, `color`, `created`). `Config::tags_dir()`. Auto-created on first use by `ops::tags::ensure_tag(slug)` with a deterministic default color (stable hash of slug → Jin swatch palette) the user can later change.

**Index tables:**
```sql
CREATE TABLE IF NOT EXISTS tags (
    slug      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    color     TEXT NOT NULL,
    file_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_tags (   -- derived from task frontmatter
    task_id  TEXT NOT NULL,
    tag_slug TEXT NOT NULL,
    UNIQUE(task_id, tag_slug)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_slug);
```
Plus a JSON `tags TEXT NOT NULL DEFAULT '[]'` column on `tasks` (mirror `notes.tags`, `schema.rs:27`) for cheap per-row chip rendering. **Rebuild:** walk `tags/`, populate `tags`; for each task, write the JSON `tags` column AND fan out one `task_tags` row per slug.

**DTO:** `TagDto { slug, name, color, task_count }`. `TaskDto` gains `tags: Vec<String>`.

**Commands (`commands/tags.rs`, new):** `list_tags() -> Vec<TagDto>`; `set_tag_color(slug, color) -> TagDto`. Assignment/removal flows through the extended `edit_task` (§1.7). **Invoke:** `listTags()`, `setTagColor(slug, color)`.

### 1.4 Sections = per-list Kanban columns (P2 storage + P5 surface)

**On-disk (source of truth): embedded in the owning List file** as `sections: Vec<SectionEntry>`. Justification: a section belongs to exactly one list ("each list owns its columns"), is lightweight, and co-location means deleting a list removes its sections atomically and a rename/reorder rewrites exactly one file.
```
SectionEntry { id: String /* ULID */, name: String, position: String /* fractional rank */ }
```
**Task → section:** `section_id: Option<String>` added to `TaskFrontmatter` (nullable → "No Section"). References a `SectionEntry.id` within the task's list.

**Index:** `tasks.section_id TEXT` (guarded `ALTER`, §1.0) + a derived `sections` table:
```sql
CREATE TABLE IF NOT EXISTS sections (   -- derived from list.sections[]
    id       TEXT PRIMARY KEY,
    list_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    position TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_list ON sections(list_id);
```
**Rebuild:** populated while iterating list files (§1.2). A task whose `section_id` resolves to no live section is bucketed to "No Section" at render time.

**Commands (in `commands/lists.rs`):**
| Command | Params | Returns |
|---|---|---|
| `create_section` | `list_id, name` | `SectionDto` |
| `rename_section` | `list_id, section_id, name` | `SectionDto` |
| `reorder_section` | `list_id, section_id, position: String` | `SectionDto` |
| `delete_section` | `list_id, section_id` | `()` — clears `section_id` on affected tasks (rewrites them → "No Section") |

**Invoke:** `createSection`, `renameSection`, `reorderSection`, `deleteSection`. **Completion stays orthogonal:** a Done task keeps its `section_id`; `set_task_status` is unchanged.

### 1.5 Manual `position` / order (P2 storage + P9 surface)

**Scheme decision: fractional index (string rank key), NOT gapped integers.**
Justification (files-first dominates): each task is its own file, so the cost that matters is **file writes per drag**. A fractional rank lets a drop rewrite **exactly one** task file (the moved one) by computing a key strictly between its two drop-neighbors — never touching neighbors, never needing a periodic rebalance that would rewrite many task files. Gapped integers eventually exhaust the gap between adjacent items and force a rebalance that rewrites many files + index rows — the opposite of what a per-file store wants. The only cost of fractional is a midpoint key generator, which is a pure, exhaustively-testable function.

**On-disk:** `position: String` added to `TaskFrontmatter` (scoped to `(list_id, section_id)`). **Always assigned on create** = append (`between(last_rank, MAX)`), so Manual sort is always functional with no seeding.
**Key contract (pure, `jin-core/src/order.rs` + a JS twin `lib/tasks/rank.ts`):**
- Alphabet base-62 over ASCII-ordered `0-9A-Za-z`; lexicographic string compare == rank order.
- `between(a: Option<&str>, b: Option<&str>) -> String` returns a key strictly between `a` and `b` (`None` = open bound). Invariants tested: `a < between(a,b) < b`; `between(None, b) < b`; `a < between(a, None)`; idempotent determinism.
**Index:** `tasks.position TEXT` (guarded `ALTER`). **Sorting is a GUI concern** (`transform.ts`): Manual mode sorts by `position` asc; auto modes ignore it. The index `ORDER BY id ASC` stays.

**Manual-sort precedence (Apple rule):** auto modes ignore `position`. When a drag *starts* in a list whose `sort_mode != "manual"`, the controller (a) flips `sort_mode→manual` via `edit_list`, (b) re-seeds positions to the **currently displayed (sorted) order** via a one-shot batch command so the drag operates on what the user sees, then (c) applies the drop. Board view is always manual within columns.

**Commands:**
- `move_task` (the atomic drag/drop op, `commands/tasks.rs`): `id, list_id: Option<String>, section_id: Option<Option<String>>, position: String -> TaskDto`. Single file write: sets list (if changed), section_id (set/clear), position. Handles within-section reorder, cross-section move, and cross-list move identically.
- `reseed_positions`: `list_id, section_id: Option<String>, ordered_ids: Vec<String> -> ()`. Assigns evenly-spaced ranks to `ordered_ids` in one transaction (N writes; used only on auto→manual flip).
**Invoke:** `moveTask(id, {list_id?, section_id?, position})`, `reseedPositions(list_id, section_id, orderedIds)`.

### 1.6 Per-list View + Sort mode (P6) — no new storage

Persisted on the **List** entity: `view` (`"list"|"board"`) and `sort_mode` columns/frontmatter from §1.2. Toggled via `edit_list`. No task-level change.

### 1.7 Due date + time (P8) + `edit_task` body fix — minimal schema impact

**Due time needs NO new field:** the existing `DueDate` enum already has `Date(NaiveDate) | DateTime(DateTime<FixedOffset>)` (`task.rs:77-82`). "Date + optional time" = the calendar emits a date (→ `Date`), and the optional time field upgrades it to a local-offset RFC-3339 string (→ `DateTime`). `parse_due` already accepts both (`commands/tasks.rs:57-74`). Overdue is **derived** in `transform.ts` (`due < now`), not stored.

**`edit_task` extensions (`commands/tasks.rs` `EditTaskInput` + `ops::tasks::EditTaskParams` is already body-capable at `ops/tasks.rs:145-148`):**
- **Fix the `body: None` bug** (`commands/tasks.rs:156`): add `body: Option<String>` to `EditTaskInput` and pass it through (enables editing task notes — required for inline edit).
- Add `section_id: Option<String>` + `clear_section: bool`; `tags: Option<Vec<String>>`; `reminders: Option<Vec<ReminderInput>>`. Each is "None = no change" (the established `EditTaskParams` convention).

### 1.8 Multiple reminders (P10 — stored only, no firing)

**On-disk:** `reminders: Vec<Reminder>` added to `TaskFrontmatter` (inline collection, mirroring `links: Vec<LinkEntry>` `task.rs:110`). Reminders are wholly owned by their task — no separate dir.
```
Reminder { kind: "relative" | "absolute", value: String }
   relative → offset string "-1d" | "-1h" | "-30m" (resolved against due at fire-time, deferred)
   absolute → RFC-3339 timestamp
```
**Index:** a JSON `reminders TEXT NOT NULL DEFAULT '[]'` column on `tasks` (mirror `notes.tags` JSON; guarded `ALTER`). No separate `reminders` table in v1 (no scheduler queries yet — flagged as a fast-follow need in §7). **DTO:** `TaskDto.reminders: Vec<ReminderDto>` where `ReminderDto { kind, value }`. **No new command** — reminders edit through extended `edit_task`/`create_task`. **No firing/scheduler** (explicit non-goal).

### 1.9 `TaskDto` final shape (`dto/task.rs:8-20` extension)

Add to existing `TaskDto`: `section_id: Option<String>`, `tags: Vec<String>`, `position: String`, `reminders: Vec<ReminderDto>`, `body: String`. `body` is populated by reading the task file in the `get_task` path (single read; left `""` in `list_tasks` rows to keep lists light). `from_model`, `from_row`, `with_backlinks` updated accordingly; `list` continues to carry the list id (`"inbox"` for default).

### 1.10 `TaskFrontmatter` final additions (`task.rs:90-111`)

`section_id: Option<String>` · `tags: Vec<String>` (`#[serde(default)]`) · `position: String` (`#[serde(default)]` — empty string tolerated; rebuild/read assigns a rank if missing) · `reminders: Vec<Reminder>` (`#[serde(default)]`). All `#[serde(default)]` so pre-existing task files parse unchanged (no migration).

### 1.11 Icon registry additions (`jin-gui/src/lib/icons/index.ts` — all 3 places)

Register (import block ~`:19`, export block, `createIcons({icons:{…}})` registry): **`Flag`** (priority), **`Inbox`** (default list), **`List`** (list-view toggle), **`LayoutGrid`** or **`Columns3`** (board-view toggle), **`GripVertical`** (drag handle), **`Bell`**/**`BellPlus`** (reminders), **`ChevronDown`** (collapsible section header), **`Pencil`** (edit), **`Trash2`** (delete), **`Palette`** (color picker), **`Folder`** (list grouping, if not already registered). Reuse already-registered: `Tag`, `Clock`, `Plus`, `Circle`, `CheckCircle`, `CircleDot`, `XCircle`, `Calendar*`, `ArrowUp/Down`, `Minus`, `ChevronRight/Left`, `X`, `CheckSquare`.

---

## 2. Epics → GIVEN/WHEN/THEN stories

> Files cited are the real paths from the scout. AC = acceptance criteria. VG = validation gate (see §4).

### EPIC P0 — Priority vocabulary reconciliation
**S0.1** — GIVEN a task with core priority `medium`, WHEN the Tasks list renders, THEN a Medium label+glyph shows and the priority filter offers Medium.
**S0.2** — GIVEN the capture/edit form, WHEN the user picks "Medium", THEN `create_task`/`edit_task` receives `priority:"medium"` and core accepts it (no error code 2).
**S0.3** — GIVEN the sort, WHEN tasks of all four priorities render, THEN order is high→medium→low→none.
**AC:** no GUI surface emits `normal`; `medium` is selectable, filterable, sortable, labelled. **Files:** `lib/tasks/transform.ts:45,105-133`; `index.html:749-753,1950-1953`; `lib/capture/transform.ts:136`; tests `__tests__/tasks_controller.test.ts`. **VG-P0.**

### EPIC P1 — Interactive core wiring (zero schema)
**S1.1 Complete/check** — GIVEN a Todo/Doing task row, WHEN the user clicks its circle, THEN `set_task_status(id,"done")` runs, the row shows optimistic strike-through+fade, and on success status=`done` and `completed_at` is set; clicking again reopens (→`todo`, clears `completed_at`).
**S1.2 Inline edit** — GIVEN a task row/detail, WHEN the user clicks the title (and edits body in detail), THEN `edit_task(id,{title,body})` persists; Enter/blur saves, Esc cancels.
**S1.3 Delete** — GIVEN a task, WHEN the user confirms delete in a `.action-dialog`, THEN `delete_task(id)` soft-deletes (status=`deleted`, `deleted_at` set) and the row disappears.
**S1.4 Create-in-place** — GIVEN an always-visible "+ Add task" row, WHEN the user types a title and presses Enter, THEN `create_task` runs in the current list and the row stays open for rapid entry.
**S1.5 State transitions** — GIVEN a task, WHEN the user changes status via a quiet hover control, THEN only legal `can_transition_to` transitions are offered (`task.rs:39-51`).
**AC:** every mutation reuses an existing command/wrapper; all confirms use `.action-dialog`; `initIcons()` re-runs after dynamic DOM. **edit_task body bug fixed** here (§1.7) since it's the editor work. **Files:** `controllers/tasks_controller.ts` (import the dead wrappers `invoke.ts:134-163`), `lib/tasks/render.ts`, `lib/tasks/transform.ts`, `index.html:716-830` (+ new edit/delete dialogs near `:2125`), `commands/tasks.rs:137-162` (body fix), `src/lib/icons/index.ts`. **VG-P1** (mutation paths — the currently-untested surface).

### EPIC P2 — Data-model foundation (backend)
**S2.1** — GIVEN a task file with the new optional fields absent, WHEN read, THEN it parses unchanged (`#[serde(default)]`), proving no migration is needed.
**S2.2** — GIVEN a populated store, WHEN `SCHEMA_VERSION` is `wave3-tasks-v1` and the index is rebuilt, THEN `lists/sections/tags/task_tags` tables exist and `tasks` has `section_id/tags/position/reminders` columns, with values round-tripped from disk.
**S2.3** — GIVEN a pre-existing `index.sqlite` with the old `tasks` schema, WHEN `apply()` runs, THEN guarded `ALTER TABLE` adds each new `tasks` column (no crash; idempotent on second run).
**AC:** §1.0 rule honored; rebuild clears+repopulates all new tables; DTO carries all new fields. **Files:** `model/task.rs:90-111` (+ new `model/list.rs`, `Reminder`, `SectionEntry`), `index/schema.rs:9,33-45,126-136`, `index/rebuild.rs:22-90`, `index/query.rs:178-248`, `dto/task.rs` (+ `dto/list.rs`), `store/fs.rs`, `config.rs`. **VG-P2** (rebuild correctness for EVERY new field + ALTER-guard test mirroring `schema.rs:188-316`).

### EPIC P3 — First-class Lists
**S3.1 Seed default** — GIVEN a store with no `lists/`, WHEN lists are first requested, THEN `lists/inbox.md` (id `"inbox"`) is created, is renamable, and `delete_list("inbox")` is refused.
**S3.2 CRUD** — GIVEN the lists sidebar, WHEN the user creates/renames/recolors/reorders a list via `.action-dialog`, THEN the change persists to the list file and rebuild preserves it.
**S3.3 Filter populated** — GIVEN lists exist, WHEN the Tasks view loads, THEN the (today-empty) list filter is populated from `listLists()` and each list shows a task count.
**S3.4 Delete reassign** — GIVEN a non-default list with tasks, WHEN deleted, THEN its tasks are reassigned to the default and the list file is removed.
**AC:** existing `list:"inbox"` tasks resolve with no rewrite; list color flows into that list's check circles/header (Apple convention). **Files:** new `model/list.rs`, `ops/lists.rs`, `commands/lists.rs`, `dto/list.rs`; `invoke.ts`; new `controllers/lists_controller.ts` + `lib/lists/{transform,render}.ts`; `main.ts` (register); `index.html` (sidebar + dialogs); `styles/browse.css`; `icons/index.ts`. **VG-P3.**

### EPIC P4 — Tags
**S4.1 Auto-create** — GIVEN a task editor, WHEN the user adds `#email`, THEN `email` tag auto-creates with a default color, attaches to the task, and persists in task frontmatter `tags[]`.
**S4.2 Chips** — GIVEN a task with tags, WHEN the row renders, THEN small rounded color-tinted chips show (tag color as tint, not full saturation).
**S4.3 Filter** — GIVEN tags exist, WHEN the user filters by a tag, THEN only tasks carrying it show (via `task_tags` join).
**S4.4 Recolor** — GIVEN a tag, WHEN the user changes its color, THEN `set_tag_color` persists and all chips update on reload.
**AC:** many-to-many; membership in frontmatter, color in `tags/<slug>.md`. **Files:** `model/task.rs` (`tags`), new `model/tag.rs`/`ops/tags.rs`/`commands/tags.rs`/`dto/tag.rs`; `rebuild.rs` (tags + task_tags); `query.rs` (tag filter); `commands/tasks.rs` (`edit_task.tags`); `invoke.ts`; `lib/tasks/{render,transform}.ts`; `icons/index.ts`. **VG-P4.**

### EPIC P5 — Sections (per-list Kanban columns)
**S5.1 CRUD** — GIVEN a list, WHEN the user adds/renames/reorders/deletes a section, THEN `list.sections[]` updates and rebuild preserves order.
**S5.2 Assign** — GIVEN a task, WHEN the user sets its section, THEN `section_id` persists and rebuild preserves it.
**S5.3 No Section** — GIVEN a deleted section, WHEN its tasks reload, THEN they appear under "No Section" (section_id cleared).
**AC:** completion stays orthogonal (Done task keeps its section). **Files:** `model/list.rs` (`SectionEntry`), `model/task.rs` (`section_id`), `ops/lists.rs`/`ops/tasks.rs`, `commands/lists.rs` + `commands/tasks.rs` (`edit_task.section_id`), `rebuild.rs` (sections table), `dto/*`; `invoke.ts`; `lib/tasks/*`; `icons/index.ts`. **VG-P5** (assert `section_id` persisted AND survives rebuild).

### EPIC P6 — Views: List ↔ Board
**S6.1 Toggle** — GIVEN a list, WHEN the user toggles List↔Board (icon or Shift+V), THEN `view` persists on the list and reload restores it.
**S6.2 List view** — sections render as collapsible group headers; tasks grouped under their section; "No Section" group present.
**S6.3 Board view** — one column per section (ordered by `position`); tasks render as cards (circle, title, priority flag, due chip, tag chips); "No Section" column present.
**AC:** same data, lossless switch; Sort By menu in List (manual/due/priority/title/created); Board always manual within columns. **Files:** `lib/tasks/{transform,render}.ts` (grouping + board layout), `controllers/tasks_controller.ts`, `commands/lists.rs` (`edit_list.view`), `index.html`, `browse.css`, `icons/index.ts`. **VG-P6.**

### EPIC P7 — Reusable calendar component (see §3)
**S7.1** — GIVEN the widget, WHEN a day is activated, THEN it emits `date:selected` with `{iso, year, month, day}`.
**S7.2** — GIVEN keyboard focus, WHEN APG keys are pressed, THEN focus moves per §3 with roving tabindex and a live month/year region.
**AC:** built from scratch, three-file pattern, no date library, generic enough for the future Calendar feature. **Files (new):** `lib/calendar/transform.ts`, `lib/calendar/render.ts`, `controllers/calendar_controller.ts`, `main.ts` (register), `index.html` (`tmpl-calendar`), `styles/` (calendar css), `icons/index.ts`. **VG-P7.**

### EPIC P8 — Due date + time
**S8.1** — GIVEN the calendar in a `.action-dialog`, WHEN a date (+ optional time) is chosen, THEN `edit_task`/`create_task` receives `YYYY-MM-DD` (date) or local-offset RFC-3339 (datetime).
**S8.2 Overdue** — GIVEN a task past its due, WHEN the row renders, THEN the due chip uses the danger token and a quick-reschedule affordance (Today/Tomorrow/Next week/Pick date) shows.
**AC:** no schema change (reuses `DueDate`); overdue derived, not stored. **Files:** `lib/tasks/{transform,render}.ts` (overdue + reschedule), `controllers/tasks_controller.ts` (calendar wiring), `lib/capture/transform.ts`, `index.html:1961` (replace/augment native date input), `browse.css`, `icons/index.ts`. **VG-P8.**

### EPIC P9 — Drag-and-drop manual reorder
**S9.1 Within section** — GIVEN a manual-sorted list, WHEN the user drags a task between two rows, THEN `move_task` persists a `position` strictly between the neighbors and reload shows the new order — proven by asserting the persisted `position` changed and ordering flipped.
**S9.2 Cross-column** — GIVEN Board, WHEN a card is dropped into another column, THEN `section_id` AND `position` update in one write.
**S9.3 Auto→manual** — GIVEN a list in an auto sort, WHEN a drag starts, THEN `sort_mode` flips to manual, positions reseed to the displayed order, then the drop applies.
**AC:** drop indicator shown; exactly one file write per simple reorder; fractional `between` invariants hold. **Files:** `order.rs` + `lib/tasks/rank.ts` (key gen), `commands/tasks.rs` (`move_task`,`reseed_positions`), `invoke.ts`, `controllers/tasks_controller.ts` (DnD + dataTransfer `application/x-jin-task-id`, mirroring the folder-drag precedent), `lib/tasks/{transform,render}.ts`, `browse.css`, `icons/index.ts`. **VG-P9** (assert persisted order actually changed).

### EPIC P10 — Multiple reminders (stored)
**S10.1 Add** — GIVEN the editor, WHEN the user adds relative (`-1h`) and absolute (calendar+time) reminders, THEN `reminders[]` persists (1..N) and reload shows removable chips ("1 hour before" / "Jun 30, 9:00 AM").
**S10.2 Remove** — GIVEN reminder chips, WHEN one is removed, THEN `edit_task` persists the shortened list.
**AC:** stored only — NO firing/scheduler; default one auto-reminder at due time when a time is set. **Files:** `model/task.rs` (`reminders`/`Reminder`), `commands/tasks.rs` (`edit_task`/`create_task` reminders), `rebuild.rs` (JSON column), `dto/task.rs`, `invoke.ts`, `lib/tasks/{transform,render}.ts` (chip format + reminder editor), `controllers/tasks_controller.ts` (reuse calendar P7), `icons/index.ts` (`Bell`). **VG-P10.**

---

## 3. Calendar component spec (reusable Stimulus month-grid)

**Goal:** one standalone controller backing due-date entry, absolute-reminder entry, and the future Calendar feature. Built from scratch (no date library), three-file pattern.

**Files:** `lib/calendar/transform.ts` (pure), `lib/calendar/render.ts` (DOM), `controllers/calendar_controller.ts` (adapter), `tmpl-calendar` in `index.html`, registered in `main.ts`.

**Structure (WAI-ARIA APG Date Picker grid):**
- Dialog/popover → header (`‹ prev` · **Month YYYY** live region · `next ›`, optional year jump) → weekday row (Su Mo Tu We Th Fr Sa, full names in `abbr`) → `role="grid"` 6×7 of `role="gridcell"` day buttons → optional footer (Today · Clear).
- Month/year label is `aria-live="polite"`. Prev/next month + prev/next year buttons.

**Cell states (data attribute → CSS, accent = Jin token):** `default`; `today` (ring/dot marker); `selected` (filled accent); `focus` (border); `outside-month` (muted); `disabled` (min/max bounds, `aria-disabled`).

**Keyboard map (roving tabindex — exactly one gridcell `tabindex=0`):**
| Key | Action |
|---|---|
| ←/→ | ∓/± 1 day |
| ↑/↓ | ∓/± 1 week |
| Home / End | first / last day of week |
| PageUp / PageDown | ∓/± 1 month |
| Shift+PageUp / Shift+PageDown | ∓/± 1 year |
| Enter / Space | select & close |
| Esc | cancel (emit `calendar:cancel`) |

**Focus management:** on open, focus the selected day (or today if none); roving tabindex follows arrow nav; on close, return focus to the trigger and update its accessible name to the chosen date.

**Event contract:** `this.dispatch('selected', { detail: { iso: 'YYYY-MM-DD', year, month /*1-12*/, day } })` → `date:selected` (Stimulus prefixes with the controller identifier `calendar`). Cancel → `calendar:cancel`. **Config via `data-calendar-*` values:** `selected` (ISO), `min`, `max`, `mode` (`single` default; `range`/`multi` reserved for reuse — v1 implements `single` only).

**Transform contract (pure, testable):** `buildMonthGrid(year, month, {selected, today, min, max}) -> Cell[42]` where `Cell = { iso, day, inMonth, isToday, isSelected, isDisabled }`; nav helpers `addDays/addWeeks/addMonths/addYears`, `startOfWeek`, `clampToBounds`. Render clones `tmpl-calendar`, sets `textContent` day numbers + `data-state`, sets roving `tabindex`. No `innerHTML`.

---

## 4. Validation gates (per epic — behavior-meaningful, anti-shallow)

> Project memory: the coder ships green-but-shallow tests. Every gate below REQUIRES an assertion on **persisted/observable state change**, not merely that a function ran. Rust unit/integration for model/ops/rebuild; Vitest+jsdom for transform/render/wiring. Stimulus connects async → mount in `beforeEach`/await a macrotask.

**Global gates (apply to all phases):**
- **G-PROMPT:** no `window.prompt/alert/confirm`; every create/edit/confirm uses `.action-dialog` (`forms.css:278`). Test asserts the dialog opens, not a prompt.
- **G-ICONS:** every new `data-lucide` name is registered in all 3 places of `icons/index.ts`; a render test asserts the icon node is replaced (non-blank).
- **G-REBUILD:** for EVERY new field/table, a Rust test rebuilds from disk and asserts the value round-trips (write file → rebuild → query == original).
- **G-ALTER:** a `schema.rs` test (mirroring `:188-316`) proves a pre-existing old-schema `index.sqlite` gains each new `tasks` column via guarded `ALTER`, idempotently.
- **G-NODE:** GUI build/test/lint run under `nvm use v24.18.0` (system Node v16 crashes Vitest).

**Per-epic:**
- **VG-P0:** sort test asserts high>medium>low>none ordering on a 4-priority fixture; a test asserts no GUI option emits `normal` and `medium` round-trips through `create_task` without error code 2.
- **VG-P1:** complete test asserts status==`done` AND `completed_at` set (and reopen clears it); edit test asserts title AND body persisted (body fix — assert the new body comes back via `get_task`); delete test asserts status==`deleted` + `deleted_at`; create-in-place test asserts a new task file/row exists with the typed title.
- **VG-P2:** round-trip each new field; ALTER-guard test (G-ALTER); a task file missing all new fields parses (no migration).
- **VG-P3:** default-list seeded with id `"inbox"` and delete refused; create/rename/recolor/reorder persist AND survive rebuild; existing `list:"inbox"` task resolves to default with the file byte-unchanged.
- **VG-P4:** add-tag test asserts slug in task frontmatter AND a `tags/<slug>.md` exists AND `task_tags` join row present after rebuild; filter test asserts only tagged tasks return; recolor persists.
- **VG-P5:** section-move test asserts `section_id` persisted AND preserved across rebuild; section reorder asserts `position` order persisted; delete-section asserts affected tasks now resolve to "No Section".
- **VG-P6:** view toggle test asserts `view` persisted on the list and restored on reload; list-view groups by section; board-view yields one column per section incl. "No Section".
- **VG-P7:** APG keyboard map test (each key moves focus to the expected ISO date); `date:selected` fires with correct `{iso}`; roving tabindex test asserts exactly one `tabindex=0` gridcell; `buildMonthGrid` unit tests (leap year, month length, outside-month cells, today/selected/disabled flags).
- **VG-P8:** overdue test asserts the danger class on a past-due chip and none on a future one; datetime compose test asserts a date+time yields a valid RFC-3339 the core accepts.
- **VG-P9:** reorder test asserts the persisted `position` value **changed** AND the resulting sorted order flipped (not just that `move_task` was called); cross-column test asserts `section_id` AND `position` both changed in one write; `between` invariants (`a<between(a,b)<b`, open bounds) exhaustively unit-tested in both `order.rs` and `rank.ts`; auto→manual test asserts `sort_mode` flipped and positions seeded to displayed order.
- **VG-P10:** add-reminder test asserts `reminders[]` (relative + absolute) persisted AND survives rebuild via the JSON column; remove test asserts the shortened list persisted; NO scheduler/firing code added (negative check).

---

## 5. Look-and-feel notes

**Adopt the convergent interaction grammar (reads as standard to-do UX); originate Jin's own identity.**
- **Reuse Jin's CSS structure:** task rows/cards extend `.task-*` (`browse.css`; `.task-row*`, `.task-detail*`, `.tasks-filter-bar` @ 1563); all modals extend `.action-dialog > .action-dialog__inner > {__header/__title, __form/__body, __actions}` (`forms.css:278-302`). The tabbed Capture modal (`index.html:1726+`) is the multi-form precedent for the task editor.
- **Checkbox:** circular; on click fills with the **list's accent color** (Apple convention — list color flows into its check circles + section headers); strike-through + fade on complete with an Undo.
- **Priority:** a small `Flag` glyph mapped warm→cool via **Jin tokens** — high=`--color-danger`, medium=warning/accent, low=muted, none=no flag. **Do NOT use Todoist red `#DE483A`.**
- **Tags:** small rounded chips, tag color as a **tint** (not full saturation), via Jin's swatch palette.
- **Lists:** left sidebar of color+icon lists with task counts, user-draggable order; default list (Inbox) always present.
- **Views:** per-list List/Board toggle; List = collapsible section group headers; Board = section columns of cards (circle, title, priority flag, due chip, tag chips). Calm, grouped, generous whitespace, subtle 1px dividers — Apple's *calm grouped feel* via Lucide + Jin typography (**not** SF Symbols / SF Pro / blur materials).
- **Density:** hover-revealed quiet action cluster (schedule, priority, tag, delete, `GripVertical` drag handle) — hidden until row hover. Drop indicator = thin accent line (List) / placeholder gap (Board).
- **Icons:** Lucide only, registered (§1.11). **Accent + typeface:** Jin's existing tokens — originate, do not borrow brand signatures.

---

## 6. Out-of-scope (restated so nothing is silently assumed)

OS notification firing / background scheduler · NL date parsing · recurrence (RRULE) · location reminders · subtasks · Google Tasks sync · saved/smart views (Today/Upcoming) beyond the basic filter bar. (All deferred per the brief.)

---

## 7. Open questions / [GAP] / [DISPUTED]

1. **[DISPUTED] Priority glyph** — recommend a single `Flag` glyph tinted by Jin tokens (Todoist grammar, Jin color). Alternative: reuse already-registered `ArrowUp`/`Minus`/`ArrowDown` for high/medium/low + no glyph for none (zero new icon). **Owner pick needed** (cosmetic; default = Flag).
2. **[GAP] Tag color persistence shape** — recommend per-tag files `tags/<slug>.md` (symmetric with lists, user-recolorable). Cheaper alternative: derive color deterministically from the slug (hash→palette), no `tags/` dir, no `set_tag_color`. Recommendation = registry; confirm we want user-chosen tag colors in v1.
3. **[GAP] `delete_list` task disposition** — recommend non-destructive reassignment to the default list (mirrors the folder-delete precedent), NOT Todoist/Apple's delete-tasks-too. Confirm this is the desired safety default.
4. **[GAP] `delete_section` cost** — recommend actively clearing `section_id` on affected tasks (truthful on-disk state) over lazy render-time bucketing (zero writes). Active clear rewrites N task files on a rare op. Confirm acceptable, or accept lazy bucketing.
5. **[GAP] Reminders index shape** — v1 uses a JSON column (no scheduler). The deferred firing fast-follow will likely want a real `reminders(id, task_id, kind, value, fire_at)` table for due-time queries. Flagged so the fast-follow isn't surprised.
6. **[GAP] List grouping (`parent_id`)** — field is reserved in the model but v1 ships a **flat** sidebar (no folder nesting UI). Confirm flat-in-v1 is acceptable (nesting = near-free follow-up).
7. **[GAP] `body` in `list_tasks`** — recommend leaving row `body` empty (lists stay light) and populating it only in `get_task` by reading the file. Confirm no list surface needs body inline.
8. **[GAP] `query::list_tasks` SQL** — still string-interpolated (quote-escaped, `query.rs:190-196`); fine for trusted local input, but tag/section filters add more user-rich values. Recommend parameterizing opportunistically during P4/P5 (not a blocker).
9. **[GAP] Subtasks** — brief said "fold in only if near-free." It is **not** near-free (needs a parent edge + nesting UI + completion roll-up). Recommend keeping OUT of v1 (confirmed).
