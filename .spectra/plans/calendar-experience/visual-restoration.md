---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-09-23
target_repos: [jin]
stories_count: 4
validation_gates_count: 8
---
# Calendar visual restoration

## Scope

Restore the implemented S1–S7 Calendar and shared Event Companion to [Jin's visual language](../../../docs/visual-language/README.md). This is an authorized restoration pass, planned with GPT-6 Astra high and implemented by GPT-6 Sol high. Preserve the dirty working tree, temporal projection, EventDraft serialization, provider routes, recurrence rules, save reducer, and all existing entry points. No Rust, new dependency, backend feature, wholesale redesign, commit, or push. S8–S10 remain separately scoped; exercise relevant accessibility seams now without claiming those stages complete.

## Diagnosis and evidence

Baseline evidence: `.artifacts/playwright-mcp/calendar-polish-before-month.png` and `calendar-polish-before-create.png` at 1280×800. Root's browser audit confirms the empty-header rail, detached checkbox, unnamed When fields, offscreen actions, Add overlay, premature validation, misleading Meet summary, untouched-draft discard prompt, and missing entry focus.

Additional confirmed evidence: `calendar-polish-before-preview-390.png` shows duplicate modal headers/close controls and excessive nested padding; `calendar-polish-before-week-create-loaded.png` shows the empty agenda consuming ~248px of a 686px field, a 1051px-tall unbounded time scroller, and overlapping folded-night/hour labels. Selecting Preview also scrolls the page unexpectedly. The earlier transient blank Week screenshot is not a product defect. Console had no unexpected errors. The current deterministic fixture uses the explicit legacy geometry fallback because its projection command is missing; QA must add the exact projection fixture before claiming projection-path coverage.

| Priority | Concrete cause | Restoration |
| --- | --- | --- |
| P0 | `events.css` gives **every** section input 100% width, square borders, and padding, including checkbox; `composer.ts` appends bare date/time/timezone controls. | Reuse labeled shared form/checkbox primitives; arrange start and end as readable paired rows. |
| P0 | Companion stretches to the full calendar/document height; Composer footer is inside the body; modal nests another shell/header/footer. | One bounded host, one named header, one scrolling body, one always-reachable action/status footer. |
| P1 | Month header never wraps by available field width; viewport rules ignore the 360px rail. Fixed Add belongs to the viewport. | Header adapts to calendar-field width; put Add in route toolbar; no overlay on editor/calendar. |
| P1 | Composer metadata keeps default paragraph margins; disclosure markers are removed without replacement; native controls bypass existing primitives. | Compact identity line, intentional title/summary hierarchy, visible disclosure chevrons, consistent field rhythm. |
| P1 | `meetSummary()` maps preserve to “Creating Meet” and remove to retry; summaries only refresh on disclosure toggle. | Derive truthful draft-intent summaries and refresh them with draft state; pending copy requires actual pending state. |
| P1 | `validateDraft()` errors render on initial mount; new drafts are always model-dirty because temporal data exists. | Separate interaction/touched state from validity and sparse serialization; fresh blank creation closes cleanly. |
| P1 | Week/Day adds a second agenda column using viewport breakpoints and rounded gray rows. | Preserve the chronological keyboard bypass as quiet rows; stack below timeline when the actual field is narrow. |

## Approach

**Composition target:** keep the calendar as continuous warm paper with quiet rules and its editorial month/date heading. Controls use the text face. Use a compact indigo selected view indicator with shape/border, quiet date navigation and calendar filter, and a vermilion Add action consistent with Capture. Avoid replacing the month with cards or broadly retheming tokens. The 360px Companion is a calm separated paper column; modal uses existing transient elevation. Identity is a small color dot plus name/alias, followed by readable event/title content. Maintain 16–24px host padding, 8px field gaps, compact fine-pointer controls and 44px coarse targets. At enlarged text, reflow instead of clipping.

### 1. Restore shared Companion geometry — P0, 1d

Owners: `jin-gui/src/lib/ui/companion.ts`, `jin-gui/src/styles/events.css`; change `lib/ui/modal.ts` only if a small reusable slot/lifecycle hook is necessary. Preserve outer-workspace ≥920px host selection and 360px rail width; do not measure the shrunken field to select the host. Bound rail height to the actual available viewport space using the existing layout contract, with CSS grid/flex `minmax(0, 1fr)`/`min-block-size: 0` for the scrolling body. Keep the rail usable while the calendar scrolls. Modal fits available `dvh`, with one internal scroll owner. Remove duplicate/empty outer modal chrome through a scoped composition hook, not global dialog overrides.

Render one visible localized mode heading (New event / Edit event / Event) with the existing close-icon primitive. Expose/mount Composer action footer in the shell footer so Save/Cancel and status/discard controls stay outside body scrolling; Preview does not reserve an empty action band. Preserve a single live region. Focus Title when entering create/edit; Preview focuses an appropriate heading/action without losing return context. Preserve field focus IDs and scroll across rail/modal migration; return focus to the real invoker on dismissal. Use preventScroll for focus restoration and preserve the actual route/page scroll owner, not only an inert field's scrollTop. Restore any inline workspace styles introduced by the host when it closes.

### 2. Restore the shared Composer and Preview — P0/P1, 1d

Owners: `jin-gui/src/lib/events/{composer,preview,locale}.ts`, `events.css`, narrow Companion presentation context as needed. Apply existing `.form-input`, `.form-select`, `.form-label`, `.jin-checkbox` markup and tokens; remove the broad full-width input rule. Every field has an associated visible label and stable unique ID, including Guests, Meet, Repeat, Location, Notes, Start date/time, End date/time, and Time zone. Use two date/time rows (Start, End), full-width All day above and Time zone below; collapse to one column at small host widths/large text. Retain native temporal input behavior. Do not change timezone payload semantics or invent a second temporal editor.

Reset metadata margins locally. Put identity swatch/name on one baseline, alias below only when present, and allow long names to wrap. Title input is prominent text-face type; temporal summary is secondary and wraps. Disclosures retain native details/summary semantics, add a decorative chevron with expanded indication, and use clear label/summary hierarchy. Preserve disclosure state while refreshing hints. Preview gets the same typography/identity rhythm, readable dates and timezone, quiet linked-context rows, existing Join/Edit/full-details actions and truthful operation state; no generic cards.

Correct Meet copy from existing conference data and draft intent: preserve means existing meeting retained or no video meeting; add means requested on save; remove means removal on save. Only provider pending state means creation in progress. Thread existing destination/detail conference capabilities into the presenter if needed so unsupported local/remote actions are unavailable with truthful copy; do not infer support from a Google label. Use localized en/pt-BR strings. Never change conference payload construction.

**Scope amendment — restore create destination choice:** the old Calendar at HEAD had an `eventDestinationTarget` selector and exact account/calendar submission checks; S7 replaced that with display-only identity and `lastWritableDestination` submission. Restore a labeled shared create-only calendar selector beside identity using existing `listGoogleAccounts()` data and controller callbacks; no backend/API addition. Options are explicit Jin-only plus connected, enabled, available, writable exact Google routes labeled with account alias/calendar name. Validate the remembered route against current data; invalid/missing remembered routes require explicit choice when remote choices exist, while local remains available if discovery fails. Filter visibility never selects the destination. Save uses the current validated selector value, never stale remembered state, and remembers it after durable submission. Preserve draft input and disable invalid submission on route/capability loss; serialize through existing local/routed adapters. Keep existing-event destination read-only. Meet capability compatibility: an empty advertised solution list is unknown (legacy provider decision), while a nonempty list excluding `hangoutsMeet` is unsupported. Retain prior exact-destination guards for Guests/Meet/recurrence. Test two accounts with same-named calendars, local create, stale memory, unavailable route, discovery failure, and exact selected route at submit; Capture advanced handoff must retain its selected route through the shared presenter.

Keep validity calculation immediate for Save gating, but show inline errors only after field interaction/blur or an attempted submission; connect errors with `aria-describedby`. Untouched blank creation must not show an error. Keep host-local initial-value/touched tracking for dismiss: opening an otherwise blank default/slot draft alone is not an unsaved edit; entered values, changed temporal fields, advanced intent, populated Capture handoff, and move/resize edit proposals still require discard confirmation. Do not weaken `EventDraft.isDirty()` or sparse serialization to implement this presentation rule.

### 3. Restore Calendar chrome and narrowed views — P1, 1d

Owners: `jin-gui/src/controllers/calendar_view_controller.ts`, `jin-gui/src/styles/calendar.css`, `jin-gui/index.html`; `lib/calendar/time_grid_render.ts` only if accessible agenda heading/disclosure markup is required. Move the existing global Add control into a stable toolbar action location while preserving its controller target/handler and selected-date context. Keep a single accessible Add action across Month/Week/Day and restore it after rerender/full-detail return. Remove fixed positioning and compensating floating-button space rules. Use the existing Capture vermilion role locally; do not alter `.btn-primary` globally.

Give `.calendar-field` a size-query context (or an existing measured-width class). At narrow field width, stack editorial identity above controls, allow controls to wrap as groups, and keep month/date text intact; the rail-open 559–700px field needs the same intentional layout even on a wide viewport. Replace stacked segmented-control overrides with one quiet compact owner. Filter uses a bounded anchored disclosure on desktop and in-flow layout when compact; long account/calendar names wrap without pushing the page. Preserve display-filter storage and zero bridge writes.

For Week/Day, reflow the chronological agenda below the time grid when the **field** cannot fit both; an empty agenda must not reserve a blank column. Remove gray-card treatment in favor of aligned rows and a restrained heading. Preserve the agenda's accessible chronological bypass and event handlers; do not hide it simply because a coarse pointer is present. Restore bounded timegrid scrolling; inspect competing scroller rules around lines 1223–1250 and 1373 in `calendar.css`. Folded-night labels must fit their band without overlapping the first visible hour; preserve expansion and projection geometry. Intrinsic seven-column content may scroll only inside its focusable component. Preserve current-time, cursor, ghost, all-day, overlap, resize, recurrence and due-task behavior. Consolidate touched rules at their owner; do not append another general override block or modify unrelated Today/Notes styling.

### 4. Focused verification — P0, 1d

Update behavior tests in `event_composer.test.ts`, `event_companion.test.ts`, `calendar_view_controller.test.ts` and relevant cross-entry tests for labels, clean/dirty dismiss, focus/host migration, truthful summaries and reachable actions. Reuse existing suites for serializer and provider invariants; no new snapshot-only style tests. Extend the existing deterministic browser fixture only with a contract-correct `calendar_range_projection` response (no permissive unknown-command fallback). Run focused event/calendar/Today/Capture/Notifications suites, `npm --prefix jin-gui run lint:css`, `npm --prefix jin-gui run build`, and `git diff --check`. Report pre-existing failures separately.

Use the Jin Playwright skills for before/after evidence: 1440 and 1280 desktop; 760, 390 and 320px; outer-content seam at 919/920px; rail open/closed; Month/Week/Day; create/preview/edit; expanded disclosures; clean/dirty dismissal; long title/calendar/alias; Today preview, full-detail Edit, Capture advanced handoff. Include dark, 3.1 text scale, increased contrast, reduced transparency/motion, forced colors and coarse pointer in the smallest representative matrix. Check document overflow, console errors, footer reachability, input names, keyboard focus and real no-write-before-save behavior. Native Tauri feel/sign-off remains owner evidence, never substitute browser results. Update the visual dossier only for implemented and visually accepted rules.

## Acceptance Criteria

### AC-VR-01 (state-driven)
GIVEN the Companion is open at a maintained viewport or accessibility scale
THEN its active action footer shall remain reachable without scrolling the page beneath the host.
VERIFY: desktop/phone/AX screenshots plus host/body/footer bounding rectangles.
### AC-VR-02 (ubiquitous)
THEN every editable Composer field shall have a programmatic accessible name matching its visible label.
VERIFY: focused DOM label tests and browser accessibility snapshot.
### AC-VR-03 (event-driven)
WHEN a blank create draft opens and closes without input
THEN the Companion shall dismiss without a discard prompt.
VERIFY: event_companion tests; counterchecks for populated Capture and move/resize drafts.
### AC-VR-04 (state-driven)
GIVEN a pristine blank create draft
THEN the Composer shall suppress visible validation errors until relevant interaction.
VERIFY: event_composer touched/blur validation tests, Save remains gated.
### AC-VR-05 (state-driven)
GIVEN the real meeting data and current conference intent
THEN the Composer shall display a summary corresponding to that state.
VERIFY: preserve/no-meeting/existing/add/remove/pending/capability fixtures in en and pt-BR.
### AC-VR-06 (state-driven)
GIVEN a narrowed Calendar field with the Companion open
THEN Calendar chrome shall fit the field without control overlap or document horizontal overflow.
VERIFY: rail-open 1280px screenshot, 559–700px field checks, long labels, Week/Day reflow.
### AC-VR-07 (event-driven)
WHEN a user enters, migrates, or dismisses the Companion
THEN keyboard focus shall follow the documented entry, preservation, and return target for that transition.
VERIFY: event_companion tests plus keyboard browser walkthrough across 919/920px seam.
### AC-VR-08 (event-driven)
WHEN a create draft is submitted with a selected calendar
THEN the existing creation adapter shall receive that currently valid exact destination.
VERIFY: controller tests for explicit local, same-named Google calendars across accounts, stale/unavailable selection, and Capture handoff.

## Execution handoff

```yaml
executor: {model: gpt-6-sol, reasoning: high, methodology: vivi}
order: [companion_geometry, shared_presenters, calendar_chrome, focused_verification]
preserve: [dirty_worktree, EventDraft_payloads, temporal_projection, provider_capabilities, shared_entry_points]
output: [implemented_restoration, focused_test_results, before_after_evidence, explicit_remaining_limits]
approval: implementation_already_authorized
```
