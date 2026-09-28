---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-24T12:00:00Z
target_repos: [jin]
stories_count: 6
validation_gates_count: 16
---
# Tasks: modern reminders and separate board workflows

## Scope

CHANGE, RAMZA → Vivi, standard execution tier. Astra6High plans; Sol6High sole product writer. User authorizes all implementation and the in-product conversion flow. Preserve the dirty branch, accepted Notes/Calendar/sidebar, task identity, relationships, due/reminder semantics, subtasks, provider/event links and canonical Markdown data.

Deliver: coherent Reminders-inspired checklist workspace and task editing; separate persisted Boards with custom typed columns; safe legacy compatibility/conversion; all callers and projections enforcing the same rules. No enterprise workflow extras, WIP limits, swimlanes, automation, dependencies, new collaboration model or second persistent navigation sidebar.

## Approach

The present system has no Board entity/type. `ListFrontmatter.view` is an old per-list display string, while GUI now uses global `jin_tasks_view` localStorage. `SectionEntry` only contains id/name/position. Task `section_id` and lifecycle `todo|doing|done|cancelled|deleted` are independent. GUI board columns are fixed status groups, and inspector exposes Status plus unrelated Section; late CSS makes the inspector replace the workspace. Therefore neither old view preference nor column-looking section names can become authoritative workflow classification.

Keep the existing List storage container and IDs (`lists/<id>.md`, frontmatter `type:list`) for compatibility, but add an explicit persisted workflow discriminator and board columns. Board is a first-class container behavior, never a presentation toggle on arbitrary lists. Keep old sections as organizational metadata. Reuse the existing recoverable canonical operation journal for multi-file changes and derived-index replay.

## Domain decisions

| Contract | Decision |
|---|---|
| Container | Add optional `workflow_kind: checklist|board`; missing means legacy/unclassified, not an inferred checklist. New GUI/API containers explicitly persist a kind; new API/CLI callers omitting it create checklist. Existing file deserialization keeps absence. |
| Columns | Separate `columns: [{id,name,position,type}]`; `type` is closed `queue|in_progress|done`. Names are arbitrary nonempty user labels, never parsed for semantics. Multiple columns may share a type. Board always retains at least one column of each type. Default names Queue, In Progress, Done. |
| Task placement | Add optional `board_column_id`. Keep `section_id` as organizational grouping, independent of status. New/converted board tasks resolve one valid matching column; checklist tasks have no board placement. |
| Canonical status | Queue ↔ existing `todo`; In Progress ↔ `doing`; Done ↔ `done`. Do not rename stored status strings or break Today/reminder/sync contracts. Checklist actionable states are `todo` and `done`. |
| Cancelled/deleted | Never silently map cancelled to done or unchecked. Existing cancelled tasks remain reachable in a separate Cancelled disclosure/closed-items surface with explicit Restore to open/queue and Delete; deleted remains a tombstone. Typed checklists offer no new Cancel status operation. |
| Board move | Column ID is authoritative intent; derive status from its type in core. Same-type column moves preserve status/completed_at. Into Done follows completion cascade; out of Done explicitly reopens and clears completed_at. Support Done→In Progress as one legitimate core transition, not two frontend requests. Cancelled restores explicitly to Queue before ordinary movement. |
| Organizational sections | Checklists retain optional sections and manual ordering. Boards show their columns, not the section selector pretending to be workflow. Legacy section membership remains readable as secondary “Group” metadata; do not delete or repurpose section IDs. |
| Aggregate scopes | Inbox/Today/Upcoming/Flexible/Completed remain aggregate list surfaces with real origin labels and task behavior from owning workflow. There is no global Board toggle, including on smart views. Distinguish the stable Inbox container from the existing aggregate Inbox smart scope. |

## Stories

### S1 — Canonical workflow contract and projections
As a user, I want Lists and Boards to mean the same thing wherever tasks are created or changed. Timebox: 3d. Risk: P0.
- Implement optional workflow kind, board columns and task board placement in canonical models, full-file serialization, DTO from-model/from-row paths and TypeScript DTOs. Add derived SQLite migration/defaults and rebuild/query projections. Preserve old `view`, sections, task bodies, links and IDs; retire GUI writes to display view without deleting legacy stored data.
- Add create/update/read validation for typed containers. Board default columns are created with the container; checklist cannot acquire board columns by a legacy view toggle. Old `edit_list.view` remains compatibility metadata and cannot convert kind. Inbox stable ID is protected from deletion and conversion to Board; an old Inbox remains usable until checklist setup preserves its data.
- Introduce root/config-aware workflow mutation helpers; all public callers (Tauri task/list commands, CLI, Capture, quick-add, subtasks, bulk, reminder completion and relevant core operations) must reach the same validation/placement rules. Do not derive vault root from tasks_dir.parent because configured task directories can differ.
- Checklist create/reopen resolves Todo and completion resolves Done. Reject typed checklist Doing/new Cancelled at the authoritative write boundary with useful error text. Do not reject existing cancelled records on read or unrelated metadata edits.
- Board create defaults to its first Queue column unless a valid target column was explicitly chosen. Existing generic status callers resolve the first matching column deterministically, preserving current column when its type already matches. Missing/stale/foreign column IDs cannot be silently accepted. Invalid imported placement gets a visible repair bucket/status message, never disappears from the board; repair is explicit or performed as part of a deliberate validated mutation.

### S2 — Safe conversion, moves and column lifecycle
As a user, I want to set up existing work without losing its statuses or organization. Timebox: 3d. Risk: P0.
- Existing unclassified containers remain fully usable in a clearly labeled compatibility surface with a small Set up workflow action. Preserve existing status controls there. Global localStorage preference and section names never rewrite data; show legacy containers under an “Existing work” sidebar group rather than falsely claiming binary semantics.
- One compact setup dialog chooses List or Board, explains their behavior and shows counts before Apply. Board maps current Todo/Doing/Done into default typed columns, preserving statuses/timestamps; old sections remain Group metadata. List explicitly reports the number of Doing tasks that will become unchecked/Todo. Existing Cancelled stays Cancelled separately in both choices. Include subtasks in the preview, no double counting of writes. No startup migration wizard or gate on unrelated work.
- Conversion uses a fresh canonical snapshot and expected-content hashes/version precondition; stale preview must refresh instead of overwriting external edits. Stage complete before/post images under existing recoverable_operations, apply idempotently, replay derived index refresh and expose blocked recovery truthfully. Do not claim a file loop is a transaction. Preserve body, dates, tags, reminders, event links, positions and grouping except the documented workflow normalization.
- Add column create/rename/reorder/delete. New column name plus semantic type are editable independently. Rename never changes status. Occupied column type change is disallowed until tasks move; explain why. Deleting occupied column requires an explicit replacement of the same type; deleting the last of any required type is blocked. Empty type changes still preserve one-of-each invariant. No task can be stranded by a successful operation.
- One core operation moves task container/column/status/position together. A move from Doing Board into checklist explicitly previews reset to unchecked; destination Board chooses a compatible column, with concrete selection when needed. Do not silently choose a name-matched column. Do not split into frontend edit_task then set_status calls.
- Preserve parent/subtask rules: children remain in parent's container; independent child container moves remain disallowed. Parent container move includes children, resolving each child's own status to destination columns without falsely completing children. Parent Done/Cancelled cascade remains authoritative; board placement for affected children updates consistently. Reopening parent does not reopen completed children. A same-container parent column move changes parent workflow only except existing completion cascade.
- Use recoverable multi-file mutation for conversions, occupied-column replacement and parent/container/status cascades that now span workflow invariants. Reuse/extend journal index-only effects rather than event-specific enqueue; no provider sync side effect unless existing event relationship behavior requires it.

### S3 — Separate Lists/Boards navigation and creation
As a user, I want to choose a checklist or board directly, not toggle every task into an unrelated view. Timebox: 1d. Risk: P1.
- Sidebar retains one248px unified slot: smart views, Lists, Boards, then Existing work when present. Reuse container row/menu/color identity; selected style remains restrained and keyboard focus distinct. Long names/counts reflow safely; all scopes remain discoverable with sidebar collapsed.
- Replace global List/Board segmented toggle and Shift+V reinterpretation with workflow identity. Selected checklist always renders checklist; selected board always renders its own board. Ignore old global view preference for typed/aggregate scopes; retain compatibility only where deliberately needed in legacy surface.
- New container dialog offers List/Board with concise explanation, name/color and valid defaults. Existing name/color edit stays nearby; workflow conversion is a named separate action with impact preview, not a hidden appearance setting. Toolbar New task and container menu/New List or Board are reachable without opening the left rail. Do not force users to move tasks through sidebar workarounds.

### S4 — Modern checklist and purposeful board composition
As a user, I want to read and act on tasks with the visual clarity of Reminders and Jin's modern chrome. Timebox: 2d. Risk: P1.
- Use a compact top toolbar in the Notes/Calendar chrome family, scope icon/name/count, New task and an overflow containing list/board management. Search/filter/sort are secondary compact controls; hide workflow-inappropriate status options. Lists offer Open/Completed visibility instead of Todo/Doing/Cancelled dropdown. Aggregates may retain meaningful workflow filters with truthful labels.
- Checklist is a continuous wide field: approximately18–20px visible completion circle inside a generous accessible hit area,15–16px system title, one subordinate readable line for actual due/reminder/priority/tag/subtask metadata. Align title and metadata consistently; eliminate scattered badge/button stacks and duplicated status text. Keep due-date semantics and non-color overdue/priority cues. Minimum row height around44–52px, grows with content/AX; no giant visible checkbox or tiny text.
- Checkbox activates completion only; title/row opens detail, so checking never navigates. Space works when completion control focused, Enter opens selected task. Keep subtasks, bulk selection and drag handles but reveal progressive controls without making them inaccessible on keyboard/touch. Per-section quick-add remains; one clear overall add path. Completed and Cancelled sections are distinct and accessible.
- Board uses canonical columns in persisted order with editable names, small semantic type descriptor/count and per-column Add task/menu. Custom columns are real persisted data. Column DnD has keyboard Move to column equivalent; internal horizontal board scrolling stays contained and focusable. Same-type moves reorder without artificial lifecycle changes. Show cancelled and invalid-placement items explicitly outside normal workflow lanes.
- Board cards use compact title and quiet metadata, not oversized list completion circles plus a second status dropdown. One active detail experience is shared with checklists. Preserve meaningful subtask progress, task links and actions.

### S5 — Task inspector without losing the workspace
As a user, I want to edit tasks while retaining my place and navigation. Timebox: 2d. Risk: P1.
- Retire the late CSS overlay that replaces browse content. At sufficient content width, use one bounded right inspector of roughly320–360px while leaving at least a usable420px work area. At narrower/AX widths use the shared modal/sheet; it does not require collapsing global sidebar. Do not add another left rail or duplicate field sets.
- Keep toolbar and current checklist/board visible on desktop. Click another task switches the one inspector after pending edits settle; closing restores selected row/card focus and relevant scroll. Inspector gets its own readable heading/close and sections: title/body, scheduling, organization, subtasks/connections. Use existing field components and temporal editor.
- Checklist inspector has Completed toggle plus List/Section, no Doing workflow selector. Board inspector has Board/Column (showing its semantic type), no competing Status+Section controls. Legacy inspector retains status and organizational sections under clear labels until setup. Preserve priority, due, reminders, tags, subtasks and related events.
- Centralize pending edit ownership: flush on task/scope changes, close, layout migration and cross-route navigation; reject/hold navigation if save fails. Do not remount a new task over unsaved old inputs, or let late field responses repaint another task. Disable duplicates, refresh from canonical result, surface errors, and retain draft/focus on failure. Responsive inspector migration preserves current draft and selected task.
- Native macOS Tasks browse/inspector uses top safe toolbar row like Notes; exact active-route gating, real traffic-light exclusion and hidden-sidebar reveal retained. Browser/nonmac has no extra52px spacer. Preserve other routes' native clearance.

### S6 — Integrated validation and accepted visual rules
As an owner, I want the overhaul proven against real persisted workflow behavior. Timebox: 1d. Risk: P1.
- Update deterministic bridge fixtures with exact new DTOs/commands and persisted-in-fixture behavior; no permissive catch-all mocks. Root exercises create List/Board, custom typed columns, same/different-type movement, conversion, completion and inspector changes on representative legacy data.
- Run focused core/index/bridge/controller tests, schema/serialization tests, type/style checks and native build. Use CARGO_INCREMENTAL=0 given disk constraints. Broaden tests only for touched contracts; preserve existing unrelated dirty work.
- Root compares1280/1440,760/390/320, AX3.1, long names, empty/error/loading, light/dark and native shown/hidden sidebar. Browser evidence is not native owner sign-off. Update dossier only for implemented accepted rules.

## Ownership and implementation order

Single writer Sol. Phase1 domain and tests: `jin-core/src/model/{list,task}.rs`, dto equivalents, `index/{schema,rebuild,query}.rs`, `ops/{lists,tasks,api,recoverable_operations}.rs` plus focused new workflow helper, relevant capture/CLI callers. Phase2 bridge: `jin-gui/src-tauri/src/commands/{lists,tasks}.rs`, command registration, `src/{invoke,types/dto}.ts`. Phase3 GUI: `controllers/{tasks,lists}_controller.ts`, `lib/tasks/{render,item,completion,transform,scopes,bulk}.ts`, `lib/lists/{render,counts,transform}.ts`, `index.html`, `browse.css`, native-only `sidebar.css`, scoped `a11y.css`; shared inspector/modal reuse. Phase4 fixtures/tests/QA/dossier. Keep public existing APIs compatible where semantics permit; explicit new optional fields must be populated consistently from model and row.

Do not build final GUI against an invented DTO while postponing persistence. Hand root a coherent domain+fixture checkpoint before final visual matrix. Every phase is part of this implementation; do not stop after a CSS pass or defer typed boards.

## Rejected Alternatives

Repurpose `view` as type: ambiguous historical presentation preference. Infer type from status/section names: silently reclassifies user intent. Reuse section_id as column: merges organizational groups with lifecycle and loses mixed-status sections. Rewrite all legacy Doing/Cancelled at load: destructive and unauditable. UI-only binary checkboxes: CLI/Capture/status operations still produce invalid lists. More persistent sidebars: repeats the width/navigation problem.

## Risks

P0: multi-file partial updates, stale conversion previews, missed mutation caller, from-row/from-model projection drift, parent cascade placement inconsistency. P1: late inspector saves, aggregate operations across workflows, loss of legacy grouping/order. Mitigation is shared core enforcement, recoverable before/post images and contract tests; no silent fallback that drops tasks. Keep container deletion's existing move-to-Inbox semantics but apply the same destination workflow normalization and preview for affected Doing tasks.

## Acceptance Criteria

### AC-01 (event-driven)
WHEN a new List is created and mutated through any supported entry point
THEN its actionable task states shall be only unchecked/Todo and checked/Done.
VERIFY: core plus bridge/CLI/Capture tests, including rejected Doing and preserved legacy Cancelled metadata edits.
### AC-02 (event-driven)
WHEN a Board column is renamed
THEN all contained tasks shall retain their canonical statuses.
VERIFY: core persistence/rebuild test.
### AC-03 (event-driven)
WHEN a task moves to a typed Board column
THEN its column ID and mapped canonical status shall converge in one operation.
VERIFY: same-type/different-type/completion/reopen tests and retry replay.
### AC-04 (unwanted-behavior)
WHEN a column deletion would strand tasks or remove the last required type
THEN core shall reject it without partial canonical changes.
VERIFY: failure-injection and invalid-target tests.
### AC-05 (state-driven)
GIVEN unclassified legacy files
THEN opening Tasks shall leave their bytes and lifecycle semantics unchanged.
VERIFY: byte snapshots for mixed statuses/sections and old global board preference.
### AC-06 (event-driven)
WHEN legacy conversion is applied after its preview
THEN every preexisting task shall remain accounted for under the documented mapping.
VERIFY: mixed Todo/Doing/Done/Cancelled, subtasks, bodies, links, positions and sections fixture.
### AC-07 (unwanted-behavior)
WHEN canonical files change after conversion preview
THEN conversion shall refuse stale overwrite.
VERIFY: compare-hash conflict test.
### AC-08 (unwanted-behavior)
WHEN conversion or a workflow cascade is interrupted
THEN recovery shall converge without exposing inconsistent workflow projections.
VERIFY: journal failpoints before/after replacement and index replay.
### AC-09 (event-driven)
WHEN workflow fields are rebuilt into the index
THEN list/get task and container DTOs shall agree on workflow placement.
VERIFY: from-model/from-row round-trip tests.
### AC-10 (event-driven)
WHEN parent tasks move container or complete
THEN subtask placement and completion shall follow the specified core cascade rules.
VERIFY: parent/child mixed-state move/completion/reopen tests.
### AC-11 (state-driven)
GIVEN a typed checklist, board or aggregate scope
THEN its surface shall be determined by semantic scope rather than global display preference.
VERIFY: controller persistence/navigation tests.
### AC-12 (event-driven)
WHEN a task completion circle activates
THEN it shall change completion without opening the inspector.
VERIFY: pointer/keyboard event test plus root rendered hit-target check.
### AC-13 (event-driven)
WHEN another task or scope is selected during a failed pending edit
THEN the existing draft shall remain available for recovery.
VERIFY: deferred/rejected save and stale-response controller tests.
### AC-14 (state-driven)
GIVEN desktop task editing with sufficient workspace width
THEN the task workspace and its toolbar shall remain visible beside the inspector.
VERIFY: root list/board screenshots and return-focus/scroll smoke.
### AC-15 (state-driven)
GIVEN narrow/AX task editing or sidebar-hidden native Tasks
THEN all task and navigation controls shall remain reachable without overlap or document overflow.
VERIFY: root320/390/760/AX3.1 and native safearea matrix.
### AC-16 (state-driven)
GIVEN typed workflows used from Today, notifications, reminders and Capture
THEN existing task/event identity and lifecycle effects shall remain correct.
VERIFY: targeted integration regressions and native build.

## Confidence

Domain ambiguity is resolved explicitly through persisted kind and non-destructive legacy compatibility. Existing journal and storage/index boundaries are reusable; this is substantive cross-layer work, not a cosmetic patch. Highest uncertainty is enumeration of old task mutation callers; phase1 requires a call-site audit and no GUI-only enforcement. Root independently reviews these decisions and final evidence.

```yaml
handoff:
  from: ramza
  to: vivi
  implementer: Sol6High
  approval: authorized
  legacy_default: unclassified
  workflow_kinds: [checklist, board]
  board_types: {queue: todo, in_progress: doing, done: done}
  phase_order: [domain, bridge, gui, integration_qa]
  preserve_dirty_work: true
  compiler_environment: {CARGO_INCREMENTAL: '0'}
```
