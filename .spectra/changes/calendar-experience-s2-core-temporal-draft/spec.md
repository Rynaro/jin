# S2 — Core range projection, temporal preview, EventDraft, operation reducer

Full-tier spec for the `calendar-experience-s2-core-temporal-draft` ESL change. This is Stage 2 of the 8-stage calendar-experience rebuild (`.spectra/plans/calendar-experience/`). It distills the already-approved `implementation.md` S2 section, `criteria.md`'s S2 gate, and `decisions.md`'s D6/D8 rationale into this change's own artifacts. It does not re-derive, second-guess, or amend that architecture.

Depends on: `calendar-experience-s1-baseline-freeze` (status `verified`, tier `lite`).

## Why this change does not require a fresh critique cycle

The parent plan (`.spectra/plans/calendar-experience/spec.md`) went through RAMZA's full RS→S→P→E→C→T→A cycle at `full` tier, was independently critiqued by a checker distinct from its author (`plan.state.json`: `critic.author = "calendar_experience_spec"`, `critic.checker = "calendar_experience_audit"`, recorded 2026-09-16T20:21:58Z), and reached `AUTO_PROCEED` confidence of **94.75%**. `critique.md`'s verdict is explicit: **"no remaining implementation-readiness blockers"** for exactly the contracts this stage builds. The 61-criteria set was frozen with `criteria_sha256 = b2f3a342fb01c6c15c04e6aa61cee8756d5971c891d63716b18fce807e94f73b`.

This change is a mechanical **execution slice** of that already-frozen architecture — it introduces no new API shape, no new tradeoff, and no rejected-alternative reconsideration beyond what `decisions.md` (D6, D8, D13) already settled. Re-running an independent critique cycle here would re-litigate a decision already made by a different reviewer against the same acceptance criteria this slice is scoped to satisfy. What needs this stage's own verification is mechanical correctness of execution — gated by this change's `acceptance_checks`, checked by VIGIL, not by a second RAMZA critique.

## User story

As a calendar user, I want every view and editor to agree on time, timezone, calendar route, and save state.

Timebox: `4d`. Risk: `P0`. Executor: `mid/deep`. Depends on: S1.

## Scope / actions

### 1. Fixture compile fix (first action — user-approved sequencing addition)

`cargo test -p jin-gui` currently fails to compile with 9 pre-existing `E0063` "missing field" errors, because `EditEventInput`/`RoutedEventInput` (`jin-gui/src-tauri/src/commands/events.rs`) and `DiscoveredCalendar` (`jin-core/src/google/account.rs`) already carry required fields (`guest_update_policy`, `clear_recurrence`, `recurrence`, `allowed_conference_solution_types`) that 9 struct-literal test fixtures across two files never picked up. Add the missing fields at the 9 verified sites using each field's own default/behavior-preserving value:

- `jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs:28` — add `allowed_conference_solution_types: vec!["hangoutsMeet".to_string()]` to the `DiscoveredCalendar` literal.
- `jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs:62,87,143,194` — add `guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy::All` to each `RoutedEventInput` literal.
- `jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs:112,220` — add `recurrence: None, clear_recurrence: false` to each `EditEventInput` literal.
- `jin-gui/src-tauri/tests/bridge.rs:1487,1515` — add `recurrence: None, clear_recurrence: false` to each `EditEventInput` literal.

This is purely additive to test fixtures. No production code changes, no assertion changes, no behavior change. This must land before action 2+ so the Rust regression harness is usable while S2 extends the same structs. (Line numbers are from RAMZA's read at spec time — re-grep first since your fixture-fix edits will shift subsequent line numbers as you go; match by struct-literal identity, not blindly by line number.)

### 2–6. Core/Tauri actions (from `implementation.md` S2, unmodified)

2. Add `CalendarRangeProjectionInput/Dto` in `jin-core`, using `config.display_tz` (pattern at `jin-core/src/ops/agenda.rs:64`) and `jin_core::time::resolve_to_utc` (`jin-core/src/time/mod.rs:79`). Project all-day/floating/anchored events, independent endpoint zones, continuation dates, slot state, elapsed duration, and typed temporal editability reason.
3. Add `EventTemporalPreviewInput/Dto`, delegating to the same resolver. Ordinary one-hour gaps may return shifted resolution; non-standard unresolved gaps return typed `unresolvable_local_time`.
4. Add a core sparse `EventEditDelta` with one optional atomic temporal bundle (`start`, `end`, all-day/value types, floating state, `start_tzid`, `end_tzid`). Reject partial temporal endpoints at deserialization/type construction. Under the supplied edit token, load the canonical event, validate the token, merge the delta into that baseline, compile recurrence against merged time, then enter the existing full local/routed mutation and outbox path (`jin_core::ops::event_mutation::EventMutationService`, existing `edit_local_scoped`/`edit_with_guest_update_policy` entry points).
5. Add a Tauri sparse-edit command and GUI invoke/DTO types. Preserve the current full `EditEventInput` (`jin-gui/src-tauri/src/commands/events.rs:56`) as a migration-only adapter that constructs the complete temporal bundle and accepts legacy `tzid`; never synthesize omitted temporal values in the browser or overwrite a distinct baseline end zone.
6. Keep range projection read-only and bounded to requested dates.

### 7–9. GUI pure-model actions (from `implementation.md` S2, unmodified)

7. Extract `EventDraft` from `jin-gui/src/lib/events/edit.ts` (current `EventEditDraft`/`EventEditInput`/`draftFromEvent`/`inputFromDraft`, at `edit.ts:16-76`) into new `jin-gui/src/lib/events/draft.ts`: constructors from event/slot/Capture, sparse dirty fields, validation input, summaries, recurrence scope, attendee/conference intent, and local/routed serializer adapters.
8. Add `jin-gui/src/lib/events/operation_state.ts` (new file) as a pure reducer for draft/validating/persisting/sync-pending/confirmed/needs-review/conflict.
9. Ensure non-time edits omit start/end/zones. Preserve all values through disclosure changes.

## Out of scope

Everything in S3–S10 of the parent plan: no shared Preview/Composer/Event Companion host, no `events.css`, no rail/modal host logic, no calendar identity/filter presentation changes, no CSS-ownership consolidation, no cursor/move/resize semantics, no surface migration for full detail/Today/Capture/Notifications, no accessibility/responsive/localization hardening, no native/provider/recovery verification, no usability rollout gate. No change to `CalendarViewController`'s current consumption of raw `list_events` geometry (that's S5's job). No CSS of any kind, no Calendar rendering/visual change of any kind. No new runtime dependency, no new provider scope, no canonical temporal storage field.

## Planned files

```text
jin-gui/src-tauri/tests/bridge.rs                          (fixture fix only)
jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs (fixture fix only)
jin-core/src/time/mod.rs
jin-core/src/dto/event.rs                                   (and jin-core/src/dto/mod.rs exports)
jin-core/src/ops/agenda.rs  or  new jin-core/src/ops/calendar_projection.rs
jin-core/src/ops/event_mutation.rs
jin-gui/src-tauri/src/commands/events.rs
jin-gui/src-tauri/src/lib.rs
jin-gui/src/invoke.ts
jin-gui/src/types/dto.ts
new jin-gui/src/lib/events/draft.ts
new jin-gui/src/lib/events/operation_state.ts
jin-gui/src/lib/events/edit.ts   (compatibility adapter during migration)
new/updated Rust/Tauri/TS fixture tests (jin-core/tests/**, jin-gui/src-tauri/tests/**)
```

## Output contract

- The 9 fixture omissions are fixed; `cargo test -p jin-gui` compiles with zero `E0063` errors and every pre-existing test in `bridge.rs`/`google_calendar_mutation_routing.rs` passes with unchanged assertions.
- Deterministic `CalendarRangeProjectionDto`/`EventTemporalPreviewDto` behavior, verified core-to-TypeScript.
- Title-only cross-zone edits preserve both endpoints/zones.
- Partial temporal bundles are rejected at construction (Rust type + Tauri/TS input).
- Stale edit tokens fail before sparse merge/write.
- No Calendar rendering change yet.
- All existing event operations remain green (S1 baseline suite unaffected).

## Gate (inherited, not re-derived)

`criteria.md`: AC-CALX-024, 027, 035–039, 051, 054–056.

## Open questions (flagged by RAMZA, not blockers, resolve mechanically)

1. `jin_core::time::resolve_to_utc` (`jin-core/src/time/mod.rs:79`) returns untyped `Result<TzResolution, String>` for both invalid-tzid and non-standard-gap failures, with 6 other call sites workspace-wide. Prefer pre-validating tzid via the existing `jin_core::time::validate_tzid` (used in `commands/events.rs::parse_input`) and treating any post-validation error as the gap case, rather than changing `resolve_to_utc`'s signature.
2. `temporal_disabled_reason`'s exact Rust type (new enum vs `String`) is unspecified — your mechanical judgment call; prefer a small enum for type safety if it doesn't ripple scope.
3. The new routed sparse-edit Tauri input type's name isn't specified in the parent plan — name it consistently with the existing `RoutedEditEventInput` sibling.
