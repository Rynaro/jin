---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-25T00:00:00Z
stories_count: 3
validation_gates_count: 8
---
# Tasks amendment: flexible board stages and compact working UI

## Scope

CHANGE; RAMZA → Vivi, Astra6High planning and Sol6High sole implementation writer. This supersedes the three-required-types rule in `tasks-reminders-workflows.md`; its preservation, locking, migration, inspector draft and accessibility requirements remain in force. Root approved the decisions below. Preserve all unrelated dirty work. No new dependencies or enterprise workflow features.

## Approach

Current `BoardColumnType` and `workflows::{validate_board,column_for_status,status_for_type}` assume one required Queue/InProgress/Done each. Add explicit neutral stages and a persisted creation destination, keeping canonical task statuses unchanged. Neutral is an **open stage without a status change**, not an additional task status. The example Inbox(Queue), Backlog(None), Doing(InProgress), Review(None), Released(Done) must work exactly; new boards retain the current three default columns until the user customizes them.

### Stable domain contract

- Add `BoardColumnType::None`, serialized `"none"`, and `ListFrontmatter.initial_column_id: Option<String>` with absent-field compatibility. Carry both through index/rebuild/query, model/row DTOs, TS and exact fixtures.
- A valid board requires a resolved initial column of type Queue or None, plus at least one Done column. InProgress is optional; Queue is optional when initial is None. No requirement that the initial column is visually first.
- Existing boards without initial ID resolve first Queue, otherwise first None, ordered by `(position,id)`. Reads never persist fallback or reclassify data. Next deliberate board mutation may materialize it. An explicit invalid ID is a repair error, never silently replaced. Existing boards lacking any eligible initial retain visible data and offer repair; do not drop tasks or rewrite files on read.
- Queue sets Todo; InProgress sets Doing; Done sets Done/completion timestamp using existing cascade. None preserves incoming Todo/Doing. Done→None explicitly reopens to Todo and clears completion timestamp. Cancelled still requires explicit Restore; Deleted remains a tombstone. Leaving None follows the actual destination's rules. Same-state moves preserve completion timestamps and exact destination IDs.
- Generic create/Capture/subtask defaults create Todo in initial. Explicit per-column create in None creates Todo; other types use their existing status mapping. Completion from any open stage routes to the first Done by `(position,id)`. Explicit Reopen from Done or Restore from Cancelled routes Todo to initial. Generic status writes preserve current exact column if compatible; a neutral column is compatible with either Todo or Doing. If generic Doing needs a destination, use first InProgress, then first None; otherwise reject with an actionable explanation, never invent a column.
- Cross-container placement preserves each task's own status: Todo uses destination initial; Doing uses InProgress then None; Done uses Done; Cancelled remains outside lanes. A Doing task entering a board containing only Queue+Done needs an explicit unchecked-reset choice or rejection, equivalent to existing List normalization. Concrete target IDs still take precedence after explicit intent validation. Parent/child status cascade remains triggered by lifecycle change, not container movement alone.
- Persist setting the initial column under the workflow journal lock. Reorder does not change initial. Deleting initial requires a concrete replacement initial Queue/None in the same operation, even when empty. Last Done cannot be deleted or retyped. Empty InProgress can be removed without replacement. Occupied deletion requires an explicit compatible destination: Todo→Queue/None, Doing→InProgress/None, Done→Done; mixed Todo/Doing in a neutral stage requires None. Incompatible destinations require moving tasks first, never implicit status normalization. Retyping occupied columns remains blocked; empty retyping preserves initial eligibility and at least one Done.
- Setup conversion keeps existing statuses, timestamps and section metadata; new default Board includes a valid initial. Existing stored neutral data and valid IDs are never collapsed into the first matching stage during metadata writes, reorder, rebuild or generic same-status mutation.

## Stories

### S1 — Canonical flexible stages
As a user, I can model open stages without forcing every stage to mean In Progress. Timebox: 2d. Risk: P0.
Owners: `jin-core/src/model/list.rs`, `dto/list.rs`, `index/{schema,rebuild,query}.rs`, `ops/{workflows,lists}.rs`; Tauri `commands/lists.rs`, registration, GUI `invoke.ts` and `types/dto.ts`. Reuse existing journal, same caller routes and status mapping helper; update all exact-type matches, initial resolution and placement compatibility together. No additional mutable status source.

### S2 — Configuration and truthful board behavior
As a user, I choose where new work arrives and rearrange named stages safely. Timebox: 1d. Risk: P1.
Owners: `controllers/tasks_controller.ts`, `lib/tasks/{render,bulk,workflow}.ts` or actual closest existing helpers, lists management and exact fixtures/tests. Add None with explanatory label “No status change” and a separate Initial/New tasks designation. Show initial marker and valid replacement choices in column management. Type and name remain independent. Board repair checks must accept Todo/Doing in None; aggregate/bulk actions use the same availability rules. Keep exact neutral lane identity for drag and keyboard Move. Changes must be reachable through current menus, not a new settings system.

### S3 — Compact coherent Tasks composition
As a user, I read and edit work with the calm density of Reminders and the accepted Jin chrome. Timebox: 1d. Risk: P1.
Owners: task `item.ts`, `render.ts`, `tasks_controller.ts`, `lists_controller.ts`, Tasks DOM and closest task rules in `browse.css`; reuse shared popover/modal primitives. Apply the visual skill/dossier, retaining native toolbar safe area and draft protections.
- Continuous compact checklist rows: visible completion circle around18–20px, title and metadata aligned at one text origin. Plain rows target32–40px on fine pointers; add height only for real metadata, wrapping or AX. Coarse-pointer targets remain at least44px. No fixed height clipping, generic round cards or global checkbox overrides affecting Notes.
- Header is contextual scope identity/count, Add task and scope management. Remove the global New List button from task content; create containers from the unified sidebar/contextual creation menu, reachable through the existing navigation reveal when collapsed. Legacy Set up workflow is a modest tertiary action near scope management, not a competing large banner/button.
- Column/menu popovers render in the shared overlay host, clamp to viewport/safe area and close/return focus correctly; overflow scrollers cannot clip them. No hand-built positioned element trapped inside a board column.
- Inspector groups title/notes, scheduling and organization compactly with existing fields; reduce empty gaps and oversized metadata rows. Preserve all real fields, saved-draft ownership, failure handling, date popover nesting and responsive dialog semantics. No new second inspector or persistent sidebar.
- Whole card body, including the title currently rendered as a button, initiates drag after a movement threshold. A title click without drag still opens detail. Exclude completion, menu, external links, inputs and active text editing from drag initiation; do not exclude all buttons indiscriminately. A card-sized drag preview tracks pointer with subtle elevation and restrained translation/tilt, valid insertion target and contained edge scrolling. Escape/pointer cancel leaves canonical placement unchanged; successful drop uses one exact-column mutation. Keyboard Move remains equivalent. Respect reduced motion: no tilt/spring animation, keep clear stationary target feedback.

## Acceptance Criteria

### AC-01 (state-driven)
GIVEN a board with Queue, None, InProgress, None and Done columns
THEN every task shall retain its exact valid lane through rebuild and metadata edits.
VERIFY: canonical/row DTO round trip; Backlog and Review keep distinct IDs.
### AC-02 (event-driven)
WHEN Todo, Doing or Done work enters a None column
THEN its status shall follow the documented neutral transition rules.
VERIFY: Todo stays Todo, Doing stays Doing, Done becomes Todo with cleared completed_at; child cascade does not spuriously run.
### AC-03 (event-driven)
WHEN work is created, completed or reopened without a concrete column
THEN placement shall follow the initial/completion routing contract.
VERIFY: Capture/subtask create, None completion→Released, Done reopen→initial; optional-InProgress absence.
### AC-04 (unwanted-behavior)
WHEN a column mutation would remove the resolved initial or last Done without a valid replacement
THEN it shall reject without partial canonical changes.
VERIFY: initial rename/reorder, deletion/retype, occupied compatible/incompatible replacement and journal recovery.
### AC-05 (state-driven)
GIVEN an older board without initial_column_id
THEN reading shall resolve its deterministic initial without modifying canonical bytes.
VERIFY: first Queue/None fallback, explicit invalid ID repair and preserved task accounting.
### AC-06 (event-driven)
WHEN a user drags a noninteractive card body or uses keyboard Move
THEN its committed exact-column placement shall agree.
VERIFY: threshold click, cancel, same-type and neutral moves, error rollback, reduced-motion feedback.
### AC-07 (state-driven)
GIVEN Tasks at desktop, narrow or large-text widths
THEN rows, contextual controls and open popovers shall remain aligned and reachable.
VERIFY: root1280/1440/760/390/320, AX3.1, light/dark and native shown/hidden navigation.
### AC-08 (event-driven)
WHEN the compact inspector changes ownership during a pending or rejected save
THEN its existing draft protections shall remain intact.
VERIFY: retain current successful deferred hydration/deep-link tests and root failure/navigation smoke.

## Rejected Alternatives

Mapping None permanently to Todo loses ongoing work in Review. Preserving Done inside neutral makes open-stage meaning misleading. Requiring InProgress prevents the user's requested workflows. Inferring initial from names or current order breaks arbitrary naming/reordering. Automatically adding five columns to every new board exceeds the request; retain three defaults.

## Risks and Confidence

Primary risks are scattered fixed-type assumptions and neutral placement being treated as invalid or silently collapsed. Centralize compatibility/routing and test actual canonical round trips and caller paths. Root independently approved the semantics. Sol owns migration defect diagnosis and all implementation; root owns rendered/native evidence. No new approval gate is required.

```yaml
handoff:
  from: ramza
  to: vivi
  implementer: Sol6High
  serialized_column_types: [queue, none, in_progress, done]
  initial_eligible: [queue, none]
  required: [resolved_initial, at_least_one_done]
  new_board_defaults: [Queue, InProgress, Done]
  neutral_open_statuses: [todo, doing]
  preserve_dirty_work: true
```
