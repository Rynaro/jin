# Today experience research

Status: proposed, spec-only. This record consolidates the user report, the current `public/main` implementation, the earlier ATLAS review, and FORGE deliberation. It does not claim owner visual sign-off or native WebKit verification.

## Evidence levels

| Level | Evidence | Use |
|---|---|---|
| User report / screenshot | The attached Today screenshot and the request | Establishes the duplicate Capture control, sparse columns, MVP task preview, shrunken event modal, timeline strengths, cozy first-look goal, and top-bar suggestion. |
| Code inspected | `public/main` at `30dfdd8ad1e9a1b12b34ac580802f48a9cc3926f` | Confirms startup routing, existing Today structure, shared modal/controller seams, task/event DTO usage, and current Capture wiring. |
| External normative guidance | Apple HIG [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), and [Modality](https://developer.apple.com/design/human-interface-guidelines/modality) | Supports contextual toolbar hierarchy, purposeful state-transition motion, and modal focus/escape/return behavior. |
| Unverified browser/native | Existing archived verification reports | Useful implementation context, but browser fixtures are not native bridge evidence and appearance/motion still need owner sign-off. |

## Findings from the current code and prior ATLAS review

The router publishes Today on initial connection when the route is Today (`jin-gui/src/controllers/router_controller.ts:46-50`), and the root markup marks Today as the active section (`jin-gui/index.html:103-104`). This is enough to preserve Today as the startup default in the proposed contract. The route should remain resilient to an interrupted detail flow by returning to Today with a sensible focus target.

Today currently owns a Capture action in its header (`jin-gui/index.html:303-311`) while the sidebar already exposes Capture. The proposed composition therefore removes the Today duplicate and keeps capture discovery in the sidebar. The top bar is contextual Today navigation and orientation only; it does not add Notes or Tasks widgets.

The current page has separate all-day, timed, and task lanes plus a Connected work rail (`jin-gui/index.html:395-451`). Prior ATLAS findings support a continuous primary agenda field, populated lanes only, and a quiet relationship rail. Empty space should be absorbed by intrinsic content flow and a calm schedule-empty message rather than by decorative cards or synthetic data.

The current render path builds task rows from the task DTO (`jin-gui/src/lib/agenda/render.ts:200-222`) and connected entities from actual event relationships (`jin-gui/src/lib/agenda/render.ts:224-256`). A richer task preview may show body, tags, and list only when those values are usable in the actual `get_task` DTO. Resolved list names must not be invented when the DTO does not provide them; optional enrichment is deferred.

Prior ATLAS/FORGE work selected a backend-authoritative projection for timezone, task lanes, and focus, with frontend editorial composition. That decision remains useful as an implementation seam, but it does not authorize new provider capability, persistence, or task scheduling semantics.

## UX synthesis

Today is a daily orientation surface: it should answer “what is happening, what needs attention, and what is connected?” within one scan. The hierarchy is date and route identity, then current schedule and attention, then contextual relationships. The timeline stays the visual spine. Task-only and all-day days remain first-class states rather than collapsing into an apparently broken blank canvas.

All authoritative items remain in their appropriate lanes. Intentional focus repetition and contextual repetition are allowed when they help orientation. Connected work deduplicates by linked entity while retaining every linked agenda event ID, so one task or note can show all of its real event associations.

Focus language must remain truthful. Time-left or countdown examples are permitted only when the existing authoritative projection/controller already supplies that value; otherwise use the event’s real time range. New derived facts such as estimates, duration, progress, or “day complete” claims are out of scope.

The task preview should be an in-place, readable detail surface with title and usable body/tags/list values when returned by `get_task`, plus an explicit Go to task action. The event preview preserves Today’s modal semantics while sharing content and edit capabilities with Calendar where supported. Calendar and Today may use different geometry because context differs; the observed shrink is a shared presentation difference, not proof that a selector caused it. Causal CSS diagnosis remains open.

Motion should communicate actual state transitions such as opening, closing, loading completion, and focus return. Do not stage entrance choreography. Reduced-motion users receive instant transitions. Modal behavior must preserve focus trapping, Escape, restoration to the invoking control, and a sensible fallback when that control disappears.

## Open evidence gaps

Native WebKit appearance, physical tap ergonomics, and motion feel remain unverified owner checks. Error, retry, and status semantics described in the spec are proposed controller work with an explicit state contract; they are not existing verified behavior. Provider capabilities must be limited to the shared components’ current support.
