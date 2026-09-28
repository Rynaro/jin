---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-24T12:00:00Z
target_repos: [jin]
stories_count: 4
validation_gates_count: 10
---
# Modern Notes explorer, with optional paper cards

## Scope

CHANGE, RAMZA → Vivi at standard tier. Astra6High plans; Sol6High is the sole product writer. Implementation is authorized. Preserve the dirty branch and accepted Notes detail/editor, collections, history, attachments and sidebar behaviors.

Primary deliverable is a substantial List/Explorer composition overhaul to match the modern app chrome. Cards are an additional view, not a substitute. Existing backend and DTOs only; no new dependency, backend, second persistent sidebar, fake native controls, per-note content fetches, sort/filter feature expansion or new selection model.

## Approach

Replace the centered reading-width browse page with a full-width native-style explorer: compact persistent top chrome, one useful information strip, and a broad scanning surface. Detail retains its centered writing column. Use existing system typography, neutral surfaces, controls and focus tokens; keep Jin identity restrained, without decorative strokes, blue selection stripes, tilted paper or serif UI.

Source diagnosis: `index.html` uses a generic combined workspace header; `browse.css` caps the list at `--reading-width` and retains overlapping flat-row/page rules. `sidebar.css` consumes the native titlebar spacer only for `.detail-open`, leaving a blank52px region in browse mode. Notes list DTO has title, updated, status, tags, folder_path and ≤200-character plain excerpt; full Markdown is unavailable there. Therefore both new views must use these exact fields, without fake page thumbnails or hidden body fetches.

Hypotheses: a small heading/metadata patch leaves the old page structure intact; a multi-column finder with another persistent rail repeats the width problem; selected approach is one adaptive explorer with two representations of the same result set. This changes composition while keeping navigation and data contracts.

## Stories

### S1 — A coherent explorer toolbar
As a writer, I want scope, search and creation in one compact toolbar so more of the window is useful. Timebox: 1d. Risk: P1.
- Convert `.notes-list-pane__header` to the same neutral chrome family as Notes detail. Desktop first row: small scope icon + system heading (about17–19px) + discreet loaded count; flexible space; compact search field with search icon; List/Cards segment; labeled New note action. Use real buttons/labels and existing icons. Search accessible name remains explicit, its visual label need not occupy a separate form row.
- One subordinate context strip below the toolbar carries full folder path or saved collection rule summary. Omit redundant “All your notes” prose. Search changes workspace identity to “Search results”, context to “Across all notes”, and reports the actual loaded result count; retain prior folder/collection internally and restore its identity when search clears. Distinguish loading from a true zero count. Keep search query visible until explicitly cleared or scope navigation clears it.
- Scope selection deliberately cancels/clears global search and restores selected scope. Use one coherent list request generation across folder/all/collection/search: late earlier requests must not overwrite current rows, title, count or empty state. No sorting override for collection results.
- New note retains current destination contract: current folder, otherwise Notes root. Do not imply a new note automatically matches a collection or search. Provide concise accessible destination context if needed, without a new dialog.
- Make the toolbar remain visible while the explorer body alone scrolls. Remove the page-form visual rhythm; search/actions align on the same compact control line. Do not duplicate New note or sidebar reveal controls.

### S2 — A genuinely redesigned default list
As a writer, I want to scan many notes by content and location without opening each one. Timebox: 1d. Risk: P1.
- Use the available workspace width with consistent20–24px desktop gutters, not the760px reading cap. Header and rows share these edges. A compact document glyph/quiet leading marker, title/excerpt column and trailing metadata lane create deliberate alignment across rows.
- Each normal row has a stronger16–17px title, a restrained up-to-two-line excerpt (14–15px), and secondary metadata. At broad widths date aligns at the trailing edge; folder path appears where useful for All Notes/global results/collections, avoiding repetition in a single folder. Tags are readable small text, not a wall of bright pills. Archived state remains explicit; normal Active badges stay omitted. Localized dates use existing formatter and machine-readable time where appropriate.
- Normal rows are roughly84–96px minimum, allowed to grow for required content/text scale. Quiet separators and one hover fill make the list continuous; no per-row raised cards. Entire existing row button opens its exact note, with visible keyboard focus. Avoid making labels look like independent controls when they are not.
- Empty excerpt renders a truthful “No preview” or is omitted without collapsing the title/date hierarchy. Long titles/paths/tags have bounded normal-scale treatment with full accessible text; accessibility text removes clamps. Do not insert fake sample text or show raw Markdown as styled document content.
- Keep existing note drag data and folder drop target behavior. Returning from detail restores the explorer view and useful scroll/focus position for the opened note rather than resetting to the top. Preserve current list ordering and conflict/flush guards.

### S3 — Optional paper-card representation
As a writer, I want a visual overview when browsing, while keeping List as the efficient default. Timebox: 1d. Risk: P1.
- Add an accessible two-button List/Cards segment (`aria-pressed`, clear names); default List. Persist only a validated `list|cards` local preference with safe fallback if storage is unavailable. Do not overload folder-tree collapsed state.
- Both views render the same loaded note IDs, order and scope/search state. View switching is presentation-only: no refetch, new sorting, body loading or dirty editor operation. Prefer one row template/semantic note button with a view class and common field renderer, rather than divergent event wiring.
- Cards use a responsive grid with approximately220–280px useful minimum cards, modest gaps and adaptive paper surface/hairline. Title and plain excerpt (about4–6 lines) sit on the page face; date/location/tags are a restrained footer. One subtle elevation at most; no nested inner card, fake folded corner, masonry, random height/rotation or image placeholder.
- Cards keep accessible names, exact open target, focus visibility and drag/drop payload. At narrow widths become one column; enlarged text removes clipping and card fixed-height assumptions. Store presentation mode independently of actual collection `view` metadata; never overwrite imported collection data.

### S4 — Native top integration and adaptive geometry
As a writer, I want browse and detail to share the usable titlebar while controls stay reachable. Timebox: 1d. Risk: P1.
- Native macOS only: active Notes browse consumes the existing52px spacer just as detail does. Sidebar shown: explorer toolbar starts at y0 in the content column. Sidebar hidden: reserve the existing real traffic-light area (90px) plus44px navigation reveal and gap (142px first-row content start). Generalize the existing active-Notes rule carefully; returning to another route restores its ordinary native spacer.
- Use the existing native drag-region mechanism in unoccupied header space; interactive controls must remain clickable. No fake traffic lights. Browser/nonmac has no native52px clearance and starts at normal content top. Do not change Rust/Tauri config for this task.
- At widths where identity/search/segment/action cannot fit, search gets a full second toolbar row; identity and actions remain readable. Reflow based on actual content pane width, including248px sidebar and native safe inset. At320/390 and AX3.1, stack toolbar groups, keep all controls reachable, wrap title/context and let body rows/cards grow. No horizontal document overflow or clipped invisible controls.
- Unify native Notes list/detail selectors and scoped a11y rules at their owners, preserving already-correct detail editor geometry and active-route gating. No patch that hides overflow over missing controls.

## Ownership and execution

Sol owns `jin-gui/index.html` (list header/template only), `src/controllers/notes_controller.ts` (view state, request identity, title/count, return focus), `src/lib/notes/render.ts` (common note list fields/presentation), optional small `src/lib/notes/explorerPrefs.ts`, `src/styles/browse.css` (explorer composition), `sidebar.css` (native integration), narrowly scoped `a11y.css`, corresponding focused tests and accepted dossier update. Reuse existing semantic tokens before adding a narrowly justified token. Consolidate old Notes list/header/row rules including the late reading-width cap, nth-child width remnants and generic workspace-header styles; leave Tasks selectors intact when splitting combined rules.

Order: state/request/view contracts → toolbar/native composition → default list → Cards → responsive/AX and behavior checks. Root owns browser evidence and native build; Astra independent source review. Existing detail internals and backend stay untouched.

## Acceptance Criteria

### AC-01 (state-driven)
GIVEN desktop Notes browse
THEN its default List shall use the broad explorer width with aligned toolbar and row gutters.
VERIFY: root1280/1440 screenshots show materially new composition, not760px page.
### AC-02 (event-driven)
WHEN global search starts and clears
THEN explorer identity shall reflect the currently displayed result scope.
VERIFY: controller test for scope title/count transitions.
### AC-03 (unwanted-behavior)
WHEN an earlier scope/search request resolves after a newer one
THEN it shall not replace the current result presentation.
VERIFY: deferred-promise folder/search/collection race test.
### AC-04 (event-driven)
WHEN List changes to Cards
THEN the displayed ordered note IDs shall remain identical without a data request.
VERIFY: renderer/controller test with invoke spy.
### AC-05 (event-driven)
WHEN either representation opens or drags a note
THEN it shall use that note's canonical ID.
VERIFY: click and drag payload regression.
### AC-06 (event-driven)
WHEN the user returns from note detail
THEN the prior explorer position shall remain useful for continuing from that note.
VERIFY: root long-list focus/scroll smoke in both views.
### AC-07 (state-driven)
GIVEN native macOS Notes with sidebar hidden
THEN browse toolbar controls shall avoid the real traffic-light and navigation-reveal region.
VERIFY: root native-marker geometry shown/hidden, then detail and route-away regressions.
### AC-08 (state-driven)
GIVEN browser or nonmac Notes
THEN browse shall have no native-only top spacer.
VERIFY: root normal browser geometry.
### AC-09 (state-driven)
GIVEN320/390/760 widths or AX3.1
THEN every explorer control shall remain reachable without document horizontal overflow.
VERIFY: root keyboard/responsive matrix with long paths/tags/titles.
### AC-10 (unwanted-behavior)
WHEN view preference is invalid or storage unavailable
THEN Notes shall fall back safely to List.
VERIFY: preference test and build/style checks.

## Confidence

High: real owners, DTO limits and accepted native detail pattern are established. Principal risk is list/search async ownership; one request generation is necessary to make the new scope/count presentation truthful. Native simulation proves geometry only; root owns native host verification. Cards add no backend or document parsing path.

```yaml
handoff:
  from: ramza
  to: vivi
  implementer: Sol6High
  approval: authorized
  default_view: list
  additional_view: cards
  backend_changes: false
  preserve_dirty_work: true
  validation: [focused_tests, typecheck, style_checks, build, root_visual_matrix]
```
