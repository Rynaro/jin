# Tasks production verification

Date: 2026-09-04
Scope: production Tasks list, board, rail and detail presentation.

## Implemented scope

- Added the real active-scope workspace heading and kept existing navigation and
  controller paths intact.
- Applied the Living Agenda language to the task list, board lanes, paper detail
  inspector and responsive task-list overlay.
- Preserved real task metadata, hierarchy, status actions, selection, drag/drop,
  quick-create, dialogs and error/empty/loading behavior.
- Added responsive and accessibility treatment for large text, dark mode,
  forced colors, focus, selection and overlay focus/close/return behavior.

## Automated verification

- Final frontend regression suite: **1884 tests / 51 files passed**.
  Evidence: `/private/tmp/jin-tasks-final-tests.log`.
- Rustfmt, Clippy and Rust tests passed during the GUI verification run.
  Evidence: `/private/tmp/jin-tasks-verify.log`.
- Subsequent TypeScript, lint and production build checks passed.
- Production smoke checks passed. Evidence: `/private/tmp/jin-tasks-smoke.log`.

## Deterministic browser evidence

The Playwright fixture was run with UTC, en-US, reduced motion and the 1280px
baseline. Evidence screenshots cover the populated Tasks list, board, rail and
detail fields, plus dark AX5/310% views:

- `tasks-work-after`
- `tasks-board-after`
- `tasks-list-ax5-dark`
- `tasks-rail-ax5-dark`
- `tasks-detail-fields-ax5-dark`

The pass fixed rail-title clipping, crowded board titles, AX5 select sizing,
full-width task-list overlay focus/close/return behavior, 1440px filter wrapping
and board stacking.

The final matrix covered all 16 list/board combinations across 320, 390, 760
and 1440px at normal and 3.1x text size. No page horizontal overflow remained;
both layout toggles stayed clickable. Detail AX5 checks at all four widths kept
subtask scrolling and Close reachable. Rail focus/close on task-list overlay
open and return behavior were verified, as was the real `Upcoming` scope
heading.

The forced-colors evidence `tasks-forced-colors.png` retained structural
selection cues. Final evidence also includes `tasks-work-final.png`. Browser
console review reported zero errors and zero warnings.

Browser evidence does not claim every task workflow was manually exercised;
preserved behavior is covered by the regression suite. Native Tasks owner
sign-off remains separate. The previously validated Today native experience is
not re-certified by this record.
