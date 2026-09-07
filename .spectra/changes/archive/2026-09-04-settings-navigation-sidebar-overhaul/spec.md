---
eidolon: ramza
version: 1.1.0
kind: spec
status: implementation-verified
created_at: 2026-09-04T20:10:00Z
thread_id: 01a06bc8-d754-7d44-876f-bf86556694a9
change_id: settings-navigation-sidebar-overhaul
esl_version: "1.1"
esl_tier: full
maker: vivi
checker: vigil
criteria_sha256: 055a1ab40820658073ce3e56656bcfa792a2eda409eb5e31930cb3f449c78e02
confidence: 0.9225
---

# Settings navigation sidebar overhaul

## Scope

Intent class: `CHANGE`.

Unify every genuine navigation rail in Main, Settings, Notes, and Tasks behind one authoritative shared anatomy while preserving existing controllers, hooks, selection behavior, dirty Settings work, and responsive accessibility.

In scope: Main links and Settings entry; Settings categories; Notes folders, All Notes, and collections; Tasks smart views and lists; shared tokens, CSS ownership, ARIA state styling, tree/actions variants, and verification.

Out of scope: note/task content rows, Notifications master rows, Today/events/calendar rows, menus, dialogs, popovers, form controls, toolbars, detail panes, router changes, backend changes, DTO changes, and runtime custom elements.

Declared product scope is the exact 15 paths in `spec.yaml.declared_scope`. Expansion requires a RAMZA amendment.

Maker is `vivi`; independent checker is `vigil`; ESL tier is `full`.

## Approach

The authoritative component is `jin-gui/src/styles/navigation.css`. It owns rail, list, row, icon, label, meta, and actions anatomy plus tree, actions, and inset variants.

Standard geometry follows Main navigation: 184px rail, 32px minimum row height, `0 10px` padding, 8px gap, 6px radius, 13px font, 18px line height, selected workspace wash, and 3px ink marker. `--context-rail-width` remains a compatibility alias to the shared navigation width.

Page and scope navigation use `aria-current="page"` only on the active item. Notes tree items retain `aria-selected="true|false"` on `role="treeitem"`. Legacy feature classes remain as controller/test hooks but cease owning canonical navigation visuals.

Tasks reserve trailing metadata/actions geometry at 184px. Idle counts and revealed edit/delete actions share a fixed grid area, keyboard focus reveals actions without hidden focusable descendants, and coarse-pointer mode does not depend on hover. Nested Notes folders retain depth, chevron, icon, label, meta, and action tracks with truncation.

The existing uncommitted Settings implementation is the migration baseline. Implementers must capture its patch and structured hook/behavior inventory before edits, apply narrow patches only, and prove preservation afterward. Settings desktop workspace scrolling, compact/AX route scrolling, persistence, focus, and all existing targets/actions remain unchanged.

## Stories

1. **Shared contract** — add the width alias, import, anatomy, variants, semantic state selectors, and ownership guards. Timebox: 1.5d; risk P0.
2. **Main and Settings** — migrate reference surfaces without changing router, collapse, notification badge, Settings pane, focus, or scrolling behavior. Timebox: 1d; risk P0.
3. **Notes** — migrate folders, All Notes, and collections while preserving tree semantics, menus, drag/drop, keyboard navigation, and collapse/reveal. Timebox: 1.5d; risk P1.
4. **Tasks** — migrate smart/list rows with stable metadata/actions, long-label containment, counts, editing, deletion, and reordering. Timebox: 2d; risk P0.
5. **Ownership and accessibility** — remove duplicate feature visuals and centralize forced-colors, contrast, transparency, AX, and coarse-pointer rules. Timebox: 1d; risk P1.
6. **Verification** — run focused/full gates and deterministic geometry/interaction QA with AC-indexed evidence. Timebox: 1d; risk P1.

## Acceptance Criteria

### AC-NAV-001 (ubiquitous)
THEN the shared navigation rail width token SHALL resolve to 184px at standard text scale
VERIFY: static token assertion in src/__tests__/notes_visual_system.test.ts

### AC-NAV-002 (ubiquitous)
THEN navigation.css SHALL be the authoritative stylesheet for shared navigation rail, list, row, icon, label, meta, and actions anatomy
VERIFY: import-order and selector-ownership assertions in src/__tests__/notes_visual_system.test.ts

### AC-NAV-003 (ubiquitous)
THEN each shared navigation row SHALL use a 32px minimum row height
VERIFY: static CSS contract in src/__tests__/notes_visual_system.test.ts

### AC-NAV-004 (ubiquitous)
THEN each standard shared navigation row SHALL use 0 10px padding
VERIFY: static CSS contract in src/__tests__/notes_visual_system.test.ts

### AC-NAV-005 (ubiquitous)
THEN each standard shared navigation row SHALL use an 8px anatomy gap
VERIFY: static CSS contract in src/__tests__/notes_visual_system.test.ts

### AC-NAV-006 (ubiquitous)
THEN each standard shared navigation row SHALL use the existing 6px small-radius token
VERIFY: static CSS contract in src/__tests__/notes_visual_system.test.ts

### AC-NAV-007 (ubiquitous)
THEN each standard shared navigation row SHALL use the existing 13px by 18px footnote typography tokens
VERIFY: static CSS contract in src/__tests__/notes_visual_system.test.ts

### AC-NAV-008 (state-driven)
GIVEN a shared page-navigation row exposes aria-current="page"
THEN the row SHALL show the shared selected wash and ink marker
VERIFY: selector contract plus browser comparison across Main, Settings, Notes collections, and Tasks

### AC-NAV-009 (state-driven)
GIVEN a shared tree item exposes aria-selected="true"
THEN its child navigation row SHALL show the shared selected wash and ink marker
VERIFY: selector contract plus Notes folder selection browser check

### AC-NAV-010 (ubiquitous)
THEN inactive page-navigation rows SHALL omit aria-current rather than expose aria-current="false" or aria-current="true"
VERIFY: jsdom assertions in settings_controller.test.ts, notes_controller.test.ts, and lists_controller.test.ts

### AC-NAV-011 (ubiquitous)
THEN Main navigation links SHALL use the shared navigation rail, list, row, icon, label, and meta classes
VERIFY: static markup assertion in src/__tests__/notes_visual_system.test.ts

### AC-NAV-012 (ubiquitous)
THEN Settings category buttons SHALL use the shared navigation rail, list, row, and label classes
VERIFY: static markup assertion in src/__tests__/notes_visual_system.test.ts

### AC-NAV-013 (ubiquitous)
THEN Notes All Notes, folder rows, and collection rows SHALL use the shared navigation anatomy
VERIFY: markup and renderer assertions in notes_visual_system.test.ts plus notes_controller.test.ts

### AC-NAV-014 (ubiquitous)
THEN Tasks smart-view and list rows SHALL use the shared navigation anatomy
VERIFY: renderer assertions in lists_controller.test.ts

### AC-NAV-015 (ubiquitous)
THEN the Notes All Notes row SHALL fill the available navigation-list width
VERIFY: static shared-row width assertion plus browser bounding-box check

### AC-NAV-016 (state-driven)
GIVEN a task-list navigation row is rendered in a 184px rail
THEN its icon, label, meta, and action slots SHALL remain inside the rail bounds
VERIFY: 184px browser bounding-box assertion with long labels and two action buttons

### AC-NAV-017 (event-driven)
GIVEN a task-list row shows its count metadata
WHEN its action cluster becomes visible
THEN the row label SHALL not shift horizontally
VERIFY: before/after browser bounding-box comparison

### AC-NAV-018 (event-driven)
GIVEN keyboard focus enters a task-list action button
WHEN the row receives focus-within
THEN the shared actions slot SHALL become visibly available
VERIFY: jsdom focus test plus keyboard browser check

### AC-NAV-019 (state-driven)
GIVEN a coarse pointer is active
THEN task-list row actions SHALL remain discoverable without hover
VERIFY: pointer-coarse CSS assertion plus browser emulation

### AC-NAV-020 (state-driven)
GIVEN a nested Notes folder row is rendered
THEN the shared tree variant SHALL preserve its depth indentation and reserved chevron, icon, meta, and action tracks
VERIFY: nested-folder renderer assertion plus browser geometry check through four depths

### AC-NAV-021 (state-driven)
GIVEN navigation text exceeds its available label slot
THEN the shared label SHALL truncate without expanding the 184px rail
VERIFY: static overflow contract plus long-label browser check

### AC-NAV-022 (ubiquitous)
THEN existing router, Stimulus target, data-action, data attribute, drag, menu, collapse, and dialog hooks SHALL remain present
VERIFY: existing router/sidebar/notes/lists/settings suites plus static hook inventory

### AC-NAV-023 (ubiquitous)
THEN the Settings desktop workspace-scroll and compact-or-AX route-scroll contracts SHALL remain unchanged
VERIFY: settings_controller.test.ts and notes_visual_system.test.ts scrolling regressions

### AC-NAV-024 (ubiquitous)
THEN Main sidebar collapse and collapsed-only tooltip behavior SHALL remain unchanged
VERIFY: sidebar_controller.test.ts and router_controller_wiring.test.ts in the full suite

### AC-NAV-025 (ubiquitous)
THEN Notes rail collapse, reveal, tree keyboard navigation, and folder menus SHALL remain unchanged
VERIFY: notes_controller.test.ts plus deterministic browser keyboard check

### AC-NAV-026 (ubiquitous)
THEN Tasks list selection, counts, editing, deletion, and drag reordering SHALL remain unchanged
VERIFY: lists_controller.test.ts plus tasks_lists_modal_wiring.test.ts in the full suite

### AC-NAV-027 (state-driven)
GIVEN accessibility text scale is active
THEN shared navigation rails SHALL use the existing accessibility rail-width override without page-level horizontal overflow
VERIFY: a11y CSS assertion plus 1280x800 and 390x844 browser checks

### AC-NAV-028 (state-driven)
GIVEN a coarse pointer is active
THEN interactive shared navigation descendants SHALL retain the existing 44px pointer target contract
VERIFY: pointer-coarse CSS assertion plus browser computed-size check

### AC-NAV-029 (state-driven)
GIVEN forced colors or increased contrast is active
THEN shared active navigation rows SHALL retain a non-color-only visible marker
VERIFY: a11y selector contract plus browser forced-colors inspection

### AC-NAV-030 (state-driven)
GIVEN reduced transparency is active
THEN shared structural navigation rails SHALL remain opaque continuous surfaces
VERIFY: a11y CSS assertion plus browser computed-style check

### AC-NAV-031 (ubiquitous)
THEN note lists, task content rows, Notifications master rows, Today/event/calendar rows, menus, dialogs, and detail panes SHALL not receive shared navigation anatomy classes
VERIFY: negative static assertions in src/__tests__/notes_visual_system.test.ts

### AC-NAV-032 (ubiquitous)
THEN feature stylesheets SHALL not redefine the shared row height, padding, gap, radius, typography, selected wash, or ink marker
VERIFY: selector ownership assertions in src/__tests__/notes_visual_system.test.ts

### AC-NAV-033 (ubiquitous)
THEN the shared navigation contract SHALL introduce no raw color literal or new runtime dependency
VERIFY: npm run lint:css plus package-lock/package.json diff inspection

### AC-NAV-034 (state-driven)
GIVEN all eligible navigation surfaces are rendered at 1280x800
THEN their standard rails and rows SHALL be visually aligned to the Main navigation geometry
VERIFY: .spectra/plans/navigation-sidebar-unification.evidence/geometry.json with rail/row/padding/gap/radius/type/marker comparisons at plus or minus 0.5 CSS px

### AC-NAV-035 (state-driven)
GIVEN the viewport is 720px wide or narrower
THEN each eligible navigation surface SHALL retain its existing compact layout behavior without clipped navigation actions
VERIFY: deterministic Playwright checks at 720x800 and 390x844

### AC-NAV-036 (ubiquitous)
THEN the pre-existing uncommitted Settings functionality and tests SHALL remain in the resulting worktree
VERIFY: compare settings-baseline.patch and settings-baseline.json to settings-preservation.json under .spectra/plans/navigation-sidebar-unification.evidence

### AC-NAV-037 (ubiquitous)
THEN every browser-produced verification artifact SHALL be indexed by acceptance-criterion ID, viewport, mode, baseline revision, and result
VERIFY: schema/content assertion over .spectra/plans/navigation-sidebar-unification.evidence/manifest.json

## Confidence

RAMZA confidence is `92.25% → AUTO_PROCEED`. Independent plan critique passed cycle two at `4.8/5`; author `ramza-nav-author` and checker `ramza-nav-critic-01` are distinct. The frozen criteria SHA-256 is `055a1ab40820658073ce3e56656bcfa792a2eda409eb5e31930cb3f449c78e02`.

## Rejected Alternatives

- CSS aliases alone: insufficient ownership and no coherent tree/actions anatomy.
- Data attributes as the component API: conflates behavioral state with visual composition.
- Runtime Web Component: disproportionate lifecycle/slot complexity across static HTML, templates, and controller-generated DOM.

## Risks

- Dirty Settings work could be overwritten: baseline patch/inventory, narrow edits, and preservation manifest are mandatory.
- Tasks actions could clip at 184px: fixed trailing slot, truncation, keyboard/coarse tests, and geometry evidence.
- ARIA could be flattened incorrectly: page navigation and tree selection remain distinct contracts.
- Cascade cleanup could regress consumers: compatibility-first staged migration and per-stage tests.
- Shared classes could leak to content rows: explicit negative-scope guards.
- Native rendering may differ: deterministic Chromium verifies logic/geometry; owner native sign-off remains required.

## Rollback

Keep legacy feature classes and the context-width alias until all consumers pass. Roll back only the failing stage by reversing its class additions and selector removals. Restore individual feature declarations only when the shared replacement fails a gate. Never use checkout/reset against dirty Settings files.

## Verification

Run focused tests, CSS lint, production build, full frontend tests, and `git diff --check`. Deterministic browser QA covers 1280x800, 720x800, and 390x844 across standard, dark, AX, coarse pointer, contrast/transparency, forced colors, keyboard navigation, long labels, four folder depths, counts, and actions.

Computed geometry tolerance is ±0.5 CSS px; horizontal overflow allows at most one CSS pixel of rounding. Evidence is indexed under `.spectra/plans/navigation-sidebar-unification.evidence/manifest.json`. Native Tauri/WebKit rendering and feel remain an owner-signoff limitation.
