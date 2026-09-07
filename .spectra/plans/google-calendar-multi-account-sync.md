---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-08-26T23:22:45Z
thread_id: 9206d943-dde5-43c1-bb84-4a03691cb4a0
target_repos:
  - jin
stories_count: 11
validation_gates_count: 54
confidence: 0.925
decisions_resolved_at: 2026-08-26T23:22:45Z
evidence_anchors_count: 18
---

# Google Calendar Multi-Account Bidirectional Sync

## Scope

Intent class: CHANGE

[DECISION] Evolve Jin's existing Google connector into a multi-account,
bidirectional calendar integration while preserving file-canonical local data,
the unified Month/Week/Day agenda, audited conflicts, and strict account isolation.

### Frozen product decisions

1. Google-origin events are editable from Jin and sync back to Google.
2. Aliases are account-level labels backed by immutable Jin account IDs.
3. Jin discovers every visible calendar, enables new discoveries by default, and
   allows each calendar to be disabled.
4. Jin-managed entries coexist in the unified agenda and may be assigned to one
   selected account/calendar destination.
5. Conflict handling remains safe and no operation may leak across accounts.

### In

- An immutable `GoogleAccountId` bound once to Google's stable `(issuer, subject)`
  identity, plus mutable account alias, display principal, and scoped auth state.
- Account-ID-namespaced keyring entries and encrypted token files.
- CalendarList discovery, persistent enablement, availability, and provider
  `accessRole` for every visible calendar.
- Versioned migration from singleton config, token storage, event provenance,
  cursors, mappings, and dirty state.
- Optional canonical `EventSyncTarget { account_id, calendar_id }`; local-only Jin
  events have no target and Google-origin events always have one.
- Schema-enforced provider/account/calendar/event/recurrence cursor, mapping,
  remote identity, and outbox constraints.
- One root-aware mutation service shared by CLI and Tauri, with crash-recoverable
  coupling between canonical file mutation and destination-scoped outbox intent.
- Assignment of new or unpublished Jin events to an enabled writable calendar.
- Google-origin edit/delete on writable calendars, including scoped recurrence
  edits for `This occurrence` and `Entire series` after the non-recurring path.
- Separate inbound enablement from outbound provider authorization, with explicit
  quarantine/review for disconnected, revoked, or downgraded routes.
- Per-destination incremental pull/push, scoped 410 recovery, etag/412 conflict
  handling, losing-snapshot audit, isolated partial failures, and aggregate status.
- Rust DTO, Tauri, CLI, TypeScript, Settings, calendar/detail, accessibility,
  migration, security, mock-provider, Playwright, and live-smoke coverage.

### Out

- `This and following` recurrence edits.
- Moving an already-published event between accounts/calendars; this needs a
  separately specified insert/delete saga.
- Destructive local-data removal. This increment supports disconnect,
  reauthentication, and alias rename while retaining cached data and audit history.
- Calendar aliases, calendar/ACL creation, attendee/RSVP management, conferencing,
  reminders, attachments, webhooks, background daemons, CalDAV, or another provider.
- Uploading aliases, Jin links, notes, backlinks, `agenda_bucket`, or other local
  context to Google.
- Real credentials in CI or representing browser evidence as native Tauri proof.

### Supersession and dependencies

The archived `.spectra/changes/archive/2026-08-26-calendar-pr47-rescue/` is the
behavioral baseline. Its atomic in-place mutation, core-owned authorization,
half-open projection, canonical detail routing, visible errors, accessibility,
and Month/Week/Day behavior remain regression gates.

[DECISION] This plan supersedes only these older assumptions:

- ADR-0004's single-account/single-configured-calendar MVP constraint and its
  CalendarList deferral (`docs/adr/0004-google-calendar-sync.md:13-31,100-112`).
- Rescue AC-CAL-02's blanket rejection of an `external` event, for supported
  Google events on a connected, enabled, available, writer/owner calendar.
- M1's unconditional Google-authoritative read-only capability and its deferred
  Google recurrence rule (`.spectra/plans/2026-08-25-calendar-event-detail-m1.md:40-48,66-81`).

M1 otherwise remains authoritative for core-projected capabilities, explicit
Save/Cancel, canonical refetch, Back-state restoration, localization, and Jin-local
privacy. Story S0 records whether M1 has landed and establishes a single writer for
overlapping event capability/DTO/controller files before implementation begins.

Assumptions: the owner-provisioned OAuth desktop client is shared across account
connections while authorization tokens are per account; there is no post-migration
fallback to a singleton credential slot. Google `accessRole` is the provider permission
source; risk if wrong: live smoke must correct the role mapping before release.
Offline writes remain local-first; risk if wrong: requiring network would regress a
core Jin property. The live API cannot be proven hermetically; risk if wrong: a
green cassette suite could overstate provider fidelity, so releases remain labeled
`live-unvalidated` until a two-account smoke result is recorded.

Right-size: 8 → full. Complexity: 11/12 → human_loop. TRANCE G3 was explicitly
authorized and terminated at cycle 3 with an independently evaluated score of 87.0.

## Approach

### Identity, registry, and authorization

[DECISION] Generate `GoogleAccountId` once in Jin, then bind it immutably to the
stable Google OIDC identity `(issuer, subject)`. Never derive the Jin ID from alias,
email, calendar ID, or token. `(issuer, subject)` is unique within the Google account
registry. Initial authorization must obtain and validate it before account activation;
reauthentication must match the stored pair or fail without replacing credentials.
Alias is trimmed, case-insensitively unique inside one Jin root, and presentation-only.
Renaming it must not rekey any secret, cursor, mapping, outbox row, event target, or
audit identity.

Persist an account/calendar registry in versioned config or an atomically referenced
registry file:

```text
GoogleAccount { id, provider_issuer, provider_subject, alias, principal?, state,
                auth_generation, created_at, updated_at }
GoogleCalendar { account_id, calendar_id, name, primary, access_role,
                 enabled, available, discovered_at, refreshed_at }
EventSyncTarget { account_id, calendar_id }
```

OAuth uses the existing owner-provisioned desktop client, PKCE, loopback redirect,
account-bound CSRF state, and the minimum identity scope needed to validate the
stable issuer/subject. Request event read/write plus the least CalendarList read
scope needed for discovery. Keyring identity becomes
`jin-oauth/google/<account_id>` and encrypted fallback becomes
`.jin/sync/accounts/<account_id>/tokens.enc`. Reauthentication replaces only that
account's tokens after subject match. After v2 activation every credential API
requires `account_id`; it must never probe or fall back to the legacy singleton slot.
Refresh uses an account-keyed lock and compares `auth_generation` before commit so
concurrent refreshes cannot overwrite a newer token. Different accounts do not share
a refresh lock or credential state.

Disconnect deletes only that account's token material, clears only its cursors,
increments `auth_generation`, quarantines its queued writes, and keeps registry,
canonical files, mappings, and audit history. Reconnect requires subject match,
calendar rediscovery, and explicit review/resume of each quarantined operation; it
never silently replays old work. Destructive removal of cached canonical data is a
separate future command/spec with its own confirmation and retention rules.

### Migration and backward compatibility

[DECISION] Use one journaled, transactional-in-effect, resumable migration state
machine. Config activation, token namespace verification, SQLite schema switch, and
event backfill are committed behind one version marker; recovery completes forward
or restores the pre-migration snapshot, never exposes a mixed v1/v2 writable state:

1. Back up v1 config and sync-state DB.
2. Persist exactly one generated legacy account ID before rewriting other state.
3. Create alias `Google` with a deterministic numeric suffix on collision.
4. Convert the configured calendar (or `primary`) into the account registry.
5. Copy the fixed keyring/file token to its account namespace and verify it reads;
   retain the legacy slot only as rollback data that v2 runtime code cannot query.
6. If the token lacks discovery scope, preserve all data, mark `needs_reauth`, and
   prohibit discovery-dependent writes until reauthorization.
7. Transactionally migrate SQLite rows to destination-scoped schemas.
8. Journal a resumable backfill of `provider_account_id` into Google mirrors and
   mapped Jin events; older files parse with a default absent target.
9. Never infer publication from a legacy Jin event's bare `calendar_id=primary`.
10. Abort on identity collisions with an actionable integrity error; never delete
    a conflicting record to make migration pass.

Rerunning any step is idempotent by migration operation ID and persisted phase.
Current Jin readers and writers must inspect the schema/version marker and reject
legacy singleton operations before mutation. An already-built historical binary
cannot be retrofitted to inspect a new marker; VIGIL's pinned counterexample records
that boundary. Downgrade guidance must therefore prohibit using a historical binary
to write an activated v2 root and must never flatten account identity.

### Calendar discovery and capability projection

CalendarList discovery is account-scoped and idempotent. The first response stores
every visible calendar as enabled. Refresh preserves prior user toggles, enables
only newly discovered calendars, and marks missing calendars unavailable without
deleting cached files or state.

Persist inbound `enabled` independently from refreshed outbound `access_role` as
`owner | writer | reader | freeBusyReader`. Inbound enablement controls pull and
agenda inclusion; it never grants write permission. Enabled reader calendars still
pull, mirror, and project into the agenda, but never appear as mutation destinations.
Every outbound create/edit/delete/recurrence operation requires current writer/owner
role plus matching account/auth generation and intent-time destination.

A role downgrade, account disconnect, or provider revocation increments the route
generation and quarantines queued writes with a stable reason; it never attempts,
reroutes, or silently replays them. Role restoration or reconnect requires explicit
per-operation review/resume after fresh discovery. Disabled/unavailable calendars
issue no provider requests, leave cached files intact, disappear from active agenda
projection and destination pickers, and retain quarantined work.

### Canonical provenance and sync-state schema

Extend event frontmatter with optional `provider_account_id`; keep `calendar_id` as
the provider calendar member. Aliases and calendar names are resolved DTO display
fields, never canonical identity. `source`, `authority`, `ical_uid`, recurrence,
timezone, backlinks, and Jin-local context retain their existing meanings
(`jin-core/src/model/event.rs:72-139`).

Freeze a non-null provider discriminator (`google`) and distinct operational keys.
`recurrence_key` is a normalized sentinel for non-recurring/master resources and a
canonical original-start/instance identity for occurrences:

```text
calendar_sync:
  PRIMARY KEY (provider, account_id, calendar_id)

event_sync_map:
  PRIMARY KEY (provider, account_id, calendar_id, jin_id, recurrence_key)
  UNIQUE (provider, account_id, calendar_id, google_event_id, recurrence_key)
  iCalUID lookup scoped by provider + account_id + calendar_id + recurrence_key

outbox:
  PRIMARY KEY (operation_id)
  destination FOREIGN KEY (provider, account_id, calendar_id)
  carries the exact intent-time provider event/recurrence key, jin_id, operation,
  base_etag, canonical_revision, auth_generation, route_generation, retry state
```

Every active mapping/outbox destination must equal the event's canonical
`EventSyncTarget`. The sync drain uses only the immutable destination captured at
intent time; it never resolves an alias/default/current-primary fallback. The same
calendar ID, Google event ID, iCalUID, or recurrence identity may coexist in
different accounts/providers. Remove usable global `list_dirty`/`clear_clean_entries` APIs;
410 reset, cleanup, retry, audit, and dirty drain all require exact destination.

### Mutation/outbox boundary and routing

[DECISION] Introduce a root-aware `EventMutationService` used by CLI, Tauri,
promotion, and future callers. It validates canonical state and core capability,
resolves the persisted target, prepares a durable operation record, performs the
same-directory atomic canonical write, finalizes the destination-scoped outbox row,
and returns a canonical refetch.

Because filesystem and SQLite cannot share one native transaction, use an
idempotent journal with before/post hashes and operation ID. Startup recovery
converges interrupted operations without overwriting newer divergent files. A
successful canonical mutation may not silently lose its required outbox intent.

New or unpublished Jin events may be Local only or assigned to one enabled,
available writer/owner destination. Multiple destinations without an explicit
preference require a choice; there is no cross-account `primary` fallback. Moving
an already-published event is rejected in this increment.

Google-origin eligible mutations preserve `source=google`, `authority=google`,
Jin ID, provider target, Google ID, iCalUID, and local links. Edits use sparse PATCH
payloads and stored etag; deletes target the same route. Provider responses replace
the pending mirror after success. Jin-private fields remain denied from payloads.

### Recurrence, synchronization, and conflicts

Build Google-origin non-recurring edit/delete first. A separate dependent slice
adds `This occurrence` and `Entire series`, preserving master/exception identity,
verbatim recurrence lines, IANA timezone/DST behavior, and exclusive all-day ends.
`This and following` remains a core-rejected, localized capability.

Aggregate sync iterates connected accounts and enabled/available calendars. Each
slice loads/refreshed only its token, uses its cursor, drains only its outbox, and
records scoped results. One slice failure does not roll back successful peers. The
derived index refreshes once affected canonical slices converge.

Retain client-specified idempotent insert IDs, `If-Match`, scoped 410 bootstrap,
and audited conflict policy (`jin-core/src/google/sync.rs`,
`jin-core/src/sync/conflict.rs`). Google-origin divergence remains remote-wins: a
412 fetches remote state, never performs unconditional overwrite, and records:
timestamp, operation ID, full provider/account/calendar/event/recurrence identity,
base and remote etags, attempted field-level Jin delta plus post-image hash, remote
snapshot/hash, policy, and winner. Tokens, aliases, and Jin-private context are
redacted. Jin-origin remote delete remains unpublish, never local destroy.

Revocation, disconnect, calendar removal, role downgrade, remote cancellation, and
local tombstone carry monotonic generations that outrank any older queued update.
Before drain, every operation revalidates auth/route generation and canonical
tombstone state. A stale write is quarantined or superseded; it can never resurrect a
deleted event or bypass a revocation.

### Client and UI contract

Core DTOs expose stable account/calendar identity, alias/name display projection,
access role, connection/enabled state, sync state, and core-owned mutation
capabilities. Tauri and CLI pass stable IDs and delegate policy to core. Human CLI
input may resolve a unique alias; JSON output always returns immutable IDs.

Commands cover account list/add/reauth/rename/disconnect, calendar list/refresh/
enable/disable, sync-all/sync-account, and destination-aware event create/edit/delete.
Existing singleton commands remain compatibility wrappers only when exactly one
eligible route exists; otherwise they return typed ambiguity.

Settings renders independently operable account cards with nested calendars,
roles, toggles, last sync, paused writes, and scoped errors. Event creation offers
Local only plus writable destinations grouped by alias. Calendar/detail continues
one unified agenda and shows account alias/calendar context without making separate
Google and Jin silos. Controls remain keyboard accessible and failures visible.

## Stories

### Story S0: Freeze baseline and ownership

As an implementer, I want one retained/superseded contract so that rescue, M1,
and integration code cannot fork. Timebox: 1d. Risk: P0. Executor: frontier.
Output: archived-rescue regression matrix, M1 landed-state inventory,
supersession matrix, frozen shared type/DTO ownership, no product change.

### Story S1: Add immutable accounts and routes

As a multi-account user, I want aliases separated from identity so that renames
cannot corrupt state. Timebox: 3d. Risk: P0. Executor: mid.
Output: account/calendar registry, `GoogleAccountId`, `EventSyncTarget`, optional
canonical account field, immutable issuer/subject binding, serialization and
invariant tests. Depends on S0.

### Story S2: Migrate singleton data safely

As an existing user, I want one idempotent upgrade so that tokens, mappings, and
event identity survive. Timebox: 6d. Risk: P0. Executor: frontier.
Output: config/DB backups, copy-verify-retain token migration, sync schema migration,
journaled event backfill, atomic activation marker, current-code singleton write
refusal, pinned historical-behavior evidence, and fixtures. Depends on S1.

### Story S3: Namespace OAuth and account lifecycle

As a user, I want Work and Personal authorization isolated so that one flow cannot
overwrite another. Timebox: 5d. Risk: P0. Executor: frontier.
Output: account-bound PKCE state, per-account secret stores, reauth/disconnect,
stable-subject checks, account refresh locks, no-fallback credential APIs,
scope-upgrade state, isolation/redaction tests. Depends on S1; consumes S2 migration.

### Story S4: Discover calendars and project permissions

As a connected user, I want every visible calendar discovered and controllable so
that availability is complete without unsafe write assumptions. Timebox: 5d.
Risk: P0. Executor: mid. Output: CalendarList client, registry reconciliation,
default inbound enable, separate outbound role authorization, quarantine/review,
availability/access-role capability tests.
Depends on S3.

### Story S5: Make sync state destination-safe

As the sync engine, I want exact destination keys so that cleanup cannot cross
accounts. Timebox: 6d. Risk: P0. Executor: frontier.
Output: composite cursor/mapping/outbox schema and repositories, scoped 410/cleanup,
same-ID/recurrence collision fixtures, intent-time route keys, migration tests.
Depends on S1, S2, and S4.

### Story S6: Centralize mutation and routed outbox writes

As a calendar user, I want every entrypoint to queue the exact route so that local
writes synchronize reliably. Timebox: 7d. Risk: P0. Executor: frontier.
Output: recoverable mutation service, local-only/routed create, ordinary edit/delete
enqueue, exact intent-time route invariants, sparse payload intent, generation and
tombstone precedence, crash tests. Depends on S4 and S5.

### Story S7: Edit Google-origin events safely

As a user, I want eligible Google events editable in Jin so that I need not leave
the app. Timebox: 7d. Risk: P0. Executor: frontier.
Output: permission-aware edit/delete, provider response refetch, etag/412 audit,
occurrence/series recurrence sub-slice, timezone/identity fixtures. Depends on S6.

### Story S8: Orchestrate isolated aggregate sync

As a multi-account user, I want one sync action with scoped outcomes so that one
failure cannot contaminate another. Timebox: 7d. Risk: P0. Executor: frontier.
Output: per-destination runner, scoped token refresh/bootstrap/outbox, pause/resume,
explicit quarantine review, partial summaries, complete 412 audit identity tests.
Depends on S3, S5, S6, and S7.

### Story S9: Extend DTO, Tauri, CLI, and GUI

As a user, I want provenance and controls everywhere so that routing is explicit.
Timebox: 8d. Risk: P1. Executor: frontier.
Output: Rust/TS DTO parity, typed commands/wrappers, CLI selectors/errors, Settings
cards, grouped destination picker, unified detail/agenda, accessibility tests.
Depends on S8 and the S0 M1 boundary.

### Story S10: Verify isolation and provider fidelity

As the owner, I want deterministic plus live-scoped evidence so that cassette
correctness is not overstated. Timebox: 5d plus owner smoke. Risk: P0.
Executor: mid checker, identity-distinct from Vivi. Output: all automated suites,
two-account collision cassettes, Playwright evidence, native sign-off, disposable
two-account smoke runbook/result or explicit `live-unvalidated`. Depends on S0-S9.

Dependency order:

```text
S0 -> S1 -> S2
       |     `------.
       `-> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 -> S10
              `------------^       ^
S2 -------------------------------'
```

## Acceptance Criteria

### AC-GCAL-001 (ubiquitous)
GIVEN the archived rescue is the implementation baseline
WHEN the integration regression gate runs
THEN the archived rescue acceptance checks SHALL remain passing
VERIFY: test: rerun AC-CAL-01 through AC-CAL-04

### AC-GCAL-002 (event-driven)
GIVEN a valid singleton Google configuration
WHEN migration first commits
THEN Jin SHALL persist exactly one immutable account ID for the legacy connection
VERIFY: test: config_migration::singleton_creates_one_account

### AC-GCAL-003 (event-driven)
GIVEN the singleton migration has completed
WHEN migration runs again
THEN Jin SHALL produce no duplicate account, token, mapping, or event rewrite
VERIFY: test: config_migration::rerun_is_idempotent

### AC-GCAL-004 (unwanted-behavior)
GIVEN a legacy token cannot be copied and verified
WHEN migration attempts account activation
THEN Jin SHALL retain the legacy token slot and fail without partial activation
VERIFY: test: config_migration::token_copy_failure_rolls_back

### AC-GCAL-005 (event-driven)
GIVEN a configured account has tokens, mappings, cursors, and event targets
WHEN its alias is renamed
THEN every immutable identity and storage key SHALL remain byte-for-byte unchanged
VERIFY: test: account_registry::rename_is_presentation_only

### AC-GCAL-006 (ubiquitous)
GIVEN OAuth token material is persisted
WHEN a token storage address is resolved
THEN every OAuth token SHALL be addressed by immutable account ID rather than alias or email
VERIFY: test: google::secrets::account_namespaces

### AC-GCAL-007 (unwanted-behavior)
GIVEN OAuth is pending for account A
WHEN a callback carries state bound to account B
THEN Jin SHALL reject the callback without persisting token material
VERIFY: test: google::auth::account_state_mismatch

### AC-GCAL-008 (event-driven)
GIVEN a migrated token lacks CalendarList scope
WHEN scope compatibility is evaluated
THEN Jin SHALL preserve local data and mark only its account `needs_reauth`
VERIFY: test: config_migration::scope_upgrade_preserves_data

### AC-GCAL-009 (event-driven)
GIVEN Google returns visible calendars for a connected account
WHEN discovery completes
THEN Jin SHALL persist every returned calendar under that account ID
VERIFY: test: google::calendar_list::persists_all_visible

### AC-GCAL-010 (state-driven)
GIVEN a calendar is discovered for the first time
WHEN its registry state is first persisted
THEN its enabled state SHALL default to true
VERIFY: test: calendar_registry::new_calendar_enabled

### AC-GCAL-011 (event-driven)
GIVEN a disabled existing calendar and a newly visible calendar
WHEN discovery refreshes
THEN Jin SHALL preserve the existing disable while enabling the new calendar
VERIFY: test: calendar_registry::refresh_preserves_choice

### AC-GCAL-012 (event-driven)
GIVEN a known calendar is absent from a later discovery response
WHEN reconciliation completes
THEN Jin SHALL mark it unavailable without deleting cached canonical events
VERIFY: test: calendar_registry::missing_calendar_is_nondestructive

### AC-GCAL-013 (state-driven)
GIVEN an enabled reader or freeBusyReader calendar
WHEN agenda and destination capabilities are projected
THEN Jin SHALL mirror its events while excluding it from mutation destinations
VERIFY: test: calendar_capability::readonly_mirrors_not_destinations

### AC-GCAL-014 (event-driven)
GIVEN a calendar with queued writes loses writer/owner access
WHEN discovery refreshes its role
THEN Jin SHALL pause those writes with `provider_permission_changed` without rerouting
VERIFY: test: calendar_capability::role_downgrade_pauses_exact_route

### AC-GCAL-015 (state-driven)
GIVEN a calendar is disabled or unavailable
WHEN aggregate sync schedules destination work
THEN sync SHALL issue no provider request for that destination
VERIFY: test: sync_orchestrator::inactive_calendar_no_network

### AC-GCAL-016 (state-driven)
GIVEN two accounts expose identical calendar IDs and Google event IDs
WHEN either remote identity is queried
THEN their cursor and mapping rows SHALL remain independently addressable
VERIFY: test: sync_state::same_remote_ids_across_accounts

### AC-GCAL-017 (event-driven)
GIVEN one destination receives HTTP 410
WHEN full-bootstrap recovery runs
THEN clean mappings outside that exact account/calendar SHALL remain unchanged
VERIFY: test: sync_state::scoped_410_cleanup

### AC-GCAL-018 (event-driven)
GIVEN a new or unpublished Jin event and an enabled writable destination
WHEN canonical creation or assignment commits
THEN one outbox operation SHALL reference that exact account/calendar target
VERIFY: test: event_mutation::routes_exact_destination

### AC-GCAL-019 (event-driven)
GIVEN Local only is selected
WHEN a Jin event is created
THEN no provider outbox operation SHALL be created
VERIFY: test: event_mutation::local_only_has_no_outbox

### AC-GCAL-020 (event-driven)
GIVEN any synced event is created, edited, or deleted through CLI or Tauri
WHEN its canonical mutation commits
THEN exactly one recoverable destination-scoped outbox intent SHALL exist
VERIFY: test: event_mutation::entrypoint_outbox_parity

### AC-GCAL-021 (event-driven)
GIVEN a process stops between canonical write and outbox finalization
WHEN startup recovery runs
THEN the canonical revision and its outbox intent SHALL converge idempotently
VERIFY: test: event_mutation::journal_failure_injection

### AC-GCAL-022 (state-driven)
GIVEN a non-cancelled Google event on an enabled available writer/owner calendar
WHEN core projects mutation capabilities
THEN core capability projection SHALL report it editable
VERIFY: test: event_capabilities::writable_google_event

### AC-GCAL-023 (event-driven)
GIVEN an eligible Google-origin event
WHEN supported fields are edited in Jin
THEN its sparse PATCH intent SHALL preserve target, remote identity, and base etag
VERIFY: test: google_sync::google_origin_sparse_patch

### AC-GCAL-024 (event-driven)
GIVEN an eligible Google-origin event
WHEN deletion synchronizes successfully
THEN Google SHALL receive the delete on the event's persisted destination
VERIFY: test: google_sync::google_origin_delete_route

### AC-GCAL-025 (event-driven)
GIVEN a recurring Google event
WHEN `This occurrence` is edited
THEN Jin SHALL preserve exception and original-start identity through round-trip
VERIFY: test: google_sync::recurring_occurrence_identity

### AC-GCAL-026 (event-driven)
GIVEN a recurring Google event
WHEN `Entire series` is edited
THEN Jin SHALL preserve master recurrence lines, timezone, and all-day end semantics
VERIFY: test: google_sync::recurring_series_lossless

### AC-GCAL-027 (unwanted-behavior)
GIVEN a recurring event mutation requests `This and following`
WHEN core validates the scope
THEN Jin SHALL reject it without canonical or outbox mutation
VERIFY: test: event_capabilities::following_scope_rejected

### AC-GCAL-028 (unwanted-behavior)
GIVEN Google returns 412 for a pending Google-origin edit
WHEN conflict resolution runs
THEN Jin SHALL retain the remote representation without unconditional overwrite
VERIFY: test: conflict::google_origin_412_remote_wins

### AC-GCAL-029 (event-driven)
GIVEN a local Google-origin edit loses conflict resolution
WHEN remote state replaces it
THEN the losing delta SHALL be appended under the same immutable account/calendar identity
VERIFY: test: conflict::google_origin_loser_audited

### AC-GCAL-030 (event-driven)
GIVEN a Jin-origin published event
WHEN its Google replica is deleted remotely
THEN the Jin canonical event SHALL remain locally present as unpublished
VERIFY: test: conflict::remote_delete_preserves_jin

### AC-GCAL-031 (event-driven)
GIVEN one destination fails while another succeeds
WHEN aggregate sync completes
THEN the successful destination SHALL commit with both scoped outcomes reported
VERIFY: test: sync_orchestrator::partial_failure_isolated

### AC-GCAL-032 (event-driven)
GIVEN a disconnected account has paused outbox work
WHEN that same account is reauthenticated with sufficient role
THEN only its original destinations SHALL resume after capability refresh
VERIFY: test: sync_orchestrator::reauth_resumes_without_reroute

### AC-GCAL-033 (state-driven)
GIVEN Jin and enabled Google events intersect the selected range
WHEN the selected Month, Week, or Day is projected
THEN Month, Week, and Day SHALL project both source classes in one agenda
VERIFY: test: agenda::unified_multi_account_projection plus Playwright fixture

### AC-GCAL-034 (state-driven)
GIVEN a provider-backed event crosses Rust, Tauri, and TypeScript boundaries
WHEN its DTO is serialized and decoded
THEN its DTO SHALL preserve stable identity, display provenance, access role, and sync state
VERIFY: test: Rust serialization fixture equals TypeScript fixture

### AC-GCAL-035 (unwanted-behavior)
GIVEN multiple writable destinations exist without an explicit preference
WHEN create or promote is requested
THEN Jin SHALL return typed ambiguity instead of selecting a cross-account fallback
VERIFY: test: CLI and controller no_singleton_fallback

### AC-GCAL-036 (state-driven)
GIVEN multiple accounts are configured
WHEN Settings renders the integration collection
THEN Settings SHALL render independently operable account cards with calendar toggles
VERIFY: test: settings_controller.test.ts multi_account_cards

### AC-GCAL-037 (ubiquitous)
GIVEN any provider event mutation is ready to synchronize
WHEN its Google payload is serialized
THEN Google payloads SHALL omit account aliases and every Jin-local context field
VERIFY: test: google::mapping::local_context_denylist

### AC-GCAL-038 (event-driven)
GIVEN an account with cached events and audit records
WHEN it is disconnected
THEN Jin SHALL retain those local records while pausing only that account's network work
VERIFY: test: account_registry::disconnect_preserves_local_state

### AC-GCAL-039 (state-driven)
GIVEN no two-account live sandbox result has been recorded
WHEN release evidence is assembled
THEN release evidence SHALL label Google end-to-end behavior `live-unvalidated`
VERIFY: review: docs/google-smoke-test.md result record and release checklist

### AC-GCAL-040 (event-driven)
GIVEN initial OAuth succeeds for a newly generated Jin account ID
WHEN the account registry activates the connection
THEN the account SHALL be immutably bound to Google's validated issuer and subject
VERIFY: test: account_registry::activation_binds_stable_subject

### AC-GCAL-041 (unwanted-behavior)
GIVEN a configured account is bound to one Google issuer and subject
WHEN reauthentication returns a different issuer or subject
THEN Jin SHALL reject the credentials without changing the stored token namespace
VERIFY: test: google::auth::reauth_subject_mismatch

### AC-GCAL-042 (event-driven)
GIVEN migration is interrupted after any v1-to-v2 phase
WHEN startup recovery reruns the same migration operation
THEN Jin SHALL converge to one complete v2 state or the intact v1 snapshot
VERIFY: test: config_migration::all_phase_failure_injection

### AC-GCAL-043 (unwanted-behavior)
GIVEN a root carries the v2 account-registry activation marker
WHEN the current compatibility guard and frozen historical writer behavior are evaluated
THEN current Jin SHALL reject legacy singleton operations before mutation, and lifecycle evidence SHALL record that an already-built historical binary is outside current-code enforcement
VERIFY: test: config_migration_old_binary_write_guard_fixture; evidence: VIGIL pinned-historical-binary counterexample; review: planner-amendment-ac-gcal-043.md

### AC-GCAL-044 (unwanted-behavior)
GIVEN v2 account credentials are active
WHEN token load, save, refresh, or delete cannot find the requested account namespace
THEN Jin SHALL fail without probing the legacy singleton credential slot
VERIFY: test: google::secrets::v2_has_no_legacy_fallback

### AC-GCAL-045 (event-driven)
GIVEN concurrent refresh requests target one account
WHEN refreshed tokens attempt to commit
THEN an account-scoped lock and auth generation SHALL prevent an older refresh overwriting a newer token
VERIFY: test: google::secrets::refresh_lock_generation_order

### AC-GCAL-046 (state-driven)
GIVEN two providers or accounts reuse calendar, event, and recurrence identifiers
WHEN mappings and outbox rows are persisted
THEN schema constraints SHALL distinguish the complete provider/account/calendar/event/recurrence key
VERIFY: test: sync_state::composite_recurrence_collision_schema

### AC-GCAL-047 (state-driven)
GIVEN a calendar is inbound-enabled with reader-only provider access
WHEN pull and outbound capabilities are evaluated
THEN Jin SHALL allow inbound mirroring without authorizing outbound mutation
VERIFY: test: calendar_capability::inbound_enable_not_write_authority

### AC-GCAL-048 (event-driven)
GIVEN queued writes exist when provider role is downgraded or revoked
WHEN route generation changes
THEN Jin SHALL quarantine the writes until explicit review without automatic replay
VERIFY: test: sync_orchestrator::downgrade_quarantine_requires_review

### AC-GCAL-049 (event-driven)
GIVEN an event mutation is accepted for one destination
WHEN its outbox operation is drained later
THEN sync SHALL use the exact intent-time destination without alias, default, or primary fallback
VERIFY: test: event_mutation::intent_route_is_immutable

### AC-GCAL-050 (event-driven)
GIVEN Google returns 412 for a pending operation
WHEN the conflict audit record is appended
THEN it SHALL contain scoped identity, operation, etags, redacted local delta, remote snapshot, policy, and winner
VERIFY: test: conflict::google_412_audit_contract

### AC-GCAL-051 (event-driven)
GIVEN an account has cursors and pending outbox operations
WHEN the account is disconnected
THEN Jin SHALL clear only its cursors and quarantine only its pending operations
VERIFY: test: account_registry::disconnect_scopes_cursor_and_outbox

### AC-GCAL-052 (event-driven)
GIVEN a disconnected account reconnects with the matching subject
WHEN discovery and capability refresh complete
THEN no quarantined operation SHALL resume until the user explicitly reviews it
VERIFY: test: sync_orchestrator::reconnect_requires_outbox_review

### AC-GCAL-053 (unwanted-behavior)
GIVEN the user disconnects or hides a Google account
WHEN local cached data is considered for deletion
THEN Jin SHALL require a separate destructive-removal operation not provided by disconnect
VERIFY: test: account_registry::disconnect_never_removes_local_data

### AC-GCAL-054 (unwanted-behavior)
GIVEN a queued write predates revocation, downgrade, disconnect, remote cancellation, or local tombstone
WHEN sync evaluates that stale operation
THEN the newer safety generation SHALL quarantine or supersede it before any provider request
VERIFY: test: sync_orchestrator::revocation_and_tombstone_outrank_stale_write

## Confidence

`ramza-score --rubric confidence`: 92.5% → AUTO_PROCEED. G3 cycle 3:
87.0 → elite/PASS. Bias mitigations: author identities stripped, candidate briefs
length-normalized, candidate B evaluated first, deterministic repository/EARS/schema
checks preferred over prose, independent checker distinct from author.

## Rejected Alternatives

- **Cycle-1 scope-expansive candidate** — 73.0: strongest alignment/innovation, but
  coupled recurrence, published-event movement, destructive removal, and live gating
  into one unsafe increment.
- **Cycle-1 risk-minimizing candidate** — 76.5: strongest simplicity/risk, but
  contradicted unqualified Google editability, used a future-hostile mapping key, and
  made external credentials block hermetic ESL verification.
- **Alias or email as account key** — rename/provider identity changes would rekey
  secrets and mappings.
- **One global dirty drain or global clean-map reset** — permits wrong-account push
  or cleanup.
- **Separate Google agenda** — violates coexistence and duplicates calendar UI.
- **Full event replacement on Google edit** — can erase unsupported provider fields;
  sparse PATCH is required.
- **Published-event auto-move now** — safe movement needs a separately reviewed saga.
- **Destructive account removal now** — disconnect satisfies lifecycle control without
  risking cached canonical history.

### G3 per-dimension merge provenance

| Dimension | Source retained | Reason |
|---|---|---|
| Alignment | expansive candidate | Explicit Google-origin mutation and UI parity |
| Correctness | risk-minimizing candidate | Scoped migration, cleanup, and sparse PATCH |
| Maintainability | merged | Stable domain types plus one mutation service |
| Performance | risk-minimizing candidate | Per-destination incremental state, no global scans |
| Simplicity | risk-minimizing candidate | Published move and destructive removal deferred |
| Risk | merged cycle 3 | Role downgrade, exact keys, pause/no-reroute invariants |
| Innovation | expansive candidate | Multi-account aggregate UX without separate agendas |

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| Cross-account push or cleanup | P0 | Exact keys, typed routes, same-ID collision tests |
| Token overwrite/callback confusion | P0 | Account-ID namespaces and account-bound OAuth state |
| Reauth binds a different Google user | P0 | Immutable issuer/subject check before token replacement |
| Singleton migration loses auth/data | P0 | Backup, copy-verify-retain, journal, idempotent rerun |
| Historical binary writes an activated v2 root | P0 | Current-code guard plus explicit prohibition on historical-binary writes; retain VIGIL counterexample |
| Concurrent refresh loses newest token | P0 | Account-keyed lock plus auth generation compare |
| Canonical write loses outbox | P0 | Recoverable mutation journal and crash injection |
| Permission downgrade still pushes | P0 | Refresh role, pause route, no reroute test |
| Reconnect silently replays stale intent | P0 | Quarantine plus explicit per-operation review |
| Stale update resurrects tombstone | P0 | Monotonic safety generations checked before request |
| Sparse edit erases provider fields | P0 | PATCH allowlist and denylist fixtures |
| Recurrence/timezone corruption | P0 | Dependent slice with identity/DST/all-day fixtures |
| One account failure blocks peers | P0 | Per-destination commits and aggregate partial result |
| M1 integration forks capability rules | P0 | S0 ownership matrix before overlapping edits |
| Cassettes diverge from live Google | P0 | Two-account disposable smoke or live-unvalidated label |
| Browser evidence overclaims native UI | P1 | Separate owner native Tauri sign-off |

## Recommended Vivi track split

After S0 and S1 freeze shared contracts, use isolated worktrees subject to hard
integration barriers:

| Track | Stories | Scope | Merge gate |
|---|---|---|---|
| Vivi-A Accounts | S2-S4 | migration, auth, tokens, discovery, roles | account/calendar APIs and fixtures |
| Vivi-B Sync safety | S5, S8 | composite state, scoped runner, conflict/audit | A types fixed; collision/410 suites green |
| Vivi-C Mutations | S6-S7 | mutation journal, routing, Google edit/delete/recurrence | A+B interfaces fixed; crash/412 suites green |
| Vivi-D Client UX | S9 | DTO/Tauri/CLI/UI against frozen fixtures | C bridge integrated before final UI proof |

[DECISION] `A → B → C → D` is a hard barrier chain, not a best-effort merge order.
The next track may not implement against provisional predecessor state: A's identity,
migration, subject, secret, discovery, and role gates must merge and verify before B;
B's schema and scoped runner gates before C; C's mutation/conflict/precedence gates
before D. Only read-only preparation may overlap. Each barrier records its verifier
evidence and may invalidate downstream work when its contract changes. Each track
gets an identity-distinct verifier. S10 and blocking ESL verification run only after
the D integration barrier; live smoke status remains separately labeled.

## Agent-Executable Plan

```yaml
plan_id: google-calendar-multi-account-sync
tier: trance
enforce: fail-fast
tracks:
  - id: accounts
    stories: [S2, S3, S4]
    depends_on: [S0, S1]
  - id: sync-safety
    stories: [S5, S8]
    depends_on: [S1, S2, S4]
  - id: mutations
    stories: [S6, S7]
    depends_on: [S4, S5]
  - id: client-ux
    stories: [S9]
    depends_on: [S7, S8]
verification:
  checker: vigil
  mode: block
  acceptance: AC-GCAL-001..AC-GCAL-054
  live_smoke: non_hermetic_separate_attestation
```

## Provenance

- ATLAS: `.artifacts/atlas/20260826-google-calendar-integration/scout-report.md`.
- Rescue baseline: `.spectra/changes/archive/2026-08-26-calendar-pr47-rescue/`.
- M1 contract: `.spectra/plans/2026-08-25-calendar-event-detail-m1.md`.
- Existing seams: `jin-core/src/config.rs`, `jin-core/src/model/event.rs`,
  `jin-core/src/google/`, `jin-core/src/sync/`, `jin-core/src/ops/events.rs`,
  `jin-core/src/ops/sync.rs`, `jin-gui/src-tauri/src/commands/`,
  `jin-gui/src/invoke.ts`, `jin-gui/src/types/dto.ts`, Settings/calendar controllers.
- RAMZA state: `.spectra/plans/google-calendar-multi-account-sync.state.json`.
