# Google Calendar stable release — review index

**Status:** approved baseline implemented; planning artifacts below retain their historical handoff state.

**Historical note (2026-09-16):** This PR implements the approved baseline and subsequent stability fixes. The linked specifications and the “Still missing” and “Implementation boundary” sections below describe the pre-implementation planning handoff. Time suggestions remain deferred to backlog B1; physical Workspace-room support remains conditional and unimplemented.
This index is the review entry point for the [main specification](./google-calendar-stable-release.md), [frozen acceptance criteria](./google-calendar-stable-release.criteria.md), [planning audit](./google-calendar-stable-release.audit.md), [handoff](./google-calendar-stable-release.handoff.yaml), [execution plan](./google-calendar-stable-release.plan.json), and [RAMZA state](./google-calendar-stable-release.state.json).

## What this packet covers

The release keeps Jin as the place for ordinary Google Calendar work:

- create invitations, edit guests, reschedule, and cancel organizer-owned meetings;
- accept, mark Maybe, decline, or change an RSVP from Event detail and Notification Center;
- add, inspect, retry, or remove Google Meet when the exact calendar advertises support;
- preserve a clear boundary for time suggestions, which are deferred to backlog B1;
- preserve exact account/calendar routing, durable intent, recurrence scope, concurrency, offline recovery, accessibility, and provider-confirmed state.

## Current baseline and remaining work

**Already present:** exact multi-account/calendar routing and durable Google event outbox; canonical attendee, resource, and conference fields; routed create/edit shapes; and a durable Notification Center RSVP ledger, command, sync worker, and GUI flow. Event detail already renders organizer, attendees, conference information, and safe Join links. [Source: audit.](./google-calendar-stable-release.audit.md)

**Still missing:** Event-detail RSVP action wiring; guest and Meet intent in create/edit; persisted `sendUpdates` policy; operation-specific authority projection; persisted conference solution capabilities; and the conditional physical-room path. Time suggestions are deliberately deferred to backlog B1, so the stable release has no Gmail integration or time-suggestion UI. [Source: audit.](./google-calendar-stable-release.audit.md)

## Decisions for greenlight

- **[DECISION]** “Meets” is specified as Google Meet through `conferenceData`. Physical Workspace rooms are a separate conditional track, represented as resource attendees and requiring distinct discovery/authorization. [Source: spec.](./google-calendar-stable-release.md)
- **[DECISION]** Time suggestions are deferred to backlog B1. The eventual recommended approach is optional, narrow `gmail.send` ordinary email to the organizer, never a native Calendar proposal; it is deferred because consent, mail persistence, UI, ambiguous-send handling, and live Gmail evidence expand this stable release. [Source: audit.](./google-calendar-stable-release.audit.md)
- **[ACTION]** At implementation greenlight, confirm the Google Meet versus physical room interpretation. Until then, no implementation lifecycle transition is authorized; B1 requires a separate frozen spec before any Gmail work. [Source: handoff.](./google-calendar-stable-release.handoff.yaml)

## Evidence and validation

- 11 stories and 64 frozen EARS criteria span routing, capability projection, invitations, RSVP parity, Meet, optional rooms, recovery, UI/accessibility, and release evidence. [Criteria index.](./google-calendar-stable-release.criteria.md)
- One gated refinement incorporated the independent `calendar_spec_critic` findings; the focused recheck passed. Structural and criteria grammar lints passed after the amendment. [Source: audit and state.](./google-calendar-stable-release.audit.md) [State.](./google-calendar-stable-release.state.json)
- Final criteria digest: `7e964657275635023d2f6fbb496add132579e0e22b66cde322a2e5d87fd932d0`. Emission gate: green. Validation is document-only; provider evidence was reviewed against official sources on 2026-09-15 and has not been validated against a live account.

## Implementation boundary

This packet authorizes planning review only. No product source, dependency, OAuth configuration, external provider data, PR, or implementation lifecycle transition is authorized before the separate user greenlight. Live disposable-account smoke evidence remains a release gate for any capability that is implemented. [Source: spec stop condition and audit.](./google-calendar-stable-release.md) [Audit.](./google-calendar-stable-release.audit.md)

---

## Provenance

- **Scribe version:** 1.10.0 (IDG)
- **Document type:** custom review index
- **Generated:** 2026-09-15
- **Source artifacts:** main spec, criteria, audit, handoff, plan, and state linked above
- **CHT gate:** C:4/5 H:5/5 T:5/5 — deliver; live-account proof and backlog B1 are explicit boundaries
- **Coverage:** status, stable scope, current baseline, missing work, Meet decision, B1 deferral, validation evidence, and implementation boundary
- **Flags:** [GAP] live provider smoke proof is deferred to implementation/release verification; [GAP] B1 needs a separate frozen spec; no [DISPUTED] claims were found in the supplied artifacts
