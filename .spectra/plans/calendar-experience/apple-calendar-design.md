---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-09-23
target_repos: [jin]
stories_count: 4
validation_gates_count: 9
---
# Apple Calendar composition for Jin

## Scope

The user explicitly replaces the previous Jin editorial/paper direction for Calendar with Apple Calendar's appearance. Implement a coherent Calendar and shared Event experience: system typography, restrained native controls, a white calendar grid, calendar-color event marks, a red current-day marker, and compact floating event details. This supersedes the serif date heading, paper field, underlined view tabs, vermilion Add action, and split-view Companion rail described by the prior restoration plan. It does not retheme Jin's global sidebar, Today layout, Tasks, Notes, Capture's compact form, or Settings.

Preserve the current working tree and its functioning S1–S7 behavior: exact local/Google routing, capabilities, RSVP, Meet, recurrence, sparse payloads, temporal projection, manipulation drafts, no write before Save, dirty-dismiss/navigation guards, focus return, shared entry points, and reduced-preference/AX support. No Rust/backend work, new dependency, new provider feature, external export, commit, or push. Implementation is already authorized. Planner: GPT-6 Astra high; implementer: GPT-6 Sol high.

## Diagnosis

The previous pass repaired controls but kept incompatible visual systems in one view: a large serif date, web-style underlined tabs, a red filled Add button, an expansive ruled grid, and a fixed full-height editor rail. The form then repeats mode heading, calendar identity, calendar label/select, title label/input, date summary, When heading, and separate date/time labels before basic editing is complete. Fixing margins cannot resolve that composition. Recent evidence is under `.artifacts/playwright-mcp/calendar-polish-after-*`: `preview-1440.png`, `week-create-1280.png`, `create-760-dark.png`, and `day-1280.png`.

## Reference provenance

Root inspected Apple's public [Calendar User Guide for Mac](https://support.apple.com/guide/calendar/welcome/mac), currently presenting macOS Tahoe 26: its examples show a Month calendar with a color-coded calendar list, a compact event/invitees window, and a Day time grid. Root also checked [Change how you view events in Calendar on Mac](https://support.apple.com/guide/calendar/change-how-you-view-events-icl28064/mac), covering view/filter choices, separate event windows and displayed hours. These public documentation references ground the visual hierarchy and compact event treatment; the numerical dimensions and exact Jin host strategy in this plan are implementation decisions. Native Calendar inspection was unavailable because the app-access call timed out. Neither these references nor Jin's browser screenshots constitute native Tauri verification.

## Approach

### Chosen surface strategy

Replace the grid-shrinking Companion rail with a **compact floating non-modal inspector** on roomy, normal-text desktop screens. It opens adjacent to the activated event/slot (or Add button for toolbar creation), leaves the calendar full width, and shares one panel for Preview/Create/Edit. Use approximately 360px for Preview and 420px for Composer; intrinsic height, never a full-height empty column. Cap height at the available viewport with a single scrolling content body. Keep actions visible below that body. Switching Preview→Edit stays in place and retains the same draft/lifecycle.

At viewport widths below 760px, accessibility text scale, or insufficient safe space, use the existing modal sheet host with the same content; fit inside the viewport with 12–16px edge clearance. The mode seam deliberately replaces the old outer-width 920px rail contract. There is no side rail in any Calendar mode. Today, full-detail Edit, and Capture advanced options may retain modal presentation where their existing entry context requires it, but use the same compact content and typography.

Use the existing EventCompanion as lifecycle owner. Forward a real anchor element/rect from Calendar event buttons, selected cells/slots, manipulation completion, and Add; time-grid callbacks already supply the event button. Place beside the anchor with 8–12px gap, flip horizontally/vertically when necessary, then clamp to a 12–16px safe inset. Recompute on relevant scroll/resize; if the anchor disappears, use a stable viewport position without losing the draft. No positioning library, fake pointer animation, or full native-window imitation. Preserve focus names, outside interactions, dirty decisions, invocation focus return and text selection. Desktop is genuinely non-modal (no backdrop, no inert calendar, no focus trap); compact sheet remains modal. Use one visible mode/title treatment and one accessible dialog name/close path, never nested modal headers.

### Unified visual grammar

| Element | Standard-scale implementation target |
| --- | --- |
| Typeface | Existing `--font-text` system stack throughout Calendar/Event UI; remove display/serif usage from these owners. Do not shrink the root type scale. |
| Toolbar | Neutral adaptive light-gray chrome, subtle bottom separator, 44–52px high at normal fine-pointer scale. Small Calendars/filter and Add icon buttons left, Month/Week/Day segmented control centered, Today and adjacent chevrons right. Every control remains real and named. |
| Date hierarchy | A separate concise system-font range heading, approximately 26–28px and semibold, inside the calendar canvas below toolbar. Month/year may have differing weight; no CALENDAR eyebrow. Day and Week reuse the same hierarchy and navigation positions. |
| Segmented control | Compact native-style 26–30px track, quiet neutral background, subtly elevated selected segment, small radius, system text; no underline tabs. Selected state remains `aria-pressed` plus shape/weight. |
| Main surface | Adaptive white/neutral calendar canvas, 1px low-contrast rules, no outer rounded calendar card, no warm parchment wash or large indigo day fill. Route-local outer spacing lets toolbar/grid use the available content width; remove the current nested 24px presentation insets without changing global shell layout. |
| Month | 12–13px weekday labels, 13–14px dates aligned toward each cell's upper trailing edge, event rows directly beneath the date, subtle adjacent-month dates and weekend distinction. Use available height for equal week rows without imposing giant fixed cells. |
| Today | Compact filled system-red date circle with contrasting number in Month and Week/Day headers; `aria-current=date`. Selection and keyboard focus remain independent system-blue cues. Never paint the entire today cell blue. |
| Event marks | Compact calendar-colored rows/pills with gentle radius and readable colored/contrasting text; timed/all-day geometry and continuation meaning preserved. Small timed blocks prioritize title/time over provider badges; full identity remains available in accessible labels and Preview. |
| Time grid | White field, quiet horizontal/vertical rules, 11–12px time labels in a 56–64px gutter at normal scale (replace current `8rem` gutter), approximately 56–64px hour rhythm using current geometry variables. Set a sensible normal-scale day minimum around 80–96px so all seven days fit at 1280/1440px with the Jin sidebar open. Today header and current-time line are red; events retain calendar color. |
| Event inspector | Neutral elevated material, restrained 10–12px radius and one real elevation shadow, 14–16px internal spacing; 13–14px operational body, 17–20px event title. No full-width black action blocks, oversized blank chrome, nested paper cards, or repeated identity sections. |
| Controls/actions | Shared real controls with Calendar/Event-local compact sizing, 26–30px fine-pointer minimums; 44px targets for coarse pointer. System accent primary Save/Done/Edit, quiet secondary action. Add is a neutral toolbar plus, not a red Capture clone. |

All dimensions are normal-scale targets expressed through rem/adaptive variables where appropriate; larger text can increase them. Reuse existing adaptive semantic tokens first. Add only missing Calendar/Event chrome/surface/selection roles in `tokens.css`, with raw values exclusively there. Dark appearance uses corresponding charcoal surfaces and legible rules, not a light screenshot inverted by ad hoc overrides. Manual preferences keep precedence. Red Today, calendar colors, errors, and focus each retain their separate meanings.

### Event content composition

**Preview:** the event title is first and dominant; a small calendar-color marker/name plus alias appears once as secondary identity. Date/time is the next readable row. Location/Join, guests, notes, task/note links and genuine operation state follow only when present. Keep Edit and Open full details compact and obvious. Show provider provenance once in subdued metadata, not as duplicate headings. Fit a plain event Preview to its content (roughly 240–360px high), rather than retaining a 700px column.

**Create/Edit:** title is the top editable element, large enough to find but not a giant bordered hero card. Its accessible label may be visually hidden if the title's purpose is clear. Present exactly one labeled calendar row: compact selector for create, identity value for edit. Remove the repeated calendar-name block above that selector. Present the All day switch/checkbox and two compact Start/End rows; at desktop each row pairs date/time under one clear row label, while each underlying input retains its unique accessible name. Keep Time zone in a quiet optional row/disclosure with its current value summarized; retain field values and existing semantics. Do not show a redundant full date-range paragraph immediately above those same fields.

Below primary fields, use compact separator-based optional rows for Guests, Video call, Repeat, Location, Notes and recurrence scope. Prefer a concise label/value arrangement and predictable expansion to the current tall stack of section headings. Existing advanced data stays available; do not delete fields to hit a height target. Keep real pending/error/discard messages in their existing lifecycle. Place Cancel and Create/Save in a compact bottom row; no duplicate buttons or minimum blank footer. At 1280×800 normal scale, a blank create inspector must show title, exact destination, All day, both endpoints and Save without scrolling. Target ≤560px initial inspector height, with expanded advanced content allowed to scroll internally.

**Calendar navigation:** unify Month/Week/Day toolbar construction in `calendar_view_controller.ts`; Day no longer gets a separate back-link-plus-serif-heading composition. Preserve Day→previous-view behavior through the existing view controls or a compact named Back control where needed. Keep the current default week start and locale behavior; this is presentation, not a scheduling preference change. Preserve the chronological agenda bypass in Week/Day, but make it an unobtrusive labeled disclosure/list below the timeline rather than a permanent competing column. No hidden keyboard-only feature removal.

## Stories and implementation order

1. **Calendar visual foundation and unified toolbar — P1, 1d.** Owners: `jin-gui/src/styles/{tokens,calendar}.css`, `controllers/calendar_view_controller.ts`, `lib/calendar/time_grid_render.ts`, `index.html`. Build one shared toolbar/date hierarchy; replace local editorial and underlined rules; apply Month/Week/Day grid/today/event grammar. Keep `.calendar-widget` and due-date picker geometry separate from the route. Output: coherent three-view calendar before touching host behavior.
2. **Compact inspector host — P0, 1d.** Owners: `lib/ui/companion.ts`, `styles/events.css`, Calendar controller; `lib/ui/modal.ts` only for a narrow reusable shell/lifecycle need. Replace rail mount/unmount/grid mutation with anchored floating host, explicit modal-only option for existing consumers, collision handling and state-preserving host migration. Update `today_controller.ts`, `events_controller.ts`, `capture_controller.ts` only if they need that explicit host option/anchor; preserve their controllers' payload paths. Output: opening Preview/Create never reduces calendar width; no orphan overlays or lost drafts on resize/scroll.
3. **Compact shared Preview/Composer — P1, 1d.** Owners: `lib/events/{preview,composer,locale}.ts`, `styles/events.css`. Reorder existing real content; compact labels/rows; remove duplicated metadata and summary; retain shared primitives and exact destination/capability handling. Output: Preview and Create/Edit visibly belong to the same native-inspired system across Calendar, Today, full detail and Capture handoff.
4. **Behavior and visual convergence — P0, 1d.** Owners: existing focused tests, deterministic fixture and `.artifacts/playwright-mcp/`; normative visual dossier only after implementation is accepted. Capture reference/before/after contact sheets, fix observed composition drift, then run focused suites, CSS lint, GUI build and `git diff --check`. No success claim based only on passing tests.

### Cascade consolidation and deletion list

`calendar.css` remains the route/widget owner, `events.css` the event presenter/host owner, `tokens.css` adaptive values, `a11y.css` final fallback. Replace the existing editorial header section, later view-switch patch, red global-add rule, blue today-cell rule, outer-card timegrid styling and competing route control spacing with one canonical route section. Delete `.event-companion-workspace--rail` grid/layout manipulation and fixed rail size rules after migration tests pass; remove unused old host geometry/tests instead of leaving a dormant third host. Consolidate Event chrome, footer, modal padding and input density in their existing sections. Do not append an “Apple overrides” tail or add global `.btn-*`, `dialog`, `h2`, or `.form-input` changes that leak into other routes.

## Acceptance Criteria

### AC-APPLE-01 (state-driven)
GIVEN Month, Week or Day at 1280/1440px normal scale
THEN Calendar shall use the unified system-font toolbar/date hierarchy described above.
VERIFY: reference-aligned screenshots; no serif date, eyebrow, underline view tabs or red filled Add.
### AC-APPLE-02 (event-driven)
WHEN Preview or Composer opens on roomy desktop
THEN the Calendar field's width shall remain unchanged.
VERIFY: before/after bounding rectangles and anchored inspector screenshot.
### AC-APPLE-03 (state-driven)
GIVEN an untouched create draft at 1280×800 normal scale
THEN title, calendar destination, All day, Start, End and Save shall be visible without scrolling.
VERIFY: screenshot and element visibility checks; initial inspector height ≤560px.
### AC-APPLE-04 (state-driven)
GIVEN today's date in Month, Week or Day
THEN the date number shall use a compact red current-day treatment distinct from selection and focus.
VERIFY: all three views plus keyboard-focus screenshot and `aria-current` inspection.
### AC-APPLE-05 (state-driven)
GIVEN an event from a colored calendar
THEN its identity color shall match across grid, filter, Preview and Composer.
VERIFY: palette/custom-color fixtures, selected create destinations and screenshot comparison.
### AC-APPLE-06 (event-driven)
WHEN a dirty inspector changes desktop/modal host or its anchor moves
THEN the active draft shall retain its entered values.
VERIFY: host migration tests plus resize/scroll walkthrough; keyboard focus/selection/return counterchecks.
### AC-APPLE-07 (state-driven)
GIVEN a compact viewport or accessibility text scale
THEN Event content shall fit within its host without document horizontal overflow.
VERIFY: 320/390/760px, 3.1× type, long labels, native temporal fields, visible actions and internal scroll access.
### AC-APPLE-08 (event-driven)
WHEN an event draft is submitted
THEN existing route, capability, recurrence and sparse-payload guards shall govern the mutation unchanged.
VERIFY: exact local/Google, stale destination, Meet compatibility, dirty guard, recurring edit, Capture/Today/full-detail suites.
### AC-APPLE-09 (state-driven)
GIVEN the appearance or accessibility preference changes
THEN Calendar and Event controls shall retain readable state distinctions.
VERIFY: dark/manual appearance, increased contrast, forced colors, reduced transparency/motion and coarse-pointer evidence.

## Verification and visual acceptance

Use existing deterministic Playwright setup with real `calendar_range_projection` fixture support. Keep separate evidence for native Tauri behavior. Baseline scenarios: empty and populated Month, dense Week, Day, red Today, multi-day/all-day event, long calendar/title, Preview, blank Create, populated Edit, expanded Guests/Meet/Repeat, dirty close, route switch, valid/invalid destination, and Capture advanced handoff. Main comparisons are 1440×900 and 1280×800 in light; then 390×844, 320px, 760px, dark and AX. Verify both sides of the new host seam and that opening an inspector does not horizontally shift the calendar.

Record the current native/official Apple Calendar reference beside the implementation at comparable density. Acceptance is the **overall hierarchy**: compact neutral toolbar, centered segmented view switch, clear system date heading, full-width white grid with red today, and an intrinsic compact floating event inspector. A screenshot retaining a huge rail, serif title, duplicated form headings, oversized black buttons, warm paper, or a wide empty agenda column fails even if individual controls work. Reference resemblance must not introduce fake search, unavailable Year view, decorative macOS traffic lights, auto-save, or new provider semantics.

Run focused Calendar/Event/Companion/Today/Capture/full-detail tests, `npm --prefix jin-gui run lint:css`, `npm --prefix jin-gui run build`, and `git diff --check`. Update CSS ownership tests for replaced host names and use behavior assertions for unchanged guards. Report native sign-off limits and unrelated failures plainly. Final result includes representative before/after screenshots, not only a test count.

## Rejected Alternatives and Risks

- Retinting the existing rail scored 74/100: low implementation risk but keeps the central composition problem; rejected by the user's request for a cohesive Apple direction.
- Compact floating inspector scored 90/100: selected; existing presenters and lifecycle can be reused while restoring calendar width and event density.
- Full native Calendar replica scored 69/100: would imply sidebar/Year/search/window/API behavior and unnecessary implementation risk; rejected.
- Main risk is host/focus/dismiss regression. Change the shell independently, keep one panel instance and existing guards, verify every entry before deleting rail code. Anchor collision or a short viewport falls back to the modal sheet rather than clipping. Native temporal inputs may have platform minimum sizes: adjust row reflow, not input semantics.

## Confidence and execution handoff

High confidence in source ownership and behavioral preservation; public-reference provenance is recorded above and final composition is checked against root-collected official evidence. No additional user approval gate.

```yaml
executor: {model: gpt-6-sol, reasoning: high, methodology: vivi}
strategy: shared_compact_floating_inspector_with_modal_fallback
order: [calendar_grammar, inspector_host, event_content, visual_convergence]
preserve: [dirty_worktree, exact_routes, capabilities, temporal_truth, RSVP, draft_guards, shared_entry_points]
prohibited: [backend_changes, new_dependencies, global_app_retheme, external_exports, commit, push]
output: [cohesive_implementation, focused_validation, reference_before_after_evidence, remaining_limits]
```
