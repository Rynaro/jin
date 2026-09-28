---
artifact: acceptance-criteria
version: 0.1.0
plan: calendar-experience
status: frozen-after-independent-critique
---

# Calendar experience acceptance criteria

## Acceptance Criteria

### AC-CALX-001 (state-driven)
GIVEN Calendar's outer workspace content box is at least 920 CSS pixels at normal text scale
WHEN an event or draft is active
THEN the Event Companion SHALL render as a 360 CSS pixel non-modal right rail beside a grid at least 559 CSS pixels wide
VERIFY: Playwright geometry test: calendar_companion.wide_rail

### AC-CALX-002 (state-driven)
GIVEN Calendar's outer workspace content box is below 920 CSS pixels or accessibility text scale is active
WHEN an event or draft is active
THEN the Event Companion SHALL render through `JinModal` with the background inert
VERIFY: Playwright test: calendar_companion.compact_modal

### AC-CALX-003 (state-driven)
GIVEN the wide Event Companion is open
WHEN keyboard focus moves between companion and calendar controls
THEN the host SHALL remain non-modal without trapping focus or setting `aria-modal`
VERIFY: Playwright keyboard test: calendar_companion.wide_focus

### AC-CALX-004 (event-driven)
GIVEN an event control is visible in Month, Week, or Day
WHEN the user activates it
THEN Jin SHALL open shared Preview while preserving the current range and scroll position
VERIFY: test: calendar_view_controller event_activation_preserves_context

### AC-CALX-005 (event-driven)
GIVEN shared Preview is open for an editable event
WHEN the user activates Edit
THEN the same Event Companion host SHALL transition to shared Composer mode
VERIFY: test: event_companion preview_to_edit_same_host

### AC-CALX-006 (event-driven)
GIVEN shared Composer saved an existing event successfully
WHEN canonical detail refresh completes
THEN the same host SHALL return to updated Preview
VERIFY: test: event_companion edit_save_returns_preview

### AC-CALX-007 (event-driven)
GIVEN shared Preview is open
WHEN the user activates Open full details
THEN Jin SHALL navigate to the existing full event detail with prep, related context, and sync diagnostics intact
VERIFY: test: event_companion full_detail_escape

### AC-CALX-008 (event-driven)
GIVEN the Day or Week temporal cursor targets empty time
WHEN the user presses Enter or clicks the slot
THEN Composer SHALL open a 60-minute timed draft snapped to 15 minutes
VERIFY: test: calendar_interaction default_slot_draft

### AC-CALX-009 (event-driven)
GIVEN a fine pointer starts on empty Day or Week time
WHEN the user drags across a valid range and releases
THEN Composer SHALL open an unsaved range draft with a minimum duration of 15 minutes
VERIFY: Playwright pointer test: calendar_interaction range_drag_draft

### AC-CALX-010 (unwanted-behavior)
GIVEN a pointer selection or event manipulation is active
WHEN pointer capture is cancelled or Escape is pressed before Save
THEN the calendar SHALL restore the original persisted geometry without mutation
VERIFY: Playwright pointer-cancel test: calendar_interaction abort_restores

### AC-CALX-011 (event-driven)
GIVEN a Month date number has focus
WHEN the user activates the date number
THEN Calendar SHALL open Day for that date
VERIFY: test: calendar_view_controller month_date_opens_day

### AC-CALX-012 (event-driven)
GIVEN unused space in a Month cell is activated
WHEN the user clicks, taps, or activates Add on date
THEN Composer SHALL open a one-day all-day draft for that date
VERIFY: test: calendar_interaction month_cell_all_day_create

### AC-CALX-013 (event-driven)
GIVEN a fine pointer starts on unused Month cell space
WHEN the user drags across multiple dates
THEN Composer SHALL represent the selected dates as one inclusive all-day range
VERIFY: Playwright pointer test: calendar_interaction month_range_create

### AC-CALX-014 (state-driven)
GIVEN a Month cell is focus-visible or the device uses a coarse pointer
WHEN Calendar renders its date actions
THEN an Add on localized date control SHALL be operable without dragging
VERIFY: Playwright accessibility test: calendar_month add_pointer_alternative

### AC-CALX-015 (state-driven)
GIVEN an event detail capability request is unresolved or obsolete
WHEN the event is selected
THEN Calendar SHALL withhold move and resize affordances
VERIFY: test: calendar_interaction capability_before_handles

### AC-CALX-016 (event-driven)
GIVEN a later event selection supersedes an earlier detail request
WHEN the earlier response arrives
THEN the obsolete response SHALL leave the current Preview and actions unchanged
VERIFY: test: event_companion stale_detail_response_ignored

### AC-CALX-017 (state-driven)
GIVEN current `detail.capabilities.collaboration.can_edit_schedule` is false
WHEN Preview renders
THEN Calendar SHALL omit temporal move and resize affordances while retaining valid Preview actions
VERIFY: test: event_companion readonly_temporal_actions

### AC-CALX-018 (event-driven)
GIVEN an editable timed event is moved on the display-timezone grid
WHEN its draft geometry is computed
THEN the draft SHALL preserve the event's elapsed duration in minutes
VERIFY: test: calendar_interaction move_preserves_elapsed_duration

### AC-CALX-019 (event-driven)
GIVEN an editable timed event is resized
WHEN its end crosses midnight
THEN Composer SHALL show the resulting end date explicitly
VERIFY: test: calendar_interaction resize_cross_midnight

### AC-CALX-020 (event-driven)
GIVEN an editable event has keyboard focus
WHEN Alt+Arrow or Alt+Shift+Up/Down changes its temporal draft
THEN Calendar SHALL apply the same snap and validation model used by pointer manipulation
VERIFY: test: calendar_interaction keyboard_move_resize_parity

### AC-CALX-021 (ubiquitous)
GIVEN direct manipulation is implemented
WHEN a user opens Edit → When
THEN date and time fields SHALL provide a single-pointer alternative for every drag outcome
VERIFY: WCAG 2.5.7 interaction audit plus Playwright form-equivalence test

### AC-CALX-022 (event-driven)
GIVEN a timed move targets a spring-forward date
WHEN grid slots are generated
THEN the grid SHALL expose no selectable slot for a nonexistent local instant
VERIFY: test: calendar_time_grid spring_gap_slots

### AC-CALX-023 (event-driven)
GIVEN a timed view includes a fall-back ambiguous wall hour
WHEN hour slots render
THEN the ambiguous slot SHALL identify core's earlier occurrence while offering no later-occurrence creation target
VERIFY: test: calendar_time_grid fallback_earlier_only

### AC-CALX-024 (event-driven)
GIVEN an all-day draft spans user-selected dates
WHEN input is serialized
THEN canonical end SHALL equal the day after the final inclusive UI date
VERIFY: test: event_draft all_day_exclusive_end

### AC-CALX-025 (ubiquitous)
GIVEN Create or Edit Composer renders
WHEN any optional section is collapsed
THEN calendar identity and start/end/timezone summary SHALL remain visible
VERIFY: test: event_composer persistent_summary

### AC-CALX-026 (event-driven)
GIVEN a collapsed Composer section contains values
WHEN the section closes and reopens
THEN every value SHALL remain unchanged
VERIFY: test: event_composer disclosure_preserves_values

### AC-CALX-027 (ubiquitous)
GIVEN Calendar, Today, Capture, or full detail submits an event draft
WHEN its payload is built
THEN the payload SHALL originate from the shared EventDraft serializer
VERIFY: static ownership test plus controller submit fixture equivalence

### AC-CALX-028 (event-driven)
GIVEN Capture contains an event draft
WHEN the user opens More event options
THEN shared Composer SHALL receive the same title, timing, location, and destination values
VERIFY: test: capture_controller event_draft_handoff

### AC-CALX-029 (event-driven)
GIVEN the nested temporal picker closes within a parent event draft
WHEN focus restoration runs
THEN focus SHALL return to the temporal-picker invoker without dismissing the parent draft
VERIFY: Playwright nested-focus test: event_composer temporal_picker_return

### AC-CALX-030 (state-driven)
GIVEN an event has multiple supported recurrence scopes
WHEN Composer enters Edit
THEN Save SHALL remain disabled until one returned scope is selected
VERIFY: test: event_composer recurrence_scope_required

### AC-CALX-031 (state-driven)
GIVEN `this_occurrence` is selected
WHEN recurrence controls render
THEN Composer SHALL keep the master recurrence pattern unavailable
VERIFY: test: event_composer occurrence_rule_immutable

### AC-CALX-032 (state-driven)
GIVEN `entire_series` is selected and recurrence pattern support is true
WHEN recurrence controls render
THEN Composer SHALL expose the normalized series-pattern editor
VERIFY: test: event_composer series_rule_editor

### AC-CALX-033 (ubiquitous)
GIVEN recurrence actions render in any surface
WHEN available scopes are inspected
THEN `this_and_following` SHALL never appear
VERIFY: static and behavior tests across Calendar, Event detail, Today, Notifications

### AC-CALX-034 (event-driven)
GIVEN recurring drag or resize produces a geometric draft
WHEN the pointer or keyboard action ends
THEN Calendar SHALL require supported scope selection before Save rather than committing the mutation
VERIFY: test: calendar_interaction recurring_direct_edit_scope

### AC-CALX-035 (event-driven)
GIVEN resolvable local start/end values and IANA zones
WHEN temporal preview runs
THEN the core/Tauri/TypeScript boundaries SHALL preserve exact resolution kind, resolved instants, display values, and elapsed minutes
VERIFY: Rust serialization fixture equals TypeScript temporal-preview fixture

### AC-CALX-036 (state-driven)
GIVEN temporal preview reports `ambiguous_earlier`
WHEN Composer renders the time summary
THEN it SHALL identify the earlier offset selected by core before Save
VERIFY: test: event_composer ambiguous_dst_copy

### AC-CALX-037 (state-driven)
GIVEN temporal preview reports `nonexistent_shifted_forward`
WHEN Composer renders the time summary
THEN it SHALL show the adjusted local time before Save
VERIFY: test: event_composer nonexistent_dst_copy

### AC-CALX-038 (unwanted-behavior)
GIVEN a timezone is invalid, a local time has an unresolvable non-standard gap, or elapsed duration is not positive
WHEN draft validation completes
THEN Composer SHALL block Save with field-associated feedback
VERIFY: test: event_draft temporal_validation

### AC-CALX-039 (event-driven)
GIVEN the user changes an event timezone
WHEN temporal preview recomputes
THEN the entered local clock values SHALL remain unchanged
VERIFY: test: event_draft timezone_change_wall_time

### AC-CALX-040 (ubiquitous)
GIVEN an event renders in Calendar, Preview, Composer, full detail, notification context, or search
WHEN its visible identity is computed
THEN calendar assignment SHALL determine its label and color while provenance remains secondary
VERIFY: shared calendar identity fixture across all renderers

### AC-CALX-041 (event-driven)
GIVEN a Calendar visibility checkbox changes
WHEN the route refreshes its visible events
THEN the change SHALL affect only GUI filtering without mutating provider sync enablement
VERIFY: test: calendar_filter no_bridge_or_settings_mutation

### AC-CALX-042 (state-driven)
GIVEN every calendar is hidden by the route filter
WHEN the calendar field renders
THEN it SHALL explain the filter state with a Reset filter action
VERIFY: test: calendar_filter all_hidden_empty_state

### AC-CALX-043 (event-driven)
GIVEN an unsaved draft contains edits
WHEN close, back, or Escape is requested
THEN the Event Companion SHALL present an inline Keep editing or Discard decision
VERIFY: test: event_companion dirty_dismiss_guard

### AC-CALX-044 (state-driven)
GIVEN a durable mutation command is unresolved
WHEN close, backdrop, Escape, or Cancel is attempted
THEN the Event Companion SHALL prevent a cancellation claim while preserving one announced pending state
VERIFY: Playwright test: event_companion persistence_lock

### AC-CALX-045 (event-driven)
GIVEN a routed mutation is durably saved but provider confirmation is pending
WHEN the user closes the companion
THEN the existing outbox operation SHALL continue without duplicate submission
VERIFY: integration test: event_companion close_during_sync

### AC-CALX-046 (state-driven)
GIVEN provider sync is pending, confirmed, paused, reauth-required, or stale
WHEN operation status renders
THEN copy SHALL distinguish durable local state from provider operation state without claiming email delivery
VERIFY: status-copy fixture and forbidden-claim static test

### AC-CALX-047 (event-driven)
GIVEN an account reconnects after an operation was paused for review
WHEN Google state refreshes
THEN Jin SHALL not auto-resubmit the paused operation
VERIFY: retained sync recovery test: reconnect_requires_review

### AC-CALX-048 (event-driven)
GIVEN Today opens an event
WHEN Preview or Composer mutates that event
THEN Today SHALL retain its projection lanes and refresh through the existing event-mutation signal
VERIFY: test: today_controller shared_event_companion

### AC-CALX-049 (ubiquitous)
GIVEN the Calendar experience renders at maintained widths and accessibility preferences
WHEN geometry, focus, color independence, contrast, motion, transparency, forced colors, and coarse pointer are exercised
THEN the document SHALL have no horizontal overflow or unreachable operation control
VERIFY: Playwright evidence matrix at 320, 390, 760, 1440 plus accessibility text scale

### AC-CALX-050 (event-driven)
GIVEN implementation has passed automated and native/provider gates and five defined participants each perform the five representative tasks
WHEN the moderated sessions are complete
THEN every participant SHALL complete at least four tasks, at least 22 of 25 attempts SHALL succeed overall, at least four participants SHALL reach task 1's durable submitted state within 30 seconds excluding provider confirmation, and no P0 misunderstanding SHALL occur
VERIFY: participant profiles, raw timings, task outcomes, error log, and owner rollout record defined in implementation Stage 10

### AC-CALX-051 (event-driven)
GIVEN Month, Week, or Day requests a date range
WHEN core builds `CalendarRangeProjectionDto`
THEN every anchored event SHALL be projected into `config.display_tz` using independent start and end zones
VERIFY: Rust tests: calendar_projection cross_zone_display_geometry

### AC-CALX-052 (event-driven)
GIVEN an open companion crosses the 920 CSS pixel workspace seam because the sidebar or window changes
WHEN the host migrates between rail and modal
THEN it SHALL preserve companion mode, draft, range, scroll, and logical focus without repeated host flipping
VERIFY: Playwright resize test with sidebar expanded and collapsed

### AC-CALX-053 (event-driven)
GIVEN a dirty companion is open
WHEN sidebar or direct app navigation requests another route
THEN Router navigation SHALL pause until the companion's inline Keep editing or Discard decision resolves
VERIFY: test: router_controller dirty_companion_guard_without_history

### AC-CALX-054 (event-driven)
GIVEN an existing event has distinct start and end IANA zones
WHEN the user saves a title-only edit through the sparse command
THEN the client SHALL omit the atomic temporal bundle, core SHALL merge under the supplied current edit token while preserving both endpoints and zones, a partial temporal bundle SHALL be rejected, and a stale token SHALL write nothing
VERIFY: Rust/Tauri/TypeScript fixtures: cross_zone_title_only_edit, partial_temporal_bundle_rejected, stale_sparse_edit_no_write

### AC-CALX-055 (state-driven)
GIVEN an existing ambiguous wall-time event cannot prove temporal round-trip identity
WHEN capabilities for the calendar projection render
THEN temporal editing SHALL be unavailable with a stable reason while other permitted sparse edits remain available
VERIFY: test: calendar_projection ambiguous_existing_event_safe_editing

### AC-CALX-056 (unwanted-behavior)
GIVEN local time falls in a non-standard gap that remains unresolved after core policy
WHEN temporal preview or calendar projection runs
THEN core SHALL return typed `unresolvable_local_time` without producing a schedulable draft
VERIFY: Rust tests: time nonstandard_gap_error and calendar_projection gap_error

### AC-CALX-057 (event-driven)
GIVEN Notification Center submits or changes an RSVP
WHEN the response is persisted
THEN the existing invitation ledger SHALL remain the sole operation owner rather than EventDraft
VERIFY: retained notification RSVP single-attempt integration tests

### AC-CALX-058 (ubiquitous)
GIVEN Calendar, Today, Capture, and full detail expose create or edit
WHEN cross-entry contract tests compare equivalent fields
THEN destination, scope, validation, and serialized mutation meaning SHALL match through shared adapters
VERIFY: cross-entry EventDraft fixture suite

### AC-CALX-059 (state-driven)
GIVEN Calendar Day renders due tasks after the time-grid scroller
WHEN the shared calendar experience is enabled
THEN the existing unscheduled appendage, scroll order, and Promote to event behavior SHALL remain intact
VERIFY: retained calendar_view_controller due-task appendage tests

### AC-CALX-060 (event-driven)
GIVEN provider retry, reauth, or review refreshes an open event
WHEN canonical detail changes
THEN the companion SHALL retain range and logical focus while preventing duplicate submit
VERIFY: integration test: event_companion provider_recovery_context

### AC-CALX-061 (ubiquitous)
GIVEN a future calendar feature adds a field, action, capability, or state
WHEN its design and tests are reviewed
THEN it SHALL declare shared section placement, summary copy, mode/capability/state matrix, owner, duplicate-removal list, and cross-entry regression coverage
VERIFY: static planning checklist plus visual-language dossier link after accepted implementation
