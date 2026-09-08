# Living Tasks production visual integration

Author: RAMZA. Maker: Vivi. Checker: ATLAS.

## Outcome

Extend the approved Living Agenda language into the real Tasks workspace. Tasks should read as a calm, capable working ledger: warm paper and ink, indigo for focus and active relationships, and the existing vermilion seal for completion. Preserve the density needed for daily planning while giving the active scope, task hierarchy, board state, selection and detail editor a clear visual order.

## Implementation contract

1. In `jin-gui/src/styles/tokens.css`, add only the semantic adaptive roles that Tasks needs and cannot express with the existing paper/ink roles: selected-row wash/edge, board-column paper, detail-paper edge, and quiet task metadata. Define them for light, system dark and explicit dark. Reuse the existing indigo, seal/vermilion, paper, ink, separator and focus roles; component CSS contains no raw colors.
2. In `jin-gui/index.html`, add a compact workspace identity directly above the filters: one real `h1` whose text is the active smart-view or list name. Keep the filter controls, List/Board segmented control, loading/empty/list/detail targets, dialogs, templates, roles, actions and fallback navigation intact. Do not add marketing copy, invented counts or a second task-creation control.
3. In `jin-gui/src/controllers/tasks_controller.ts`, populate that heading from the existing `currentScope` and already-fetched `ListDto[]`. Smart views use their canonical visible names (`Inbox`, `Today`, `Upcoming`, `Flexible`, `Completed`); list scopes use the exact list name, falling back truthfully to the id while data is unavailable. Update it on initial load, rail scope changes and deep-link scope correction. This is a presentation projection only: no bridge calls, persistence changes, new task states or new navigation behavior.
4. In `jin-gui/src/styles/browse.css`, consolidate the existing Tasks visual rules instead of appending another override block. Remove or rewrite superseded late `Representative Tasks migration` declarations as part of the same edit. Apply the following composition:
   - The lists rail is quiet warm paper with indigo active-row text/wash and a persistent non-color active mark. Counts and edit/delete actions must remain readable and keyboard/touch reachable; long list names truncate without displacing actions.
   - The workspace header and toolbar form one restrained top band. The title leads; Filters and List/Board remain compact subordinate controls. Controls wrap or collapse through the existing filter toggle rather than causing horizontal scrolling.
   - List view is an open ledger, not a grid of gray cards. Use stable status, title, due/tags/progress and action tracks at normal desktop text sizes. Selected/focused tasks receive indigo wash plus an edge or outline. The vermilion completion seal remains the primary completion affordance. Due, priority, status, parent breadcrumb and subtask progress retain text/glyph meaning and may wrap at large text. Hover-only actions are also shown on focus and coarse pointers.
   - Section headers are calm dividers with visible names/counts and unchanged collapse, rename, delete, add and drag affordances. Nested children remain visibly subordinate without hiding their title or checkbox.
   - Board view retains the real Todo/Doing/Done workflow. Columns read as three paper lanes with stable headings/counts; cards are slightly elevated paper sheets, with indigo focus/selection and legal/illegal drop states expressed by shape/text/outline as well as color. Do not invent WIP limits, progress metrics or statuses.
   - The detail pane is a readable paper inspector connected to the selected row. Keep title, body, status, priority, due, list, section, tags, subtasks, reminders, backlinks, Promote to Event and delete/close actions. On wide screens it remains beside the list; at narrow widths it uses the existing full-width slide-over, with its own vertical scroll and always-reachable close action. The list must not be compressed below a usable width.
   - Loading, empty, failure/toast, quick-create, bulk selection, due popover and all dialogs retain truthful existing behavior. Empty space is acceptable; do not fill it with sample tasks or decorative copy.
5. In `jin-gui/src/styles/a11y.css`, add scoped Tasks rules for AX5/310% text, reduced motion/transparency, increased contrast and forced colors. At 320px and large text, rail/workspace/detail become one usable layer at a time, the toolbar wraps, rows/cards grow with content, and the document has no horizontal scrolling. Do not use fixed row heights, scaled minimum widths, clipping masks or `overflow:hidden` on text-bearing containers to manufacture a pass. Forced-colors selection, completion, drag/drop and focus remain structurally visible.
6. Extend `jin-gui/src/__tests__/tasks_controller.test.ts` and the existing token/visual-system test where appropriate. Assert active-scope title mapping and updates, preserved list/board callback parity, selected/status non-color hooks, no lost metadata at the DOM level, and the new semantic token discipline. Existing task/list/controller tests remain green.

## Acceptance criteria

- **AC1 — identity and navigation:** When Tasks opens or its rail scope changes, the workspace SHALL show exactly one level-one heading with the exact active smart-view or list name, and every smart view/list plus the global navigation SHALL remain reachable with its current routing and persisted state.
- **AC2 — real workflows:** When a user filters, sorts, creates, completes/reopens, selects, bulk-selects, drags, edits, reschedules, promotes, links, manages subtasks/reminders/sections/tags/lists or deletes, Jin SHALL call the same existing controller callback and bridge path with the same guarded legal transitions and error behavior.
- **AC3 — list hierarchy:** When list view renders real tasks, Jin SHALL preserve task order and expose status, title, due information, priority, tags, parent/subtask context and available actions without using color as the only meaning. Selected and keyboard-focused rows SHALL have a persistent non-color focus/selection cue.
- **AC4 — board hierarchy:** When board view renders in any existing scope, Jin SHALL preserve Todo/Doing/Done columns, counts, legal transition rules, card actions and Todo quick-create placement. Legal and illegal drop targets SHALL remain distinguishable without color alone.
- **AC5 — detail continuity:** When one task or multiple tasks are selected, the existing single-task inspector or bulk panel SHALL open without removing the list workflow. At narrow widths the pane SHALL scroll internally and keep Close, Delete and all editable fields/actions reachable.
- **AC6 — truthful states:** When Tasks is loading, empty or a bridge call fails, the existing truthful loading/empty/error treatment SHALL remain; the UI SHALL NOT display fabricated tasks, counts, statuses or promotional filler.
- **AC7 — responsive accessibility:** When viewport width is 320, 390, 760 or 1440 CSS pixels, or dynamic type reaches AX5 (310%), the Tasks rail, toolbar, list/board and detail SHALL reflow without page horizontal scrolling, clipped task meaning, or unreachable task/navigation/dialog controls.
- **AC8 — appearance preferences:** When light/dark/auto, reduced motion/transparency, increased contrast or forced colors is active, paper/ink/indigo/vermilion roles SHALL remain legible; focus, selected, completed and drag/drop states SHALL remain identifiable by structure, text, glyph or outline in addition to color.

## Boundaries

No Rust/core/DTO/bridge/API changes. No new task states, WIP rules, metrics, command bar, reminder model, list semantics or navigation destinations. Do not redesign Notes, Events, Today, Settings or the global Capture flow. Preserve all current Stimulus targets/actions, native dialogs, task templates, keyboard shortcuts, roving tabindex, multi-select semantics, legal-status FSM, DnD ranking, local view preference and server/client filtering contracts. Do not replace real functionality with prototype interactions.

## Verification

Run focused `tasks_controller`, `lists_controller`, sidebar, appearance, a11y and token-discipline tests, then `make verify-gui`. Browser evidence at 320/390/760/1440 covers light/dark, empty/populated lists, active rail selection, collapsed filters, List/Board, selected task detail, bulk panel, long titles/tags, coarse-pointer action reachability, and 310% text reflow. Console warnings/errors must be reviewed. Native owner validation remains distinct from deterministic browser evidence.

## Risks

The principal risks are hiding mature workflows during visual simplification, list compression when detail opens, board overflow, false confidence from fixed-height rows, dark-mode vermilion contrast and adding a fourth CSS authority layer. Mitigate by keeping behavior hooks unchanged, deriving the title only from existing scope data, using content-sized rows at large text, testing the full interaction matrix, and consolidating superseded Tasks declarations during the edit.
