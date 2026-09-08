---
eidolon: ramza
version: 1.1.0
kind: spec
status: superseded
superseded_by: ../changes/today-connected-agenda/spec.md
created_at: 2026-09-08T01:48:04Z
thread_id: 03a7ff1f-df82-41e7-ab69-e90c5a3232e9
target_repos:
  - Rynaro/jin
stories_count: 5
validation_gates_count: 34
confidence: 0.91
---

# Today connected agenda

> **Superseded by** `.spectra/changes/archive/2026-09-07-today-connected-agenda/spec.md` and
> `.spectra/changes/archive/2026-09-07-today-connected-agenda/criteria.md`. Retained as the
> original planning record; do not use this file as the implementation
> contract.

Change ID: `today-connected-agenda`

## Scope

Intent class: `CHANGE`.

Turn Today into Jin's connected daily desk: an editorial date header, a truthful current/up-next focus, a chronological event timeline, separate lanes for unscheduled task work, and a contextual rail made only from real task/note relationships. The reference supplies hierarchy and rhythm; Jin supplies warm paper, ink, indigo linkage, restrained vermilion Capture, accessible semantics, and responsive behavior.

In scope:

- Additive core `AgendaDto` projections for open work and current focus, resolved in `config.display_tz`.
- A compact `AgendaTaskDto` carrying only the fields Today needs; three disjoint lanes: attention, due on the selected day, and explicitly flexible.
- A deterministic, test-clock-aware focus projection for an active event or next event.
- An editorial Today header with existing previous/next/date/today navigation and existing Capture flow.
- A continuous timeline that distinguishes calendar events from promoted-task time blocks without changing their underlying event identity.
- A Connected work context rail populated from existing `originating_task` and `prep_notes` edges.
- Existing event, task, and note detail navigation from Today.
- Desktop, mobile, large-text, keyboard, dark, contrast, transparency, motion, forced-color, and coarse-pointer treatment.
- Core, bridge, TypeScript, DOM, controller-lifecycle, fixture, build, and visual verification.

Out of scope:

- New scheduling, completion, editing, drag/drop, AI summarization, search, or calendar-provider behavior.
- Fabricated task times, durations, estimates, dependencies, summaries, or prep material.
- Mutating task/event/note data from the Today timeline beyond opening existing flows.
- A new persistence field, schema migration, runtime dependency, notification, or background service.
- Replacing the Events day/week views or Tasks smart views.

Selected-date rules:

1. Current day means the date containing `now_utc` in `config.display_tz`.
2. Current-day attention contains open tasks whose date-only due is before today or whose datetime due instant is before now.
3. Due contains remaining open tasks whose due value localizes to the selected date. On non-current dates it is the only standalone task lane.
4. Flexible contains remaining open tasks explicitly marked `agenda_bucket=flexible`, and appears only on the current day.
5. Lane precedence is attention, due, flexible. Completed, cancelled, deleted, invalid-due, and already represented originating tasks are excluded.
6. Task ordering is deterministic: due instant/date, then existing manual position, then title and id. Flexible ordering uses manual position, then title and id. The UI does not imply precision absent from the task.

Focus rules:

- Focus exists only for the current selected day and valid timed events.
- The core resolves anchored and floating event intervals with the existing explicit timezone/DST helpers. Invalid or unresolved intervals fail closed.
- An active event wins; overlapping active events use earliest start, earliest end, then id, with `concurrent_count` exposing the overlap. Otherwise the earliest future event wins.
- `AgendaFocusDto` carries `phase` (`active|up_next`), `event_id`, nonnegative `minutes`, `concurrent_count`, and `as_of_utc`. It does not duplicate event content.
- The controller reloads at minute boundaries only while current-day Today is connected and the document is visible; visibility return refreshes immediately. The server projection remains time authority.

Complexity (`ramza-score --rubric complexity`): `8/12` → `extended`. Right-size score: `2` → `lite`.

Declared product-file scope:

1. `jin-core/src/dto/agenda.rs`
2. `jin-core/src/ops/agenda.rs`
3. `jin-gui/src-tauri/tests/bridge.rs`
4. `jin-gui/src/types/dto.ts`
5. `jin-gui/tools/tauri-fixture-init.js`
6. `jin-gui/index.html`
7. `jin-gui/src/controllers/today_controller.ts`
8. `jin-gui/src/controllers/router_controller.ts`
9. `jin-gui/src/lib/agenda/transform.ts`
10. `jin-gui/src/lib/agenda/render.ts`
11. `jin-gui/src/styles/today.css`
12. `jin-gui/src/__tests__/today_controller.test.ts`
13. `jin-gui/src/__tests__/dto_shapes.test.ts`

The maker may omit a listed file when no change is needed. Product-file expansion requires a RAMZA amendment before implementation continues.

## Approach

Select **one backend-authoritative daily projection with a frontend editorial composition** (`87.5/100`, elite).

### Data contract

Extend `AgendaDto` additively rather than introduce a second bridge round trip. Add `attention_tasks`, `due_tasks`, `flexible_tasks`, and nullable `focus`. Preserve every existing event field and the `today_agenda(date?)` signature. Add `agenda_for_date_at(root, date, now_utc)` as the deterministic implementation seam; keep `agenda_for_date` as the production wrapper using `Utc::now()`.

Build `AgendaTaskDto` from indexed tasks inside the same recovered/read-consistent core operation. It carries `id`, `title`, `status`, `priority`, `due`, `list`, `position`, `parent`, and `agenda_bucket`. Date-only due values remain calendar dates. Datetime values are parsed as RFC 3339 instants and localized to the configured display timezone. Invalid values fail closed. Query all nondeleted tasks once, retain only `todo|doing`, apply lane precedence, remove task ids present as agenda-event `originating_task`, and sort deterministically.

Resolve focus against the same `now_utc` and `display_tz` used for task lanes. Reuse `time::resolve_to_utc`; do not use machine-local parsing. All-day events are excluded. Missing/invalid intervals are still rendered in the schedule when existing behavior permits, but cannot power focus. `minutes` is ceiling-rounded at zero so labels never go negative between refreshes.

### Composition

Reshape the Today markup into three semantic regions while preserving Stimulus targets and existing state behavior:

- Header: full localized selected date as eyebrow, `Today` as the editorial route title, a short connected-work subtitle, compact date controls, and a vermilion Capture button wired to `capture#open`.
- Main desk: focus block when authoritative focus exists; all-day strip; one continuous ordered timed-event list with an indigo timeline; then attention, due, and anytime task sections only when populated. A no-future-events message speaks only about the schedule, never declares the whole day complete.
- Context rail: event-grouped task/note relationships. It remains a continuous paper field with quiet rules, not a stack of rounded gray cards. A restrained relationship-empty message preserves the region's purpose.

The timeline uses a circular marker and `Event` label for calendar events. A promoted event uses a square marker and `Task time block` label while keeping `data-event-id`, event detail navigation, event source/authority, task link, notes, recurrence, time range, and overlap cue. Standalone task rows show status, title, truthful due metadata when present, list/priority only when real, and a real task-detail control. They never occupy invented timeline times.

Extend Today navigation to `events` through the same router activation/detail mechanism already used by Tasks and Notes. Preserve event-row task/note actions with event activation isolated so nested links do not double navigate.

### Responsive and accessible contract

At standard desktop widths, use a generous editorial header and two-column desk/context composition; the primary agenda keeps the dominant measure and the context rail stays readable without creating a boxed inspector. At compact widths the context rail follows task lanes in source order and header controls wrap. At accessibility text scale every fixed block size becomes intrinsic/minimum geometry; the page must not horizontally overflow. Existing indigo/seal/capture tokens own state color, and each state has label/shape/position in addition to color. Preserve real lists, headings, buttons, links, live regions, focus restoration, 44px coarse targets, reduced motion, reduced transparency, and forced-color outlines.

### Freshness and failure

`showLoading` hides stale content consistently; a successful response updates every region atomically. A failed refresh hides loading, keeps the last successful content stable, and uses the existing error channel. The timer is cancelled on disconnect, hidden documents, and non-current selected dates. `jin:tasks-changed`, existing event mutation refreshes, date changes, and visibility return use the same authoritative reload path. No polling runs for historical/future dates.

## Stories

### Story 1: Project one truthful connected day

As a Jin owner, I want Today to receive schedule, tasks, relationships, and focus from one timezone-authoritative read, so that the page never assembles contradictory local-time interpretations.

Timebox: `2d`. Risk: `P0`. Executor: `mid` tier.

Action: add DTOs and test-clock seam; query/categorize/deduplicate/sort tasks; resolve focus; keep command backward compatible; cover timezone, DST, invalid data, overlaps, and bridge serialization.

### Story 2: Build the editorial daily desk

As a daily Jin user, I want the date, focus, timeline, and remaining work to scan as one calm composition, so that I can orient and act quickly.

Timebox: `2d`. Risk: `P0`. Executor: `mid` tier.

Action: reshape markup/templates and render model; show only populated truthful regions; preserve all event metadata and relationship reachability; add task and event detail actions.

### Story 3: Keep focus current

As a user moving through the day, I want Now and Up next to cross boundaries without manual reload, so that the highlighted work remains credible.

Timebox: `1d`. Risk: `P0`. Executor: `mid` tier.

Action: implement minute-boundary and visibility lifecycle; react to task/event mutation channels; prevent duplicate timers and stale-request overwrites.

### Story 4: Make the composition adaptive

As a user on desktop, phone, keyboard, or enlarged text, I want the same information order and actions to remain legible, so that Today works as a daily driver in every supported presentation mode.

Timebox: `1.5d`. Risk: `P1`. Executor: `mid` tier.

Action: implement owning Today CSS with existing tokens, responsive reflow, focus/contrast/forced-color/coarse rules, and no decorative content cards.

### Story 5: Prove behavior and visual fidelity

As a release owner, I want deterministic data tests and browser evidence, so that the screenshot-inspired work cannot ship fabricated semantics or responsive drift.

Timebox: `1.5d`. Risk: `P1`. Executor: `mid` tier.

Action: extend fixtures and tests; verify real navigation/capture; run full checks; inspect populated, relationship-empty, tasks-only, overlap, mobile, desktop, accessibility, and preference states.

## Acceptance Criteria

The normative EARS criteria are frozen in `.spectra/plans/today-connected-agenda.criteria.md`, `AC-TODAY-001` through `AC-TODAY-034`.

## Confidence

`ramza-score --rubric confidence`: pending Assemble computation. Expected route is `AUTO_PROCEED`; the goal, visual contract, data boundaries, and existing Jin patterns are explicit.

## Rejected Alternatives

- **Frontend composition of `today_agenda` and `list_tasks`** — `69.5/100`, weak. It reduces core changes but splits read consistency and encourages host/UTC task-date logic that disagrees with `config.display_tz`.
- **Events-only visual reskin** — `79/100`, solid. It is simple and safe, but repeats the prototype's known limitation and does not deliver the requested mixed daily work.
- **Put all tasks onto the timed event spine** — rejected before scoring because Jin has no task estimate/start contract. It would fabricate chronology and duration.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| A DTO extension breaks fixtures or consumers | P0 | Add fields only, update all compile-time fixtures, preserve command arguments and event fields, run Rust/TS shape tests. |
| Time focus disagrees at DST or timezone boundaries | P0 | Resolve only in core with fixed-clock tests and existing explicit time helpers; invalid intervals fail closed. |
| A promoted task appears twice | P0 | Build the represented-task id set before task categorization and assert disjoint lane ids. |
| Minute refresh leaks timers or races date changes | P0 | One timer, visibility/disconnect cancellation, current-date guard, and latest-request protection. |
| Reference styling becomes decorative cards | P1 | Keep paper fields continuous, use rules and type hierarchy, and review against the Jin visual-language dossier. |
| Mobile or AX text clips the dense composition | P1 | Intrinsic layout, source-order stacking, no fixed heights, and 320/390 plus AX browser checks. |
