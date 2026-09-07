---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-02T23:02:42Z
thread_id: 01a0645f-c5bd-7669-8785-b68f1b6c9071
target_repos:
  - Rynaro/jin
stories_count: 8
validation_gates_count: 67
evidence_anchors_count: 16
confidence: 0.9425
decisions_resolved_at: 2026-09-02T23:24:00Z
---

# Google Calendar invitations and Jin Notification Center

Change ID: `google-calendar-invites-notification-center`

## Scope

Intent class: `CHANGE`.

This change gives a connected Google Calendar attendee a durable place inside Jin to review invitations and respond with the product labels **Allow**, **Maybe**, or **Refuse**. Those labels map only to Google attendee `responseStatus` values `accepted`, `tentative`, and `declined`. The same Notification Center also receives task-reminder occurrences so a failed, denied, or ignored native notification does not erase the reminder.

In scope:

- An additive, device-local `.jin/notification-center.sqlite` ledger and rebuildable projection.
- Idempotent producers for actionable Google invitations and claimed task-reminder occurrences.
- A dedicated `EventMutationService` RSVP operation with exact account/calendar/event/recurrence routing.
- Durable in-app curation: unread/read, defer, dismiss, action-pending, acted, failed, and obsolete behavior.
- A Notifications route, sidebar bell and unread badge, desktop list/detail workspace, and mobile single-column flow.
- Task reminder actions to open the task, mark it done, mark read/unread, defer, or dismiss.
- Native notification submission as a best-effort signal after durable center insertion.
- Hermetic core, bridge, scheduler, TypeScript, and deterministic browser verification.

Out of scope:

- Creating, forwarding, or editing invitations beyond the self-attendee response.
- Unlocking general edits for externally owned or otherwise non-editable events.
- Native notification action buttons, native deep links, or platform callback routing.
- A cloud-synchronized notification inbox or cross-device read/dismiss state.
- Email invitations, non-Google providers, task-reminder authoring changes, or a generalized activity feed.
- `This and following` recurrence mutation.
- Automatic acceptance policies, assistant-authored responses, or background choice changes.

Deferred:

- **Suggest a new time.** Google Calendar REST event resources expose attendee response status but no stable structured proposed-time fields. Jin shall not encode a proposal into free-form comments or perform a multi-event workaround. A future provider-specific design must cover organizer semantics, negotiation state, recurrence, cancellation, and interoperability.
- Native actions and click-to-open are deferred until every platform transport carries a stable item identity and response callbacks without weakening the durable in-app source of truth.

Assumptions and risk if wrong:

- Canonical Google event files retain organizer, attendees, `self`, response status, route, recurrence identity, and etag. If any field is absent, reconciliation must fail closed and the RSVP service must return a typed eligibility error.
- The existing recoverable event mutation/outbox boundary remains the only accepted path for provider writes. If it cannot represent a dedicated RSVP operation, the implementation must extend that boundary rather than issue a side-channel HTTP PATCH.
- Task reminder definitions remain canonical in task frontmatter while `.jin/reminder-state.sqlite` remains the delivery-occurrence ledger. Conflating either database with Notification Center would make recovery ownership ambiguous.
- Native notification submission means only that the OS accepted the request, not that the user saw or acted on it.

Complexity (`ramza-score --rubric complexity`): `11/12` → `human_loop`. Right-size score: `8` → `full`. TRANCE G3 is authorized by cross-module complexity, external-write integrity risk, and the user's explicit TRANCE request.

Human-loop decision: on 2026-09-02 the user explicitly authorized full TRANCE execution after the `11/12` complexity gate. The specification author is `ramza`; the independent specification critic is `ramza-critic`; implementation maker/checker identities remain `vivi` and `vigil` respectively. Critique does not substitute for implementation verification.

## Approach

### Selected architecture

[DECISION] Add one versioned device-local notification-center projection. Canonical task and event files remain authoritative; the center stores durable actionable snapshots and action state, while native notifications are only a best-effort delivery channel.

[DECISION] Use one stable current item per `(source_kind, source_key)`, not one visible row per etag. `source_revision` changes refresh the snapshot in place. This avoids duplicate invitations when an organizer edits title or location while preserving a separate immutable action-attempt history.

[DECISION] Implement RSVP as a dedicated `EventMutationService::respond_to_invitation` operation and a dedicated outbox operation kind. It shall not call the generic external-event edit path and shall not advertise broader edit capability.

[DECISION] The provider PATCH body is always exactly the unique self attendee's email and requested `responseStatus`, plus top-level `attendeesOmitted: true`. The request-only truncation flag never changes canonical `attendees_omitted`.

[DECISION] Use `sendUpdates=none` for the MVP and `If-Match` with the stored etag. Attendee `responseStatus` propagation is resource synchronization; the user did not authorize broad guest-update email. A provider conformance test must prove the organizer copy observes the response without guest mail before release. If that assumption fails, implementation stops for a spec amendment rather than silently switching to `all`. HTTP 412 gets one fetch-and-conditional-retry cycle; no unconditional overwrite is permitted.

[DECISION] Reconcile invitations from canonical event files through a dedicated projection. The ordinary indexed event-list DTO is not a source because it intentionally omits organizer and attendees.

### Source references

- Google attendee propagation and response values: <https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events>
- Google Events update semantics: <https://developers.google.com/workspace/calendar/api/v3/reference/events/update>
- Google Events patch semantics, array replacement, and `sendUpdates`: <https://developers.google.com/workspace/calendar/api/v3/reference/events/patch>
- Existing event model: `jin-core/src/model/event.rs`.
- Routed mutation and limited-attendee guards: `jin-core/src/ops/event_mutation.rs`.
- Google mapping and sparse wire projection: `jin-core/src/google/mapping.rs`.
- Multi-account sync/outbox drain: `jin-core/src/google/multi_sync.rs`.
- Reminder occurrence ledger: `jin-core/src/reminders.rs`.
- GUI scheduler and native transport: `jin-gui/src-tauri/src/scheduler.rs`, `jin-gui/src-tauri/src/notifications.rs`.
- Frontend routes, bridge, DTOs, and event detail: `jin-gui/src/lib/router.ts`, `jin-gui/src/invoke.ts`, `jin-gui/src/types/dto.ts`, `jin-gui/src/lib/events/render.ts`.

### Durable data model

Add `Config::notification_center_path()` returning `.jin/notification-center.sqlite`. Opening the ledger applies additive, idempotent schema migrations in one transaction. Failure leaves the prior schema usable or fails opening without rewriting canonical files.

`notification_items` is the current projection:

| Field | Contract |
|---|---|
| `id TEXT PRIMARY KEY` | Deterministic opaque ID derived from source kind and source key. |
| `source_kind TEXT` | Closed MVP set: `calendar_invitation`, `task_reminder`. |
| `source_key TEXT` | Exact stable identity; never a display alias. |
| `source_revision TEXT` | Latest provider etag or reminder occurrence generation. |
| `kind_payload_json TEXT` | Versioned typed snapshot; never the full attendee list or secrets. |
| `status TEXT` | `active`, `action_pending`, `acted`, `superseded`, `dismissed`, or `obsolete`. |
| `read_at TEXT NULL` | Independent read state. Clearing it marks unread. |
| `visible_after TEXT NULL` | Hidden from normal lists until due; does not alter the source. |
| `requested_action TEXT NULL` | Last user choice, retained across a visible failure. |
| `action_error_code/message TEXT NULL` | Sanitized retryable or terminal action outcome. |
| `native_state TEXT` | `not_requested`, `pending`, `submitted`, `failed`, or `suppressed`. |
| `native_attempt_count INTEGER` | Bounded delivery-attempt count. |
| `native_next_attempt_at TEXT NULL` | Retry scheduling independent of item visibility. |
| `version INTEGER` | Optimistic concurrency token for center mutations. |
| timestamps | `created_at`, `updated_at`, `resolved_at`, `last_seen_at`. |

Constraints:

- Unique `(source_kind, source_key)`.
- Status, kind, and native state are checked closed values.
- Every mutation increments `version` and uses `expected_version`; stale clients receive `stale_item` plus a refreshed DTO.
- `kind_payload_json` has an explicit `schema_version` and is decoded into a kind-specific struct before use.

`notification_action_attempts` is append-oriented and immutable apart from its delivery result:

| Field | Contract |
|---|---|
| `operation_id TEXT PRIMARY KEY` | Caller-supplied idempotency key. |
| `item_id TEXT` | Foreign key to the center item. |
| `requested_action TEXT` | `allow`, `maybe`, `refuse`, or `complete_task`. |
| `recurrence_scope TEXT NULL` | `this_occurrence` or `entire_series`. |
| `state TEXT` | `preparing`, `queued`, `sending`, `succeeded`, `failed_retryable`, `failed_terminal`, `superseded`, or `obsolete`. |
| provider fields | Exact route, base etag, one-retry counter, sanitized error. |
| timestamps | Created, updated, completed. |

Reusing an `operation_id` with byte-identical intent returns the recorded outcome. Reusing it with different intent returns `idempotency_conflict` without mutation.

`notification_source_tombstones` contains `(source_kind, source_key, terminal_status, last_source_revision, expires_at)` after terminal item pruning. A tombstone prevents a historical scan from recreating a dismissed/resolved source. Tombstones expire after 90 days or may be replaced by an explicitly detected new response cycle.

Within `notification-center.sqlite`, action attempts reference items with `FOREIGN KEY ... ON DELETE RESTRICT`. Retention deletes expired child attempts and their item in one transaction only when no nonterminal operation exists, then writes the source tombstone. There is intentionally no cross-database foreign key to provider outbox state; operation ID is the durable join and startup reconciliation repairs either side. Provider outbox/audit retention is owned by sync state and never cascades from Notification Center deletion.

Schema metadata records `schema_version`, `created_by_version`, and the last completed migration. Item payloads carry their own integer `schema_version`. Unknown future enum/payload versions are preserved and returned as unsupported items rather than destructively rewritten.

### Source identities and snapshots

Calendar invitation source key:

`google/<account_id>/<calendar_id>/<google_event_id>/<recurrence_key>`

Its payload contains only the account ID and display alias, calendar ID/name, canonical Jin event ID, Google event ID, recurrence identity, title, organizer display/email, start/end/all-day/timezone, location, self email, self response status, etag, and capability/error projection. The item does not persist other attendees.

Task reminder source key is the existing durable `occurrence_key`. Its payload contains task ID, title, scheduled time, list/project display context when available, and the task edit token needed only as a snapshot hint; completion must refetch and validate the current task revision.

### Normative item lifecycle and reconciliation

1. A producer computes the exact source key and current revision.
2. An unseen actionable source inserts one `active`, unread item.
3. The same revision is a no-op except `last_seen_at`; a newer revision refreshes display and eligibility in place without clearing read, defer, or dismiss state.
4. A dismissed item remains dismissed while the same source remains continuously actionable. Organizer edits alone do not resurrect it.
5. A previously answered/obsolete invitation that later transitions back to `needsAction` at a newer etag may reopen as active; this is a new response cycle, not an organizer text edit.
6. An externally answered invitation with no competing local attempt resolves to `acted` with `resolution_origin=external`. A response that conflicts with a pending local choice resolves the item to `superseded`. A cancelled, deleted, missing, ended, or no-longer-eligible source becomes `obsolete`.
7. A completed/deleted task makes its reminder item `obsolete`; completing through the center makes it `acted` only after the canonical task mutation succeeds.
8. `dismiss` is center-local and never means decline, task completion, or source deletion.
9. `defer` sets `visible_after`; the item becomes visible and unread when due. Fixed UI presets are one hour and tomorrow morning, plus an accessible date-time input using Jin's existing date/time controls.
10. Terminal items remain queryable for 30 days, then are pruned. Action attempts remain for 90 days. Pruning never touches canonical events, tasks, reminder state, or provider sync state.

Normative item transitions:

| From | Trigger/guard | To | Required side effect |
|---|---|---|---|
| `active` | read/unread | `active` | CAS `read_at`; increment item version. |
| `active` | valid future defer | `active` | Set `visible_after`; increment version. |
| `active` | dismiss | `dismissed` | No source or provider mutation. |
| `active` | RSVP attempt prepared | `action_pending` | Persist operation ID and requested choice. |
| `active` | source no longer valid | `obsolete` | Record source reason. |
| `action_pending` | provider confirms desired response | `acted` | Attempt `succeeded`; clear action error. |
| `action_pending` | different external response wins | `superseded` | Preserve requested and observed responses. |
| `action_pending` | source cancelled/deleted/ended | `obsolete` | Mark attempt `obsolete`; cancel/quarantine outbox. |
| `action_pending` | retryable/terminal send failure while still eligible | `active` | Preserve requested choice and error; issue a new operation ID on Retry. |
| `action_pending` | account disconnected or generation invalid | `active` | Disable RSVP capability; preserve requested choice. |
| `dismissed` | source disappears/resolves | `obsolete` or `acted` | Never mutate provider because of dismissal. |
| terminal | explicit new `needsAction` response cycle | `active` | Clear terminal UI state, retain prior attempt history, mark unread. |

No other transition is legal. Terminal rows cannot be acted upon. The explicit response-cycle test requires a prior non-`needsAction` canonical revision followed by a newer `needsAction` revision; a title/location/etag-only change cannot reopen a row.

Normative action-attempt transitions:

| From | Trigger | To |
|---|---|---|
| absent | center CAS commits | `preparing` |
| `preparing` | exact outbox row is durable | `queued` |
| `queued` | provider worker claims row | `sending` |
| `sending` | desired remote response confirmed | `succeeded` |
| `sending` | still eligible after bounded failure | `failed_retryable` |
| `sending` | nonretryable provider rejection | `failed_terminal` |
| any nonterminal | different external response wins | `superseded` |
| any nonterminal | event cancelled/deleted/ended | `obsolete` |

Normative native-delivery transitions:

| From | Trigger | To |
|---|---|---|
| `not_requested` | durable item requests native signal | `pending` |
| `pending` | OS accepts submission | `submitted` |
| `pending` | transient failure below retry ceiling | `failed` |
| `failed` | backoff expires below retry ceiling | `pending` |
| `pending` or `failed` | permission denied/unavailable or ceiling reached | `suppressed` |
| `suppressed` | explicit permission/settings change | `pending` |

Native state never changes item status or source delivery truth.

First-open bootstrap suppresses historical floods:

- Import only invitation sources currently `needsAction` whose event has not ended.
- Import only reminder occurrences that are currently pending/claimed and not expired.
- Do not reconstruct already delivered historical reminders.

Reconciliation runs at startup, after each account sync, after RSVP outbox completion/failure, after task mutations, and on the existing scheduler wake. Reconciliation is idempotent and source-scoped; one corrupt source records a bounded error without blocking other accounts or reminders.

### Invitation eligibility

The backend owns eligibility. The frontend never infers it from organizer text, attendees, account role, or DTO omissions.

An invitation is actionable only when all conditions hold:

- Source is Google and has an exact persisted account/calendar/event/recurrence route.
- Event is not cancelled and has not ended.
- The account copy is not organizer-owned.
- Exactly one attendee has `self=true`.
- That attendee has a non-empty email and `response_status=needsAction` for discovery.
- The account route is connected enough to queue or send the response; offline network status may still permit durable queueing.
- The requested recurrence scope is valid for the canonical recurrence identity.

The RSVP operation rechecks every condition against the current canonical event. Missing self, multiple self attendees, organizer-owned events, route mismatch, cancellation, stale item versions, unsupported recurrence scopes, or a changed response return typed errors without canonical, center-action, or outbox mutation.

### Recoverable RSVP saga and pending overlay

Core request:

```text
RespondInvitationRequest {
  item_id,
  expected_item_version,
  operation_id,
  response: Allow | Maybe | Refuse,
  recurrence_scope: None | ThisOccurrence | EntireSeries
}
```

Product-to-provider mapping is closed:

| Product label | Domain action | Google `responseStatus` |
|---|---|---|
| Allow | `allow` | `accepted` |
| Maybe | `maybe` | `tentative` |
| Refuse | `refuse` | `declined` |

The RSVP flow is an at-least-once recoverable saga joined everywhere by `operation_id`. No step optimistically changes canonical `response_status`.

1. **Prepare center intent.** In one Notification Center transaction, compare `expected_item_version`, persist an attempt in `preparing`, and move the item to `action_pending`. The attempt stores requested choice, recurrence scope, source revision, exact immutable route, `auth_generation`, `route_generation`, and self email observed during validation.
2. **Enqueue provider intent.** `EventMutationService::respond_to_invitation` reloads the canonical event, revalidates eligibility and generations, and idempotently writes one recoverable `respond_invitation` outbox operation under the existing operation journal. It does not change canonical attendees. The outbox operation ID is the same center attempt ID.
3. **Join center to outbox.** After enqueue commit, mark the attempt `queued`. If the process crashes before this mirror update, startup reconciliation queries outbox by operation ID and repairs the center state.
4. **Dispatch provider request.** The worker revalidates account subject, `auth_generation`, calendar route, `route_generation`, source identity, and current etag before every request, then claims the row and marks the mirrored attempt `sending`.
5. **Confirm canonical state.** Only a provider success response or a 412 refetch already showing the desired response may update canonical attendee response through the normal provider-import/recoverable write path. That commit and outbox success are recoverable under the existing sync operation boundary.
6. **Converge center state.** Reconciliation joins operation ID, provider outcome, and canonical response to mark acted, superseded, obsolete, or active-with-error. A crash after provider/canonical success but before center update is repaired without a second PATCH.

While a saga is nonterminal, DTO projection overlays `requested_action` and `Pending sync` on the provider-confirmed canonical event. Invitation reconciliation recognizes the operation overlay and must not create a duplicate or misclassify canonical `needsAction` as an unhandled invitation. Removing a failed overlay exposes the still-provider-confirmed canonical response.

Crash-boundary recovery is normative:

| Crash point | Recovery behavior |
|---|---|
| Before center prepare commit | No operation exists; user may retry normally. |
| After center prepare, before outbox | Reconciler re-runs enqueue with the same operation ID or returns item active with validation error. |
| After outbox, before center queued mirror | Reconciler discovers the outbox row and marks the attempt queued. |
| After provider accepts, before canonical commit | Outbox recovery refetches; desired remote state becomes success without duplicate PATCH. |
| After canonical/outbox success, before center acted | Center reconciliation marks acted from operation ID and canonical response. |
| During 412 fetch/retry | Stored retry counter prevents more than one conditional retry across restarts. |

`EventMutationService::respond_to_invitation` shall:

1. Resolve the item to the exact immutable provider route; never use alias, email, primary-calendar, or default-account fallback.
2. Reload the canonical event and find exactly one `self=true` attendee.
3. Reject organizer-owned, missing-self, ambiguous-self, unsupported-source, cancelled, answered/stale, and invalid recurrence requests.
4. Resolve `ThisOccurrence` to the exact instance identity and `EntireSeries` to the master. Reject `ThisAndFollowing` before any write.
5. Leave canonical attendees and canonical `attendees_omitted` unchanged while preparing or queueing.
6. Commit one recoverable outbox intent under the existing operation journal and operation ID.
7. Store only the narrow response intent in the outbox; generic sparse-diff generation must not serialize the canonical attendee array.

The Google wire request is exactly:

```json
{
  "attendees": [
    { "email": "<unique-self-email>", "responseStatus": "<accepted|tentative|declined>" }
  ],
  "attendeesOmitted": true
}
```

No display name, comment, organizer, other attendee, local metadata, or unrelated event field is permitted. The request uses `PATCH`, `If-Match: <base-etag>`, and query `sendUpdates=none`. Provider conformance evidence must demonstrate organizer-copy response propagation without broad guest mail; otherwise this decision requires a reviewed spec amendment.

This dedicated authorization does not change generic event capabilities. An otherwise read-only externally owned event may expose only `can_respond_to_invitation=true`; `can_edit`, `can_delete`, attendee editing, and organizer editing remain unchanged.

### Authorization, provider completion, etag, and offline behavior

- Authorization is bound to immutable `(provider, account_id, calendar_id, google_event_id, recurrence_identity, self_email, provider_subject, auth_generation, route_generation)`. Alias, displayed account email, and `primary` are never authority.
- Token refresh within the same validated provider subject does not change `auth_generation`. Disconnect, subject replacement, reauthentication, or authority-changing credential rotation increments it. Calendar disable/reenable, removal, or access-role change increments `route_generation`.
- A queued operation whose auth or route generation no longer matches is quarantined before network access. Its item returns to active with RSVP controls disabled and requested choice preserved. Reconnect never silently rebinds or replays it; the user explicitly retries under a new operation ID after capabilities refresh.
- After durable outbox acceptance, the item remains `action_pending`, retains the visible requested choice, and disables competing actions.
- If offline but authenticated and route-valid, the outbox remains queued and the center shows `Pending sync`. Restart resumes by operation ID.
- If disconnected, reauthentication-required, permission-invalid, or exact route unavailable, the command fails before local response mutation and leaves the item active.
- On provider success, map the returned/current provider representation through the normal canonical sync path before marking the action attempt succeeded and the item acted.
- On network or retryable provider failure, keep the outbox queued under existing bounded retry policy and keep the item `action_pending` with a non-destructive status.
- On terminal provider failure, refresh canonical state when safe, mark the attempt failed, and return the item to `active`, unread, with the user's requested choice and sanitized error preserved.

HTTP 412 policy:

1. Fetch the current remote event on the same account/calendar/event route.
2. If the unique self attendee already has the desired status, treat the operation as idempotent success.
3. If the event is still eligible and the self response can still be changed, refresh canonical content/etag and retry the same narrow PATCH exactly once with the new `If-Match`.
4. If a different external response is present, mark the attempt and item `superseded`. If the event disappeared, was cancelled, or ended, mark it `obsolete`. If a second 412 occurs while the invitation remains eligible, return the item to `active` with a retryable error and preserve the requested choice. If the account disconnected or generations changed, return it to `active` with controls disabled.
5. Never retry without `If-Match`; never silently discard the operation ID or requested response.

### Exact recurrence identity

- `Single` identity is `(account_id, calendar_id, google_event_id)` with no `recurring_event_id` or `original_start`.
- `SeriesMaster` identity is `(account_id, calendar_id, master_google_event_id, recurrence_key=MASTER)`.
- `Instance` identity is `(account_id, calendar_id, instance_google_event_id, recurring_event_id=master_google_event_id, original_start)`; `original_start` is normalized as RFC3339 instant plus tzid for timed events or ISO date for all-day events.
- Expanded local instances without their own Google event ID, etag, and route mapping are presentation-only and never actionable sources.
- Generated instances inherited from one pending master do not each create an item. Reconciliation emits one master item unless an exact provider instance has a distinct response state or detached-exception identity.
- `ThisOccurrence` is offered only for an exact `Instance` and targets its `instance_google_event_id` with the same original-start identity.
- `EntireSeries` is offered only when the exact same account/calendar mapping resolves a `SeriesMaster`; it targets `master_google_event_id`.
- A `SeriesMaster` item offers Entire series only. A `Single` item offers no scope chooser.
- If either exact mapping is missing or ambiguous, the corresponding capability is false and core rejects that scope without fallback.
- `ThisAndFollowing` is not rendered and is rejected by core if supplied by a stale or hostile caller.

### Task-reminder producer

The scheduler flow becomes:

1. Claim a due reminder occurrence using the existing lease/generation protocol.
2. Upsert the Notification Center item by `occurrence_key`.
3. Mark the reminder occurrence delivered only after durable center insertion succeeds.
4. Attempt native notification independently.
5. Record native submission outcome without changing item existence or reminder delivery truth.

A crash after insertion but before marking delivered causes an idempotent upsert on restart. A crash after marking delivered but before native submission leaves the durable center item available. Permission denial or platform submission failure never removes the item.

### Native notifications

MVP keeps the current title/body transport. Invite notifications state that Jin has an invitation to review; task notifications preserve their current title/body semantics. No provider mutation is triggered from an OS notification. Submission retries are bounded and recorded per item; a denied permission sets `suppressed` until settings change rather than polling aggressively.

### Command guards and DTO contracts

New Tauri commands:

| Command | Input | Result |
|---|---|---|
| `list_notification_items` | filter, include deferred/terminal, cursor, limit | `NotificationCenterPageDto` |
| `get_notification_item` | item ID | `NotificationItemDto` |
| `notification_center_summary` | none | unread/visible/pending/error counts |
| `set_notification_read` | item ID, read boolean, expected version | updated item |
| `defer_notification_item` | item ID, ISO instant, expected version | updated item |
| `dismiss_notification_item` | item ID, expected version | updated item |
| `respond_calendar_invitation` | closed request above | updated item plus queued/synced state |
| `complete_notification_task` | item ID, expected item version, operation ID | updated item |

List order is actionable errors first, then visible unread, then visible read, each newest-relevant first. Cursor pagination uses `(sort_class, relevant_at, id)` and a default/max limit of 50/100. Deferred and terminal items are excluded unless requested.

`NotificationItemDto` is a tagged union with common fields `id`, `kind`, `status`, `version`, `read_at`, `visible_after`, `created_at`, `updated_at`, `requested_action`, `action_state`, `action_error`, and `capabilities`. Invite payloads contain organizer/account/time/location and stable event navigation identity. Task payloads contain task/list/scheduled identity. The Rust/TypeScript representation and serialized fixtures must match.

Backend errors serialize as `{ code, message, retryable, item }`. Closed MVP codes are `not_found`, `stale_item`, `invalid_cursor`, `ineligible`, `organizer_owned`, `self_attendee_missing`, `self_attendee_ambiguous`, `already_answered`, `route_unavailable`, `reauth_required`, `credential_generation_changed`, `route_generation_changed`, `unsupported_recurrence_scope`, `idempotency_conflict`, and `provider_failed`. Offline queue acceptance is a successful command result, not an error. Messages are safe for display and contain no token, raw provider body, or full attendee list.

Normative command guards:

| Command | Allowed item states | Additional guards |
|---|---|---|
| list/get/summary | any requested visibility | Cursor schema version supported; limit 1-100. |
| set read/unread | any retained item | Expected item version matches. |
| defer | `active` | Future instant within 30 days; not action-pending. |
| dismiss | `active` | Expected version; never maps to provider/task action. |
| respond invitation | `active` invitation | Unread is not required; exact backend eligibility, route/generations, recurrence capability, new operation ID. |
| complete task | `active` task reminder | Current canonical task exists/open; current edit token fetched by backend. |
| Retry RSVP | `active` invitation with retryable prior attempt | New operation ID; revalidate all authority and source state. |

All mutation commands require `expected_item_version`. Read/list DTO `version` is monotonic per item, not global. Cursor versioning is independent; an unknown cursor version returns `invalid_cursor`. Pagination uses a snapshot watermark so inserts during traversal appear on a later refresh rather than duplicating or skipping rows in the current traversal.

### UI contract

- Add `/notifications` and a sidebar bell labeled `Notifications`. The badge is backend-projected visible unread count and is absent at zero.
- Desktop uses a list/detail workspace. Mobile uses one column: list first, then selected detail with a Back control that restores list scroll/focus.
- Filters: All, Invitations, Reminders, Unread. Deferred and History are explicit secondary views.
- Invitation rows/details show organizer, account alias, date/time/timezone, location when present, response state, and text buttons **Allow**, **Maybe**, **Refuse**.
- `View event` uses existing event-detail navigation with stable canonical identity; Notification Center does not duplicate the event detail implementation.
- Task rows/details support `Open task`, `Mark done`, read/unread, defer, and dismiss.
- During RSVP, all three response buttons and recurrence controls for that item are disabled, the item has `aria-busy=true`, and a polite live region announces pending, queued, success, or error.
- The pending choice remains textually visible. Errors preserve context and provide Retry when retryable.
- Loading, empty, offline/pending, stale-refresh, partial-error, and backend-unavailable states are explicit. One source failure does not blank the list.
- Action labels are text, not icon-only or color-only. Focus order follows visual order; dialogs trap focus and restore it to the invoking button; every badge count is included in an accessible label.

### Security and privacy

- Never store OAuth tokens, provider response bodies, or the full attendee list in Notification Center.
- Never log native notification content at info level or expose attendee emails in generic error text.
- Route and operation IDs may be logged; user-visible event titles and self email are redacted from provider-error telemetry.
- Center database deletion is recoverable by reconciliation for active invitations and future reminder occurrences, but read/dismiss/history state is intentionally device-local and may be lost.

## Stories

### Story S0: Freeze contracts and migrations

As an implementer, I want closed domain, storage, error, and bridge contracts so that parallel tracks converge without semantic drift.

Timebox: 3d. Risk tag: P0. Executor hint: deep tier; output contract is schema/types, migration tests, transition tables, operation identity, and DTO fixtures matching this spec.

### Story S1: Build the durable center ledger

As a user, I want notifications to survive restarts and native delivery failures so that I can curate them later.

Timebox: 6d. Risk tag: P0. Depends on S0. Executor hint: standard tier with explicit lifecycle, tombstone, FK, retention, pagination, and corruption tests.

### Story S2: Add the narrow invitation response mutation

As a Google Calendar attendee, I want to Allow, Maybe, or Refuse without granting Jin broader event-edit power.

Timebox: 8d. Risk tag: P0. Depends on S1. Executor hint: deep tier; output contract includes saga recovery, pending overlay, exact payload golden tests, route/generation ownership, recurrence, idempotency, and 412 tests.

### Story S3: Reconcile actionable invitations

As a multi-account user, I want every pending invitation represented once under the correct account and recurrence identity.

Timebox: 4d. Risk tag: P0. Depends on S2. Executor hint: standard tier; output contract includes canonical-scan, operation-overlay, partial-scan, and source-lifecycle tests.

### Story S4: Route task reminders through the center

As a task user, I want every due reminder durably captured before native delivery so that permission failures do not lose it.

Timebox: 4d. Risk tag: P0. Depends on S3. Executor hint: standard tier; output contract includes crash-boundary, duplicate, permission, and fake-transport tests.

### Story S5: Expose typed Tauri commands and DTOs

As a frontend implementer, I want a narrow typed API so that UI state never reconstructs backend eligibility.

Timebox: 4d. Risk tag: P1. Depends on S4. Executor hint: standard tier; output contract includes command guards, cursor/version fixtures, registration, serialization parity, and bridge error tests.

### Story S6: Build the Notification Center experience

As a Jin user, I want an accessible inbox across desktop and mobile so that I can review and act at my own pace.

Timebox: 6d. Risk tag: P1. Depends on frozen S5 fixtures. Executor hint: standard tier; output contract includes route, render/transform, controller, responsive, keyboard, focus, non-color, and live-region tests.

### Story S7: Verify integration and failure recovery

As a release owner, I want deterministic evidence across storage, sync, bridge, scheduler, and UI so that no response or reminder is silently lost.

Timebox: 6d. Risk tag: P0. Depends on S0-S6. Executor hint: deep checker tier; output contract is the EARS matrix, all crash/generation/redaction/partial-scan evidence, and explicit native-owner sign-off status.

### Phased implementation tracks

| Stage | Single-writer work | Barrier |
|---|---|---|
| A | S0 contracts and migration skeleton | VIGIL reviews schema/identity before behavior work. |
| B | S1 ledger, transitions, tombstones, pagination | Core ledger suite green before any producer writes it. |
| C | S2 RSVP saga, outbox kind, provider mapper/client | Exact payload, crash, generation, recurrence, and 412 suites green. |
| D | S3 invitation reconciliation and overlay | Multi-account and partial-scan suites green. |
| E | S4 task-reminder/native producer | Scheduler crash and best-effort delivery suites green. |
| F | S5 Tauri commands and DTO fixtures | Bridge and Rust/TypeScript parity green. |
| G | S6 GUI | Controller/unit/accessibility green against frozen fixtures. |
| H | S7 verifier cascade | Core → Tauri → TypeScript → Playwright; VIGIL signs the implementation. |

Vivi is the only implementation writer for stages A-G in the primary change branch. TRANCE parallelism is limited to read-only analysis, isolated test-fixture preparation that does not touch shared production files, and the independent verifier cascade. `event_mutation.rs`, outbox schema/migrations, command registration, `invoke.ts`, DTOs, router, and `index.html` each have one designated writer at a time; stages do not overlap across barriers.

## Acceptance Criteria

The frozen, lintable EARS contract is [criteria.md](./criteria.md). Its 67 criteria are mirrored into `change.json.acceptance_checks`; that file, not prose examples, is the verification checklist.

## Test strategy

| Layer | Required evidence |
|---|---|
| SQLite/core | Migration idempotence, corruption/fail-safe rebuild, status transitions, optimistic versions, deduplication, tombstones/FKs, reopen/obsolete rules, retention, stable pagination. |
| RSVP unit | Unique-self validation, organizer rejection, no optimistic canonical response, exact JSON golden body, canonical flag preservation, closed mapping, exact recurrence identity. |
| Sync integration | Multi-account route isolation, operation-ID saga crash points, credential/route generation rotation, duplicate replay, offline queue, partial scan, success, terminal failure, all 412 outcomes. |
| Reminder scheduler | Insertion-before-delivered, every crash boundary, duplicate claims, native denial/failure, bounded native retries. |
| Tauri bridge | Command registration/guards, typed errors, stale versions, cursor watermark pagination, summary counts, task/event navigation identities. |
| TypeScript | Rust fixture parity, pure transforms/renders, pending/error/superseded/disabled state, redaction, accessibility attributes, focus restoration. |
| Browser | Desktop list/detail, mobile list/detail/back, keyboard-only filters/actions/dialogs, non-color cues, badge/live-region behavior, invite/task actions, partial failure. |
| Native | Fake transport is automated; macOS/Windows/Linux appearance and tap behavior are owner-sign-off only and cannot prove response actions. |

Recommended commands after implementation:

```text
cargo test -p jin-core notification_center
cargo test -p jin-core invitation
cargo test -p jin-core google_multi_account_regressions
cargo test --manifest-path jin-gui/src-tauri/Cargo.toml
npm --prefix jin-gui test
```

Use the repository's deterministic Playwright MCP workflow for browser evidence. Native Tauri behavior must be labeled separately from headless browser evidence.

## Declared file scope

Expected production scope:

- `jin-core/src/config.rs`
- `jin-core/src/lib.rs`
- `jin-core/src/notification_center.rs` (new)
- `jin-core/src/reminders.rs`
- `jin-core/src/ops/event_mutation.rs`
- `jin-core/src/google/client.rs`
- `jin-core/src/google/mapping.rs`
- `jin-core/src/google/multi_sync.rs`
- `jin-core/src/sync/state.rs` and its additive migrations if the RSVP outbox kind requires them
- `jin-core/src/ops/recoverable_operations.rs` if the existing operation journal needs the RSVP saga stage
- `jin-gui/src-tauri/src/state.rs`
- `jin-gui/src-tauri/src/scheduler.rs`
- `jin-gui/src-tauri/src/notifications.rs`
- `jin-gui/src-tauri/src/commands/mod.rs`
- `jin-gui/src-tauri/src/commands/notification_center.rs` (new)
- `jin-gui/src-tauri/src/lib.rs`
- `jin-gui/src/index.html`
- `jin-gui/src/main.ts`
- `jin-gui/src/lib/router.ts`
- `jin-gui/src/invoke.ts`
- `jin-gui/src/types/dto.ts`
- `jin-gui/src/controllers/notifications_controller.ts` (new)
- `jin-gui/src/lib/notifications/**` (new)
- Notification Center stylesheet entry under the existing GUI style structure

Expected tests/fixtures:

- `jin-core/tests/notification_center.rs` (new)
- `jin-core/tests/google_multi_account_regressions.rs`
- `jin-gui/src-tauri/tests/bridge.rs`
- `jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs`
- `jin-gui/src-tauri/tests/notification_center.rs` (new)
- `jin-gui/src/__tests__/dto_shapes.test.ts`
- `jin-gui/src/__tests__/invoke.test.ts`
- `jin-gui/src/__tests__/router*.test.ts`
- `jin-gui/src/__tests__/notifications*.test.ts` (new)

Any production file outside this list requires a recorded RAMZA scope amendment before merge. Test filenames may adapt to the repository's existing test colocation convention without broadening behavior.

## Confidence

`ramza-score --rubric confidence`: `94.25%` → `AUTO_PROCEED`.

Dimensions: pattern match `92`, requirement clarity `96`, decomposition stability `94`, constraint compliance `95`. Full-tier critic `ramza-critic` is recorded separately from implementation checker `vigil`; refine cycle 1 passed at `4.8/5`.

## Rejected Alternatives

- **Derive the center on every UI read from canonical files and reminder state** — explore score `72` (`solid`). It is simpler and cheap to rebuild, but cannot durably preserve read/dismiss/defer/action errors or separate in-app truth from native delivery.
- **Extend `.jin/reminder-state.sqlite` to store invitations** — explore score `72` (`solid`). It reuses leases but mixes task occurrence delivery ownership with provider invitation curation and complicates recovery and retention.
- **Maintain separate invite and reminder ledgers and merge in the GUI** — explore score `75` (`solid`). It isolates producers but duplicates lifecycle, pagination, badge, and optimistic concurrency behavior across stores.
- **Native-first action buttons** — rejected from MVP. Platform transports currently accept only title/body and response callbacks discard context; adding mutation authority there would multiply platform-specific failure and identity risks.
- **Generic attendee editing through the existing event edit operation** — rejected as unsafe. PATCH replaces specified arrays, generic serialization can replace the complete attendee list, and it would broaden external-event capabilities beyond self RSVP.
- **Proposed-time via attendee comment or event cloning** — rejected as semantically misleading and non-interoperable because the REST schema has no structured proposal contract.

TRANCE evaluation note: the winning durable-ledger architecture scored `89` (`elite`). The three alternatives scored `72`, `72`, and `75`. Independent ATLAS tracks supplied backend/storage, RSVP-safety, and frontend evidence. The user explicitly authorized the human-loop TRANCE decision. Independent checker `ramza-critic` returned REFINE; this revision applies its saga, overlay, authorization, transition, recurrence, testing, accessibility, and sequencing prescriptions. VIGIL remains the distinct implementation checker.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| Generic attendee serialization replaces the array | P0 | Dedicated operation and exact golden payload; never call generic diff builder. |
| User choice disappears on 412 or restart | P0 | Durable operation ID/requested action, one fetch/retry, visible failed/pending states. |
| RSVP unlocks general external edits | P0 | Separate capability and operation-specific authorization tests. |
| Cross-account response routes incorrectly | P0 | Source key and outbox identity include immutable account/calendar/event/recurrence; no fallbacks. |
| Recurring invites flood the center | P1 | Master deduplication and detached-exception rule. |
| Reminder marked delivered before durable center insert | P0 | Enforced ordering plus crash-injection test. |
| Native permission failure loses the reminder | P0 | Native transport is independent best effort after durable insertion. |
| Organizer edit resurrects dismissed invite | P1 | Preserve dismissal during continuous `needsAction`; reopen only after a response-cycle transition. |
| Device-local DB is deleted/corrupt | P1 | Fail opening safely; rebuild only currently actionable/future sources; document loss of local curation history. |
| UI acts on stale eligibility | P0 | Expected item version and backend canonical revalidation. |
| Sensitive invite data leaks to logs/native surfaces | P1 | Minimal snapshot, redacted errors, no full attendees/provider bodies. |
| Full-tier plan self-approves | P0 | RAMZA critic gate requires author `ramza` and checker `vigil`; Tonberry retains `maker=vivi`, `checker=vigil`. |

## Decision log

| Decision | Rationale |
|---|---|
| Durable center precedes native delivery | A reliable inbox cannot depend on OS permission or callbacks. |
| One current item plus attempt history | Avoids etag-driven duplicates while retaining user-choice auditability. |
| Backend-only eligibility | Indexed DTOs omit attendee data and clients are stale/untrusted. |
| Exact self-only PATCH with `attendeesOmitted=true` | Google array replacement makes full attendee PATCH unsafe. |
| Preserve canonical `attendees_omitted` | Request transport optimization is not canonical source truth. |
| `sendUpdates=none` | The response resource update should propagate without unsolicited broad guest email; release evidence must validate this provider assumption. |
| One controlled 412 retry | Honors etag safety without silently losing a valid choice. |
| Proposed-time deferred | No structured REST contract and high semantic complexity. |
