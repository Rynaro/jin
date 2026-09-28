# Staged implementation plan

This is the execution handoff after greenlight. It deliberately sequences data/time truth before direct manipulation and shared presenters before consumer migration. Each stage leaves the repository runnable and has a rollback boundary.

## Dependency spine

```text
S1 baseline
 └─ S2 range projection + EventDraft + operation reducer
     └─ S3 shared Preview/Composer/Companion
         └─ S4 identity/filter/CSS ownership
             └─ S5 cursor/in-context create
                 └─ S6 move/resize/recurrence
                     └─ S7 surface migrations
                         └─ S8 a11y/responsive/i18n
                             └─ S9 native/provider/recovery
                                 └─ S10 usability gate
```

Do not start S5/S6 against raw `list_events` geometry. Do not remove old create/edit markup until its consumer has migrated and focused tests pass.

## S1 — Freeze current behavior and ownership

**User story:** As a release owner, I want the accepted Google and Calendar baseline recorded so that a workflow redesign cannot erase stability fixes.

Timebox: `1d`. Risk: `P0`. Executor: `mid`. Depends on: none.

Actions:

1. Re-run focused current suites and capture the existing create/detail/edit/Today flows from the supplied baseline recipe.
2. Inventory all event payload builders, recurrence-scope transients, source/color helpers, Calendar CSS duplicate declarations, static dialog IDs/targets, and current locale keys.
3. Add an AC-to-test manifest under `.artifacts/playwright-mcp/calendar-experience/` without changing product behavior.
4. Record dirty-worktree files and preserve all user changes; no whole-file replacement.

Primary evidence/files:

- `jin-gui/index.html`
- `jin-gui/src/controllers/{calendar_view,events,today,capture,notifications,router}_controller.ts`
- `jin-gui/src/lib/events/{edit,render,invitation}.ts`
- `jin-gui/src/lib/calendar/{time_grid,time_grid_render,colors}.ts`
- `jin-gui/src/styles/{calendar,browse,forms,components,a11y}.css`
- current focused tests named in S9

Output contract: baseline manifest, duplicate-owner inventory, payload-builder inventory, and green current focused tests. No visual change.

## S2 — Core range projection, temporal preview, EventDraft, operation reducer

**User story:** As a calendar user, I want every view and editor to agree on time, timezone, calendar route, and save state.

Timebox: `4d`. Risk: `P0`. Executor: `mid/deep`. Depends on: S1.

Core/Tauri actions:

1. Add `CalendarRangeProjectionInput/Dto` in `jin-core`, using `config.display_tz` and `time::resolve_to_utc`; project all-day/floating/anchored events, independent endpoint zones, continuation dates, slot state, elapsed duration, and typed temporal editability reason.
2. Add `EventTemporalPreviewInput/Dto`, delegating to the same resolver. Ordinary one-hour gaps may return shifted resolution; non-standard unresolved gaps return typed `unresolvable_local_time`.
3. Add a core sparse `EventEditDelta` with one optional atomic temporal bundle (`start`, `end`, all-day/value types, floating state, `start_tzid`, `end_tzid`). Reject partial temporal endpoints at deserialization/type construction. Under the supplied edit token, load the canonical event, validate the token, merge the delta into that baseline, compile recurrence against merged time, then enter the existing full local/routed mutation and outbox path.
4. Add a Tauri sparse-edit command and GUI invoke/DTO types. Preserve the current full `EditEventInput` as a migration-only adapter that constructs the complete temporal bundle and accepts legacy `tzid`; never synthesize omitted temporal values in the browser or overwrite a distinct baseline end zone.
5. Keep range projection read-only and bounded to requested dates.

GUI pure-model actions:

1. Extract `EventDraft` from `lib/events/edit.ts` into `lib/events/draft.ts`: constructors from event/slot/Capture, sparse dirty fields, validation input, summaries, recurrence scope, attendee/conference intent, and local/routed serializer adapters.
2. Add `lib/events/operation_state.ts` as a pure reducer for draft/validating/persisting/sync-pending/confirmed/needs-review/conflict.
3. Ensure non-time edits omit start/end/zones. Preserve all values through disclosure changes.

Planned files:

- `jin-core/src/time/mod.rs`
- `jin-core/src/dto/event.rs` and DTO module exports
- `jin-core/src/ops/agenda.rs` or a focused new `jin-core/src/ops/calendar_projection.rs`
- `jin-core/src/ops/event_mutation.rs`
- `jin-gui/src-tauri/src/commands/events.rs`, `jin-gui/src-tauri/src/lib.rs`
- `jin-gui/src/invoke.ts`, `jin-gui/src/types/dto.ts`
- new `jin-gui/src/lib/events/{draft,operation_state}.ts`
- `jin-gui/src/lib/events/edit.ts` compatibility adapter during migration
- Rust/Tauri/TS fixture tests

Output contract: deterministic range/temporal DTOs; title-only cross-zone edits preserve both endpoints/zones; partial temporal bundles are rejected; stale tokens fail before sparse merge/write; no Calendar rendering change yet; all existing event operations green.

Gate: AC-CALX-024, 027, 035–039, 051, 054–056.

## S3 — Shared Preview, Composer, and Event Companion

**User story:** As a user, I want one understandable event surface whose fields and behavior stay consistent wherever I enter it.

Timebox: `4d`. Risk: `P0`. Executor: `mid`. Depends on: S2.

Actions:

1. Add `lib/events/preview.ts` from current full detail and Today preview patterns. It consumes `EventDetailDto`, operation state, and callbacks; it never fetches or mutates by itself.
2. Add `lib/events/composer.ts` around `EventDraft`: persistent header summary, progressive sections, field errors, scope field, change summary, inline discard decision, and stable footer.
3. Add `lib/events/recurrence_scope.ts`; migrate only one existing consumer initially and keep compatibility adapters until S7.
4. Add `lib/ui/companion.ts`: an outer-content-width observer, 360px wide non-modal complementary rail at ≥920px normal scale, `JinModal` otherwise, state-preserving host migration, focus-return identity, and submitting/dirty close policy.
5. Add one cancelable `RouterController` app-navigation guard. Companion modes remain out of browser/hash history.
6. Add `events.css`; import it at the proper cascade seam. Use current primitives/tokens; do not style calendar geometry there.

Planned files:

- new `jin-gui/src/lib/events/{preview,composer,recurrence_scope}.ts`
- new `jin-gui/src/lib/ui/companion.ts`
- `jin-gui/src/lib/ui/modal.ts` only if a narrow lifecycle hook is missing
- `jin-gui/src/controllers/router_controller.ts`, `jin-gui/src/lib/router.ts`
- new `jin-gui/src/styles/events.css`
- `jin-gui/src/styles/index.css`, `forms.css`, `components.css`, `a11y.css`
- new focused tests for companion, composer, preview, draft guard, and host migration

Output contract: shared components render in a test harness and preserve focus/state across rail↔modal migration; existing product surfaces still work through compatibility code.

Gate: AC-CALX-001–007, 025–026, 043–044, 052–053.

## S4 — Calendar identity, display filter, and CSS authority

**User story:** As a multi-calendar user, I want each commitment to retain its calendar identity and I want a quiet way to focus the view.

Timebox: `3d`. Risk: `P1`. Executor: `mid`. Depends on: S3.

Actions:

1. Make `calendarKeyForEvent`, calendar label/color, and account alias the only membership presentation helpers across Calendar/Preview/Composer/detail/notifications/search.
2. Add the route-local display filter keyed by exact calendar identity. Persist in GUI preferences/local storage; do not call any Settings/sync bridge.
3. Add filter disclosure and all-hidden recovery. Keep calendar selection for creation separate from visibility.
4. Reorder/consolidate `calendar.css`: paper field/header/filter, Month, time grid, interaction states, responsive/AX blocks. Remove earlier declarations only after equivalent owner tests pass.
5. Move preview/composer/detail content rules from broad `browse.css`/late Calendar overrides into `events.css`. Retain controller/test class hooks until migration completes.
6. Add static ownership tests rejecting canonical calendar geometry or Event Companion rules outside their owner.

Planned files:

- `jin-gui/src/lib/calendar/colors.ts`
- `jin-gui/src/lib/calendar/time_grid_render.ts`
- `jin-gui/src/lib/events/{render,preview,composer}.ts`
- `jin-gui/src/controllers/calendar_view_controller.ts`
- `jin-gui/src/styles/{calendar,events,browse,index,a11y}.css`
- `jin-gui/src/__tests__/{calendar_colors,calendar_view_controller,events_controller}.test.ts`
- new CSS ownership/static test

Output contract: calendar identity matches every surface; filter has zero bridge calls; one CSS owner per primitive/composition.

Gate: AC-CALX-040–042, 046, 061.

## S5 — Temporal cursor and in-context creation

**User story:** As a calendar user, I want to create time where I see it so that scheduling feels immediate and predictable.

Timebox: `4d`. Risk: `P0`. Executor: `mid/deep`. Depends on: S2, S3, S4.

Actions:

1. Make `CalendarViewController` consume `calendar_range_projection` instead of raw event wall-time geometry for Month/Week/Day.
2. Extend `time_grid.ts`/`time_grid_render.ts` with display-time slots, unavailable/ambiguous-earlier states, temporal cursor, live announcement, chronological agenda bypass, and event occupancy.
3. Add pure `lib/calendar/interaction.ts` for cursor initialization/restoration, 15-minute movement, click/tap selection, fine-pointer range selection, all-day Month selection, pointer capture/cancel, and 60-minute default.
4. Keep Month date-number → Day. Add unused-space create and focus/coarse `Add on date` action.
5. Open Composer directly with `draftFromSlot`; keep global Add using selected date/range and the same constructor.
6. Preserve current time-grid scrolling/night expansion and Day due-task appendage after the scroller.

Planned files:

- `jin-gui/src/controllers/calendar_view_controller.ts`
- `jin-gui/src/lib/calendar/{time_grid,time_grid_render,interaction}.ts`
- `jin-gui/src/styles/calendar.css`
- `jin-gui/index.html` for workspace/rail/filter host, not a second editor
- `jin-gui/src/__tests__/{calendar_time_grid,calendar_view_controller}.test.ts`
- new `calendar_interaction.test.ts`

Output contract: all three views start drafts in context; coarse-pointer scroll is untouched; no write occurs before Composer Save.

Gate: AC-CALX-008–014, 021–024, 049, 051, 059.

## S6 — Capability-gated move/resize and recurrence

**User story:** As an authorized owner, I want to reshape commitments from the grid without losing recurrence, timezone, or provider truth.

Timebox: `5d`. Risk: `P0`. Executor: `deep`. Depends on: S5.

Actions:

1. Add sequenced event-detail loading/caching with invalidation on selection/range/visibility/locale/display-zone/controller teardown.
2. Render move body/end handle only after current `detail.capabilities.collaboration.can_edit_schedule`; ambiguous unsafe existing times expose the projection's stable disabled reason.
3. Implement fine-pointer move/end-resize and keyboard `Alt+Arrow` / `Alt+Shift+Up/Down` into the same pure draft geometry. Keep elapsed duration on move and 15-minute minimum on resize.
4. On gesture completion, open Composer with before→after summary. Never submit automatically.
5. Require explicit supported recurrence scope; gate pattern controls to entire-series/support. Keep `this_and_following` absent.
6. Exercise stale edit token, capability loss while dirty, cross-midnight, cross-zone, ordinary DST gap, non-standard gap error, ambiguous earlier-only, and pointer cancellation.

Planned files: S5 owners plus `lib/events/{draft,composer,recurrence_scope}.ts`, `controllers/events_controller.ts`, recurrence/direct-manipulation tests.

Output contract: direct manipulation is a safe draft accelerator over existing durable mutation APIs; no alternate write path.

Gate: AC-CALX-015–020, 030–034, 055–056.

## S7 — Migrate full detail, Today, Capture, and Notifications

**User story:** As a user moving between Jin surfaces, I want the same event meaning and actions without losing each surface's purpose.

Timebox: `5d`. Risk: `P0`. Executor: `mid/deep`. Depends on: S3, S6.

Actions:

1. Calendar event activation opens shared Preview; remove the ordinary full-detail navigation behavior but retain `Open full details`.
2. Full detail retains existing context/diagnostics and replaces generated full-page edit with shared Composer modal.
3. Today replaces only its event preview/editor with shared Preview/Composer; task preview and `TodayProjectionDto` remain untouched.
4. Capture binds current compact fields to EventDraft and adds More event options handoff. Preserve Capture tablist, parent modal, temporal picker, and outcome routing.
5. Notifications retain triage and invitation ledger; use shared RSVP controls and recurrence-scope component. Do not route RSVP through EventDraft.
6. Remove the static calendar create dialog and obsolete full-page editor DOM/CSS only after all migrated adapters/tests are green.

Planned files:

- `jin-gui/index.html`
- `jin-gui/src/controllers/{calendar_view,events,today,capture,notifications}_controller.ts`
- `jin-gui/src/lib/events/{edit,render,preview,composer,invitation,recurrence_scope}.ts`
- `jin-gui/src/styles/{events,calendar,today,browse,forms,a11y}.css`
- controller tests for every migrated surface

Output contract: one draft/preview meaning; surface-specific density only; Notification RSVP remains one ledger operation.

Gate: AC-CALX-027–029, 047–048, 054, 057–060.

## S8 — Accessibility, responsive, localization, and extension contract

**User story:** As a user with any input method or display preference, I want calendar operation to remain complete and legible.

Timebox: `3d`. Risk: `P0`. Executor: `mid`. Depends on: S4–S7.

Actions:

1. Complete composite-grid/list-bypass semantics, modal/non-modal focus, live regions, forced colors, contrast, transparency, motion, and coarse-pointer behavior.
2. Add all `en`/`pt-BR` copy to Events locale; use locale/timezone formatters for dates, offsets, recurrence, operation, and errors.
3. Exercise 320, 390, 760, and 1440px; sidebar expanded/collapsed; host seam crossings; accessibility text; dense overlap; long calendar/account/event labels.
4. Document the Calendar extension contract in `docs/visual-language/README.md` only after implementation is visually accepted: placement, summaries, mode/capability/state matrix, owner, duplicate removal, and cross-entry tests.

Output contract: no inaccessible drag-only outcome, no document overflow, no false modal semantics, and a guardrail for future feature additions.

Gate: AC-CALX-001–003, 014, 021, 023, 049, 052, 061.

## S9 — Automated, native, provider, and recovery verification

**User story:** As a release owner, I want proof across local, routed, recurring, invitation, and recovery states before accepting a definitive workflow.

Timebox: `4d`. Risk: `P0`. Executor: `mid`; checker: independent VIGIL/ATLAS. Depends on: S8.

Focused commands (adjust only for repository script names, not coverage):

```sh
cargo fmt --all --check
cargo test -p jin-core
cargo test -p jin-gui
npm --prefix jin-gui test -- src/__tests__/calendar_time_grid.test.ts src/__tests__/calendar_view_controller.test.ts src/__tests__/calendar_interaction.test.ts src/__tests__/event_draft.test.ts src/__tests__/event_companion.test.ts src/__tests__/events_controller.test.ts src/__tests__/today_controller.test.ts src/__tests__/capture_controller.test.ts src/__tests__/notifications_controller.test.ts
npm --prefix jin-gui run lint:css
npm --prefix jin-gui run build
cargo test --workspace
git diff --check
```

Required evidence:

- deterministic Playwright matrix and zero unexpected console errors;
- native Tauri owner sign-off for rail/modal feel, pointer capture, scrolling, focus, and OAuth/settings handoff;
- disposable Google account: local create, Google create+Meet, guest update policy, recurrence occurrence/series, move/resize draft then save, pending/confirmed/paused/reauth, and no duplicate after close/retry;
- no claim that an invitation email was delivered;
- full retained Google stable-release and Notification RSVP regressions;
- AC-indexed manifest and independent checker report.

## S10 — Task-based usability gate and rollout decision

**User story:** As the product owner, I want observed evidence that the new workflow is understandable before it becomes the only workflow.

Timebox: `2d`. Risk: `P1`. Executor: product/QA with owner sign-off. Depends on: S9.

Recruit five participants: three current Jin users who actively use a routed Google calendar and two calendar-competent people unfamiliar with this redesign. Each participant performs all five tasks; distribute desktop and compact width so every task is observed in both hosts across the study. Each participant performs at least two tasks keyboard-only. The product owner observes and decides rollout but is not counted as independent usability evidence.

1. Create a 60-minute event on Agenda Pessoal with Meet and verify its current operation state.
2. Move a local event across midnight, review the before→after summary, then cancel without mutation.
3. Reschedule one supported occurrence of a recurring Google event and explain scope.
4. RSVP from Notification Center, open the same event from Today, and identify provider-confirmed versus requested response.
5. Start in Capture, add advanced recurrence/timezone details, save, and return to the expected context.

Pass rule: every participant completes at least four of five tasks without leaving the intended context or causing an incorrect calendar/provider action, at least 22 of 25 attempts succeed overall, and no P0 misunderstanding occurs. For task 1, at least four of five participants reach the durable submitted state within 30 seconds; external Google confirmation time is recorded separately and excluded. Record completion time, errors, route changes, verbal model, input method, host, and owner observations. This is a release gate for the specified tasks, not proof of broad retention or population-level usability. Failure returns to S3/S5/S7 by cause; it does not trigger cosmetic patching over an incoherent contract.

## Rollback strategy

- Keep current controller class/target hooks until each consumer migration is green.
- Range projection can coexist with `list_events` behind an internal adapter during S2–S5; remove fallback only after parity fixtures pass.
- Shared Preview/Composer may migrate one surface at a time; rollback removes the adapter, not the shared model used by completed consumers.
- Retain old CSS declarations until static ownership tests cover their replacements, then remove them in the owning stage.
- Never roll back durable provider operations by deleting canonical data. UI rollback concerns presenters and adapters only.

## Declared implementation scope

Expected product scope (amend RAMZA before expanding outside these owners):

```text
jin-core/src/time/mod.rs
jin-core/src/dto/**
jin-core/src/ops/{agenda.rs,calendar_projection.rs}
jin-core/src/ops/event_mutation.rs
jin-gui/src-tauri/src/{lib.rs,commands/events.rs}
jin-gui/index.html
jin-gui/src/invoke.ts
jin-gui/src/types/dto.ts
jin-gui/src/controllers/{calendar_view,events,today,capture,notifications,router}_controller.ts
jin-gui/src/lib/router.ts
jin-gui/src/lib/ui/{modal,companion}.ts
jin-gui/src/lib/calendar/**
jin-gui/src/lib/events/**
jin-gui/src/styles/{index,tokens,components,forms,events,calendar,today,browse,a11y}.css
jin-gui/src/__tests__/**calendar**
jin-gui/src/__tests__/**event**
jin-gui/src/__tests__/{today,capture,notifications,ui_modal,router_controller}*.test.ts
jin-core/tests/**
jin-gui/src-tauri/tests/**
docs/visual-language/README.md
.artifacts/playwright-mcp/calendar-experience/**
```

No new runtime dependency is expected. A new dependency, canonical temporal storage field, provider scope, or external API is plan drift and requires a recorded amendment.
