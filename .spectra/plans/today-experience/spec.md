# Today experience specification

Status: implemented-pending-native-review. Owner: RAMZA. Source baseline: `public/main` `30dfdd8ad1e9a1b12b34ac580802f48a9cc3926f` (2026-09-28). This document remains the product contract; implementation is recorded in [implementation.md](implementation.md) and awaits native Tauri owner sign-off. It is not an acceptance record.

## Product intent

Today is Jin’s main page and the default page on app startup. It is a cozy daily desk for orientation and action: a calm first look that makes the current schedule, needs-attention work, and real relationships easy to scan. Preserve the timeline as the page’s visual spine and make empty states feel intentional through intrinsic composition and useful next actions.

The router already publishes Today on initial connection when the route resolves to Today (`jin-gui/src/controllers/router_controller.ts:46-50`) and the root marks it active (`jin-gui/index.html:103-104`). Keep that behavior as the startup contract, including current-day re-entry after returning from a detail route or an interrupted focus flow.

## Composition

The page has three semantic zones:

1. A contextual Today top bar: selected date, Today title, compact previous/next/current-day controls, and orientation copy. Capture appears only in the existing sidebar action; remove the duplicate page Capture control (`jin-gui/index.html:303-311`). The top bar is not a Notes or Tasks widget strip.
2. A dominant agenda field: current focus only when truthful and already supported by the authoritative projection/controller, all-day items, one continuous chronological timeline, then populated task lanes in attention, due, and flexible order. A schedule-clear message describes only the schedule.
3. A quiet Connected work rail: real task and note relationships grouped by their agenda event context. It uses continuous paper and rules rather than generic content cards. At narrow widths it follows the agenda in source order.

All items stay in their authoritative lane. Intentional focus repetition and contextual repetition are allowed. Connected work deduplicates by linked entity while retaining every linked agenda event ID and its real event association.

## Preview and modal contract

Task preview is an in-place detail surface with a readable title and body/tags/list only when the actual `get_task` DTO returns usable values. Do not invent resolved list names when they are absent; optional enrichment is deferred. Include an explicit Go to task action and preserve focus on close.

Event preview keeps Today’s modal semantics and shares supported content and editing behavior with Calendar. Shared content parity is the goal; identical geometry in every context is not required. The observed shrink is a presentation difference whose causal CSS diagnosis remains open, so implementation must inspect the shared modal/component contract before changing selectors.

Escape closes, focus returns to the invoking control, and a sensible fallback is used when that control no longer exists. Loading, success, error, and retry states must be explicit controller states if added; they are proposed behavior, not existing verified semantics.

## Data truth and state coverage

Use the existing authoritative Today projection and DTO seams. Do not fabricate task times, durations, estimates, list names, provider fields, or countdown values. Time-left and starts-in copy is allowed only when already supplied by a truthful projection/controller; otherwise show real times.

The spec must cover: authoritative empty; task-only; all-day; noncurrent selected date; initial load failure; retry after failure; populated schedule; relationship-empty schedule; midnight/current-day re-entry; and interrupted preview focus restoration. A current-day transition must refresh according to the existing authoritative current-date signal. Historical and future dates must not acquire current-day focus semantics.

## Interaction and visual rules

Use Apple-like toolbar hierarchy and Jin’s existing warm paper, ink, indigo linkage, and restrained vermilion Capture language. Keep the timeline markers and labels distinguishable by shape and text as well as color. Maintain keyboard access, readable headings, live status, coarse-pointer hit targets, dark/contrast/forced-color states, and intrinsic large-text reflow.

Motion is reserved for actual state transitions: modal open/close, loading completion, and focus restoration where useful. No staged entrance sequence. Reduced motion is instant.

## Scope boundaries

In scope: startup default preservation; duplicate Capture removal; Today top-bar hierarchy; continuous timeline and populated lanes; task preview content gating; event modal parity of shared content; empty/loading/error/retry state contract; contextual relationship presentation; responsive and accessibility behavior; focused frontend behavior/style/build and visual verification.

Out of scope: Notes/Tasks widgets in the top bar; new scheduling semantics; fabricated task chronology; provider or persistence changes; new background services; forcing identical Today and Calendar modal geometry; blanket workspace verification when no Rust/core changes are planned.

## Acceptance outline

- Startup opens Today and current-day re-entry restores a sensible focus target.
- Only the sidebar presents Capture.
- Empty, task-only, all-day, noncurrent, failure, retry, and midnight states are truthful and visually calm.
- Task preview renders only usable `get_task` fields and offers Go to task.
- Event preview preserves Today modal semantics and shares supported Calendar content; no causal CSS claim is made without evidence.
- All authoritative lanes remain complete; focus/context repetition is intentional and connected work retains all event IDs.
- Timeline remains continuous and scannable at desktop, compact, large-text, dark, contrast, forced-color, keyboard, and reduced-motion settings.
- Verification is proportional: frontend behavior/style/build and visual checks; Rust only if a core contract actually changes.
