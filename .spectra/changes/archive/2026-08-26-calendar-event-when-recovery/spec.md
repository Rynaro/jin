---
eidolon: ramza
version: 1.0.0
kind: spec
status: deliberated
created_at: 2026-08-26T00:00:00Z
target_repos:
  - jin
stories_count: 6
validation_gates_count: 26
confidence: 0.94
---

# Recover the Jin Event “When” Input

## Outcome

Replace the operating-system `<input type="date">` in Calendar → **Add Event** with Jin’s shared Calendar component and restore the relative date/time input as one calm, synchronized **When** control. A person can type “tomorrow at 2pm” / “amanhã às 14h”, choose one day, or paint an inclusive date range without translating between disconnected controls.

The interaction must feel native to Jin: quiet hierarchy, direct feedback, no browser picker chrome, and no ambiguity between the human-selected range and the canonical Event interval that is saved.

## Evidence and recovery boundary

At `e63a2bb`, `#jin-event-dialog` still contains `#event-date` as `<input type="date">`. In Tauri/WebKit this delegates the visible calendar to the operating system, which is the surface shown in the owner’s evidence. `CalendarViewController` reads that single date and cannot create multi-day Events.

Jin’s committed shared Calendar remains present for task due dates at `#jin-due-date-dialog #jin-calendar-widget`; it is not globally missing. Its committed `CalendarController` implements only single selection.

The dirty primary checkout contains an uncommitted recovery prototype and is **read-only reference evidence**. It demonstrates useful seams—a bounded natural-language parser, a range-mode extension to the shared controller, inclusive range highlighting, explicit Calendar events, and the Add Event embedding—but it also mixes older grid-local edit/delete behavior, hardcoded English, an unused multi-select mode, and pre-M2 controller policies. Vivi must port the intended seams into this clean branch, not copy the dirty controller wholesale.

## Scope

### In scope

- Calendar → Add Event only: replace the native date input with the shared Jin Calendar in range mode.
- A localized relative date/time text input synchronized with that Calendar selection.
- Single-day and inclusive multi-day selection with clear range visuals and summary.
- All-day and timed Event creation over one or multiple selected dates.
- Exact half-open canonical serialization for all-day Events.
- Local wall-time serialization for timed Events, including overnight ranges.
- Generic shared Calendar range-mode behavior while preserving its existing single mode.
- `en` and `pt-BR` parsing, visible copy, Calendar labels, previews, validation, and accessible names.
- Keyboard/focus behavior, live validation, modal reset, responsive layout, light/dark themes, reduced motion, browser QA, and native owner sign-off.
- Regression coverage for chronological Month/Day/Week, M1 detail/back, M2 detail-resident edit/conflict, and task due-date Calendar behavior.

### Out of scope

- Replacing M2’s detail-resident editor inputs; its authority and conflict contract stay unchanged.
- Adding the compound When control to Capture → Event or task promotion in this milestone.
- Editing Google, cancelled, recurring, or Time block Events.
- Natural-language event titles, locations, durations other than the one-hour shortcut, recurring rules, attendees, reminders, or timezone selection.
- Arbitrary natural-language understanding, fuzzy inference, or server/LLM parsing.
- Multi-select/non-contiguous dates; the shared controller may retain the reserved type but gains no product consumer here.
- Click/drag creation from the chronological grid.
- Month start-time label recovery or Notes FTS recovery.

## Decisions

### D-01 — One compound When draft, two synchronized inputs

The Add Event dialog contains a semantic `fieldset` named **When** with:

1. A text input for relative date and optional time.
2. A polite live preview/error directly beneath it.
3. The shared Jin Calendar, visibly embedded in the dialog in `range` mode.
4. A localized summary of the selected date or inclusive date range.
5. The existing all-day toggle and, when timed, start/end time inputs.

The text input and Calendar write to one controller-owned draft `{startDate, endDate, allDay, startTime, endTime}`. There is no hidden native date input and no OS/browser date-picker path. Changing either input updates the other and the summary in the same interaction turn.

### D-02 — Calendar range interaction is valid after the first date

In range mode:

- First activation starts a valid one-day selection: `startDate === endDate`.
- Second activation extends and completes the inclusive range; reverse selection normalizes chronologically.
- A third activation starts a new one-day selection.
- Month-crossing and year-crossing ranges are supported.
- Clear removes the range and makes Create invalid until a date is chosen.
- Today starts/restarts the range at today; it does not silently create the Event.

The Calendar exposes two deliberately different range events. `calendar:change`
is emitted synchronously after every user-caused range mutation and is the only
event Add Event consumes. `calendar:commit` is retained as an opt-in generic
affordance for a future staged consumer; Add Event does not render or listen to
that affordance, and Create never depends on it. Both events carry the same
immutable selection detail. Programmatic `setSelection` is silent so the host
can project its draft back into the widget without a feedback loop.

`complete` describes the click-cycle phase, not validity: the first activation
is a valid `{start: D, end: D, complete: false}` one-day range, the second is a
valid completed range, and the next activation restarts the cycle. Empty
selection is the only date-selection state that blocks Create.

### D-03 — Extend the generic Calendar without regressing single mode

Extend the pure Calendar transform/render/controller seams rather than adding Event-specific DOM logic to the widget. The public selection contract distinguishes:

- `{mode: 'single', iso}`
- `{mode: 'range', start, end, complete}`

Single mode retains current task due-date behavior exactly: one selection, the existing `calendar:selected` event, RFC3339-to-date normalization, bounds, navigation, clear/today, and dialog integration. Range mode emits `calendar:change`; it may render an explicit commit control only when a consumer opts in, and that control emits `calendar:commit`. It does not cause single consumers to receive new semantics. In range mode, Today is a selection mutation that starts/restarts a one-day range; month/year navigation alone is not a selection mutation and emits neither event.

### D-04 — Range rendering and accessibility follow the APG grid model

Range endpoints and interior days receive distinct state hooks; styling uses Jin tokens and remains legible in light/dark themes. Selection cannot be encoded by color alone.

The grid declares `aria-multiselectable="true"` in range mode, each gridcell exposes accurate `aria-selected`, and day buttons keep localized full-date accessible names. Roving tabindex remains exactly one. Arrow keys, Home/End, Page Up/Down, Shift+Page Up/Down, Enter, and Space retain the shared Calendar map. Keyboard activation restores focus to the newly rendered selected day so a range can be completed without re-tabbing. Disabled cells cannot become endpoints.

### D-05 — Relative parsing is bounded, deterministic, and locale-owned

Parsing is a pure function of `{input, today, locale}`. The locale is required
and narrowed to the supported grammar set (`en | pt-BR`); the parser never
reads local storage, `navigator.language`, or the Event preference resolver. It
returns structured success data or stable error codes, never localized prose.
The Add Event host maps those codes through the Event locale catalog. Parsing
never calls the network, an LLM, `Date.now`, or locale-dependent free-form
parsing.

Supported English grammar:

- `today`, `tomorrow`, `yesterday`
- `this <weekday>`, `next <weekday>`
- `in N day(s)`, `in N week(s)` with bounds of 1–365 days / 1–52 weeks
- `YYYY-MM-DD`
- Optional time: `at 9`, `9:30`, `9am`, `9:30 pm`, `noon`, `midnight`

Supported Portuguese grammar:

- `hoje`, `amanhã`, `ontem` (accent-insensitive input is accepted)
- `esta/este <weekday>`, `próxima/próximo <weekday>`
- `em N dia(s)`, `em N semana(s)` and `daqui a N dia(s)/semana(s)` with the same bounds
- `YYYY-MM-DD`
- Optional time: `às 9`, `9:30`, `9h`, `9h30`, `meio-dia`, `meia-noite`

Weekday names use the active locale and accept common pt-BR accented/unaccented spellings. ISO input is accepted in both locales. Unsupported or impossible values return a localized actionable error; no partial date is applied. Preview formatting uses the selected Event locale and its hour cycle.

### D-06 — Applying relative input preserves intent

Input is previewed as the person types and applied by Enter or the localized **Use** button.

- A date-only result sets a one-day Calendar selection and preserves the current all-day/timed choice and time values. On a fresh dialog this therefore remains all-day.
- A result with time sets a one-day selection, switches to timed, assigns that start time, and assigns a one-hour end.
- If the one-hour end crosses midnight, `endDate` advances by one day and the Calendar range reflects both dates.
- Invalid text never mutates the last valid draft.
- After application, Calendar summary, all-day state, and time fields agree with the new draft.

### D-07 — Human range is inclusive; canonical all-day end is exclusive

The Calendar summary and highlighted range are inclusive. On Create:

- One all-day date `D` saves `start=D`, `end=D+1 day`.
- Inclusive all-day range `D1…D2` saves `start=D1`, `end=D2+1 day`.
- Timed selection saves `start=D1TstartTime:00`, `end=D2TendTime:00`.
- A same-day timed end must be later than its start.
- A later end date may have an earlier clock time and remains valid.
- Zero-length/backwards intervals fail locally with localized guidance and do not invoke `createEvent`.

Date arithmetic uses Jin’s ISO wall-date helpers, not UTC conversion. No timezone selector or new TZID policy enters scope; newly created timed Events retain the existing floating/local wall-time contract.

### D-08 — Add Event remains create-only and source-safe

The dialog creates Jin Events through the existing `createEvent` command. It never edits existing Events, changes Google/read-only authority, or restores dirty-prototype grid-local mutation controls. M2 remains the only Event edit flow: authoritative detail → Edit for eligible Jin one-off Events/Time blocks, with the existing conflict handling.

Successful Create keeps the current mutation notification and calendar reload path, closes/reset the dialog, and renders the created Event in Month and the restored chronological Day/Week grid. Failure preserves title, When draft, times, location, and description so retry is tranquil.

### D-09 — Localization belongs to explicit locale inputs

The existing Event locale preference/catalog owns all Add Event prose: field
labels, relative-input examples, Use, preview connectors, range summary,
validation/error messages, and Calendar chrome labels supplied by that host.
The Add Event host resolves the effective Event locale once per render/update
and passes the same explicit BCP-47 value to the parser, preview formatter, and
generic Calendar, together with the localized Calendar chrome labels.

The generic Calendar owns date presentation and interaction only. It formats
month names, weekday headings, and full-date accessible labels with its explicit
locale and consumes generic supplied labels for Today, Clear, and an optional
commit action. It must not import Event locale code, read the Event preference,
or translate parser error codes. A consumer that omits locale/labels keeps the
existing template copy and snapshots a supported system-locale fallback at
connection, preserving task due-date single-mode behavior.

On `jin:event-locale-changed`, the Add Event host supplies the newly resolved
locale and labels, then rerenders Calendar chrome, summary, errors, and the
cached valid preview. It must not clear selection or text and must not reparse a
previously valid expression under the new grammar. Subsequent input is parsed
under the new locale.

### D-10 — Calm modal behavior and reset boundary

Opening Add Event initializes the range to the selected Day when one exists, otherwise today; defaults to all-day with 09:00–10:00 retained as hidden timed defaults; clears prior text/error/content fields; and focuses Event title first. The When field and Calendar follow naturally in tab order.

Closing/cancelling and reopening produces a clean draft. Submitting twice is prevented while the command is pending. The Calendar is visually embedded—no clipped popup, stacking fight, document overflow, or platform-specific date chrome. At narrow native widths the dialog scrolls internally and keeps actions reachable.

## Stories

### S1 — Freeze the shared Calendar range contract (P0, 2d)

Extend pure selection/cell state, generic rendering, public events, locale input, and keyboard focus while proving single-mode parity.

### S2 — Add localized natural date/time parsing (P0, 2d)

Implement the pure `en`/`pt-BR` grammar, formatting, normalization, bounds, and actionable errors.

### S3 — Build the compound Add Event When surface (P0, 3d)

Replace the native date input, embed the shared Calendar, synchronize draft state, and implement calm responsive styling.

### S4 — Serialize all-day and timed ranges safely (P0, 2d)

Implement inclusive UI → half-open canonical conversion, multi-day timed creation, validation, pending/error retention, and reset behavior.

### S5 — Preserve calendar architecture boundaries (P0, 2d)

Prove M2 detail editing, source/read-only rules, chronological grid lifecycle, task due single mode, and Capture behavior are unchanged.

### S6 — Browser and native acceptance (P1, 2d)

Exercise mouse/keyboard, locales, responsive widths, themes, dialog scroll/focus, native Tauri rendering, creation, and owner sign-off.

## Acceptance criteria

- **AC-001** — GIVEN Calendar → Add Event is open WHEN the When surface renders THEN it SHALL contain Jin’s shared Calendar component and SHALL contain no `input[type="date"]` or OS/browser date-picker trigger. Verify: DOM test plus native screenshot.
- **AC-002** — GIVEN a fresh Add Event dialog WHEN it opens from a selected Day or without one THEN its range SHALL initialize respectively to that Day or today, all-day SHALL be selected, 09:00–10:00 SHALL remain the hidden timed default, and focus SHALL begin on Event title. Verify: controller GUI tests.
- **AC-003** — GIVEN range mode with no selection WHEN one enabled date is activated THEN start and end SHALL equal that date and Create SHALL have a valid one-day date selection. Verify: Calendar controller unit/DOM test.
- **AC-004** — GIVEN a one-day range WHEN a second date before or after it is activated THEN endpoints SHALL normalize chronologically and every inclusive day SHALL expose range state. Verify: transform/controller range matrix.
- **AC-005** — GIVEN a completed range WHEN a third date is activated THEN a new valid one-day range SHALL start at that date. Verify: controller test.
- **AC-006** — GIVEN a range spanning month/year boundaries WHEN selected by pointer or keyboard THEN both endpoints and inclusive interior SHALL remain correct through navigation. Verify: unit plus Playwright flow.
- **AC-007** — GIVEN range mode WHEN the grid renders and selection changes THEN it SHALL expose `aria-multiselectable`, accurate gridcell `aria-selected`, endpoint/interior cues beyond color, one roving tabindex, and localized full-date labels. Verify: DOM accessibility assertions.
- **AC-008** — GIVEN keyboard focus in the Calendar WHEN arrows, Home/End, Page keys, Shift+Page keys, Enter, or Space are used THEN the existing APG navigation SHALL hold and focus SHALL remain on the selected/re-rendered day so the range can continue. Verify: keyboard unit matrix plus Playwright.
- **AC-009** — GIVEN the task due-date Calendar in single mode WHEN its existing selection, clear, today, bounds, keyboard, RFC3339 normalization, and dialog flows run THEN behavior and `calendar:selected` payloads SHALL remain unchanged. Verify: complete existing Calendar/task/capture tests plus focused Playwright smoke.
- **AC-010** — GIVEN Event locale `en` WHEN each supported English expression is parsed THEN it SHALL return the deterministic expected ISO date and optional `HH:mm`; unsupported, impossible, zero, and over-bound values SHALL return localized errors. Verify: pure parser table test.
- **AC-011** — GIVEN Event locale `pt-BR` WHEN each supported Portuguese expression, weekday spelling, accent-insensitive variant, and time form is parsed THEN it SHALL return the deterministic expected ISO date and optional `HH:mm`; invalid values SHALL return localized errors. Verify: pure parser table test.
- **AC-012** — GIVEN identical parser input, explicit today, and locale WHEN evaluated under different system timezones/locales THEN the date/time result SHALL not change. Verify: pure deterministic fixtures.
- **AC-013** — GIVEN valid or invalid relative text WHEN preview updates THEN valid text SHALL show a locale-formatted preview, invalid text SHALL show actionable localized guidance, and invalid text SHALL not mutate the last valid draft. Verify: controller tests and Playwright live-region evidence.
- **AC-014** — GIVEN valid relative text WHEN Enter or Use is activated THEN its date SHALL update Calendar range/summary immediately; a time SHALL switch to timed and create a one-hour draft, including next-day rollover at 23:30. Verify: controller test matrix.
- **AC-015** — GIVEN date-only relative input WHEN applied after any all-day/timed choice THEN it SHALL preserve that choice and its time values while changing the selection to one day. Verify: controller tests.
- **AC-016** — GIVEN the Calendar range changes WHEN pointer/keyboard selection, Clear, Today, or natural input acts THEN the compound draft, visible range, and localized summary SHALL agree in the same turn; Create SHALL not require an extra Use dates confirmation. Verify: state synchronization tests plus Playwright.
- **AC-017** — GIVEN one all-day UI date WHEN Create runs THEN `createEvent` SHALL receive that date as start and the next date as exclusive end. Verify: controller command assertion.
- **AC-018** — GIVEN an inclusive multi-day all-day range WHEN Create runs THEN `createEvent` SHALL receive its first date as start and the day after its last visible date as exclusive end. Verify: leap/month/year boundary matrix.
- **AC-019** — GIVEN a timed one-day or multi-day selection WHEN Create runs THEN `createEvent` SHALL receive start/end wall datetimes on the selected endpoint dates; same-day end-after-start and later-date validity SHALL be enforced locally. Verify: controller serialization matrix.
- **AC-020** — GIVEN missing title/range, malformed time, zero/backwards interval, or cleared Calendar WHEN Create is attempted THEN a localized inline error SHALL appear, `createEvent` SHALL not run, and all entered draft fields SHALL remain intact. Verify: controller tests.
- **AC-021** — GIVEN a pending Create WHEN Create is activated again THEN at most one command SHALL be in flight; GIVEN command failure THEN the complete draft SHALL remain retryable; GIVEN success THEN mutation notification/reload SHALL run once and the dialog SHALL close/reset. Verify: async controller tests.
- **AC-022** — GIVEN the created one-day, multi-day, all-day, timed, or overnight Event WHEN Calendar reloads THEN Month inclusion and restored Day/Week half-open chronological projections SHALL remain correct. Verify: existing projection suites plus browser smoke.
- **AC-023** — GIVEN M1 detail/back and M2 eligible/ineligible Events WHEN detail, Edit, Cancel, Save, conflict, Google, cancelled, recurring, and Time block paths run THEN their authority, canonical data, focus/scroll, and detail-resident UI SHALL remain unchanged and no Add Event edit mode/grid-local mutation control SHALL appear. Verify: complete M1/M2 suites plus Playwright.
- **AC-024** — GIVEN `en` or `pt-BR` and a locale switch while Add Event is open WHEN the compound control renders/rerenders THEN all labels, weekday/month names, buttons, previews, summaries, validation, and accessible names SHALL use the effective locale without clearing the valid draft. Verify: locale DOM test plus Playwright.
- **AC-025** — GIVEN supported native/browser widths, light/dark themes, 200% zoom, and reduced motion WHEN Add Event is used THEN the embedded Calendar, inputs, live messages, focus ring, and actions SHALL remain readable/reachable with internal modal scroll and no document overflow or clipped popup. Verify: Playwright visual QA plus native owner sign-off.
- **AC-026** — GIVEN the complete GUI suite and production build WHEN verification runs THEN all tests, TypeScript/build, CSS lint, and diff checks SHALL pass, with VIGIL as checker distinct from Vivi. Verify: commands below and ESL block-mode verification.

## Verification commands

```sh
npm --prefix jin-gui test -- --run src/__tests__/calendar_transform.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_controller.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_natural_language.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_view_controller.test.ts
npm --prefix jin-gui test -- --run src/__tests__/events_controller.test.ts src/__tests__/event_edit.test.ts src/__tests__/event_locale.test.ts
npm --prefix jin-gui test -- --run src/__tests__/tasks_controller.test.ts src/__tests__/capture_controller.test.ts src/__tests__/tauri_fixture.test.ts
npm --prefix jin-gui test -- --run
npm --prefix jin-gui run build
npm --prefix jin-gui run lint:css
git diff --check
```

## Handoff

FORGE deliberates only the interaction-state boundary: whether `calendar:change` is sufficient for Add Event while retaining `calendar:commit` as a generic affordance, and confirms the locale ownership boundary. Vivi then implements S1–S6 in the clean worktree. VIGIL independently verifies all 26 criteria in recorded block mode and performs browser QA before requesting native owner sign-off.
