# FORGE deliberation — Calendar Event Detail M1

## Decision

Performative: `DECIDE`

[DECISION] Proceed with the RAMZA plan only after applying the amendments below. The selected architecture remains core-authoritative event-detail capabilities plus an explicit `agenda_bucket: flexible`, but both Time block creation and removal/return must use the same application-observable recoverability contract.

The decision preserves the user-facing intent—quiet event management, `Time block`, `Source: Jin`, `Source: Google`, optional return to flexible work—while making crash recovery and synchronization ordering mechanically testable.

## Sources considered

- Frozen RAMZA plan: `.spectra/plans/2026-08-25-calendar-event-detail-m1.md`.
- Frozen criteria hash: `bb61faea0e600b186593fcd828e84d443807accd8264189c2a10dafed75b9367`.
- Current lifecycle manifest: `.spectra/changes/calendar-event-detail-m1/change.json`.
- Object-sovereignty and additive-write decision: `docs/adr/0001-data-model-and-linking.md:66-77,110-128`.
- Current multi-step promotion: `jin-core/src/ops/promote.rs:24-99`.
- Existing note-specific recovery journal: `jin-core/src/ops/recovery.rs:1-7,123-213`.
- Canonical read recovery entry points: `jin-core/src/ops/api.rs:1-24,141-163`.
- RFC-5545 temporal representation: `jin-core/src/model/event.rs:34-150` and `docs/adr/0004-google-calendar-sync.md:64-79,114-125`.

## Trade-off record

### H1 — Keep promotion additive and make only removal recoverable

This minimizes changes to `promote`, but it leaves application-observable partial states: a new Event may exist before its `derived-from` link or before the Task’s flexible marker is cleared. A retry may return an incomplete canonical result. Rejected.

### H2 — Recoverable core operations for both creation and removal/return

Both operations stage durable before/post images and hashes, acquire an operation lock, write through one operation ID, recover before canonical reads, converge canonical files first, then refresh the index and enqueue sync. This is the selected option because it gives the UI one trustworthy success boundary and makes retry/crash behavior deterministic.

### H3 — Database transaction over the derived SQLite index

This gives familiar transaction semantics but violates Jin’s canonical-file authority: SQLite is disposable and cannot be the commit record for Markdown state. Rejected.

## DECIDE amendments

### A1 — Explicit flexible metadata with an ADR exception

[DECISION] Keep `agenda_bucket` as explicit Task metadata. This intentionally departs from ADR-0001’s statement that promotion leaves the Task untouched and that the edge alone represents scheduling (`docs/adr/0001-data-model-and-linking.md:110-128`).

The exception is narrow:

- `agenda_bucket` records agenda-placement intent, not Event identity or Task completion.
- Successful Time block creation clears `flexible`; eligible remove/return sets `flexible`.
- Due date, list, status, priority, content, and identity remain sovereign.

[ACTION] Update ADR-0001 after M1 verification to record this exception and the recoverable-operation boundary. Owner: IDG/architecture documentation. Trigger: before lifecycle archive.

### A2 — Flexible query fails closed

[DECISION] A Task appears in the flexible agenda only when `agenda_bucket=flexible` and canonical status is `todo` or `doing`. Missing, unknown, done, cancelled, or deleted status must not surface it. The index projection must reproduce the canonical predicate and fail closed on malformed/unknown values.

### A3 — Shared recoverable operation protocol

[DECISION] `promote`/create-Time-block and remove/return use application-observable atomicity:

1. Acquire a per-vault operation lock before eligibility revalidation or staging.
2. Recover incomplete operations before every affected canonical read.
3. Revalidate preconditions from canonical files under the lock.
4. Allocate or accept a durable operation ID.
5. Stage complete before/post images plus SHA-256 hashes for every target.
6. Persist and sync the recovery record before the first canonical rename.
7. Apply same-directory atomic replacements.
8. Mark the operation converged before exposing success.
9. Refresh the derived index and enqueue sync only after canonical convergence.

Retries with the same operation ID return the same converged semantic result and never create a second Event or apply a second removal.

### A4 — Deterministic recovery and blocked conflicts

[DECISION] Recovery compares each current canonical hash with the staged hashes:

- Current hash equals the before-image hash: the target is safe to roll forward.
- Current hash equals the post-image hash while the overall operation is incomplete: the target is safe to roll back when recovery selects rollback.
- Current hash matches neither known hash: treat it as newer/divergent canonical data, record a blocked conflict, release no success result, perform no index refresh, and enqueue no provider sync.

Recovery never overwrites unknown newer content. A blocked conflict remains visible and retryable after explicit resolution.

### A5 — Detail-specific capability projection

[DECISION] Add `EventDetailCapabilitiesDto` rather than expanding every Event list row. A shared pure core predicate computes mutability/read-only reason/display kind; both mutation authorization and detail projection consume it. Return-to-flexible eligibility may join Task/Event state only on the detail path.

### A6 — Bounded localization registry

[DECISION] M1’s locale registry initially contains `en` and `pt-BR`, exposes `System Default`, validates any persisted override against the registry, and falls back to System Default on invalid values. M1 localizes only Calendar/Event surfaces; global application localization is out of scope.

### A7 — Provider privacy by allowlist

[DECISION] Google mapping uses an explicit outbound allowlist. `agenda_bucket`, Jin edge/backlink data, local note/link context, localization keys, capability DTOs, and privacy copy have no provider mapping. Allowlist tests fail when a local-only field becomes serializable without an explicit mapping decision.

### A8 — M2 starts with a temporal-losslessness audit

[DECISION] Before recurrence editing design, M2 audits `original_start` across model, index, DTO, provider mapping, and exception identity for value type (`date` versus `date-time`) and timezone/TZID losslessness. Recurrence mutation stays blocked until that audit passes.

## Consequences

- M1 is broader in core/recovery work than the frozen RAMZA plan’s minimum, but the UI scope is narrower and better bounded.
- The existing single-file additive-write invariant remains the default; the explicit `agenda_bucket` and its two lifecycle operations are a documented exception.
- Canonical convergence precedes derived index and provider side effects.
- Blocked conflicts are safe failures, not silent best-effort repair.
- The lifecycle remains `proposed`; this document records deliberation but does not transition it.

## Provenance

- **Scribe version:** IDG 1.10.0.
- **Document type:** FORGE DECIDE deliberation record.
- **Generated:** 2026-08-26.
- **Source artifacts:** frozen RAMZA plan, parent-provided FORGE decisions, current lifecycle manifest, cited ADR/core files.
- **CHT scores:** C:5/5 H:5/5 T:4/5 → DELIVER.
- **Coverage:** all eight FORGE amendments, alternatives, consequences, and deferred ADR/M2 actions are explicit.
- **Flags:** no unresolved `[DISPUTED]`; no inbound ECL envelope was supplied.
