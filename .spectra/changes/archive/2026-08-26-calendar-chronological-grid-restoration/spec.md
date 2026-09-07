---
eidolon: ramza
version: 1.0.0
kind: spec
status: deliberated
created_at: 2026-08-26T00:00:00Z
target_repos:
  - jin
stories_count: 7
validation_gates_count: 24
confidence: 0.91
---

# Restore the Chronological Day and Week Grid

## Outcome

Restore the lost temporal separation in Day and Week so the calendar reads as time, not as two differently arranged lists. Day becomes one continuous, readable timeline. Week uses the same temporal grammar across seven aligned day columns so the user can understand both commitment and free space at a glance. The visual treatment borrows HEY Calendar's calm relationship to time while remaining recognizably Jin.

## Evidence and diagnosis

The committed implementation at `d52607a` has no chronological grid:

- `CalendarViewController.renderWeekView` builds seven static flex columns and appends event chips in each column.
- `renderDayView` builds a sorted `<ul>` of Event cards.
- The corresponding CSS styles cards and columns but has no hour rail, y-axis time geometry, overlap packing, all-day lane, current-time marker, or internal timeline scroll.
- Existing tests lock mode switching and half-open day inclusion, but not chronological placement.
- Repository history on this branch contains no committed time-grid implementation to restore.

The dirty primary checkout contains an uncommitted prototype with useful seams: a pure `time_grid.ts`, half-open segmentation, all-day lanes, deterministic overlap columns, minimum visual duration, continuation flags, and a shared Day/Week renderer. It is reference evidence only. Vivi must re-implement against this branch rather than wholesale-copying the older controller, which mixes unrelated create-dialog and mutation behavior and reintroduces policies superseded by archived M1/M2.

## Product reference

Official HEY sources establish the inspiration:

- [Calendar Overview](https://help.hey.com/article/800-calendar-overview): Day is a single readable line of time and a continuous story; Week shows how days fit together.
- [Nighttime](https://help.hey.com/article/846-nighttime): nighttime is collapsed from 10pm to 6am and can be revealed; those hours are not configurable.
- [HEY Calendar](https://www.hey.com/calendar/): the product emphasizes day/week thinking, continuous time, and visible uninterrupted free space.

Jin adopts those principles, not HEY's exact layout or branding. Jin keeps its typography, spacing, paper-like surfaces, restrained blue accent, exact source semantics, Time block identity, and canonical detail/edit behavior.

## Scope

### In scope

- A shared pure wall-time grid model consumed by Day and Week.
- Day as one chronological column; Week as seven aligned chronological columns.
- A shared hour rail, subtle hour separators, sticky date headers, and sticky all-day lane.
- Half-open clipping for timed and all-day intervals.
- Deterministic overlap columns based on semantic duration.
- Continuation state for intervals crossing visible day/week boundaries.
- A minimum visual height that never changes semantic duration or overlap truth.
- A today-only current-time marker refreshed safely while mounted.
- An internally scrolling timeline with deterministic initial position.
- Fixed 22:00–06:00 nighttime compression with an accessible reveal/collapse affordance, inspired by HEY.
- Exact source and `Time block` meaning conveyed by text/iconography and accessible names, never color alone.
- Keyboard, accessibility, `en`/`pt-BR`, light/dark themes, reduced motion, and narrow-window behavior.
- Preservation of archived M1 detail/back and M2 detail-resident edit/conflict/canonical policies.
- Due Tasks rendered after/outside the Event grid.

### Out of scope

- Dragging or resizing Events.
- Creating an Event by clicking or dragging empty grid space.
- User-configurable working/nighttime hours.
- A timezone selector or multi-timezone rail.
- Virtualization.
- New Event mutation authority, recurrence, Google-write, task-promotion, detail, or edit behavior.
- Moving due Tasks into chronological positions.
- Month-view redesign.

## Decisions

### D-01 — One model, two projections

Add a pure module under `jin-gui/src/lib/calendar/` that accepts canonical `EventDto[]` plus an ordered ISO-date window and produces all-day spans and timed day segments. Day passes one date; Week passes exactly seven dates. Rendering consumes this model rather than calculating geometry in the controller.

The model does no DOM work, localization, timers, `Date` timezone conversion, or mutation authorization.

### D-02 — Wall time remains wall time

Parse the stored `YYYY-MM-DDTHH:mm[:ss]` components directly. Do not feed Event wall-time strings through browser timezone conversion. Offsets, when present in fixtures, must not silently shift the displayed wall clock. `start_tzid`, floating state, and DST boundary fixtures prove that layout preserves the stored local wall time; timezone interpretation remains owned by the existing canonical/time formatting layer.

### D-03 — Half-open segmentation

Timed and all-day intervals use `[start,end)` semantics:

- An Event ending exactly at midnight does not appear on the ending date.
- A timed multi-day Event is clipped to each visible day with `continuesBefore`/`continuesAfter` flags.
- An all-day exclusive end is clipped to the visible date window and packed into a non-colliding lane.
- Malformed, zero-length, or backwards intervals fail closed and never produce invalid geometry.

### D-04 — Deterministic overlap geometry

Within each day, sort by semantic start minute, semantic end minute, then stable Event id. Partition transitive overlap clusters. Assign the lowest available column; every segment in a cluster receives the cluster's maximum column count. Touching endpoints do not overlap. Minimum visual height is applied only after overlap calculation and does not create a semantic collision.

### D-05 — Time geometry and free space

The expanded daytime scale uses one shared pixels-per-minute token across Day and Week. Empty time remains visually empty; do not fill it with cards, labels, or decorative noise. Hour separators are quiet half-pixel/token lines. Day has more horizontal breathing room; Week trades detail density for comparison while preserving the same y-axis.

### D-06 — Structure of the shared renderer

The renderer produces:

1. Sticky date header row.
2. Sticky all-day lane with deterministic spanning lanes.
3. Internally scrolling timed body with one hour rail and one or seven day columns.
4. Absolutely positioned Event blocks inside relatively positioned day columns.
5. A today-only current-time marker.

The grid surface carries an accessible Day/Week label. Hour rules and the now line are decorative. Each date column is an accessible region; Event buttons remain in chronological DOM order by date, start, end, and id.

### D-07 — Initial scroll and restoration

On first entry or date navigation, scroll the internal timed body to one hour before the earliest timed Event, clamped to the start of the display scale. With no timed Events, start at 08:00. Do not reset scroll after icon hydration, now-marker refresh, locale/theme change, detail refetch, or resize.

Opening detail records the internal timeline scroll position and focused Event id. M1 Back restores both. M2 Edit continues to occur only in the detail surface; no grid-local Edit/Delete/Remove controls return.

### D-08 — Dense Event identity beyond color

Every block includes title and a localized time/continuation label as space permits. It also exposes source and kind without relying on color:

- Accessible names contain exact `Source: Jin` or `Source: Google` and `Time block` when applicable.
- A compact visible source glyph plus text cue distinguishes Jin and Google.
- A visible `Time block` cue is retained even when the originating Task is missing.
- Color may support grouping but is never the only differentiator.

Event activation always routes to the authoritative detail. Read-only/mutation policy remains exclusively in M1/M2 detail capabilities and core commands.

### D-09 — Locale, theme, and responsive ownership

Hour labels use `Intl.DateTimeFormat` with the effective Event locale, so `en` and `pt-BR` receive their locale-appropriate 12/24-hour forms. Day names, all-day, continuation, nighttime, source, kind, and accessible labels come from the Calendar/Event locale registry. No hardcoded English or AM/PM formatting remains in the renderer.

At narrow widths, Day fits its container without document overflow. Week always retains seven columns and gains horizontal scrolling inside the calendar timeline; the document itself must not overflow horizontally. Light/dark themes use existing tokens only. Reduced motion disables nonessential animation without changing geometry.

### D-10 — Occupied or current nighttime auto-expands

Each fixed nighttime band is independent: early night is 00:00–06:00 and late night is 22:00–24:00. On first render of a Day date or Week window, a band auto-expands when any visible date contains a timed Event segment intersecting that band or when today's current-time marker lies inside it. Empty, non-current bands remain compressed.

Week derives one shared state per band across all seven columns: one Event in any visible date expands that band for the whole Week, preserving a single y-axis. Day and Week use the same pure content predicate. Automatic expansion is monotonic for the active view identity: newly arriving content or the current-time marker entering a compressed band may expand it, but content removal or the marker leaving never auto-collapses it while that view remains active.

Manual collapse is allowed after auto-expansion. A collapsed occupied band retains every Event button in chronological DOM/accessibility order, guarantees the compact visual minimum, and exposes a localized band summary containing the Event count, time range, and current-time presence when applicable. The toggle is a real button with accurate `aria-expanded`, an accessible name that states the band, count, and current-time presence, and visible focus. This explicit user action is the only state in which occupied/current nighttime may remain compressed.

### D-11 — Expansion is active-view-local

Manual early/late choices belong to the active view identity: `{mode, Day date}` or `{mode, Week start}`. They survive data refetch, locale/theme changes, resize, icon hydration, detail open/back, and other rerenders of that same identity. They reset when the user changes Day date, Week window, or Day/Week mode, and on controller disconnect/app restart.

No nighttime state is stored in canonical files, sync, local storage, settings, or a session-wide map. This prevents a choice made for one quiet date from silently changing another date while keeping the surface stable during the interaction at hand.

## Nighttime design and resolved FORGE gates

Nighttime is fixed at 22:00–06:00, matching HEY's published boundary. The pure projection maps these hours through compressed bands rather than removing them, so nighttime Events remain present, focusable, and ordered. Expanding a band restores the normal pixels-per-minute scale; collapsing restores the compressed scale without changing event data or semantic duration.

### DG-01 — Default expansion when nighttime contains content (resolved)

[DECISION] Auto-expand an early/late band when it contains any visible timed Event segment or today's current-time marker. This prioritizes readable chronology and prevents a quiet visual treatment from obscuring a commitment. Empty bands remain compressed, retaining the calm default where compression is truthful.

### DG-02 — Nighttime persistence lifetime (resolved)

[DECISION] Keep state active-view-local, not app-session-wide or persistent. Manual overrides survive rerenders and detail/back for the same Day date or Week window, then reset on view/date/week identity change or disconnect. This is the smallest lifetime that avoids unexpected recollapse without carrying an unrelated choice into another agenda.

HEY's official material establishes the 22:00–06:00 collapsed/revealable, non-configurable boundary and the goal of a readable continuous line of time. It does not specify occupied-band or persistence policy; D-10 and D-11 are Jin decisions derived from zero-hidden-event, accessibility, parity, and implementation-safety requirements.

## Detailed model contract

The exact names may vary, but the implementation must expose equivalent pure data:

```text
TimeGridModel
  dates[]
  timedByDate: date -> TimedSegment[]
  allDaySpans[]
  bands: early-night | daytime | late-night

TimedSegment
  event
  date
  semanticStartMinute
  semanticEndMinute
  visualStartMinute
  visualEndMinute
  continuesBefore
  continuesAfter
  overlapColumn
  overlapColumnCount

AllDaySpan
  event
  startDateIndex
  endDateIndexExclusive
  continuesBefore
  continuesAfter
  lane
  laneCount
```

The event's semantic interval is never rewritten to achieve a visual minimum or compressed nighttime projection.

## Stories and sequence

### S1 — Freeze pure temporal geometry (3d, P0)

- Build the pure wall-time parser, date clipping, timed segmentation, all-day spans, overlap packing, continuation flags, minimum visual height, and nighttime projection.
- Port the prototype's useful invariants with new tests; do not copy unrelated primary-checkout code.
- Cover offset-shaped input, TZID/floating combinations, DST boundaries, malformed intervals, and deterministic shuffled input.

### S2 — Build the shared accessible renderer (4d, P0; depends on S1)

- Create one renderer configured with one or seven dates.
- Render sticky date/all-day structure, hour rail, decorative rules, chronological Event DOM, now marker, source/kind cues, and detail callbacks.
- Keep the controller responsible for mode/date orchestration only.

### S3 — Restore Day as a continuous line of time (2d, P1; depends on S2)

- Replace the Event `<ul>` with the one-column timeline.
- Keep due Tasks below/outside the grid.
- Preserve date heading, Add Event, detail navigation, internal scroll capture, and Back restoration.

### S4 — Restore Week as seven aligned days (3d, P1; depends on S2)

- Replace static chip columns with seven date columns sharing one y-axis and all-day lane.
- Keep week navigation, date-heading activation, seven-column semantics, internal horizontal scrolling, and shared nighttime alignment.

### S5 — Add safe now and nighttime behavior (2d, P0; depends on S3, S4, FORGE)

- Apply D-10/D-11 with independent early/late bands, shared Week expansion, active-view-local overrides, and localized occupied-band summaries.
- Refresh the current-time marker at the next minute boundary and every minute thereafter only while connected/visible.
- Cancel timers on rerender/disconnect; refresh the marker without rebuilding Events, changing focus, or resetting scroll.

### S6 — Complete locale, theme, responsive, and focus fidelity (3d, P1; depends on S3–S5)

- Localize all grid and accessibility copy in `en` and `pt-BR`.
- Validate locale-native hour cycles, themes, reduced motion, 1280×800 and narrow widths, internal overflow, visible focus, and detail/back restoration.

### S7 — Verify preserved calendar boundaries (2d, P0; depends on S1–S6)

- Prove M1/M2 detail, edit, conflict, source/privacy, recurrence/Google read-only, and canonical mutation tests remain green.
- Run focused and complete GUI suites, build/CSS lint, Playwright MCP evidence, and native owner visual sign-off.

## Acceptance checks

- **AC-001** GIVEN Day mode WHEN its Event surface renders THEN it SHALL contain one chronological timed column with a shared hour rail rather than an Event list.
- **AC-002** GIVEN Week mode WHEN its Event surface renders THEN it SHALL contain exactly seven aligned chronological day columns with one shared time scale.
- **AC-003** GIVEN the same timed Event and visible date WHEN Day and Week models are built THEN semantic clipped start/end minutes and continuation flags SHALL match.
- **AC-004** GIVEN an Event ending at midnight WHEN the following date is modeled THEN no segment SHALL be emitted for that exclusive end date.
- **AC-005** GIVEN a timed Event crossing day or visible-window boundaries WHEN the model is built THEN each visible day SHALL receive one half-open clipped segment with correct continuation flags.
- **AC-006** GIVEN overlapping Events in any input order WHEN columns are assigned THEN the same lowest-free columns and cluster column count SHALL result, and touching endpoints SHALL not overlap.
- **AC-007** GIVEN a short Event WHEN visual geometry is calculated THEN its block SHALL meet the minimum visual height while its semantic end, duration label, and overlap relation remain unchanged.
- **AC-008** GIVEN all-day Events crossing or overlapping the visible window WHEN the all-day lane is built THEN spans SHALL use exclusive ends, deterministic non-colliding lanes, and continuation cues.
- **AC-009** GIVEN malformed, zero-length, or backwards temporal input WHEN the model is built THEN it SHALL fail closed without invalid CSS geometry or runtime error.
- **AC-010** GIVEN stored wall time with floating, TZID, offset-shaped, and DST-boundary fixtures WHEN grid position is calculated THEN displayed wall-clock minutes SHALL not shift through the browser timezone.
- **AC-011** GIVEN a Date/Week render WHEN hour labels appear THEN they SHALL use the effective locale's hour cycle and all visible/accessibility copy SHALL come from the Calendar/Event locale registry.
- **AC-012** GIVEN a Jin or Google Event block WHEN it renders THEN source SHALL be conveyed beyond color and its accessible name SHALL include exact `Source: Jin` or `Source: Google`.
- **AC-013** GIVEN an Event with `derived_from` WHEN it renders THEN a visible and accessible exact `Time block` cue SHALL appear regardless of originating-Task availability.
- **AC-014** GIVEN overlapping or compact blocks WHEN keyboard traversal runs THEN Event controls SHALL remain focusable in chronological DOM order and activation SHALL open authoritative detail.
- **AC-015** GIVEN detail opens from Day or Week WHEN Back is activated THEN the same mode, date/week, internal vertical/horizontal scroll, and originating Event focus SHALL be restored.
- **AC-016** GIVEN M2 edit is entered from a grid Event detail WHEN Save, Cancel, stale conflict, or error resolves THEN no grid-local mutation policy SHALL appear and the canonical detail/edit contracts SHALL remain unchanged.
- **AC-017** GIVEN today's visible column WHEN time advances across a minute boundary THEN one now marker SHALL update in place without rebuilding Events, changing focus, or resetting scroll; non-today columns SHALL contain none.
- **AC-018** GIVEN the grid rerenders or controller disconnects WHEN now-marker timers are inspected THEN obsolete timers SHALL be cancelled and at most one live refresh schedule SHALL remain.
- **AC-019** GIVEN first entry with timed Events WHEN initial scroll is applied THEN the internal body SHALL scroll to earliest semantic start minus one hour, clamped; with no timed Events it SHALL scroll to 08:00.
- **AC-020** GIVEN a fixed early or late nighttime band WHEN first rendered, rerendered, manually toggled, or entered by the current-time marker THEN it SHALL auto-expand for any visible Event/current time unless manually collapsed for the active view identity; preserve that override across same-view rerenders/detail Back; reset it on mode/date/week change or disconnect; keep every Event in DOM/accessibility with an accurate localized Event-count/time-range/current-time summary and `aria-expanded`; and use one shared band state across all seven Week columns.
- **AC-021** GIVEN due Tasks for the selected Day WHEN Day renders THEN Tasks SHALL remain in their separate section after/outside the chronological Event grid.
- **AC-022** GIVEN a narrow Week viewport WHEN the grid renders THEN all seven columns SHALL remain available through timeline-internal horizontal scrolling and the document SHALL have no unintended horizontal overflow.
- **AC-023** GIVEN supported widths, light/dark themes, `en`/`pt-BR`, reduced motion, empty/all-day/overlap/nighttime states WHEN visual QA runs THEN labels, focus rings, blocks, rail, sticky layers, and free space SHALL remain readable without clipping or keyboard traps.
- **AC-024** GIVEN the complete existing GUI suite WHEN the change is verified THEN M1/M2 detail/edit/back, Google privacy/read-only, recurrence read-only, create, Month, and canonical interaction tests SHALL remain green.

## Verification plan

### Focused model and controller

```sh
npm --prefix jin-gui test -- --run src/__tests__/calendar_time_grid.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_view_controller.test.ts
npm --prefix jin-gui test -- --run src/__tests__/events_controller.test.ts src/__tests__/event_edit.test.ts src/__tests__/event_locale.test.ts
```

Tests must include shuffled overlap inputs; midnight exclusivity; multi-day continuation; all-day lane packing; minimum visual height; floating/TZID/offset/DST wall time; locale hour cycles; nighttime state; now timer cleanup; initial/internal scroll; focus/back restoration; narrow Week overflow; and source/Time block semantics.

### Mechanical suite

```sh
npm --prefix jin-gui test -- --run
npm --prefix jin-gui run build
npm --prefix jin-gui run lint:css
git diff --check
```

### Playwright MCP and native evidence

Use the repository's deterministic Playwright MCP at `http://127.0.0.1:1420`. Begin each state with accessibility and console inspection. Capture at minimum:

- Day: empty, all-day, overlapping, short, multi-day continuation, occupied nighttime, and current time.
- Week: seven columns, overlaps, all-day spans, shared nighttime toggle, current day, and horizontal internal scroll.
- English and pt-BR, light and dark, reduced motion, 1280×800 plus narrow viewport.
- Keyboard traversal, detail open/back restoration, and M2 edit entry/Cancel.

Artifacts belong under `.artifacts/playwright-mcp/`. Browser evidence is not proof of native Tauri rendering. Final verification requires native owner sign-off under `docs/gui-testing.md`; until then report `CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED`.

## Handoff

FORGE resolved DG-01 and DG-02 in D-10/D-11. Vivi may implement S1→S7 on the isolated branch within the exact boundary above; VIGIL remains the independent checker. Nighttime hours stay fixed and non-configurable, and no session-wide, persisted, canonical, or synced preference enters scope.
