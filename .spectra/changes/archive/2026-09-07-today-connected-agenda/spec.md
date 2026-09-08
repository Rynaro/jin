# Today connected agenda

## Objective

Turn Today into Jin's connected daily desk: an editorial date header, a live and truthful current/up-next focus, a chronological event spine, separate lanes for work without scheduled spans, and a contextual rail made only from real task/note relationships. The reference supplies hierarchy and rhythm; Jin supplies warm paper, ink, indigo linkage, restrained vermilion Capture, semantic HTML, and adaptive behavior.

## Scope

Implement a dedicated `TodayProjectionDto` and `today_projection(date?)` command. Keep the existing `AgendaDto` and `today_agenda(date?)` contract unchanged for existing consumers. The new projection contains:

- `agenda: AgendaDto`;
- authoritative `current_date` and `is_current_date`, resolved in `config.display_tz`;
- disjoint `attention_tasks`, `due_tasks`, and `flexible_tasks` using a compact `AgendaTaskDto`;
- every currently active timed event as focus references, plus the next timed event;
- `generated_at_utc` and core-resolved start/end instants and minute values for freshness and display.

Add the corresponding Tauri command, frontend invoke wrapper and TypeScript DTO. No storage field, schema migration, provider behavior, runtime dependency, or background service is in scope.

## Data semantics

Use a deterministic `today_projection_for_date_at(root, date, now_utc)` implementation for tests and a production wrapper using `Utc::now()`.

Task eligibility and precedence:

1. Read indexed tasks in the same recovered core operation as the agenda; retain only `todo|doing` tasks with no deletion.
2. On the authoritative current day, `attention_tasks` contains date-only due values before `current_date` and datetime due instants before `now_utc`.
3. `due_tasks` contains remaining tasks whose date-only due equals the selected date or whose datetime due localizes to the selected date in `display_tz`.
4. `flexible_tasks` contains remaining open tasks explicitly marked `agenda_bucket=flexible`, and is present only when the selected date is the authoritative current day.
5. On past or future selected dates, expose exact-date `due_tasks`; omit attention and flexible lanes.
6. Exclude any task already represented as an `originating_task` on an event in this agenda. Enforce attention > due > flexible so one task appears in at most one standalone lane.
7. Invalid due datetimes fail closed. Sort deterministically by due, existing manual position, title, and id. Do not invent a task time, duration, estimate, relationship, or completion state.

Focus semantics:

- Derive focus only for the authoritative current day and only from valid timed events.
- Resolve anchored and floating intervals to real UTC instants with Jin's existing explicit timezone/DST helpers and configured display timezone. Never compare pseudo-UTC floating order with anchored instants and never use browser or host-local parsing as authority.
- Return all active events whose half-open intervals contain `now_utc`, ordered by resolved start, end, and id. Concurrent focus is plural by contract; the UI must keep every active commitment directly accessible.
- Return the earliest future event independently as `next_event`, using the same resolved instant domain.
- Each focus reference carries `event_id`, resolved start/end UTC seconds, and a nonnegative ceiling-rounded minute value. Active values mean minutes left; next values mean starts in. Invalid, unresolved, all-day, cancelled, or other-day events cannot power focus.

## Experience

Compose Today as three semantic regions while preserving existing controls and Stimulus behavior.

The header uses a localized selected-date eyebrow, `Today` editorial title, concise connected-work subtitle, compact previous/next/date/today navigation, and a vermilion Capture button wired to the existing `capture#open` flow.

The main desk renders:

- a focus region only from `TodayProjectionDto`: all active commitments under `Now`, followed by the real upcoming event when present; no arbitrary single-event winner;
- an all-day strip;
- one continuous chronological timed-event spine with indigo rule and markers;
- populated attention, due, and anytime task lanes after the timed schedule;
- schedule-specific empty copy such as “No more scheduled events”; it must not call the whole day complete while task lanes contain work.

A promoted event remains an event entity and opens Events detail. Its square marker and visible `Task time block` label distinguish the linked task commitment; ordinary events use a circular marker and `Event` label. Preserve time range, source/authority, recurrence, overlap, originating task, prep notes, event id, and nested-link behavior. Standalone task rows open real Tasks detail and show only truthful task metadata.

The Connected work rail deduplicates real linked task and note entities by kind and id, while retaining the actual agenda event ids/titles associated with each entity. It contains only `originating_task` and `prep_notes` relationships. Task and note controls open their existing detail routes. Events without relationships do not create invented context. When no relationship exists, hide the Connected work rail rather than showing an empty message.

Use the existing generic `jin:navigate` route for event detail and existing Today navigation for tasks/notes, avoiding router changes unless implementation evidence proves one is required.

## Freshness and lifecycle

Reload the projection at the next minute boundary only while Today is connected, visible, and displaying `is_current_date=true`. Pause while the document is hidden; refresh immediately and resume when it becomes visible. Cancel on disconnect and for non-current selected dates. Listen to `jin:tasks-changed` and existing event refresh signals. Use one timer and a latest-request guard so a slower prior date response cannot overwrite the current selection.

A successful load replaces all regions atomically. A failed refresh hides loading, keeps the last successful content stable, and uses Jin's existing error channel.

## Visual and accessibility contract

Use the existing Today stylesheet and semantic tokens. The page is a continuous paper composition with editorial hierarchy and quiet rules, not nested rounded gray cards.

At desktop width, the agenda owns the primary measure and Connected work forms a readable right rail. On compact screens, header actions wrap and the context rail follows the agenda/task lanes in source order. At accessibility text scale, fixed heights become intrinsic/minimum geometry. Preserve real headings, lists, buttons, links, live status, visible focus, 44px coarse-pointer targets, text/shape state cues, reduced motion, reduced transparency, increased contrast, dark appearance, and forced colors. The document must not overflow horizontally at 320, 390, 760, or 1440 CSS pixels.

## Product-file boundary

- `jin-core/src/dto/agenda.rs`
- `jin-core/src/ops/agenda.rs`
- `jin-core/src/ops/api.rs`
- `jin-gui/src-tauri/src/commands/agenda.rs`
- `jin-gui/src-tauri/src/lib.rs`
- `jin-gui/src-tauri/tests/bridge.rs`
- `jin-gui/src/types/dto.ts`
- `jin-gui/src/invoke.ts`
- `jin-gui/tools/tauri-fixture-init.js`
- `jin-gui/index.html`
- `jin-gui/src/controllers/today_controller.ts`
- `jin-gui/src/lib/agenda/transform.ts`
- `jin-gui/src/lib/agenda/render.ts`
- `jin-gui/src/styles/today.css`
- `jin-gui/src/__tests__/today_controller.test.ts`
- `jin-gui/src/__tests__/dto_shapes.test.ts`
- `jin-gui/src/__tests__/invoke.test.ts`
- `jin-gui/src/__tests__/router_controller_wiring.test.ts`

Omit a listed file when no change is needed. Any product-file expansion requires a scope amendment. Preserve unrelated dirty-worktree files.

## Implementation order

1. Add core DTOs, deterministic projection seam, timezone-safe task lanes and plural focus; cover them with fixed-clock Rust tests.
2. Wire the new command through core API, Tauri registration, bridge tests, frontend invoke and DTO shape tests without altering the legacy command.
3. Update deterministic browser fixtures with dense mixed work, overlaps, relationships, tasks-only, and relationship-empty states.
4. Reshape Today markup and pure transform/render model; retain event/task/note identity and actions.
5. Add timer, visibility, mutation, race and navigation behavior to the controller.
6. Apply Jin's Today-owned responsive styling and verify the full state matrix.

## Verification

- Fixed-clock core tests: display-timezone current date, date-only and datetime due, invalid due, open-only filtering, precedence/deduplication, promoted-task exclusion, anchored/floating focus, DST overlap/gap policy, concurrent active events, next event, and non-current suppression.
- Bridge/contract tests: new command serialization and malformed-date errors; legacy `today_agenda` unchanged.
- Frontend tests: DTO/invoke shape, pure projection/render behavior, all focus items accessible, no fabricated task time/duration, real Capture and detail routes, nested-link isolation, mutation refresh, minute/visibility lifecycle, race protection, loading/error retention.
- Deterministic Playwright: populated mixed day, concurrent focus, tasks-only, relationship-empty and empty day at 1440x900, 760x800, 390x844 and 320x700; accessibility scale at 390 and 1280; dark, contrast, forced colors, reduced transparency/motion, coarse pointer, keyboard, console and document-overflow checks.
- Required gates: focused tests, `cargo test --workspace`, `npm --prefix jin-gui run lint:css`, `npm --prefix jin-gui run build`, full frontend suite, `git diff --check`, and repository verification target.

## Completion boundary

Completion means every criterion in `criteria.md` is evidenced, the checker confirms no fabricated state or contract drift, and native owner review is reported separately from browser evidence. Documentation changes are required only if implementation establishes an accepted new general visual-language rule.
