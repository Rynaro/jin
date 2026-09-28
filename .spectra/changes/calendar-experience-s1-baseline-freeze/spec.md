# S1 — Freeze current behavior and ownership

One-page spec for the `calendar-experience-s1-baseline-freeze` ESL change. This is Stage 1 of the 8-stage calendar-experience rebuild (`.spectra/plans/calendar-experience/`). Distilled from `implementation.md`'s S1 section; that document remains the source of record.

## User story

As a release owner, I want the accepted Google and Calendar baseline recorded so that a workflow redesign cannot erase stability fixes.

Timebox 1d. Risk P0. Executor mid. Depends on: none.

## Scope / actions

1. Re-run the current focused test suites (TS + Rust) covering create/detail/edit/Today/Capture/Notifications and capture pass/fail results, cross-referenced to the already-captured baseline recipe (`.artifacts/playwright-mcp/calendar-experience-baseline.md` and its screenshots/console log, current at commit `c03c408`).
2. Inventory, by reading (not rewriting) the primary evidence files, all: event payload builders; recurrence-scope transients; source/color helpers; Calendar CSS duplicate declarations; static dialog IDs/targets; current Events locale keys (`en`/`pt-BR`).
3. Add one AC-to-test manifest file under `.artifacts/playwright-mcp/calendar-experience/` combining the test results and the full inventory, without changing product behavior.
4. Record dirty-worktree/untracked files present before this change and confirm they remain untouched; no whole-file replacement of anything.

Primary evidence/files (read-only inspection):

- `jin-gui/index.html`
- `jin-gui/src/controllers/{calendar_view,events,today,capture,notifications,router}_controller.ts`
- `jin-gui/src/lib/events/{edit,render,invitation}.ts`
- `jin-gui/src/lib/calendar/{time_grid,time_grid_render,colors}.ts`
- `jin-gui/src/styles/{calendar,browse,forms,components,a11y}.css`

## Out of scope

Everything in S2–S10 of the parent plan: core `CalendarRangeProjection`/`EventTemporalPreview`/`EventEditDelta`, the unified `EventDraft`, the operation-state reducer, the shared Preview/Composer/Event Companion host, calendar identity/filter/CSS-ownership consolidation, the temporal cursor and in-context creation, capability-gated move/resize and recurrence UX, surface migrations (full detail/Today/Capture/Notifications), accessibility/responsive/localization hardening, native/provider/recovery verification, and the usability rollout gate. No product source behavior or visual change of any kind. No new runtime dependency.

## Output contract

- Baseline manifest file under `.artifacts/playwright-mcp/calendar-experience/` cross-referencing current create/detail/edit/Today flows to their tests.
- Duplicate-CSS-owner inventory (Calendar-relevant selectors across `calendar.css`, `browse.css`, `forms.css`, `components.css`, `a11y.css`).
- Payload-builder inventory (`invoke.ts` event commands, `lib/events/edit.ts` `inputFromDraft`, `lib/capture/transform.ts` `buildCreateEventPayload`, backend `EditEventInput`/`RoutedEventInput`/`DiscoveredCalendar`).
- Green current focused tests (TS + Rust), with any pre-existing failures recorded, not fixed.
- No visual change. No behavior change.
