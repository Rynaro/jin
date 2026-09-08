# Today connected agenda acceptance criteria

> **Superseded by** `.spectra/changes/archive/2026-09-07-today-connected-agenda/criteria.md`.
> Retained as the original planning record; do not use this file as the
> implementation contract.

### AC-TODAY-001 (state-driven)
GIVEN an open task has a date-only due value earlier than the current date in the configured display timezone
THEN the current-day agenda SHALL include the task in the attention lane
VERIFY: Rust unit test in jin-core/src/ops/agenda.rs

### AC-TODAY-002 (state-driven)
GIVEN an open task has a datetime due value earlier than the current instant
THEN the current-day agenda SHALL include the task in the attention lane using configured-display-timezone comparison
VERIFY: Rust unit test with a due instant crossing the UTC/display-timezone date boundary

### AC-TODAY-003 (state-driven)
GIVEN an open task is due on the selected date and is not already in attention
THEN the agenda SHALL include the task in the due lane
VERIFY: Rust unit test for date-only and datetime due values

### AC-TODAY-004 (state-driven)
GIVEN a non-current date is selected
THEN the agenda SHALL include only open tasks whose localized due date equals that selected date
VERIFY: Rust unit test covering past and future selected dates

### AC-TODAY-005 (state-driven)
GIVEN the current date is selected and an open task has agenda_bucket flexible
THEN the agenda SHALL include that task in the flexible lane unless a higher-precedence task lane already contains it
VERIFY: Rust unit test for flexible-only and flexible-plus-due tasks

### AC-TODAY-006 (ubiquitous)
THEN completed, cancelled, or deleted tasks SHALL not appear in Today task lanes
VERIFY: Rust unit test over all inactive task states

### AC-TODAY-007 (state-driven)
GIVEN a task is the originating task of an event included in the selected-day agenda
THEN the task SHALL appear only through that event relationship rather than as a standalone Today task
VERIFY: Rust and frontend fixture tests asserting one visible representation

### AC-TODAY-008 (ubiquitous)
THEN one task SHALL occur in at most one standalone Today lane
VERIFY: Rust unit test asserting disjoint task-id sets

### AC-TODAY-009 (state-driven)
GIVEN the selected date is the current date and a valid timed event contains the current instant
THEN focus SHALL identify a deterministic active event with a nonnegative minutes-left value
VERIFY: Rust unit test using agenda_for_date_at with a fixed instant

### AC-TODAY-010 (state-driven)
GIVEN no valid timed event is active and a valid timed event starts later on the current date
THEN focus SHALL identify the earliest upcoming event with a nonnegative starts-in value
VERIFY: Rust unit test using a fixed instant and unsorted input

### AC-TODAY-011 (state-driven)
GIVEN active timed events overlap the current instant
THEN focus SHALL report the number of concurrent events and select one by a documented stable order
VERIFY: Rust unit test for overlapping intervals

### AC-TODAY-012 (unwanted-behavior)
GIVEN an event interval is invalid, unresolved, all-day, cancelled, or belongs to another selected date
WHEN focus is derived
THEN that event SHALL not become the current or upcoming focus
VERIFY: Rust unit tests for each exclusion class

### AC-TODAY-013 (state-driven)
GIVEN a floating event crosses a daylight-saving boundary in the configured display timezone
THEN focus SHALL use the existing explicit DST resolution policy without host-timezone inference
VERIFY: Rust unit test with fixed timezone and transition fixture

### AC-TODAY-014 (state-driven)
GIVEN the selected date is not the current date in the configured display timezone
THEN focus and flexible task lanes SHALL be absent
VERIFY: Rust unit test with fixed current instant

### AC-TODAY-015 (event-driven)
GIVEN Today is showing the current date
WHEN the next minute boundary arrives while the document is visible
THEN Today SHALL refresh its authoritative agenda projection
VERIFY: Vitest fake-timer test in today_controller.test.ts

### AC-TODAY-016 (event-driven)
GIVEN the document becomes hidden and later visible
WHEN Today manages its refresh lifecycle
THEN minute refresh SHALL pause while hidden and resume with an immediate refresh when visible
VERIFY: Vitest lifecycle test in today_controller.test.ts

### AC-TODAY-017 (event-driven)
GIVEN a task mutation succeeds elsewhere in Jin
WHEN jin:tasks-changed reaches Today
THEN Today SHALL reload the displayed projection once
VERIFY: Stimulus integration test in today_controller.test.ts

### AC-TODAY-018 (event-driven)
GIVEN the Today header is rendered
WHEN Capture is activated
THEN the existing Capture controller SHALL open the existing capture dialog
VERIFY: static wiring assertion plus focused browser interaction

### AC-TODAY-019 (state-driven)
GIVEN focus is present
THEN the focus block SHALL render its phase, truthful countdown, title, time range, and overlap cue from the DTO
VERIFY: jsdom render test for active and upcoming focus

### AC-TODAY-020 (ubiquitous)
THEN standalone task lanes SHALL not display invented start times or durations
VERIFY: jsdom negative assertion over attention, due, and flexible fixtures

### AC-TODAY-021 (state-driven)
GIVEN an agenda event originated from a task
THEN its timeline marker and visible type label SHALL distinguish it as a task time block while preserving its event identity
VERIFY: jsdom render test asserting event id, task link, marker class, and type label

### AC-TODAY-022 (event-driven)
GIVEN a user activates an event row or its event-detail control
WHEN Today dispatches navigation
THEN the existing Events detail route SHALL open for that event id
VERIFY: router plus Today Stimulus integration test

### AC-TODAY-023 (event-driven)
GIVEN a user activates an originating-task or prep-note link
WHEN Today dispatches navigation
THEN the existing Tasks or Notes detail route SHALL open for the linked id
VERIFY: existing hero-flow navigation tests extended for the new composition

### AC-TODAY-024 (state-driven)
GIVEN events carry originating-task or prep-note relationships
THEN Connected work SHALL render only those real relationships grouped by their event
VERIFY: jsdom render test for populated and unrelated events

### AC-TODAY-025 (state-driven)
GIVEN no agenda event carries a task or prep-note relationship
THEN Connected work SHALL present a restrained truthful empty state
VERIFY: jsdom render test for relationship-empty agenda

### AC-TODAY-026 (state-driven)
GIVEN no future timed event remains while task lanes still contain work
THEN Today SHALL describe the schedule as clear without describing the whole day as complete
VERIFY: jsdom copy assertion with tasks-only fixture

### AC-TODAY-027 (ubiquitous)
THEN the Today surface SHALL retain real headings, lists, buttons, links, live status, accessible names, and visible focus behavior
VERIFY: static markup assertions, axe browser scan, and keyboard walkthrough

### AC-TODAY-028 (state-driven)
GIVEN the viewport is 900 CSS pixels or wider at standard text scale
THEN Today SHALL present the editorial agenda and Connected work as continuous paper fields with a readable right context rail
VERIFY: Playwright geometry and screenshot evidence at 1440x900

### AC-TODAY-029 (state-driven)
GIVEN the viewport is 390 CSS pixels or narrower
THEN Today SHALL stack header actions, agenda, task lanes, and Connected work without document-level horizontal overflow
VERIFY: Playwright checks at 390x844 and 320x700

### AC-TODAY-030 (state-driven)
GIVEN accessibility text scale is active
THEN Today SHALL reflow intrinsically without fixed-height clipping or document-level horizontal overflow
VERIFY: Playwright checks at 390x844 and 1280x800 with accessibility scale

### AC-TODAY-031 (state-driven)
GIVEN dark appearance, increased contrast, forced colors, reduced transparency, reduced motion, or coarse pointer input is active
THEN Today SHALL preserve legibility, non-color state cues, motion preferences, and usable interactive targets
VERIFY: focused CSS assertions plus Playwright preference matrix

### AC-TODAY-032 (ubiquitous)
THEN existing AgendaDto event fields and today_agenda command arguments SHALL remain backward compatible
VERIFY: DTO shape tests, bridge tests, and cargo test --workspace

### AC-TODAY-033 (ubiquitous)
THEN the implementation SHALL introduce no new runtime dependency and no raw color literal outside tokens.css
VERIFY: package manifest diff plus npm run lint:css

### AC-TODAY-034 (ubiquitous)
THEN the focused frontend tests, full frontend suite, CSS lint, production build, Rust workspace tests, and git diff check SHALL pass
VERIFY: make verify-gui plus git diff --check
