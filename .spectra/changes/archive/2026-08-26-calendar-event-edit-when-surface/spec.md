---
eidolon: ramza
version: 1.0.0
kind: spec
status: deliberated
created_at: 2026-08-26T00:00:00Z
target_repos: [jin]
stories_count: 5
validation_gates_count: 22
confidence: 0.94
---

# Apply the Shared When Surface to M2 Event Editing

## Outcome

Replace M2 Edit Event’s native date input with the same calm compound **When** surface now used by Add Event: Jin’s shared range Calendar, localized relative date/time input, live preview and inclusive range summary, all-day toggle, and explicit times. Preserve M2’s detail-resident, capability-gated, conflict-safe save contract.

## Current boundary

Verified baseline `21af8bd4` ships Add Event’s compound When surface and keeps task due dates in shared Calendar single mode. M2 Edit remains in `lib/events/edit.ts` with `<input type="date">`, one draft `date`, and native time inputs.

M2 already guarantees that only active Jin-owned, non-recurring one-off Events and Time blocks can enter edit; Cancel is non-mutating; Save is token/operation guarded; stale conflicts preserve the draft and refetch latest detail; successful Save refetches canonical detail; Google, recurring, and cancelled Events remain view-only. This change extends the edit form only. It does not reopen those decisions.

## Right sizing

**Full ESL** — 8 expected files, rubric 8/12, real temporal-policy trade-off. Although the UI reuse is bounded, it changes the shape of the conflict-preserved draft and must prove exact no-op preservation, inclusive/exclusive conversion, multi-day timed edits, live locale draft survival, and stale-token recovery.

## Scope

### In scope

- Detail-resident M2 Edit Event for eligible Jin one-off Events and Time blocks.
- Reuse of the shipped shared Calendar range controller, natural parser, localization catalog, Calendar labels, and `event-when*` visual grammar.
- Exact initialization from canonical single/multi-day all-day and timed intervals.
- Relative relocation, direct Calendar resizing, all-day/timed conversion, overnight ranges, validation, dirty comparison, conflict preservation, and locale-safe rerendering.
- Existing Add Event, task due single mode, Month/Day/Week grid, M1 detail/back, and M2 save regression coverage.
- Browser QA and separate native owner sign-off.

### Out of scope

- Any core/bridge mutation contract, edit-token, operation recovery, or capability change.
- Google, recurring, cancelled, occurrence, or series editing.
- Recurrence, timezone selection, drag/resize, Capture Event, task promotion, task due-date redesign, Month redesign, or grid-based creation.
- A new parser grammar or non-contiguous date selection.

## Decisions

### D-01 — The edit form uses the shipped compound When contract

The date row becomes a localized `fieldset` containing:

1. relative text input plus **Use**;
2. polite preview/error;
3. shared Jin Calendar in live range mode, with no commit button;
4. localized inclusive date/range summary;
5. all-day toggle and the same text-based `HH:mm` controls used by Add Event.

There is no `input[type="date"]` in edit state and no browser/OS date-picker path. The implementation must use the existing Calendar controller and natural parser; it must not fork either module or create an edit-only calendar/parser.

### D-02 — One in-memory edit draft owns every rerender

Evolve the temporal draft from one `date` to `{start_date, end_date, is_all_day, start_time, end_time}`. Title, When, location, and description changes update the controller-owned draft as the person edits, before Save. Calendar selection and natural application update the same draft synchronously.

That draft is the only source for pending rerenders, en/pt-BR locale changes, validation feedback, `Review my draft`, and transient failures. Rendering must not reset it from canonical detail except on initial Edit, explicit **Use latest**, successful Save, or Cancel exit.

### D-03 — Canonical intervals initialize losslessly

- All-day canonical `[start,end)` initializes the visible inclusive range as `start…end-1 day`.
- Timed canonical start/end initialize their respective date endpoints and wall times, including multi-day/overnight intervals.
- The draft retains an exact temporal baseline alongside its editable projection.
  Whenever the current projection is semantically equal to that retained
  baseline, composition reuses the baseline `start` and `end` strings verbatim
  rather than reconstructing them from minute inputs. This preserves seconds
  and the existing separate TZID behavior for title-only, locale-only,
  change-then-revert, and untouched Save paths. This promise applies to the
  existing bridge-supported wall-time grammar; this change does not add offset
  parsing to the bridge or a second TZID input.

### D-04 — Calendar selection resizes; relative input relocates

The two input methods intentionally express different edit intentions:

- Direct Calendar selection uses the shipped first-click valid one-day / second-click inclusive range / third-click restart behavior and literally replaces both draft endpoint dates. Existing clock values remain. This is an explicit resize operation, not a relocation. If a one-day resize combines an overnight clock pair into a zero/backwards interval, the draft may be temporarily invalid and Save stays blocked until the person selects a later end date or changes a time; the controller must not silently add a day.
- A valid date-only relative expression moves the draft start to that date and shifts its end by the same signed wall-date delta, preserving inclusive all-day span or timed endpoint spacing, all-day/timed state, and both clock values. It is a relocation, not a resize.
- A valid expression with time moves the start to that date/time. If the draft is timed, preserve its current **naive wall-clock duration in whole minutes** between the draft endpoints and derive the new end with wall-date arithmetic, including overnight/multi-day rollover. DST elapsed-time reinterpretation is out of scope and the existing TZID is retained. If the draft is all-day, discard its prior day span and create a one-hour timed interval starting at the explicit time, with next-day rollover when required, matching Add Event’s safe timed default.
- Invalid text updates localized guidance but never mutates the valid draft.

FORGE must confirm this resize-versus-relocate distinction before implementation. It preserves M2’s prior “change date shifts both boundaries” behavior while making an explicit Calendar range the way to change duration.

### D-05 — Inclusive UI and half-open canonical semantics remain exact

- All-day visible `D1…D2` serializes to `start=D1`, `end=D2+1 day`.
- Timed ranges serialize endpoint wall datetimes.
- Same-day timed end must be later than start; later-date end may have an earlier clock time.
- Toggling timed → all-day keeps the visible endpoint dates and converts the inclusive range to a half-open end.
- Toggling all-day → timed keeps visible endpoint dates and uses retained/default times; a canonically all-day draft initializes those hidden defaults to 09:00–10:00. Toggling timed → all-day → timed within one edit retains the prior clock values.
- Clear/missing range, malformed `HH:mm`, zero, or backwards intervals block Save locally without changing the canonical Event.

No timezone selector or new TZID policy is introduced. Changed timed values are
serialized as local naive `YYYY-MM-DDTHH:mm:00` values and reuse the existing
single M2 `tzid` value; changed all-day values omit TZID. Floating timed Events
remain floating and TZID-backed timed Events retain their existing TZID under
the current bridge-representable invariant that both endpoints share it.
Untouched or semantically reverted temporal projections use the retained exact
baseline strings instead of this changed-value serializer. No core, bridge,
capability, operation, or canonical schema change is required.

### D-06 — Dirty and conflict comparison understand both endpoints

Dirty/no-op comparison includes both date endpoints and all other editable fields. A latest canonical Event is normalized to the same draft shape before `changedEditableFields` runs. Conflict copy may present the temporal difference as localized **Date** once rather than duplicate Start date/End date prose, but it must detect either endpoint changing.

On stale conflict:

- the entire compound When draft remains visible and interactive;
- latest detail supplies the fresh edit token and comparison only;
- **Review my draft** preserves text, selection, all-day state, times, title, location, and description;
- **Use latest** rebuilds the complete When surface from latest canonical data;
- neither choice writes; a later explicit Save is required.

The edit draft's exact temporal baseline travels with the draft. **Review my
draft** keeps that baseline even after latest detail provides the fresh token,
so an untouched older interval can be explicitly resubmitted without losing
seconds. Composition compares the preserved draft projection with its own
baseline for exact passthrough, while dirty/conflict reporting compares the
draft's resulting exact interval with latest canonical start/end. **Use latest**
replaces both the editable projection and exact baseline with latest canonical
data.

### D-07 — M2 interaction and authority remain unchanged

Edit stays in the same bounded detail article with source and Time block identity visible. Focus begins on Title. Save/Cancel remain in the header; Escape cancels, Mod+Enter saves, Description Enter inserts a newline, and pending Save ignores repeats. Cancel discards the draft and returns focus to Edit. Successful Save refetches canonical detail, notifies only for a real mutation, and restores focus to Edit.

Entry and command authority continue to trust core detail capability and core revalidation. No edit affordance or Calendar is rendered for Google, recurring, or cancelled items.

### D-08 — Live locale changes preserve unsubmitted DOM state

The host resolves the existing Event locale and passes its locale/labels to the generic Calendar exactly as Add Event does. Switching en ↔ pt-BR while editing localizes headings, When labels, parser hint/preview, Calendar month/weekdays/actions, range summary, times, feedback, and conflict copy without reparsing existing text or losing any draft field or Calendar focus context.

The generic Calendar remains Event-agnostic, Add Event behavior remains unchanged, and task due consumers retain single mode and their existing fallback labels/events.

## Resolved FORGE gates

### DG-01 — Direct Calendar resize and relative relocation are distinct

Resolved as specified in D-04. Calendar selection owns endpoint dates and may
produce a temporarily invalid timed interval without hidden correction.
Date-only relative input shifts both endpoints by the same signed day delta.
Timed relative input preserves naive wall-clock duration for timed drafts. An
explicit time on an all-day draft intentionally converts it to a one-hour timed
interval; it does not preserve the former all-day span.

### DG-02 — Existing GUI/bridge wall-time contract is sufficient

Resolved with no core or bridge change. Preserve an exact temporal baseline in
the edit draft and reuse it whenever the visible projection is semantically
unchanged. Only genuinely changed temporal projections use minute-resolution
wall-time serialization and the existing single TZID input. Conflict handling
must preserve or replace the exact baseline together with the visible When
draft, and dirty comparison must compare the resulting exact interval against
latest canonical data.

## Stories

- **S1 (P0, 2d)** — Evolve pure edit draft/serialization/comparison for endpoint ranges and lossless initialization.
- **S2 (P0, 3d)** — Render and synchronize the shared compound When surface inside the dynamic detail editor.
- **S3 (P0, 2d)** — Preserve locale, dirty state, validation, pending, Cancel, Use latest, and Review draft lifecycles.
- **S4 (P0, 2d)** — Prove M2 authority/conflict/no-op and Add Event/task/grid regressions.
- **S5 (P1, 1d)** — Browser visual/keyboard QA and native owner sign-off.

## Acceptance criteria

- **AC-001** GIVEN an eligible Event enters Edit WHEN the form renders THEN it SHALL show the shared compound When surface and no native date input/picker, while source/kind identity and title focus remain.
- **AC-002** GIVEN canonical all-day `[D1,D3)` WHEN Edit initializes THEN Calendar and summary SHALL show inclusive `D1…D2`.
- **AC-003** GIVEN canonical timed multi-day/overnight start/end WHEN Edit initializes THEN both endpoint dates and wall times SHALL match exactly.
- **AC-004** GIVEN no temporal edit or a title-only edit WHEN input is composed THEN original start/end strings and TZID behavior SHALL remain exact.
- **AC-005** GIVEN Calendar range selection WHEN one, two, reverse, cross-month, or third-click interactions occur THEN the existing live range contract SHALL apply and draft endpoints SHALL match without an extra commit.
- **AC-006** GIVEN valid date-only relative text WHEN Enter/Use applies THEN start and end dates SHALL shift by the same delta while span, all-day state, and times remain.
- **AC-007** GIVEN valid relative date/time on a timed draft WHEN applied THEN wall-clock duration SHALL remain and the derived endpoint SHALL handle overnight/multi-day rollover.
- **AC-008** GIVEN valid relative date/time on an all-day draft WHEN applied THEN it SHALL become a one-hour timed draft synchronized with Calendar and summary.
- **AC-009** GIVEN invalid relative text WHEN preview/apply runs THEN localized guidance SHALL appear and no valid draft field SHALL change.
- **AC-010** GIVEN an inclusive all-day range WHEN Save composes input THEN canonical end SHALL be the day after the last visible date, including month/year/leap boundaries.
- **AC-011** GIVEN a timed same-day, overnight, or multi-day range WHEN Save validates THEN only zero/backwards chronology or malformed time SHALL block; valid endpoint wall datetimes SHALL serialize exactly.
- **AC-012** GIVEN all-day is toggled either direction WHEN the draft updates THEN visible endpoint dates SHALL remain and canonical conversion/default times SHALL follow D-05.
- **AC-013** GIVEN any field or Calendar selection changes WHEN locale, validation, pending, or Review draft rerenders THEN every unsubmitted value and range SHALL remain intact.
- **AC-014** GIVEN en/pt-BR live switching WHEN edit rerenders THEN all visible/accessibility Calendar/When/edit/conflict copy SHALL localize without reparsing text, resetting range, or changing canonical data.
- **AC-015** GIVEN an unchanged complete draft WHEN Save runs THEN the existing no-op contract SHALL perform no canonical mutation notification or grid refresh.
- **AC-016** GIVEN Save is pending or fails validation/retriably WHEN UI rerenders THEN duplicate commands SHALL be prevented and the full compound draft SHALL remain safe to retry.
- **AC-017** GIVEN a stale conflict WHEN latest detail loads THEN changed endpoint dates SHALL be detected, the draft SHALL remain, and conflict choices SHALL not write.
- **AC-018** GIVEN Use latest or Review my draft WHEN activated THEN Use latest SHALL rebuild all When state/token from latest while Review SHALL preserve all draft state; a later Save SHALL use the fresh token.
- **AC-019** GIVEN Cancel/Escape, Mod+Enter, or Description Enter WHEN used THEN original M2 non-mutation, single-save, newline, and focus-restoration behavior SHALL remain.
- **AC-020** GIVEN Google, recurring, or cancelled detail WHEN rendered/authorized THEN Edit and its When surface SHALL remain unavailable and core command rejection SHALL remain unchanged.
- **AC-021** GIVEN Add Event, task due Calendar, Month/Day/Week, detail Back, and Time block flows WHEN regression suites run THEN create range/parser, single selection, timeline scroll/focus, authority, and linkage SHALL remain unchanged.
- **AC-022** GIVEN supported widths, 200% zoom, themes, reduced motion, mouse, and keyboard WHEN browser/native QA runs THEN the embedded Calendar and actions SHALL remain reachable with no clipping, document overflow, console error, or keyboard trap; VIGIL automation and native owner sign-off remain distinct.

## Verification

```sh
npm --prefix jin-gui test -- --run src/__tests__/event_edit.test.ts
npm --prefix jin-gui test -- --run src/__tests__/events_controller.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_controller.test.ts src/__tests__/calendar_natural_language.test.ts
npm --prefix jin-gui test -- --run src/__tests__/calendar_view_controller.test.ts src/__tests__/event_locale.test.ts
npm --prefix jin-gui test -- --run src/__tests__/tasks_controller.test.ts src/__tests__/capture_controller.test.ts
npm --prefix jin-gui test -- --run
npm --prefix jin-gui run build
npm --prefix jin-gui run lint:css
cargo fmt --all -- --check
git diff --check
```

## Handoff

FORGE resolved DG-01 and DG-02 above. Vivi may implement S1–S5 within those
boundaries. VIGIL independently checks all 22 criteria in recorded block mode,
including exact change-then-revert and stale Review-draft temporal fixtures,
performs browser QA, and requests native owner sign-off.
