### AC-SET-001 (state-driven)
GIVEN the Settings route is visible at a viewport wider than 720px
THEN the settings shell SHALL occupy the available content width as a two-column split view
VERIFY: static guard in src/__tests__/notes_visual_system.test.ts plus browser measurement at 1280x800

### AC-SET-002 (state-driven)
GIVEN the desktop settings shell is visible
THEN the category rail SHALL use the existing 208px context-rail width token
VERIFY: static guard in src/__tests__/notes_visual_system.test.ts

### AC-SET-003 (ubiquitous)
THEN the Settings navigation SHALL list General, Calendars & Sync, Notifications, and Data & Storage in that order
VERIFY: markup assertion in src/__tests__/notes_visual_system.test.ts

### AC-SET-004 (state-driven)
GIVEN Settings has initialized
THEN exactly one settings pane SHALL be exposed to the accessibility tree
VERIFY: jsdom unit test in src/__tests__/settings_controller.test.ts

### AC-SET-005 (event-driven)
GIVEN Settings is initialized with a valid category selection
WHEN the user activates another category
THEN the activated navigation control SHALL expose aria-current="page"
VERIFY: jsdom unit test in src/__tests__/settings_controller.test.ts

### AC-SET-006 (event-driven)
GIVEN Settings is initialized with a valid category selection
WHEN the user activates another category
THEN the newly selected pane SHALL become the sole visible pane
VERIFY: jsdom unit test in src/__tests__/settings_controller.test.ts

### AC-SET-007 (event-driven)
GIVEN localStorage contains a valid saved settings category
WHEN Settings connects
THEN the saved category SHALL be restored
VERIFY: storage helper unit test in src/__tests__/settings_controller.test.ts

### AC-SET-008 (unwanted-behavior)
GIVEN localStorage is unavailable or contains an unknown category
WHEN Settings connects
THEN the General category SHALL be selected without throwing
VERIFY: storage helper unit tests in src/__tests__/settings_controller.test.ts

### AC-SET-009 (event-driven)
GIVEN Settings has completed its initial data requests
WHEN the user changes categories
THEN category navigation SHALL issue no additional Tauri data request
VERIFY: controller integration test with mocked invoke calls in src/__tests__/settings_controller.test.ts

### AC-SET-010 (ubiquitous)
THEN every pre-existing Settings data-settings-target, control id, and data-action hook SHALL remain present
VERIFY: static markup contract in src/__tests__/notes_visual_system.test.ts plus existing Settings tests

### AC-SET-011 (state-driven)
GIVEN the Calendars & Sync pane is selected
THEN calendar accounts, pending-review operations, and sync controls SHALL appear in that priority order
VERIFY: markup order assertion in src/__tests__/notes_visual_system.test.ts

### AC-SET-012 (event-driven)
GIVEN Google account data has loaded
WHEN dynamic account and calendar controls render
THEN the generated controls SHALL remain contained by the Calendars & Sync pane
VERIFY: jsdom rendering assertion in src/__tests__/settings_controller.test.ts

### AC-SET-013 (state-driven)
GIVEN the Data & Storage pane is selected
THEN technical fields for timezone, calendar ID, and schema version SHALL be inside a collapsed native details disclosure
VERIFY: markup assertion in src/__tests__/notes_visual_system.test.ts

### AC-SET-014 (event-driven)
GIVEN a notification permission action owns focus
WHEN the asynchronous action completes while Notifications remains selected
THEN focus SHALL return to the originating enabled action or the Check Again fallback
VERIFY: existing notification focus tests plus a pane-aware regression in src/__tests__/settings_controller.test.ts

### AC-SET-015 (state-driven)
GIVEN the viewport is 720px wide or narrower
THEN the settings category navigation SHALL become a compact top navigation above the active pane
VERIFY: responsive CSS guard plus browser check at 720x800 and 390x844

### AC-SET-016 (state-driven)
GIVEN accessibility text scale is active
THEN the settings shell SHALL reflow without page-level horizontal overflow
VERIFY: static CSS guard plus browser scroll-width check at 390x844

### AC-SET-017 (ubiquitous)
THEN settings groups SHALL use existing Jin color, spacing, radius, typography, and workspace tokens
VERIFY: npm run lint:css plus static CSS review for newly introduced raw color literals

### AC-SET-018 (state-driven)
GIVEN Settings is shown above 720px at standard text scale
THEN the settings workspace SHALL be the sole vertical scroll host
VERIFY: static CSS guard plus computed-overflow inspection at 1280x800

### AC-SET-019 (state-driven)
GIVEN Settings opens without a saved category
THEN General SHALL be the visible initial pane
VERIFY: jsdom unit test plus browser check at 1280x800

### AC-SET-020 (state-driven)
GIVEN the General pane is the visible initial pane at 1280x800
THEN hidden settings categories SHALL contribute no height to the scrollable document
VERIFY: browser measurement confirming hidden panes have zero layout boxes

### AC-SET-021 (state-driven)
GIVEN Settings is shown above 720px at standard text scale
THEN the settings shell SHALL be bounded to the available route height
VERIFY: static CSS guard plus shell/route bounding-box comparison at 1280x800

### AC-SET-022 (state-driven)
GIVEN Settings is shown above 720px at standard text scale
THEN the settings category rail SHALL stretch to the full settings shell height
VERIFY: computed bounding-box comparison between the rail and shell at 1280x800

### AC-SET-023 (event-driven)
GIVEN the desktop settings workspace has been scrolled
WHEN the user activates another settings category
THEN the settings workspace scrollTop SHALL reset to zero
VERIFY: jsdom controller test plus browser check at 1280x800

### AC-SET-024 (event-driven)
GIVEN keyboard focus is on a settings category button
WHEN that button activates its category
THEN focus SHALL remain on the activating category button
VERIFY: jsdom controller test plus keyboard browser check at 1280x800

### AC-SET-025 (state-driven)
GIVEN Settings is shown at 720px or narrower
THEN vertical scrolling SHALL remain owned by the route document rather than the settings workspace
VERIFY: responsive CSS guard plus computed-overflow inspection at 720x800 and 390x844

### AC-SET-026 (state-driven)
GIVEN accessibility text scale is active
THEN vertical scrolling SHALL remain owned by the route document rather than the settings workspace
VERIFY: accessibility CSS guard plus computed-overflow inspection at 1280x800 and 390x844
