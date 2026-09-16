---
eidolon: ramza
version: 0.1.0
kind: spec
status: awaiting-implementation-greenlight
created_at: 2026-09-15T22:05:00Z
thread_id: 01a0a715-0d22-7a12-ba9f-5eaedf350e59
target_repos:
  - jin
stories_count: 11
validation_gates_count: 64
confidence: 0.9375
decisions_resolved_at: 2026-09-15T22:33:35Z
evidence_anchors_count: 31
---

# Google Calendar stable release

## Scope

Intent class: CHANGE.

Deliver the remaining Google Calendar collaboration features without creating a
second calendar model or sending the user to Google Calendar for ordinary work.
Jin becomes the place to create invitations, change schedules, respond to received
invitations from Event detail and Notification Center, add Google Meet, cancel an
organizer-owned meeting, and track provider-confirmed outcomes.

### In

- Create a Google-backed event with guests and an explicit guest-update policy.
- Add, remove, and classify attendees while preserving unchanged attendee state.
- Directly reschedule events when Google semantics permit the current account to edit.
- Accept, mark Maybe, or Decline invitations in both Event detail and Notification
  Center through the existing durable RSVP ledger and outbox.
- Change a prior RSVP before the event ends; show queued state separately from the
  provider-confirmed response.
- Add, inspect, retry, and remove Google Meet conference data where the destination
  calendar advertises `hangoutsMeet` support.
- Cancel organizer/shared-calendar events with guest notifications; keep attendee
  Decline separate from organizer cancellation and local deletion.
- Exact account/calendar routing, offline queues, optimistic concurrency, recurrence
  scopes, scoped recovery, accessibility, responsive behavior, and release evidence.
- A separately specified physical Workspace-room extension so “Google Meet” and
  “room resource” never share one ambiguous control.

### Out

- Pretending `attendees[].comment` is a native proposed-time object. The public
  Calendar REST API exposes no interoperable proposal lifecycle.
- Gmail inbox reading, mail-thread discovery, read receipts, delivery/read claims,
  arbitrary email composition, or a general email client.
- Automatically selecting a physical room, checking room availability, or requesting
  Admin Directory scope in the baseline Google Meet interpretation.
- `This and following` recurrence mutation. Google implements it as a series split
  that can reset later exceptions; it needs a dedicated future contract.
- Moving a published event between account/calendar routes, event ownership transfer,
  Calendar ACL administration, or silent cross-account fallback.
- More than 200 guests as a fully synchronized attendee workflow. Existing large
  events may be read, but Jin does not promise response propagation beyond Google's
  documented boundary.
- Push notification payload processing as event truth. A push message may trigger
  exact-route incremental sync only.

### Deferred

- **Send time suggestion.** The stable release exposes no time-suggestion action.
  Calendar REST has no native proposed-time lifecycle, and attendee comments are not
  reliable delivery. Backlog B1 freezes the preferred future solution and its entry
  gates without adding Gmail OAuth, mail persistence, UI, or release obligations now.

### Product assumptions requiring greenlight acknowledgement

1. **“Meets” means Google Meet.** This is the baseline and ships through the existing
   `conferenceData` model. If the user meant a physical office room, activate the
   optional room-resource track described below.
2. **Time suggestions are deferred.** The eventual preferred route is a narrow
   ordinary email to the organizer using optional `gmail.send`, because Calendar REST
   has no native proposal contract. The stable release does not request that scope or
   expose a disabled/partial send control.
3. **Approving/rejecting a received meeting means attendee RSVP.** Organizer-side
   approval workflows outside Calendar attendee responses are not inferred.

Risk if assumption 1 is wrong: the baseline creates a video room rather than booking
physical inventory. Risk if assumption 2 is wrong: the backlog needs a different
explicit transport decision before implementation. Risk if assumption 3 is wrong:
the product needs a different provider workflow and vocabulary.

Right-size: 8 → full. Complexity: 11/12 → human-loop. Cortex tier remains standard;
RAMZA full-tier gates apply to the planning artifact. The user explicitly requires a
specification-only stop, so no AUTO_PROCEED result authorizes implementation.

## Approach

### Selected pattern: one collaboration capability projection, existing durable paths

Extend the canonical Event and exact-route mutation contracts, then project all user
actions from core. Event detail and Notification Center consume the same invitation
action reference and invoke the existing durable response command. Event creation,
schedule/guest edits, conference creation, and cancellation each persist intent before
provider I/O. UI controllers render pending, confirmed, failed, stale, and read-only
states; they do not infer permission from a Google badge.

The prior multi-account plan remains authoritative for immutable account IDs, exact
calendar destinations, route/auth generations, sparse provider writes, 412 handling,
and isolated 410 recovery. This plan extends those contracts; it does not replace
them. The existing Notification Center RSVP implementation is the reusable baseline,
not a prototype to rebuild.

### Capability matrix

| Action | Core authorization | Provider operation | Surface behavior |
|---|---|---|---|
| Create invitation | connected account + enabled, available `owner|writer` calendar + at least one non-self guest | `events.insert`, `sendUpdates=all` by default | Event editor guest field; exact destination required |
| Reschedule | writable exact route + event unlocked + organizer authority or `guestsCanModify=true` | sparse `events.patch`, `If-Match`, chosen `sendUpdates` | Event detail Edit; recurrence scope first |
| Invite another guest | writable exact route + event unlocked + organizer authority or `guestsCanInviteOthers=true` | append against a complete fresh attendee set | Add guest; show notification policy |
| Remove/change guests | writable exact route + event unlocked + organizer authority | full attendee replacement built by core from complete provider state | Attendee editor; show notification policy |
| RSVP | non-organizer self attendee, future event, exact route valid | attendee-only `events.patch`, `attendeesOmitted=true`, existing RSVP policy | Accept / Maybe / Decline in both surfaces |
| Change RSVP | same as RSVP; requested value differs from provider-confirmed value | same durable RSVP path | Current choice selected; pending choice announced |
| Add Meet | event unlocked + organizer authority + destination advertises `hangoutsMeet` + no foreign conference | `conferenceDataVersion=1`; create request | Meeting row in editor/detail, never encoded as location |
| Remove Meet | event unlocked + organizer authority + current solution is a removable `hangoutsMeet` conference | explicit conference removal | Action explains link removal |
| Cancel meeting | event unlocked + organizer authority | `events.delete` with guest update policy | Destructive confirmation says guests are notified |
| Decline meeting | RSVP permission only | attendee-only response patch | Never deletes/cancels event for other guests |
| Assign physical room (optional) | guest-management permission + known resource email; discovery additionally needs domain admin scope | room attendee with `resource=true`; optional Directory list | Separate Room control and capability copy |

`owner|writer` on the invitee's own primary calendar is not sufficient proof that the
invitee may edit somebody else's meeting. Core derives two mechanical authorities:

```text
organizer_authority = organizer.self == true
  OR (route is writable AND calendar.primary == false
      AND canonical_email(organizer.email) == canonical_email(route.calendar_id))

guest_authority = exactly one self attendee on the exact route
  AND the relevant guestsCan* field is true
```

`locked=true` denies schedule, guest, conference, and cancellation mutation. Guest
authority may permit schedule edits or appending invitees, but never removing or
changing existing attendees, cancelling the meeting, or replacing conference data.
A conference whose provider solution is not `hangoutsMeet`, or whose ownership cannot
be established from the current event, stays visible and read-only.

### Domain and backend contracts

#### 1. Provider fields and capabilities

Retain explicit Google event permission fields needed for policy (`guestsCanModify`,
`guestsCanInviteOthers`, `guestsCanSeeOtherGuests`, `locked`) instead of hiding them
only in a flattened provider map. Extend `EventDetailCapabilitiesDto` with one nested
collaboration projection:

```text
EventCollaborationCapabilitiesDto {
  invitation?: {
    action_ref: { notification_item_id, expected_item_version },
    provider_response: needs_action|accepted|tentative|declined,
    requested_response?: accepted|tentative|declined,
    state: idle|queued|sending|confirmed|failed|obsolete,
    can_respond, recurrence_scopes[], disabled_reason?
  },
  can_edit_schedule,
  can_append_attendees,
  can_remove_attendees,
  can_change_attendee_roles,
  can_cancel_meeting,
  can_add_conference,
  can_remove_conference,
  allowed_conference_solution_types[],
  disabled_reasons: map<capability, stable_reason>
}
```

The action reference contains no bearer token, provider subject, etag, or route
generation. Core resolves and validates those against the latest canonical event and
notification ledger. Rust DTO, Tauri command, TypeScript interface, fixtures, and
shape tests change together.

Calendar discovery also persists `allowedConferenceSolutionTypes`. A one-time,
destination-scoped full event sync is required before that route reports conference
management ready, so older mirrors cannot silently overwrite conference data omitted
by a historical projection.

#### 2. Attendee edits and invitation delivery

Add an attendee draft contract with `email`, optional display label, `optional`, and
`resource`; ordinary users enter guests through a purpose-built email chip/list
control. Do not reuse TagInput, which lowercases and applies tag vocabulary.

Core, not the browser, merges edits with the canonical attendee set. Before any
full-list replacement, the operation must hold a fresh exact-route provider resource
whose attendee set is explicitly complete (`attendeesOmitted != true`, no configured
attendee truncation, matching etag). A self-only RSVP representation is never a merge
base. If completeness is unknown, core refetches once; if Google still omits attendees,
remove/change operations are disabled and append requires a provider-supported
append-safe path or remains unavailable.

With a complete set, core:

- deduplicate email identities case-insensitively while preserving provider spelling;
- reject the authenticated account as a newly added ordinary guest;
- preserve response status, comment, additional guests, and provider-only fields for
  unchanged attendees;
- initialize a new attendee without inventing an accepted response;
- never rewrite organizer identity through the attendees array;
- serialize only provider-writable fields and replace the full attendee list once;
- block a new in-app invite above 200 guests and explain Google's propagation limit.

Every create, schedule change, attendee change, and organizer cancellation carries an
immutable `GuestUpdatePolicy = all | external_only | none` in the mutation journal
and outbox. UI defaults to `all` when guests exist. Choosing `none` is an explicit
advanced action with warning text; retries reuse the original policy. RSVP stays on
its attendee-only path and does not reuse organizer notification policy.

Invitation insert also persists a Google-valid client event ID before canonical/outbox
commit. The same ID, operation ID, guest-update policy, and Meet `requestId` (when
present) survive crash recovery and every transport retry. On timeout or connection
loss after POST, the worker performs exact-route `events.get` by that ID: an existing
event is reconciled as success; 404 retries the same insert; 409 fetches and validates
the existing resource. Jin never creates a second event or a second notification fan-
out to recover an ambiguous insert.

#### 3. Shared RSVP ledger

Notification reconciliation remains the source of response attempts. It retains one
item for each exact provider/account/calendar/event/recurrence identity and exposes
the action reference to Event detail. Both surfaces call the existing
`respond_calendar_invitation` bridge command; no second event-detail RSVP outbox is
created.

The current response validator expands from `needsAction` only to any non-organizer
self attendee on a future event. Selecting the already confirmed response is a no-op.
A new response uses a new operation ID, item version, current etag, auth generation,
route generation, and provider subject. Canonical attendee state changes only after
provider confirmation is imported. Pending state is shared immediately via the
existing mutation signal. Provider-side changes supersede stale UI and refresh both
surfaces. A terminal/history notification remains actionable for a response change
until the event ends or capability is lost.

For recurrence, `this_occurrence` targets the exact instance identity and
`entire_series` targets the master. The scope dialog is required whenever both are
available. `this_and_following` stays core-rejected.

#### 4. Direct edits, concurrency, and cancel/delete semantics

Schedule, guest, and conference edits use the existing canonical edit token plus the
stored provider etag. A 412 fetches the current provider event, imports it, records the
losing local intent, and returns a typed stale result for review. Jin never retries an
unconditional overwrite. Recurring edits require scope before opening the editor.

Provider-backed organizer deletion is presented as **Cancel meeting**, records
`GuestUpdatePolicy`, and notifies guests according to that policy. Attendee
**Decline** modifies only the authenticated attendee response. Local-only deletion
remains local. Removing an invitation from only the user's calendar is deferred; it
must never be conflated with either action.

#### 5. Google Meet lifecycle

Meet creation uses the existing `PendingConferenceCreateRequest` shape.

```text
idle -> queued -> provider_pending -> ready
                    |                |
                    v                v
                  failed <------- removed
```

- Capability requires `hangoutsMeet` in the destination's allowed solution types.
- One semantic create action generates a fresh unpredictable `requestId`.
- Transport retries reuse that request ID; a user-started retry after terminal failure
  is a new semantic action and gets a new ID.
- Provider `pending` remains visibly pending and triggers bounded exact-route refetch;
  it is never rendered as a usable meeting link.
- Success renders safe HTTPS entry points and a Join action in Event detail.
- Failure preserves the event and offers Retry; removal is an explicit edit.
- Existing conference data is retained losslessly when unrelated fields change.

#### 6. Deferred backlog B1: send time suggestion

The public Calendar REST Events resource has no native proposed-time field or
accept/reject-proposal lifecycle. `attendees[].comment` is not a substitute and must
not be presented as delivered organizer communication.

The preferred future approach is an ordinary email sent only to the organizer through
incremental, optional `gmail.send` consent. It is the narrowest route that actually
leaves Jin while avoiding inbox-read scope, fake Calendar semantics, and a general
mail client. It is deferred because the Sensitive OAuth scope, a separate durable
mail outbox, non-idempotent ambiguous POST recovery, consent UX, and live Gmail release
proof materially expand this stable Calendar release.

B1 may enter planning only when all prerequisites are accepted:

- explicit authorization for incremental `gmail.send` consent and its verification;
- a narrow organizer-only message product contract, never a native proposal claim;
- core revalidation of current organizer, occurrence, interval, account principal,
  event state, revision, and auth/scope generation immediately before submission;
- bounded MIME/header/recipient validation and privacy denylist;
- durable states that distinguish queued, submitted-to-Gmail, delivery-unknown,
  stale-review, and failed without claiming delivery or read;
- no automatic retry after an ambiguous POST; explicit warned re-attempt only;
- deterministic provider tests plus disposable-account submission evidence.

Until a separate frozen spec satisfies that boundary, Jin shows no time-suggestion
button, requests no Gmail scope, creates no mail outbox, and makes no delivery claim.

### Frontend interaction contract

#### Event create/edit

Use the existing event dialog and form primitives. Keep one continuous form field,
not nested cards:

```text
Event dialog
  Title
  When + recurrence
  Where
  Guests
    email rows/chips + Optional + Remove
    Add guest
  Meeting
    Add Google Meet / Pending / Join / Retry / Remove
    [optional physical-room control when capability is enabled]
  Description
  Calendar destination
  Guest updates: Notify all (default) / external only / do not notify
  Cancel | Create invitation / Save changes
```

The primary label becomes **Create invitation** when guests are present and **Create
event** otherwise. Destination, attendee, Meet, and notification-policy errors appear
next to their owning field and in the dialog summary. A local-only destination cannot
carry guests or provider conferencing; changing to Local only requires resolving
those fields first.

#### Event detail

Place response actions close to time and organizer context. Show **Accept**, **Maybe**,
and **Decline** as real buttons with current and pending state expressed by text,
`aria-pressed` where appropriate, and an `aria-live` result. Editing and destructive
actions remain visually separate. Attendees render as a continuous list with text
status; resources are labeled “Room.” Conference entry points use the existing Join
link treatment. No time-suggestion control appears in this release.

#### Notification Center

Reuse its master/detail triage, recurrence-scope dialog, busy state, retry treatment,
focus return, and live feedback. Replace user-visible `Allow / Maybe / Refuse` with
Calendar-standard **Accept / Maybe / Decline** while preserving internal enum
compatibility. The item refreshes when Event detail acts, and Event detail refreshes
when Notification Center acts.

The RSVP state/action renderer is a shared component contract used by both surfaces.
Core remains the sole owner of provider capability, pending, stale, and confirmed
state; shared UI code only renders and dispatches the projected contract.

#### Visual and accessibility rules

- Reuse `.btn-primary`, `.btn-secondary`, explicit destructive button, dialog, form,
  list-row, status-cue, and notification action primitives before adding styling.
- Calendar and notification content remain continuous paper fields; do not wrap each
  guest, action, or state in a rounded gray card.
- Indigo represents focus/selection/time; semantic red represents failure; the
  existing explicit destructive primitive is reserved for cancellation.
- At 320, 390, 760, and 1440 CSS px, controls wrap before the document overflows.
  Guest entries and action groups become one-column at their owning seam.
- Preserve real labels, visible focus, focus trap/restore, keyboard list navigation,
  44px coarse-pointer targets, large-text intrinsic height, reduced motion,
  increased contrast, reduced transparency, and forced-colors legibility.
- Browser evidence proves DOM/interaction behavior only; native Tauri OAuth, external
  join links, mail submission, and platform feel require owner smoke sign-off.

### Physical Workspace-room extension (conditional)

If “meeting room” means a physical room, implement it as an attendee resource, not a
Meet link or location string. Two levels are intentionally distinct:

1. **Known room email:** users with guest-management permission may add a resource
   email flagged `resource=true`. The event shows Pending / Accepted / Declined from
   the provider response. This requires no resource-directory discovery.
2. **Searchable room inventory:** opt-in account capability backed by Admin Directory
   `resources.calendars.list`, limited to Google Workspace domains and an authorized
   administrator with the read-only resource scope. Cache only display metadata,
   resource email, building/floor, capacity, and features. Consumer/non-admin accounts
   receive truthful “Directory access unavailable” state and may use a known email.

This extension has separate consent, capability, and tests. It must not block the
baseline Google Meet flow when the current product assumption is retained.

### Permission matrix

| Scope / permission | Required for | Consent behavior |
|---|---|---|
| `openid email` | stable Google subject/principal | existing account binding |
| `calendar.events` | read/write invited events, RSVP, attendee/schedule/conference changes | existing Calendar account; `calendar.events.owned` is insufficient |
| `calendar.calendarlist.readonly` | calendars, roles, conference capability discovery | existing Calendar account |
| `admin.directory.resource.calendar.readonly` | searchable physical-room inventory | optional Workspace-admin consent only |

Revocation increments the owning capability generation and pauses only matching
work. Restoring consent requires explicit retry/review; old operations never reroute
to another Google account.

### Upgrade and persistence migration

Introduce versioned, crash-safe migrations for collaboration capability metadata,
`GuestUpdatePolicy`, client event IDs, per-route conference bootstrap state, reusable
invitation action references, and the optional room state. Migration is
idempotent and retains unknown historical records for review rather than inventing
permissions.

On upgrade, existing `needsAction`, accepted, tentative, and declined Google
invitations are materialized on demand into the Notification Center using the unique
provider/account/calendar/event/recurrence source key. Repeated startup, sync, or
Event-detail reads converge on one item and never create an action attempt. Existing
items keep their versions, history, and pending attempt ownership. New outbox columns
receive explicit legacy-safe defaults; no historical create is replayed merely to
obtain a client event ID.

### Sync, offline, and failure policy

- Calendar and RSVP mutations remain local-first and exact-route queued. UI says
  **Queued** until provider-confirmed state is imported.
- One account/calendar failure does not block other routes. Aggregate status reports
  partial failure without erasing successful commits.
- HTTP and Google error reasons are classified by endpoint. `401` and explicit
  invalid/insufficient-scope reasons pause the exact capability for reauthorization;
  quota/rate reasons and `429/5xx` use bounded backoff and `Retry-After` when present;
  `forbiddenForNonOrganizer`, role, domain-policy, or event-policy reasons refresh
  capability then terminate to review rather than asking for credentials.
- A targeted-event 404/410 obsoletes or reconciles only that operation. An event-list
  sync-token 410 resets only the exact route cursor and starts a scoped full sync.
  Push notifications carry no event truth and only schedule that sync.
- 412 always refetches and surfaces a conflict. Provider cancellation and newer route,
  auth, or tombstone generations outrank queued older work.
- Reconnect or permission restoration never silently replays quarantined guest edits,
  cancellations, RSVP, conference, or mail operations.

## Stories

### Story S0: Freeze the implemented baseline

As an implementer, I want a retained/superseded matrix so that the final pass extends
the multi-account and Notification Center work without forking it. Timebox: 2d. Risk:
P0. Executor hint: frontier, goals and constraints. Output: call-site inventory,
contract ownership, retained tests, frozen provider evidence dated 2026-09-15.

### Story S1: Project collaboration permissions

As a user, I want controls to reflect real Google authority so that a writable badge
does not expose actions I cannot perform. Timebox: 4d. Risk: P0. Executor hint: mid,
file-level action plan. Output: explicit provider permission fields, collaboration DTO,
calendar conference capability, Rust/TS parity tests. Depends on S0.

### Story S2: Create invitations and manage attendees

As an organizer, I want to add guests while creating or editing an event so that Jin
can send a real Calendar invitation. Timebox: 6d. Risk: P0. Executor hint: frontier.
Output: attendee draft/merge service, guest update policy in journal/outbox, insert and
patch mappings, event-form behavior, provider cassettes. Depends on S1.

### Story S3: Reschedule and cancel safely

As an authorized organizer or contributor, I want to move or cancel a meeting so that
guests receive the intended update. Timebox: 6d. Risk: P0. Executor hint: frontier.
Output: semantic capability rules, recurrence scope, If-Match conflicts, cancellation
policy, no attendee-delete confusion. Depends on S1-S2.

### Story S4: Add RSVP to Event detail

As an invitee, I want Accept, Maybe, and Decline beside the calendar entry so that I
can respond in context. Timebox: 4d. Risk: P0. Executor hint: mid. Output: event-detail
action reference, shared command wiring, current/pending state, focus and a11y tests.
Depends on S1.

### Story S5: Reconcile both RSVP surfaces

As an invitee, I want Event detail and Notification Center to agree so that a response
never appears contradictory. Timebox: 4d. Risk: P0. Executor hint: frontier. Output:
ledger changes for response updates, terminal/history action, mutation refresh,
recurrence/stale/error tests. Depends on S4.

### Story S6: Create and manage Google Meet

As an organizer, I want a Meet link created with the event so that conferencing is
ready without opening Google Calendar. Timebox: 5d. Risk: P0. Executor hint: mid.
Output: capability discovery, route bootstrap marker, request lifecycle, UI states,
cassette and live-smoke coverage. Depends on S1-S3.

### Story S7: Support physical room resources when selected

As a Workspace organizer, I want to add a room resource so that Google can accept or
decline it according to availability. Timebox: 6d. Risk: P1. Executor hint: frontier.
Output: known-email resource path; optional admin Directory discovery, consent and
capability state; room-response UX. Conditional on product clarification; depends on S2.

### Story S8: Harden offline, recurrence, and concurrency behavior

As a multi-account user, I want collaboration actions isolated and recoverable so that
offline work or stale state cannot affect another event. Timebox: 7d. Risk: P0.
Executor hint: frontier. Output: exact-route generation checks, recurrence fixtures,
crash injection, 410/412, quarantine and partial-failure tests. Baseline depends on
S2-S6; include S7 only when decision D2 activates physical rooms.

### Story S9: Compose the stable Jin experience

As a Jin user, I want collaboration controls to feel native to Calendar and
Notifications so that the final pass remains calm and coherent. Timebox: 6d. Risk:
P1. Executor hint: mid. Output: shared controls/dialogs, localized copy, responsive and
preference-state evidence, no overflow/console errors. Depends on S3-S8.

### Story S10: Verify provider fidelity and release state

As the owner, I want deterministic evidence plus disposable-account smoke results so
that unsupported provider assumptions cannot ship as stable. Timebox: 5d plus owner
smoke. Risk: P0. Executor hint: mid checker, identity distinct from implementation.
Output: full automated matrix, Playwright evidence, native Tauri checklist, Calendar,
Meet and activated room-variant results; unresolved live behavior remains disabled.

Dependency spine:

```text
S0 -> S1 -> S2 -> S3 -----> S8 -> S9 -> S10
       |      |     `-> S6 --^     ^
       |      `-> S7 --[if D2]--^  |
       `-> S4 -> S5 --------^------'
```

## Acceptance Criteria

The 64 frozen EARS criteria are in
`.spectra/plans/google-calendar-stable-release.criteria.md`. They cover baseline
preservation, capability projection, guest delivery, RSVP parity, recurrence,
concurrency, Meet, the optional physical-room variant,
offline isolation, UI/accessibility, and live release evidence.

## Confidence

`ramza-score --rubric confidence`: 93.75% → AUTO_PROCEED. The Explore winner is
`unified-core-owned-capability` at 89.5/100. Independent critique required one gated
refinement and passed focused recheck. This document remains
`awaiting-implementation-greenlight` despite AUTO_PROCEED because the user explicitly
asked to stop after specification.

## Rejected Alternatives

- **GUI-direct provider patches** — 67.0. Smallest visible change, but bypasses core
  authority, exact-route generations, durable outbox, cross-surface reconciliation,
  and offline guarantees.
- **Notification ledger as the primary Event model** — 73.0. Reuses RSVP state but
  makes event edit/attendee/conference truth depend on a derived triage projection.
  The ledger remains the action coordinator only.
- **Generic calendar collaboration workflow engine** — 72.5. Flexible and novel but
  expands beyond one provider and introduces abstraction before the real Google
  contracts are stable.
- **Attendee comment as proposed time** — rejected on correctness. It is not a native
  proposal object or a documented organizer proposal lifecycle.
- **Route writable ⇒ every edit allowed** — rejected because an invitee's primary
  calendar is writable even when the invitee cannot edit the organizer's meeting.
- **Ship the Gmail suggestion transport in this release** — deferred because its
  Sensitive OAuth consent, separate persistence, ambiguous POST semantics, and live
  evidence would expand the stable Calendar release. Backlog B1 retains it as the
  preferred future approach.
- **Treat Meet, physical room, and location as one field** — rejected because they
  have different identity, permissions, provider state, and failure semantics.
- **Separate Google calendar UI** — rejected because Jin's unified agenda and exact
  provenance already provide the correct surface.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| Invitation exists but guests receive no notice | P0 | Immutable guest-update policy; default `all`; cassette + live smoke |
| Guest edit erases response/provider fields | P0 | Core merge by identity; full-array serialization tests |
| Invitee accidentally cancels meeting for everyone | P0 | Separate RSVP and organizer cancel capabilities/copy/commands |
| Primary calendar write role over-authorizes editing | P0 | Organizer/shared-calendar/guest-permission semantic projection |
| Both RSVP surfaces diverge | P0 | One notification action reference, command, attempt ledger, mutation signal |
| Recurrence change targets wrong resource | P0 | Exact instance/master identity; mandatory scope; reject following |
| Stale edit overwrites organizer changes | P0 | edit token + If-Match; fetch/audit on 412; no force retry |
| Meet request duplicates | P0 | Fresh semantic request ID; reuse on transport retry; status polling |
| Historical mirror erases conference data | P0 | Per-route full sync before capability activation |
| Deferred suggestion is mistaken for current capability | P0 | No control, scope, outbox, or stable-release claim; Backlog B1 only |
| Physical directory scope is unavailable | P1 | Separate known-room-email path; admin-only capability explanation |
| Room acceptance is mistaken for guaranteed booking | P1 | Show provider Pending/Accepted/Declined truth |
| One account failure contaminates peers | P0 | Exact destination keys/generations and partial aggregate results |
| Browser evidence overclaims native behavior | P1 | Native owner checks for OAuth, links, mail and tactile behavior |
| Provider docs differ from live behavior | P0 | Disposable accounts; affected capability stays disabled and release is not claimed stable without required proof |

## Agent-Executable Plan

```yaml
plan_id: google-calendar-stable-release
tier: full
status: awaiting-implementation-greenlight
enforce: fail-fast
spec_only: true
implementation_authorized: false
decision_gates:
  - id: D2
    question: Does “meeting room” mean Google Meet or a physical Workspace room?
    assumed: google_meet
    conditional_story: S7
tracks_after_greenlight:
  - id: core-collaboration
    stories: [S0, S1, S2, S3]
  - id: rsvp-surfaces
    stories: [S4, S5]
    depends_on: [core-collaboration]
  - id: meet
    stories: [S6]
    depends_on: [core-collaboration]
  - id: physical-room-optional
    stories: [S7]
    depends_on: [core-collaboration, D2]
  - id: integration-and-release
    stories: [S8, S9, S10]
    depends_on: [rsvp-surfaces, meet]
verification:
  checker: identity-distinct
  acceptance: AC-GCSR-001..AC-GCSR-064
  live_smoke: separate_non_hermetic_attestation
```

## Evidence anchors

Repository anchors include `jin-core/src/model/event.rs`,
`jin-core/src/dto/event.rs`, `jin-core/src/google/account.rs`,
`jin-core/src/google/client.rs`, `jin-core/src/google/mapping.rs`,
`jin-core/src/google/multi_sync.rs`, `jin-core/src/ops/event_mutation.rs`,
`jin-core/src/notification_center.rs`, `jin-gui/src/lib/events/`,
`jin-gui/src/controllers/calendar_view_controller.ts`,
`jin-gui/src/controllers/notifications_controller.ts`,
`jin-gui/src/lib/notifications/`, `jin-gui/src/styles/calendar.css`, and
`jin-gui/src/styles/notifications.css`.

Provider sources were reviewed on 2026-09-15:

- Calendar create/events/auth/recurrence/sync/push/version resource documentation:
  `developers.google.com/workspace/calendar/api/...`
- End-user proposed-time constraints: `support.google.com/calendar/answer/37135`
- Workspace room resources and Directory resources API:
  `developers.google.com/workspace/calendar/api/concepts/domain` and
  `developers.google.com/workspace/admin/directory/reference/rest/v1/resources.calendars/list`
- Gmail send, MIME, scopes, errors, and Message schema:
  `developers.google.com/workspace/gmail/api/...`

These are researched contracts, not live-account proof. S10 owns that boundary.

## Stop condition

This packet is a proposal only. After RAMZA verification and IDG synthesis, stop.
No source code, dependency, OAuth configuration, external provider data, PR, or
implementation lifecycle transition is authorized until the user gives the separate
implementation greenlight.
