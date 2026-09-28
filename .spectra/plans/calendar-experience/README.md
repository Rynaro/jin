# Jin calendar experience — implementation-ready planning packet

**Status:** researched and specified; implementation is intentionally stopped pending the user's greenlight.

## Recommendation

Make the calendar an active paper field with one event interaction grammar:

1. Select an event to open a stable **Event Companion** while the schedule remains visible.
2. Edit or create inside that same companion; do not route ordinary work through a different page.
3. Select an empty time slot to start a draft at that time. Pointer drag may set duration, but typed fields and keyboard controls remain equivalent paths.
4. Keep the existing full event page as an optional focus view for long context, relationships, and existing sync diagnostics.
5. Share one preview, draft, validation, recurrence-scope, invitation, and operation-state contract across Calendar, Today, Capture, Notifications, and full detail.

The wide-screen host is a non-modal right companion rail. When the Calendar workspace content box is narrower than 920px, and at accessibility text scale, the same companion becomes a true modal sheet through `JinModal`. Jin does not use event-anchored popovers for this workflow.

## What this resolves

- Month, Week, and Day become places to create and reshape time, not links to another screen.
- Create and edit share the same title-first composition, always-visible time/calendar summary, optional sections, validation, and save state.
- Calendar assignment controls visible identity and route filtering; provenance remains secondary metadata.
- Recurrence, timezone/DST, Google capabilities, invitations, sync recovery, and guest-update policy stay truthful instead of being hidden until failure.
- Today keeps its calm projection and gains the same event preview/actions without becoming another calendar.
- Visual ownership moves to named shared components and one ordered calendar stylesheet authority, preventing another late override stack.

## Packet

- [Research and current-state dichotomy](./research.md)
- [Decisions and rejected alternatives](./decisions.md)
- [Normative product and interaction specification](./spec.md)
- [Staged implementation plan](./implementation.md)
- [Frozen acceptance criteria](./criteria.md)
- [Independent readiness critique](./critique.md)
- [Agent handoff](./handoff.yaml)
- [Machine plan](./plan.json)
- [ECL proposal envelope](./spec.envelope.json)
- [RAMZA state](./plan.state.json)
- [Current fixture evidence](../../../.artifacts/playwright-mcp/calendar-experience-baseline.md)

## Scope boundaries

The implemented Google route/conference/invitation/recovery baseline remains authoritative. This plan does not add native proposed-time support, Gmail delivery, `this and following`, physical-room discovery, calendar moves, provider opening links, or a new calendar framework. Time suggestions remain deferred. Display filtering is a GUI preference and never changes provider sync enablement. Jin's current temporal model cannot persist the later physical occurrence of an ambiguous fall-back wall time; the plan labels the earlier slot and disables unsafe temporal edits without blocking unrelated sparse edits.

RAMZA scored the finalized packet at `94.75%` specification confidence after an independent maker≠checker audit found no remaining readiness blockers. The score does not authorize implementation; the explicit user greenlight remains the activation gate.

## Evidence limit

Official product documentation and repository code establish interaction patterns and current seams; they do not prove that this design improves retention. The supplied Playwright fixture screenshots are structural baseline evidence only, not native Tauri sign-off or real-provider proof. The implementation plan therefore includes task-based usability gates before the final rollout.
