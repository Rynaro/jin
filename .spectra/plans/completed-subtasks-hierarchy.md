---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-28T11:59:08Z
---
# Completed subtasks stay with their parent

## Scope

Amendment to `todo-item-density.md` and checklist presentation in `tasks-reminders-workflows.md`. The user's new instruction supersedes previous presentation constraints that left completion placement unchanged. Intent: change List presentation so completing a subtask preserves the visible family. RAMZA Astra 6 High plans; VIVI Sol 6 High implements. Mechanical right-size: lite, score 2 (four estimated product/test files, medium stakes); complexity 5/12. No data migration, status lifecycle change, API change, or new preference.

Scope is a concrete checklist List, including sectioned and sectionless rendering. Boards retain status-column cards; Smart/All Lists retain existing independent search/aggregate results. The user's screenshot and correction concern children escaping their checklist family on completion. No clarification is needed for that correction.

## Approach

ATLAS identified the cause: `tasks_controller.ts` removes all terminal tasks before nesting, then `appendTaskDisclosure` renders done/cancelled tasks as flat rows. Reuse `partitionParentsAndChildren` and `appendTasksWithNesting`; do not invent a second hierarchy renderer. Partition *families* before passing each bucket to the existing render paths.

A visible root is a task whose parent is absent from the current filtered task set, or a task without a parent. Its status determines the family's destination: open area, Completed disclosure, or Cancelled disclosure. Every visible child accompanies its visible parent, regardless of the child's own status. Existing one-level hierarchy guarantees remain authoritative; do not add arbitrary-depth nesting. Each matching task is rendered once. An open parent with done/cancelled children stays in its current section with those children. A completed parent and all its visible children render as a nested family in Completed. A cancelled parent does likewise in Cancelled. Existing legal reopen/cascade behavior remains owned by core; presentation reflects the returned state.

Use the same compact task row and checked styling, child indentation, inspector callbacks, keyboard controls and collapse affordance. Completing or reopening a child does not reorder siblings by status. Preserve the existing sort mode within each family and existing section grouping. Recompute parent progress from the complete visible family: done children are included in numerator and all visible children in denominator, using existing cancelled-child semantics. Workspace open count still counts task statuses, not visible rows.

Disclosure numbers count their top-level entries (families and standalone tasks). Thus Completed · 2 can contain two parent families with nested children. A completed child beneath an open parent contributes to the parent's progress and contributes zero to Completed. Omit a terminal disclosure when it has no root entries. This makes its count match what its summary opens and avoids counting the same child twice.

Filters remain authoritative. Do not fetch or insert parents excluded by status, priority, or tag filters. When a child matches but its parent does not, render it with the existing standalone fallback; this is a filtered result, not a completion-driven move. With an explicit status filter, preserve the current single filtered list (no automatic terminal disclosures) and nest matching family members whenever both are present. Clearing the filter restores normal family placement. A genuinely missing/deleted parent follows the same standalone fallback so its child never vanishes.

## Stories

S1 — Preserve family placement. VIVI owns the checklist partition in `jin-gui/src/controllers/tasks_controller.ts`, the existing task nesting/terminal renderer in `jin-gui/src/lib/tasks/render.ts`, and a small task helper only if it makes the partition reusable/testable. Keep sections and terminal roots stable under completion. Target one bounded implementation pass; escalate only if inspection reveals core contradicts the assumed one-level hierarchy.

S2 — Verify lifecycle presentation. Add focused coverage in existing task renderer/controller suites for child completion, reopen, mixed terminal statuses, completed parents, sections, count semantics and filtered parent omission. Reuse fixtures; no new dependency or large fixture expansion. Scope allowance includes those nearest tests and existing task helper tests. Product code and test files are the coder's only write ownership; preserve all unrelated dirty branch work.

## Acceptance Criteria

Atomic criteria live in `completed-subtasks-hierarchy.criteria.md`. They define family placement, no duplication, terminal counters, sections, sorting, filters, and unchanged independent Board/aggregate behavior.

## Verification

Run the relevant renderer/controller regression suites and GUI production build. Capture the screenshot scenario with one open parent, one completed child and one open child: all children remain beneath the parent, progress shows 1/2, and Completed contains only standalone/completed-root families. Complete the parent using existing transition flow, expand Completed, and confirm nested family; reopen according to existing lifecycle and confirm the returned family remains together. Repeat the primary scenario in a section. Verify child checkbox and inspector remain usable. Browser evidence demonstrates frontend placement; do not imply it proves native Tauri dispatch. No native IPC contracts change.

Dependency check: only existing hierarchy primitives and TaskDto fields; no added package. Constraint check: no status writes beyond existing completion handlers, no data deletion, no hidden parent insertion against filters, no global completion primitive restyling. Self-consistency: terminal routing follows root status; child status affects styling/progress, not placement. Tests should assert observable hierarchy/counts rather than mirror the partition algorithm.

## Rejected Alternatives

Open-parent-only patch (78.5): fixes the screenshot but leaves completed parent families flattened. Remove terminal disclosures (78.5): preserves hierarchy but removes the accepted way to set completed top-level work aside. Family partition (92) reuses existing primitives and satisfies both family continuity and terminal organization.

## Confidence

Pattern match 95, requirement clarity 95, decomposition stability 92, constraint compliance 96. Highest risk is incomplete input caused by filters; the explicit fallback above prevents disappearance and avoids altering filter contracts. No unresolved product decisions remain.

## Handoff

VIVI / Sol 6 High is sole product writer; it is not alone in the branch. Implement S1 and S2, preserve others' edits, report exact files and validation results. RAMZA artifacts are planning evidence only; no product tests have been executed by the planner. CRYSTALIUM recall is unavailable in this session's tool catalog; local existing specifications and ATLAS findings supply context.
