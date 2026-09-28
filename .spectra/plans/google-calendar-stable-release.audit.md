# Google Calendar stable release — planning audit

## Routing

```yaml
selected: [atlas, ramza, idg]
tier: standard
chain:
  - eidolon: atlas
    role: repository_and_provider_scout
    hand_off_artifact_path: .spectra/plans/google-calendar-stable-release.audit.md
    edge_origin: roster
  - eidolon: ramza
    role: specification_author
    hand_off_artifact_path: .spectra/plans/google-calendar-stable-release.md
    edge_origin: roster
  - eidolon: idg
    role: research_packet_synthesis
    hand_off_artifact_path: .spectra/plans/google-calendar-stable-release.handoff.yaml
    edge_origin: composition
model_tier_per_step: [standard, standard, standard]
confidence: 0.98
assumptions:
  - The user authorizes research and specification only.
  - “Meets” means Google Meet unless clarified as physical room inventory.
  - Accept/reject means attendee RSVP.
  - Time suggestions are deferred from this stable release.
clarification_request:
  - Confirm Google Meet versus physical Workspace room if the baseline assumption is wrong.
refusal_rerouting: false
```

## RAMZA phase record

- RS: score 8, full tier (`files_est=34`, public API, migration, security,
  novelty, high stakes).
- S: CHANGE; complexity 11/12, human-loop.
- P: adapt the existing multi-account route/outbox, Event detail, and Notification
  Center RSVP patterns. Prior pattern match is above 85% for RSVP/routing and below
  60% for time-suggestion delivery.
- E: selected `unified-core-owned-capability` (89.5). Rejected GUI-direct provider
  patch (67), notification-ledger-primary (73), and generic collaboration engine
  (72.5).
- C: amended to 11 stable-release stories and 64 EARS acceptance criteria.
- T: initial structural and EARS lints passed; independent checker
  `calendar_spec_critic` required refinement for operation-specific authority,
  attendee completeness, insert idempotence, Gmail revalidation, error taxonomy,
  migration, conditional dependencies, and live stability gates.
- R1: all material findings were incorporated in one gated refinement; focused
  recheck and final T/A records live in the RAMZA state.

## Evidence summary

Repository evidence was read-only. The current code already has:

- exact multi-account/calendar route identity and durable Google event outbox;
- attendee, resource, and conference data in the canonical Event model;
- routed create/edit bridge shapes that can carry attendees and conference data;
- a robust Notification Center RSVP ledger, command, sync worker, and GUI flow;
- Event detail rendering for organizer, attendees, conference information, and safe
  Join links.

The final-pass gaps are:

- Event detail has no RSVP capability/action reference;
- calendar create/edit UI does not collect guests or Meet intent;
- generic insert/patch does not carry `sendUpdates`, so adding attendees is not yet
  a reliable invitation-delivery workflow;
- writable calendar role currently over-approximates organizer/contributor authority;
- calendar discovery does not persist allowed conference solution types;
- physical room discovery would require separate Admin Directory authorization;
- Calendar REST exposes no native proposed-time lifecycle;
- Jin has no existing email delivery integration.

Provider evidence was reviewed on 2026-09-15 against official Calendar, Admin
Directory, Gmail, Google API HTTP, and RFC 6068 sources. It has not been validated
against a live account in this planning session.

## Provider boundaries frozen by the spec

- Invitation create/update explicitly uses a persisted `sendUpdates` policy.
- RSVP remains a self-attendee-only patch and preserves every other attendee.
- Meet creation is gated by the calendar's advertised conference types and retains
  request IDs across transport retry.
- Resource rooms are attendees; searchable inventory is a Workspace-admin feature.
- Calendar proposed-time UI has no equivalent public Events API contract.
- Time suggestions are excluded from the stable release: no Gmail scope, mail outbox,
  UI action, or delivery claim is included.
- Backlog B1 retains ordinary organizer-only Gmail email as the preferred future
  approach, gated by Sensitive-scope consent, canonical revalidation, MIME/privacy
  safety, explicit ambiguous-POST handling, and separate live evidence.
- HTTP 412 never falls back to an unconditional overwrite; HTTP 410 resets one route.

## Full-tier test-layer evidence

| Layer | Evidence | Result |
|---|---|---|
| Structural | `ramza-lint` against full-tier state | pass |
| Criteria grammar | `ramza-ears-lint` on AC-GCSR-001..064 | pass after amendment |
| Dependency/call-site | Capability matrix, exact backend contracts, 12-story dependency spine, repository anchors | covered |
| Constraint | Stories are 2–7d; Gmail is backlog-only; optional room scope remains explicit; specification stop is preserved | covered |
| Self-consistency | User-journey, provider-operation, and persistence/surface decompositions were normalized against ten release invariants | 8/10, 9/10, 8/10 overlap; all ≥70% |
| Adversarial | Independent `calendar_spec_critic` review, gated R1, focused recheck | recorded in plan state |

The ten invariants used for re-derivation were exact-route identity, core-owned
capability, operation-specific authority, durable intent, complete attendee state,
provider-confirmed UI, recurrence identity, concurrency/recovery, truthful external
delivery, and live stable-release proof.

## User-directed amendment — time suggestions

After the initial criteria freeze, the user selected the lowest-risk stable-release
boundary: reason about the best complete approach, then defer implementation.

- Selected future approach: optional, narrow `gmail.send` ordinary email to the
  organizer. This is the only researched route that actually sends from Jin without
  pretending Calendar attendee comments are native proposed-time state.
- Deferral rationale: Sensitive OAuth consent, a new mail outbox, non-idempotent POST
  ambiguity, consent UX, and separate provider release evidence expand this pass.
- Stable consequence: Story S7 mail implementation and its criteria were removed;
  later stories were renumbered; the baseline dependency spine no longer includes
  any mail work; two negative stable criteria ensure no Gmail integration or
  time-suggestion UI ships accidentally.
- Tamper evidence: the acceptance-criteria digest is updated only through
  `ramza-freeze --amend --reason`, preserving the previous digest in state history.

## Scope protection

The user requested specifications and an implementation stop. All authored files are
under `.spectra/`. No product source, dependency, OAuth console state, external data,
or provider account was modified.

Known unrelated pre-existing/untracked workspace items were preserved:

- `.spectra/plans/navigation-sidebar-unification.evidence/`
- `.spectra/plans/ramza-calibration.jsonl` (the pre-existing file received only the
  mandatory RAMZA score entries written by the gate tools)
- `readme-jin-today.png`
- `ui-fix-1280-subtask-nested-final.png`
