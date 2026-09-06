# Jin Whole-App Visual Overhaul — EARS Criteria

### AC-001 (event-driven)
GIVEN the Events route in Month, Week, or Day view
WHEN  the workspace renders
THEN  the route presents an editorial header and warm calendar field with distinguishable date, current view, navigation, Today, and Add Event actions without a heavy gray segmented strip
VERIFY: Playwright Events screenshot and accessibility snapshot set

### AC-002 (event-driven)
GIVEN dense, overlapping, all-day, selected, today, or current-time calendar content
WHEN  a user navigates or activates the content
THEN  existing calendar geometry, source meaning, callbacks, accessible names, and content reachability remain intact
VERIFY: calendar controller and time-grid Vitest suites plus Playwright interaction

### AC-003 (event-driven)
GIVEN a local, Google, recurring, read-only, or task-derived event
WHEN  a user inspects, creates, edits, saves, cancels, deletes, or resolves a conflict
THEN  real capabilities, fields, validation, recurrence scope, payloads, focus, context, return position, and errors remain truthful in an unboxed editorial surface
VERIFY: event render, edit, locale, and controller Vitest suites plus Playwright detail/create flows

### AC-004 (event-driven)
GIVEN active or historical notification content
WHEN  a user filters, selects, responds, retries, defers, dismisses, marks read, or chooses recurrence scope
THEN  provider truth, state labels, disabled reasons, listbox focus, live announcements, and actions remain intact in a calm open triage view
VERIFY: notification render, controller, and accessibility Vitest suites plus Playwright

### AC-005 (state-driven)
GIVEN any Settings pane and operational state
WHEN  the pane renders or changes
THEN  every existing value and control remains readable and functional in an open settings document with truthful status and error text
VERIFY: settings controller and notification settings Vitest suites plus Playwright pane matrix

### AC-006 (event-driven)
GIVEN an existing dialog, Capture flow, form, search, filter, select, tag input, color picker, or destructive confirmation
WHEN  it is used by keyboard or pointer
THEN  shared Jin styling preserves labels, focus lifecycle, validation, pending state, Escape, submit, cancel, callback, and payload behavior
VERIFY: modal, capture, actions, and select Vitest suites plus representative Playwright flows

### AC-007 (state-driven)
GIVEN a loading, empty, not-found, offline, conflict, disabled, queued, success, warning, or failure state
WHEN  any route exposes the state
THEN  its meaning is explicit in text, perceivable without color, correctly announced, and does not fabricate progress or success
VERIFY: route state fixtures, accessibility snapshots, and source assertions

### AC-008 (event-driven)
GIVEN all six application routes
WHEN  a user navigates among them
THEN  material, typography, color roles, rules, controls, badges, dialogs, and density read as one Jin system while accepted Today, Tasks, and Notes layouts remain stable
VERIFY: complete route screenshot set and existing regression suites

### AC-009 (state-driven)
GIVEN a 320, 390, 760, or 1440 CSS px viewport or the AX5 310 percent text setting
WHEN  every route and a representative dialog are exercised
THEN  content and actions remain readable and reachable without document horizontal overflow or clipped meaning
VERIFY: deterministic Playwright viewport and overflow matrix

### AC-010 (state-driven)
GIVEN light, dark, automatic, reduced-motion, reduced-transparency, increased-contrast, or forced-color presentation
WHEN  the interface renders
THEN  explicit preferences win and hierarchy, focus, boundaries, state, and meaning remain perceivable
VERIFY: token and source tests plus Playwright appearance matrix

### AC-011 (ubiquitous)
GIVEN the completed implementation diff
THEN  no excluded system contract, dependency, API, product feature, intentionally hidden Events list, or production sample data has changed
VERIFY: independent checker diff review and full regression gate

### AC-012 (event-driven)
GIVEN a stable integrated implementation
WHEN  final verification runs
THEN  focused suites, make verify-gui, browser route and accessibility evidence, and the native Tauri build boundary are recorded
VERIFY: command logs, Playwright evidence directory, and independent checker verdict
