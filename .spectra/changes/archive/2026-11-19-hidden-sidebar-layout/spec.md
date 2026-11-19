---
eidolon: ramza
kind: spec
version: 1
created_at: 2026-11-19
---

# Hidden sidebar layout

## Scope

Fix the native layout exposed when the user hides Jin's main sidebar. The supplied screenshot shows a Notes library with a compressed title and toolbar, a narrow search field, and an editor header shifted inward. Review Today, Tasks, Notes, Calendar, Settings and Notifications in the same state. This is a presentation repair through existing shell and route owners.

Source evidence is specific. The native hidden-sidebar rules apply 118px of inline padding to the whole Notes library toolbar and 142px to every Notes editor header. A split editor already begins beyond the library, so applying window-edge clearance there creates a second offset. The library's limited width also means reserving native clearance for all of its controls compresses them unnecessarily.

## Approach

Use one shared, visually quiet native titlebar and navigation-reveal row while main navigation is hidden. This row owns the native window-control safe area and drag region for all six pages. The working headers beneath it use their normal pane spacing and full available width. A split Notes editor uses its normal offset from the library, and a single-pane editor receives the same shared titlebar protection.

Scope this row to the native hidden-navigation state. A compact drawer and expanded navigation use their existing geometry. Remove the per-route hidden-state offsets which duplicate clearance, including the library toolbar inset and Notes editor header inset.
Use the current sidebar-visible, responsive, Notes split and native-overlay state contracts. Keep native window buttons and drag regions operable and keep application controls above any drag hit area. Treat browser headers, compact drawer and enlarged-text layouts through their actual geometry. Existing expanded navigation, document state, autosave, route guards and continuous surface tokens constrain the change.

## Stories

1. A person hides navigation while writing and receives more usable space in the library and editor. Vivi owns the shared and route CSS change, its focused regression coverage and the affected-file handoff. Estimate one focused working day with native verification.
2. A person can hide navigation on any main page and continue working with clear headings, controls and a way to restore navigation. Parent browser and native review covers all six destinations, while Vigil independently reviews acceptance and regression evidence.

## Acceptance Criteria

### AC-HS-1 (event-driven)

GIVEN A native macOS Notes split view with a visible library
WHEN The main sidebar is hidden
THEN The library title and controls retain useful width while one shared titlebar row reserves native-control clearance
VERIFY: Native split view screenshot and measured library control geometry

### AC-HS-2 (event-driven)

GIVEN Notes editor in split or single-pane layout
WHEN The main sidebar or library is hidden and restored
THEN The editor header uses normal pane spacing beneath the shared titlebar and its commands remain reachable
VERIFY: Split and single-pane screenshots plus library toggle interaction

### AC-HS-3 (event-driven)

GIVEN Today, Tasks, Notes, Calendar, Settings and Notifications
WHEN The user hides the main sidebar on each page
THEN The page uses the available width with readable headings and controls and a reachable navigation reveal button
VERIFY: All-route desktop review with native overlay and plain browser

### AC-HS-4 (event-driven)

GIVEN The native titlebar is overlaid on the content
WHEN Navigation is hidden or shown
THEN Native window buttons and drag regions remain usable without intercepting route controls
VERIFY: Native titlebar and reveal interaction checks

### AC-HS-5 (event-driven)

GIVEN A compact window or enlarged text
WHEN Navigation is opened, dismissed or used to select a route
THEN The drawer and page controls stay reachable with visible focus and without document-level horizontal overflow
VERIFY: Compact and large-text keyboard and overflow checks

### AC-HS-6 (event-driven)

GIVEN An open note with edits and the existing expanded sidebar
WHEN The user repeatedly toggles main navigation and the note library
THEN The same note and editor state remain available and the continuous workspace surface and expanded layout remain coherent
VERIFY: Existing editor/sidebar tests and live toggle review

## Alternatives

The initial planning tool scored pane-specific window-edge clearance 92.5, a local Notes reset 75 and an additional titlebar row 80.5. The maker and parent selected a single shared titlebar row scoped to hidden native navigation. That constraint changes the tradeoff by avoiding expanded-layout changes while giving all routes one safe-area owner. The revised shared-row hypothesis scores 94.5 and is the implementation direction.

## Risks and verification

The split layout can change when the library is hidden or text size increases. Check actual geometry in each state and repeated toggles. Native overlay styling must be verified in the current signed macOS binary, as browser fixtures do not include real window controls. Compare all six primary routes, plus a Calendar event detail and a Notes document. Inspect light and dark appearance, expanded and collapsed desktop navigation, compact drawer behavior, large text, focus and overflow. Run existing relevant sidebar/editor/style tests and add rendered regression coverage for the specific geometry if existing tests cannot detect it. Reference updates require reviewing the changed screenshots first.

## Confidence

The user screenshot and CSS owners establish the defect and intended repair. Source reuse is high, and the main uncertainty is native geometry across pane transitions. ESL sizing belongs to the parent lifecycle gate. RAMZA sized this focused plan lite and validates criteria and confidence through its planning tools before handoff.
