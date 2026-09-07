# Google Calendar multi-account bidirectional sync

## Intent

Evolve Jin's existing Google connector from one configured account/calendar into
an account-isolated, bidirectional integration. Google and Jin-managed events
coexist in the existing unified Month/Week/Day agenda. The complete frozen
implementation plan and EARS contract live at
`.spectra/plans/google-calendar-multi-account-sync.md`.

## Frozen decisions

1. Google-origin events are editable from Jin and sync back to Google.
2. Aliases are account-level labels backed by immutable Jin account IDs.
3. Discover every visible calendar, enable new discoveries by default, and allow
   persistent per-calendar disable.
4. Jin-managed entries can remain Local only or be assigned to one selected
   account/calendar while sharing the unified agenda.
5. Preserve etag/audited conflict safety and prohibit cross-account leakage.

## Baseline and supersession

The archived `calendar-pr47-rescue` change remains the regression baseline for
atomic in-place event mutation, core-owned authorization, half-open projection,
canonical detail routing, visible errors, accessibility, and persistent calendar
views.

This change supersedes ADR-0004's singleton account/calendar and CalendarList
deferral. It also supersedes blanket Google-read-only rules in the rescue and M1
contracts only for provider-supported mutations on a connected, enabled, available
calendar whose current `accessRole` authorizes the operation. M1's core-projected
capabilities, explicit editing, canonical refetch, Back restoration, localization,
and Jin-local privacy boundary remain authoritative.

## Semantic architecture

- `GoogleAccountId` is generated once by Jin, then immutably bound to Google's
  validated stable `(issuer, subject)`. Alias and email are never identity keys;
  reauthentication with another subject is rejected before token replacement.
- OAuth uses account-bound PKCE state. Tokens are stored under immutable account
  IDs in the keyring or `.jin/sync/accounts/<account_id>/tokens.enc`. V2 credential
  APIs never fall back to the singleton slot, and refresh commits use account-scoped
  locks plus an auth generation.
- CalendarList discovery stores every visible calendar, preserving inbound disable
  choices and independently refreshing outbound authorization as
  `owner|writer|reader|freeBusyReader`.
- Event provenance uses optional `EventSyncTarget { account_id, calendar_id }`.
  Aliases and calendar names are display projections, never canonical identity.
- `calendar_sync` is keyed by `(provider, account_id, calendar_id)`.
- `event_sync_map` is keyed by provider/account/calendar/Jin-event/recurrence
  identity, with the same scoped uniqueness for Google event/recurrence identity.
- Outbox operations have their own operation ID plus the exact intent-time provider,
  account, calendar, event, and recurrence identity; no alias/default fallback exists.
- One root-aware mutation service provides recoverable file/outbox coupling for
  CLI, Tauri, promotion, and ordinary event create/edit/delete.
- Google edits use sparse PATCH and `If-Match`; 412 never becomes unconditional
  overwrite. Audit records include scoped identity, operation, base/remote etags,
  redacted attempted delta, remote snapshot, policy, and winner.
- Recurring Google edits are a dependent slice supporting `This occurrence` and
  `Entire series`; `This and following` is rejected without mutation.
- Disconnect clears only account cursors and quarantines its outbox. Permission
  downgrade/revocation also quarantines queued writes. Reconnect/restored permission
  requires explicit per-operation review after discovery; no silent replay/reroute.
- Revocations, disconnects, provider cancellations, and local tombstones carry
  generations that outrank stale writes before any provider request.
- Published cross-destination moves and destructive account removal are deferred.

## Migration and compatibility

Migration is backup-backed, resumable, idempotent, and transactional in effect:
one journal/activation marker gates config, verified token copy, SQLite schema, and
event provenance backfill so recovery exposes complete v2 or intact v1, never mixed
writable state. Missing CalendarList scope preserves local data and marks only the
account `needs_reauth`. A bare legacy `calendar_id=primary` never implies publication.
Identity collisions abort rather than delete data. Current Jin readers and writers
must reject legacy singleton operations before mutation whenever the v2 marker
exists. An already-built historical binary cannot be made aware of a newly
introduced marker by current product code; the pinned VIGIL counterexample records
that boundary. Downgrade and recovery guidance must therefore prohibit using a
historical binary to write an activated v2 root.

## Dependency-ordered stories

| Story | Outcome | Depends on |
|---|---|---|
| S0 | Rescue/M1 retained-versus-superseded matrix and file ownership | — |
| S1 | Immutable account, calendar, and event-route domain types | S0 |
| S2 | Singleton config/token/DB/event migration and rollback guards | S1 |
| S3 | Account-bound OAuth, token namespaces, reauth/disconnect | S1, S2 hook |
| S4 | CalendarList discovery, enablement, availability, access roles | S3 |
| S5 | Composite cursor/mapping/outbox schema and scoped cleanup | S1, S2, S4 |
| S6 | Recoverable mutation service and exact-route outbox wiring | S4, S5 |
| S7 | Google-origin edit/delete plus scoped recurrence and conflict safety | S6 |
| S8 | Isolated aggregate sync, pause/resume, partial summaries | S3, S5-S7 |
| S9 | DTO, Tauri, CLI, Settings, destination picker, unified calendar UI | S8, M1 boundary |
| S10 | Automated isolation/migration/UI evidence plus separate live smoke | S0-S9 |

## Verification and live caveat

VIGIL is the identity-distinct checker and Tonberry enforcement is `block`.
Automated acceptance uses migration phase/crash fixtures, current-code legacy
singleton guards plus the pinned historical-binary counterexample,
issuer/subject and concurrent-refresh tests, provider/account/calendar/event/
recurrence collision cases,
mock HTTP CalendarList/events responses, crash injection, scoped 410/412 cases,
Rust/TypeScript DTO parity, CLI/bridge tests, controller tests, and deterministic
Playwright evidence. Native Tauri appearance requires owner sign-off.

A disposable two-account Google smoke run validates live scope/discovery/edit/
routing/disable/conflict fidelity. Its absence does not invalidate hermetic ESL
verification, but release evidence must state `live-unvalidated` and must not claim
current Google end-to-end proof.

## Deliberation reconciliation

FORGE's conditional no-go is closed by AC-GCAL-040 through AC-GCAL-054. These bind
stable provider subject, transactional migration, current-code fail-closed legacy
guards with an explicit historical-binary limitation, credential
no-fallback, refresh locking, schema identities, independent inbound/outbound policy,
quarantine/review, intent-time routes, complete 412 audit, disconnect/reconnect,
separate destructive removal, and stale-write precedence. Vivi tracks cross hard
`A → B → C → D` barriers; only read-only preparation may overlap.

## TRANCE evaluation

G3 used two clean-context candidates, identity stripping, reversed presentation
order, length normalization, deterministic anchors, independent evaluation, and a
three-cycle hard cap. Candidate scores were 73.0 and 76.5. Cycle 2 scored 84.0 and
surfaced access-role/key/disconnect gaps. Cycle 3 closed them and scored 87.0
(`elite`, PASS). No further evaluation cycle is permitted.
