# Notes production verification

Date: 2026-09-05
Scope: production Notes rail, browse list, search and editor/detail surfaces.

## Implemented scope

- Added the real active-scope heading while preserving folder, collection,
  search and global navigation behavior.
- Applied the Living Agenda language to the Notes rail, open paper index,
  writing surface, Read mode and related-note metadata.
- Preserved the existing CodeMirror editor, title save/revert, autosave,
  formatting, Focus/Typewriter controls, attachments, links, backlinks,
  history, conflict handling and truthful loading/empty states.
- Added responsive and accessibility treatment for large text, dark mode,
  forced colors, focus, selected scope, editor actions and full-width search.
- Registered the existing History icon so opening a note produces no icon
  registry warning.

## Automated verification

- Final frontend regression suite: **1887 tests / 51 files passed**.
  Evidence: `/private/tmp/jin-notes-final-tests.log`.
- Rustfmt, Clippy, Rust tests, TypeScript, lint and production build checks
  passed during the full GUI verification run.
- Production smoke checks passed. Evidence:
  `/private/tmp/jin-notes-smoke.log`.

## Deterministic browser evidence

The Playwright fixture was run with UTC, en-US, reduced motion and the 1280px
baseline. Evidence covered editor and Read mode, populated and search states,
real note title/label/history rendering, and responsive behavior at 320, 390,
760 and 1440px at normal and 3.1x text. No page horizontal overflow remained.

Verified details included:

- AX preview clamping and overlap correction.
- Full-width AX search behavior.
- Real note title, label and History icon with zero console warnings.
- Search for `Nanquim` returning one real result.
- Editor and Read-mode toggles remaining reachable.
- Ordinary narrow search measured at 240px on 320px, 310px on 390px and 472px
  on 760px, with no horizontal overflow.
- At 390px, folder reveal, focus, Collapse sidebar, close and Show sidebar were
  browser-verified.
- At 1280px, collapsed-rail reveal, collapse and reveal again were verified.
- Scope projection was verified for the exact `Studio` folder title and its
  `All Notes` recovery state.

Evidence screenshots:

- `notes-list-ax5-final`
- `notes-editor-ax5-final`
- `notes-forced-colors.png`

The final editor/list AX screenshots were reviewed with no overlap. Forced-colors
review retained structural state cues, and browser console review reported zero
errors and zero warnings. The final CSS lint and production build passed.

Native Notes owner sign-off remains separate from deterministic browser evidence.
Browser evidence does not claim every Notes workflow was manually exercised;
preserved behavior is covered by the regression suite.
