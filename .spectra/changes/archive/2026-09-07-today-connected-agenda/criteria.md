# Acceptance criteria

### AC-TODAY-001 (state-driven)
GIVEN an open task is overdue under date-only or datetime semantics in the configured display timezone
THEN the current-day projection SHALL place it in attention
VERIFY: fixed-clock Rust tests crossing UTC and display-timezone date boundaries

### AC-TODAY-002 (state-driven)
GIVEN an open task due value localizes to the selected date and it is not in attention
THEN the projection SHALL place it in due work
VERIFY: Rust tests for date-only and RFC 3339 due values on current, past, and future selected dates

### AC-TODAY-003 (state-driven)
GIVEN the selected date is the authoritative current date and an open task is explicitly flexible
THEN the projection SHALL place it in flexible work unless a higher-precedence lane contains it
VERIFY: Rust tests for flexible-only and flexible-plus-due tasks

### AC-TODAY-004 (ubiquitous)
THEN completed, cancelled, deleted, or invalid-due tasks SHALL not enter a Today task lane through due evaluation
VERIFY: Rust eligibility tests over every excluded state and invalid due value

### AC-TODAY-005 (state-driven)
GIVEN a task is an originating task represented by an event in the selected agenda
THEN the projection SHALL exclude it from standalone task lanes
VERIFY: core and frontend tests asserting one visible representation for the task id

### AC-TODAY-006 (ubiquitous)
THEN standalone Today task lane id sets SHALL be pairwise disjoint
VERIFY: Rust precedence test over attention, due, and flexible eligibility

### AC-TODAY-007 (state-driven)
GIVEN the selected date differs from the authoritative current date
THEN attention, flexible work, active focus, and next focus SHALL be absent
VERIFY: fixed-clock Rust tests for past and future dates

### AC-TODAY-008 (state-driven)
GIVEN multiple valid timed events contain the current instant
THEN active focus SHALL include every concurrent event in stable start/end/id order
VERIFY: fixed-clock Rust overlap test plus DOM assertion that every focus event remains directly accessible

### AC-TODAY-009 (state-driven)
GIVEN a valid timed event starts later on the current date
THEN next focus SHALL identify the earliest resolved future event
VERIFY: fixed-clock Rust test with unsorted anchored and floating fixtures

### AC-TODAY-010 (unwanted-behavior)
GIVEN an interval is invalid, unresolved, all-day, cancelled, or outside the selected date
WHEN focus is derived
THEN that interval SHALL not appear in active or next focus
VERIFY: Rust exclusion tests

### AC-TODAY-011 (state-driven)
GIVEN a floating or anchored event crosses a timezone or daylight-saving boundary
THEN core focus SHALL resolve it through Jin's explicit timezone policy before instant comparison
VERIFY: fixed-clock Rust tests for offset crossing, DST overlap, and DST gap

### AC-TODAY-012 (ubiquitous)
THEN focus minute values SHALL be nonnegative and derived from core-resolved instants
VERIFY: Rust boundary tests at before, exact, within, and after interval times

### AC-TODAY-013 (event-driven)
GIVEN Today displays the authoritative current date
WHEN a minute boundary arrives while the document is visible
THEN Today SHALL reload one authoritative projection
VERIFY: fake-timer controller test

### AC-TODAY-014 (event-driven)
GIVEN Today is connected
WHEN document visibility changes
THEN refresh timing SHALL pause while hidden and refresh immediately when visible
VERIFY: controller lifecycle test including disconnect cleanup

### AC-TODAY-015 (event-driven)
GIVEN two projection requests resolve out of order
WHEN the active selected date has changed
THEN the older response SHALL not overwrite the newer date's content
VERIFY: deferred-promise controller race test

### AC-TODAY-016 (event-driven)
GIVEN a task or event mutation succeeds elsewhere in Jin
WHEN its existing mutation signal reaches Today
THEN Today SHALL refresh through the same projection path
VERIFY: Stimulus integration tests for jin:tasks-changed and event refresh

### AC-TODAY-017 (event-driven)
GIVEN the Today header is visible
WHEN Capture is activated
THEN the existing Capture dialog SHALL open
VERIFY: static wiring assertion and browser interaction

### AC-TODAY-018 (state-driven)
GIVEN active or next focus exists
THEN the focus region SHALL show real phase, event title, time range, minute value, and concurrent state from the projection
VERIFY: DOM tests for one active, concurrent active, next-only, and focus-empty fixtures

### AC-TODAY-019 (ubiquitous)
THEN standalone task rows SHALL not display invented start times, end times, or durations
VERIFY: DOM negative assertions over attention, due, and flexible fixtures

### AC-TODAY-020 (state-driven)
GIVEN an event has an originating task
THEN its timeline row SHALL expose a square marker and Task time block label while retaining event identity
VERIFY: DOM test for marker, visible type, data-event-id, event navigation, and task link

### AC-TODAY-021 (event-driven)
GIVEN a user activates an event, task, or prep-note control
WHEN Today dispatches navigation
THEN Jin SHALL open the corresponding existing Events, Tasks, or Notes detail route
VERIFY: Today and router integration tests including nested-link isolation

### AC-TODAY-022 (state-driven)
GIVEN agenda events carry originating-task or prep-note relationships
THEN Connected work SHALL deduplicate those real linked task/note entities by kind and id while retaining their associated agenda event ids
VERIFY: DOM tests for task-only, notes-only, combined, and unrelated events

### AC-TODAY-023 (state-driven)
GIVEN no agenda event carries a task or prep-note relationship
THEN Connected work SHALL be hidden
VERIFY: DOM test for relationship-empty projection

### AC-TODAY-024 (state-driven)
GIVEN no future timed event remains while standalone task work remains
THEN Today SHALL describe only the schedule as clear
VERIFY: DOM copy assertion with a tasks-only fixture

### AC-TODAY-025 (ubiquitous)
THEN Today SHALL preserve real headings, lists, buttons, links, live status, accessible names, keyboard focus, event metadata, and source labels
VERIFY: static/DOM assertions, keyboard browser walkthrough, and automated accessibility scan

### AC-TODAY-026 (state-driven)
GIVEN standard desktop width
THEN Today SHALL present a dominant continuous agenda field and readable Connected work rail without generic content cards
VERIFY: Playwright geometry and screenshot review at 1440x900

### AC-TODAY-027 (state-driven)
GIVEN a viewport of 390 CSS pixels or less
THEN Today SHALL stack header, agenda, task lanes, and Connected work without document-level horizontal overflow
VERIFY: Playwright checks at 390x844 and 320x700

### AC-TODAY-028 (state-driven)
GIVEN accessibility text scale is active
THEN Today SHALL reflow intrinsically without fixed-height clipping or document-level horizontal overflow
VERIFY: Playwright checks at 390x844 and 1280x800 with accessibility text scale

### AC-TODAY-029 (state-driven)
GIVEN dark appearance, increased contrast, forced colors, reduced transparency, reduced motion, or coarse pointer input is active
THEN Today SHALL retain legibility, non-color cues, preference behavior, and usable targets
VERIFY: focused CSS assertions and Playwright preference matrix

### AC-TODAY-030 (ubiquitous)
THEN existing AgendaDto fields and today_agenda command behavior SHALL remain compatible
VERIFY: Rust bridge tests, TypeScript DTO tests, and existing Today tests

### AC-TODAY-031 (ubiquitous)
THEN the implementation SHALL add no runtime dependency, persistence field, schema migration, or raw component color literal
VERIFY: manifest/schema diff inspection and CSS lint

### AC-TODAY-032 (ubiquitous)
THEN focused tests, full frontend tests, Rust workspace tests, CSS lint, production build, repository verification, and diff checks SHALL pass
VERIFY: recorded command outputs indexed to this criterion
