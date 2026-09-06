# Jin Mobile Calendar — Compact Month Reference

## Objective

Refine the Events Month view at small-screen widths using the attached Apple mobile calendar as compositional inspiration: a compact month/year header, seven equal date columns, horizontal week rules, circular date emphasis, and small multicolor event indicators. The result must still feel distinctly Jin through warm paper, black ink, indigo interaction, vermilion today, and the application's existing source colors.

This is an inspired adaptation, not a literal clone. Desktop Month, Week, and Day layouts remain unchanged. The change does not add infinite calendar loading, search, alternate event semantics, new navigation, or fabricated icons/data.

## Implementation Contract

1. **Limit the layout change to mobile Month view.** In `jin-gui/src/styles/calendar.css`, place the compact rules after the existing Month-view authority inside the `max-width: 700px` calendar seam, and exclude `:root[data-text-scale="accessibility"]` from normal-scale compression. Do not alter desktop calendar geometry, the reusable `.calendar-widget`, or the Week/Day time grids. Reuse existing adaptive `--calendar-*`, ink, indigo, vermilion/seal, and calendar/source-color roles; add no generic-token retheme.

2. **Compress the header without removing controls.** Make `.calendar-month-header` and `.calendar-month-controls` a compact top composition. `.calendar-month-label` shows the real localized month and year at a modest, readable size rather than the desktop large display size; the Calendar eyebrow may recede visually but its route identity remains available. Previous, next, Today, Month, Week, Day, and Add Event remain the existing real buttons with their labels, accessible names, pressed state, actions, and focus treatment. Navigation may wrap into two compact rows when needed, but must not create the current large header. Do not introduce new floating controls or fake icons. The existing Today/Add controls may retain their current compact or floating mobile treatment if they do not cover dates or indicators.

3. **Create a compact seven-column month field.** Keep `.calendar-weekday-row`, `.calendar-day-grid`, and every `.calendar-week-row` at seven equal `minmax(0, 1fr)` columns. On normal mobile text scale, render all six weeks within a compact field using warm paper, no vertical cell borders, and a single fine horizontal rule between week rows. Remove tall desktop cell minimums, card fills, inset boxes, and per-cell framing. Weekday labels, date numbers, and focus remain legible at 320 and 390 CSS px. Outside-month dates recede; weekend dates may use a quieter ink role, but both remain readable.

4. **Distinguish today and focus truthfully.** Render today's date as a circular Jin vermilion/seal marker with readable on-color ink, using the existing adaptive role when contrast is sufficient. Month transitions immediately to Day when a date is activated, so it has no persistent Month selection and must not invent one merely to copy the reference. Indigo remains the visible keyboard focus and active-interaction cue. Do not add a selected-date class, change `selectedDate`, or alter date navigation, storage, or selection control flow.

5. **Turn month events into small truthful indicators.** At mobile Month width, restyle the mounted `.calendar-event-chip` buttons as two or three short horizontal source/calendar-colored segments centered beneath the date number. Do not target the unused `.calendar-event-dot` hook. Keep each real button's source color assignment, DOM text, `data-event-id`, `data-source`, calendar-color style, localized accessible label, keyboard focus, and `openEventDetail` activation. Dense dates retain the real first-three plus `+N` disclosure. Text may be visually compacted only when the button's accessible name and focus indicator remain intact; tapping `.calendar-day-button[data-date]` continues through `selectDate()` to the existing Day view, where full titles and detail remain available.

6. **Preserve the real interaction model.** `CalendarViewController` remains unchanged as the owner of localized header text, current month/date navigation, saved view, date selection, Day-view transition, and event-detail dispatch. Preserve `.calendar-day-button[data-date]`, `.calendar-event-chip`, and every existing handler, attribute, DOM identity, storage value, payload, sort, source color, bridge call, and lifecycle. Do not modify the reusable date-picker `.calendar-widget` merely to match the Events Month reference.

7. **Let accessibility text scale rather than shrink.** The standard compact grid applies at normal mobile text scale. In the repository accessibility text mode at dynamic scale 3.1, retain full readable labels and hit targets and use the existing keyboard-focusable `.calendar-month-grid-scroller` only when the seven-column field cannot fit. Do not force normal-scale compact dimensions onto enlarged content. The header may stack, view controls may become full-width rows, and the date field may scroll horizontally, but the document itself must not overflow.

## Acceptance Criteria

- **AC1 — Mobile reference composition:** WHEN Events Month opens at 320 or 390 CSS px at standard text scale THEN the real localized month/year SHALL appear in a compact header above seven equal date columns, six compact week rows, and horizontal week separators without vertical cell boxes or a tall desktop grid.
- **AC2 — Jin date states:** WHEN today, keyboard focus, an outside-month date, or a weekend is shown THEN each applicable state SHALL remain distinguishable; today SHALL use a circular vermilion/seal treatment, focus SHALL use a visible indigo cue, muted dates SHALL remain readable, and Jin SHALL NOT invent a persistent Month selection merely to copy the reference.
- **AC3 — Event truth:** WHEN a date contains events THEN up to the existing first three real events SHALL appear as compact source/calendar-colored dots or bars with their accessible names, focus, event IDs, detail activation, and `+N` overflow truth preserved.
- **AC4 — Existing date flow:** WHEN a user taps or activates a date THEN Jin SHALL continue to expose the existing Day view and real event-detail path; previous/next, Today, Month/Week/Day, Add Event, saved view, locale, date selection, and return behavior SHALL remain unchanged.
- **AC5 — Desktop boundary:** WHEN Events renders above 700 CSS px THEN the accepted desktop Month, Week, Day, event detail, and Add Event layouts SHALL remain visually and behaviorally unchanged.
- **AC6 — Responsive accessibility:** WHEN the Month view is exercised at 320 and 390 CSS px at standard and accessibility dynamic scale 3.1, in light/dark and forced colors THEN labels, all real controls, date states, event indicators, and focus SHALL remain readable and reachable without document horizontal overflow; any calendar-only scrolling SHALL be keyboard reachable.

## Scope and Boundaries

Expected files:

- `jin-gui/src/styles/calendar.css`
- focused `jin-gui/src/__tests__/calendar_view_controller.test.ts`, `calendar_time_grid.test.ts`, and `token_discipline.test.ts` assertions as needed, including date-button-to-Day and event-chip-to-detail contracts if not already covered

No `index.html`, controller, renderer, Rust, core, DTO, invoke, bridge, persistence, timezone, recurrence, locale-copy, route, storage, or event data changes. Do not change the reusable Calendar widget, Week/Day time-grid calculations, event creation/detail behavior, sorting, source colors, first-three/`+N` logic, or previously accepted desktop styles. Do not add a new icon, button, view, search, gesture, infinite month stream, event preview, or calendar-loading feature.

## Verification

Run focused calendar-view, time-grid, and token/source tests, then TypeScript, style lint, production build, and the repository full GUI gate. Use deterministic Playwright on the real Events route at 320 and 390 CSS px in standard and accessibility dynamic scale 3.1, plus a 760/1440 desktop regression. Verify localized month/year, seven equal columns, all six week rows, horizontal-only rules, circular today and independent focus treatment, outside/weekend legibility, zero/one/three/more-than-three event indicators, date-to-Day navigation, event-detail activation, every header action, page overflow, keyboard reachability, light/dark, forced colors, and console output. Browser evidence remains distinct from native Tauri owner visual sign-off.

## Completion

- [x] Compact normal-scale mobile Month header and six-week field implemented at 700 CSS px and below.
- [x] Seven equal date columns, horizontal week rules, vermilion today circle, indigo focus, muted dates, and compact real event bars verified.
- [x] Existing date-to-Day, event-to-detail, navigation, source-color, first-three, and `+N` behavior preserved.
- [x] Desktop Month/Week/Day presentation remained outside the compact rule set.
- [x] Standard, dense, accessibility dynamic scale 3.1, dark, and forced-colors browser evidence completed without page overflow.
- [x] Automated regression, lint, production build, standalone production smoke, independent checker review, and final native bundle completed.

Detailed evidence and the native owner-review boundary are recorded in `verification.md`.
