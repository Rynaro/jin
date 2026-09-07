# Unified Calendar and Reminder Time Input

## Outcome

Jin SHALL provide one keyboard-friendly time-entry grammar across the scoped Calendar event and task reminder/due-date surfaces. The browser-native segmented time control is removed so entering an hour never silently changes its value and users do not have to transition between hour and minute segments. Task reminders SHALL reuse the Calendar month grid and natural-date language already used by Calendar events.

## Scope and boundaries

### In scope

- Task reminder/due-date editor opened from task detail and task quick capture.
- Calendar event creation and Calendar event detail editing.
- The existing single-date/range `CalendarController`, natural-date parser/formatter/error messages, and a pure shared clock normalizer.
- English and Portuguese (Brazil) validation and natural-date feedback.

### Out of scope

- Global quick-capture Event `datetime-local` start/end controls.
- Promote-to-Event `datetime-local` control.
- Reminder offset rules, recurrence behavior, timezone semantics, persisted schemas, DTOs, Rust/Tauri commands, and calendar-grid redesign.

## Functional requirements

### R1 — Shared clock grammar

WHEN a scoped non-all-day time field is blurred or submitted, Jin SHALL trim the input and normalize these forms to `HH:mm`:

| Input form | Rule | Examples |
|---|---|---|
| 1–2 digits | hour, minute `00` | `9` → `09:00`; `16` → `16:00` |
| 3–4 digits | final two digits are minutes | `930` → `09:30`; `1600` → `16:00` |
| `H:MM` or `HH:MM` | explicit hour and two-digit minute | `9:30` → `09:30`; `16:20` → `16:20` |

Jin SHALL reject hours greater than 23, minutes greater than 59, negative values, letters, and any other shape, including one-digit colon minutes such as `16:2`. Jin SHALL NOT alter the field while the user is still typing. Empty input SHALL mean “no optional time” only for a task due date; timed Calendar events require both clocks.

GIVEN `16`, `1600`, or `16:20` in a scoped field, WHEN the value is committed, THEN Jin persists or composes `16:00`, `16:00`, or `16:20` respectively and never produces `06:00`.

GIVEN an invalid clock, WHEN the user submits, THEN Jin SHALL keep the editor open, preserve the invalid text for correction, expose localized validation, and perform no mutation. Event end-after-start validation SHALL run on normalized clocks.

### R2 — Single text-entry experience

The scoped clock controls SHALL be `type="text"` with numeric input hints, autocomplete disabled, and an `HH:mm` example. They SHALL NOT use the browser-native segmented `type="time"` experience. Valid values MAY normalize on blur; submission SHALL always normalize before comparison or composition.

### R3 — Reminder natural date and time

The task reminder/due editor SHALL expose a natural-date text field, live preview, and **Use** action matching Calendar events.

GIVEN natural text is edited, WHEN it parses successfully, THEN the preview SHALL show the existing locale-aware formatted result without changing the draft. WHEN parsing fails, THEN localized guidance SHALL be shown and the last valid draft SHALL remain unchanged.

GIVEN a valid natural result, WHEN the user activates **Use** or presses Enter, THEN Jin SHALL apply the date to the visible single-date calendar selection. A date-only result SHALL preserve the current optional time; a result containing time SHALL replace it with canonical `HH:mm`. Persistence SHALL still require the existing **Set Date** confirmation.

GIVEN the user clears, cancels, presses Escape, or closes the editor, THEN existing explicit commit, clear, focus-restoration, and mutation-free cancel behavior SHALL remain unchanged.

### R4 — Shared component boundary

`CalendarController` SHALL remain the sole reusable month-grid controller: task reminders use single-date mode and Calendar events use range mode. Domain controllers SHALL continue to own their drafts and persistence.

Clock parsing SHALL be implemented once as a pure helper under `src/lib/calendar/`. Natural-date parsing, formatting, and error mapping SHALL be shared from `src/lib/calendar/natural_language.ts`. No second calendar grid, task-specific natural parser, or duplicate event clock validator SHALL be introduced.

## Acceptance checks

| ID | Acceptance check | Verify method |
|---|---|---|
| AC-UCRT-001 | The pure clock helper normalizes `16`, `1600`, and `16:20` to `16:00`, `16:00`, and `16:20`, plus the documented shorthand forms. | `npm --prefix jin-gui test -- calendar_clock.test.ts` |
| AC-UCRT-002 | Overflow, malformed, signed, alphabetic, and one-digit-colon-minute clocks fail closed; empty remains distinguishable for optional task time. | `npm --prefix jin-gui test -- calendar_clock.test.ts` |
| AC-UCRT-003 | The task due editor uses a text clock, normalizes on blur/confirm, blocks invalid commits, and preserves date-only, clear, cancel, Escape, and focus behavior. | `npm --prefix jin-gui test -- temporal_editor_controller.test.ts tasks_lists_modal_wiring.test.ts` |
| AC-UCRT-004 | Natural reminder input previews without mutation; Use/Enter applies valid date/date-time through the single-date calendar; invalid input cannot replace the last valid draft; Set Date remains the persistence boundary. | `npm --prefix jin-gui test -- temporal_editor_controller.test.ts tasks_lists_modal_wiring.test.ts` |
| AC-UCRT-005 | Calendar create and detail edit use the shared clock helper, normalize shorthand before save, require clocks for timed events, and retain chronological validation. | `npm --prefix jin-gui test -- calendar_view_controller.test.ts event_edit.test.ts` |
| AC-UCRT-006 | Calendar and reminders consume the existing `CalendarController` and shared natural parser/error formatter; no task-specific grid/parser or duplicate clock validator exists. | Code review of `temporal_editor_controller.ts`, `calendar_view_controller.ts`, `lib/events/edit.ts`, `lib/calendar/clock.ts`, and `lib/calendar/natural_language.ts`; `npm --prefix jin-gui run build` |
| AC-UCRT-007 | The complete frontend suite, TypeScript build, and CSS policy remain green. | `npm --prefix jin-gui test`; `npm --prefix jin-gui run build`; `npm --prefix jin-gui run lint:css` |
| AC-UCRT-008 | At 1280×800, task due and Calendar event flows are keyboard-operable, visibly retain focus/feedback, do not clip, and emit no browser console errors. | Repository Playwright MCP evidence per `.agents/skills/jin-gui-visual-qa/SKILL.md`; retain `LOGIC VERIFIED — VISUALS NOT VERIFIED` until owner sign-off |
| AC-UCRT-009 | Global quick-capture Event and Promote-to-Event `datetime-local` controls remain unchanged. | DOM/code review of `jin-gui/index.html` plus focused existing capture/actions regression tests |
