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
