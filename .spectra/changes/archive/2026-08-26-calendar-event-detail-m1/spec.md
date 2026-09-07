---
eidolon: ramza
version: 1.0.0
kind: spec
status: proposed
created_at: 2026-08-26T00:00:00Z
target_repos:
  - jin
stories_count: 8
validation_gates_count: 39
confidence: 0.90
---

# Milestone 1 — Tranquil Event Detail and Flexible Agenda Return

## Scope

Intent class: CHANGE

[DECISION] Make the individual Event detail the calm canonical management surface, add the exact `Time block` lifecycle, and let the user optionally return an originating Task to a flexible agenda without changing the Task’s sovereign work state.

### In scope

- Summary-first Event detail bounded by the existing reading-width token.
- Exact visible tokens `Time block`, `Source: Jin`, and `Source: Google`.
- Detail-specific `EventDetailCapabilitiesDto` projected by jin-core.
- A shared pure core predicate for display kind, mutation authorization, and deterministic read-only reason precedence.
- `agenda_bucket: flexible` as explicit, orthogonal Task metadata.
- Flexible-agenda query semantics that fail closed unless canonical Task status is `todo` or `doing`.
- Recoverable application-observable atomicity for both create-Time-block/promotion and remove-Time-block/optional-return.
- Durable before/post images and hashes, a per-vault operation lock, operation-ID idempotency, recover-before-read, deterministic hash-based recovery, and blocked conflicts.
- Canonical convergence before index refresh or provider-sync enqueue.
- Explicit Save/Cancel, existing `ConfirmDialog`, canonical detail refetch, and Back restoration of calendar view state.
- Prep notes and Related sections with human search and labels.
- Jin-local context on Google mirrors with provider allowlist enforcement.
- Calendar/Event localization registry initially supporting `en` and `pt-BR`, System Default, and a validated persisted override.
- Core, persistence, migration, bridge, frontend, accessibility, recovery, provider-boundary, browser, and native visual verification.

### Out of scope

- Recurrence editing in M1.
- Google-authoritative Event mutation, RSVP, attendee, conferencing, provider attachment, or provider deep-link work.
- Application-wide localization outside Calendar/Event surfaces.
- Changing Task due date, list, status, priority, body, section, tags, position, reminders, parent, or identity during Time block removal.
- Using SQLite as the canonical transaction record.
- Silently overwriting a canonical file whose current hash matches neither staged before nor staged post state.
- Lifecycle transition, product implementation, or verification by this documentation step.

### Dependency state

The frozen plan prohibited overlap while `calendar-pr47-rescue` was active. In this worktree that change is archived at `.spectra/changes/archive/2026-08-26-calendar-pr47-rescue/`, so implementation may begin only from that archived baseline. AC-001 is preserved verbatim as part of the frozen 33-criterion contract.

### ADR exception

[DECISION] `agenda_bucket` is an explicit, narrow exception to ADR-0001’s additive-write statement that promotion leaves the Task untouched and that the edge alone expresses scheduling (`docs/adr/0001-data-model-and-linking.md:110-128`). It records agenda-placement intent only; Task/Event identity and lifecycle remain separate.

[ACTION] Update ADR-0001 after M1 verification and before lifecycle archive. Owner: IDG/architecture documentation. The update must describe `agenda_bucket`, the create/remove operations that may change it, and the recoverable-operation exception.

### M2 handoff

[ACTION] M2 begins immediately after M1 verification with an `original_start` losslessness audit across model, canonical serialization, index, DTO, Google mapping, and recurrence exception identity. The audit must prove preservation of value type (`date` versus `date-time`) and timezone/TZID before enabling Jin-authoritative recurrence edits.

After that audit, M2 may plan `This occurrence` and `Entire series`; `This and following` remains deferred. Google-authoritative recurrence remains view-only. RFC-5545 lines, exception identity, timezone/DST, sync sequencing, and conflicts remain lossless.

Complexity: full tier; cross-layer persistent-model and recoverability change with a material trade-off.

## Approach

### 1. Core-authoritative detail capabilities

[DECISION] Add a detail-only projection:

```text
EventDetailCapabilitiesDto
  display_kind: event | time-block
  can_edit: bool
  can_delete: bool
  read_only_reason: cancelled | recurring_milestone_1 | external_authority_or_source | null
  can_return_task_to_flexible: bool
  originating_task: optional human reference
```

Do not add return-eligibility joins to every Event list row. A shared pure core predicate consumes Event canonical fields and produces display kind plus event mutation policy. Both `ensure_mutable` and the detail projection call it, eliminating the policy duplication currently visible between `jin-core/src/ops/events.rs:56-79` and `jin-gui/src/controllers/calendar_view_controller.ts:1037-1046`.

Rules:

- `derived_from` present means `display_kind=time-block`, even if the Task is missing or inactive.
- `derived_from` absent means `display_kind=event`.
- Read-only reason precedence is cancelled, then `recurring_milestone_1`, then external authority/source, then mutable.
- Return eligibility additionally requires a mutable Time block, an originating Task with status `todo` or `doing`, and no other non-cancelled Event derived from that Task.
- The core re-evaluates eligibility under the operation lock at commit time.

### 2. Explicit flexible agenda bucket

Add an optional enum-backed `agenda_bucket` field to Task canonical frontmatter, derived-index schema/query/rebuild rows, Rust DTOs, and TypeScript DTOs. Missing legacy values deserialize to no explicit bucket.

The flexible agenda query returns a Task only when both conditions hold:

- `agenda_bucket == flexible`.
- canonical status is `todo` or `doing`.

Unknown, malformed, done, cancelled, deleted, or missing status fails closed. The query must not infer flexibility from due date, list, link count, or absence of a Time block.

Lifecycle:

- Successful create-Time-block clears `flexible`.
- Eligible remove/return sets `flexible` when the user selects the unchecked option.
- Task completion, cancellation, or deletion clears `flexible` in the same canonical transition.
- Removing a Time block never completes, cancels, deletes, moves, or rewrites Task content.

### 3. Shared recoverable operation protocol

[DECISION] Create-Time-block/promotion and remove-Time-block/return use one recoverable operation facility. Filesystem atomic rename remains the per-file primitive; the journal supplies application-observable multi-file convergence.

Each operation:

1. Acquires a per-vault operation lock.
2. Runs recovery before affected canonical reads.
3. Resolves and revalidates canonical preconditions under the lock.
4. Uses a caller-supplied or generated durable operation ID.
5. Stages complete before/post bytes and SHA-256 hashes for every target.
6. Persists and syncs the journal record before the first canonical rename.
7. Applies same-directory atomic replacements.
8. Records canonical convergence.
9. Refreshes the derived index.
10. Enqueues provider sync only after convergence and only for the Event effect.
11. Releases the lock after the durable final state is observable.

#### Create-Time-block targets

- New Event post-image containing temporal fields and `derived_from`.
- Existing active Task post-image with `agenda_bucket` cleared when necessary.
- No separately visible link step may leave an Event without its `derived_from` fact.

Create success is visible only after the Event and affected Task converge. A retry with the same operation ID returns the same Event identity.

#### Remove/return targets

- Existing Event post-image with status cancelled.
- Eligible existing Task post-image with `agenda_bucket=flexible` only when requested.

Remove success is visible only after the Event and optional Task mutation converge. It preserves all Task fields named in AC-017.

#### Recovery matrix

| Current canonical hash | Safe action |
|---|---|
| Equals staged before hash | Roll forward to staged post image |
| Equals staged post hash while operation is incomplete | Roll back to staged before image when the recovery decision is rollback |
| Equals neither staged hash | Record blocked conflict; do not overwrite |

Recovery is idempotent. Blocked conflict is durable and surfaced to callers. It does not refresh the index, enqueue sync, or claim operation success. After explicit resolution, a retry may re-enter recovery using the same operation ID.

The existing recovery journal is note-specific (`jin-core/src/ops/recovery.rs:1-7,123-213`); implementation may factor a generic operation journal while preserving note revision behavior. Canonical reads that depend on Task/Event convergence must call recover-before-read, matching the canonical-first intent of `jin-core/src/ops/api.rs:1-24`.

### 4. Derived state and provider boundary

Canonical convergence precedes:

- SQLite rebuild/refresh.
- mutation notifications.
- Google sync enqueue.
- GUI success feedback.

[DECISION] Google outbound mapping is an explicit allowlist. Provider serialization tests enumerate allowed Event fields and prove omission of:

- `agenda_bucket`.
- Task state/content.
- Jin edge/backlink collections.
- prep notes and related links.
- detail capability DTO fields.
- localization keys and privacy copy.

No reflection/generic flattening may automatically send a new canonical field to Google.

### 5. Tranquil detail interaction

The bounded detail hierarchy is:

1. Back destination plus compact header actions.
2. Title, exact source label, and exact `Time block` label when applicable.
3. Human date, time, location, and timezone only when disambiguating.
4. Description as readable prose.
5. Originating Task for Time blocks.
6. Prep notes and Related objects with human titles and Open actions.
7. Infrequent metadata under More.

Behavior:

- Hide global Add Event from layout and accessibility trees while detail is open.
- Show Edit/Delete for mutable plain Events.
- Show Edit/Remove for mutable Time blocks.
- Show a localized, explicit read-only explanation otherwise.
- Edit mode uses Save/Cancel; blur never commits.
- Remove uses `ConfirmDialog`. The optional `Return task to flexible agenda` checkbox is unchecked and appears only when the core projects eligibility.
- Every successful save, attach, link, remove, or return refetches canonical detail.
- Back restores calendar mode, date, and scroll state.
- Search and rendered relations use human titles; IDs and edge vocabulary stay out of visible copy.

Approved removal copy:

> Remove this Time block?
>
> The task will not be completed or deleted.
>
> ☐ Return task to flexible agenda

### 6. Bounded localization

[DECISION] Introduce a Calendar/Event locale registry with initial entries `en` and `pt-BR`.

- `System Default` resolves from the operating system/browser locale.
- A persisted override is accepted only if it is a registry key.
- Invalid or removed values fall back to System Default.
- Effective locale is passed explicitly to date/time formatters.
- Floating time remains wall time; all-day dates remain date-only; anchored times honor IANA TZID.
- Switching locale rerenders the open Calendar/Event surface without changing canonical data.
- Visible copy, accessible names, dialogs, errors, empty states, status feedback, source labels, and privacy copy are keyed.
- Notes, Tasks, Settings, and global shell localization are not part of M1 except for the minimal Calendar/Event language selector placement required to select the override.

### 7. Google-local context privacy

For `Source: Google`, Jin may attach local notes and links, but the detail must show:

> **Private to Jin**
>
> Attached notes and links stay in Jin. They aren’t shared with Google or event guests.

Success feedback:

> Attached in Jin only.

The copy explains the boundary; the provider allowlist mechanically enforces it.

## Stories

### Story 1: Freeze domain and lifecycle contracts

As an implementer, I want one amended spec of record, so that the rescue baseline and FORGE decisions do not diverge.

Timebox: 1d. Risk: P0. Executor: frontier, explicit contracts.

- Use the archived `calendar-pr47-rescue` baseline.
- Preserve AC-001 through AC-033 exactly.
- Add AC-034 through AC-039 for recoverability.
- Keep lifecycle status proposed until the orchestrator transitions it.

### Story 2: Add flexible agenda persistence and fail-closed query

As a task owner, I want flexible placement to be explicit without changing Task meaning, so that replanning is reversible.

Timebox: 3d. Risk: P0. Executor: frontier, schema/migration detail.

- Add serde-defaulted `agenda_bucket`.
- Update index schema/migration/rebuild/query and both Task DTO paths.
- Implement canonical status guard `todo|doing`.
- Clear the marker on successful scheduling and inactive Task transitions.

### Story 3: Add detail-specific authoritative capabilities

As a user, I want detail actions and explanations to be trustworthy, so that read-only states never feel broken.

Timebox: 3d. Risk: P0. Executor: frontier, typed predicate matrix.

- Add shared pure Event policy predicate.
- Reuse it in core mutation guards.
- Add `EventDetailCapabilitiesDto` only to the detail path.
- Join originating Task/other active blocks for return eligibility.
- Remove GUI policy re-derivation.

### Story 4: Make create-Time-block recoverable

As a task owner, I want scheduling to survive a crash without duplicate or half-linked blocks, so that retries are safe.

Timebox: 5d. Risk: P0. Executor: frontier, operation protocol and failure injection.

- Stage Event and optional Task before/post images and hashes.
- Embed `derived_from` in the Event post-image.
- Clear flexible only in the same recoverable operation.
- Return success after convergence; refresh index and enqueue sync afterward.

### Story 5: Make remove/return recoverable

As a task owner, I want removal to cancel only the block and optionally restore flexible placement, so that work is never lost.

Timebox: 5d. Risk: P0. Executor: frontier, operation protocol and conflict tests.

- Revalidate eligibility under lock.
- Stage Event and optional Task changes.
- Preserve sovereign Task fields.
- Block on divergent current hashes.
- Expose one compound Tauri command.

### Story 6: Build the tranquil detail surface

As a calendar user, I want one quiet commitment view, so that agenda management feels easy.

Timebox: 6d. Risk: P1. Executor: mid, DOM state matrix and accessibility plan.

- Implement bounded hierarchy, exact labels, explicit edit mode, ConfirmDialog flow, contextual sections, refetch, and Back state restoration.
- Preserve visible errors and keyboard/focus behavior.

### Story 7: Localize Calendar/Event and enforce privacy

As a multilingual mixed-calendar user, I want coherent language and local-context clarity, so that actions are predictable.

Timebox: 4d. Risk: P0. Executor: frontier, registry and allowlist tests.

- Register `en` and `pt-BR`, System Default, validated persisted override, and fallback.
- Restrict M1 localization to Calendar/Event.
- Add privacy copy and allowlist provider tests.

### Story 8: Verify recovery and native tranquility

As the product owner, I want mechanical and native evidence, so that correctness and calmness both hold.

Timebox: 5d. Risk: P0. Executor: frontier verification contract.

- Inject failures at every journal, staging, rename, convergence, index, and sync boundary.
- Exercise operation-ID retry and blocked conflict resolution.
- Run core, bridge, frontend, migration, provider allowlist, accessibility, browser, and native Tauri checks.
- Verify compact/standard/wide layouts, light/dark, 100/125/150 percent scaling, reduced motion, `en`, `pt-BR`, and System Default.

## Acceptance Criteria

### AC-001 (state-driven)
GIVEN `.spectra/changes/calendar-pr47-rescue` remains in progress without explicit owner supersession
THEN implementation SHALL make no edit to an overlapping calendar or event file
VERIFY: gate: pre-implementation change-state check plus changed-file inventory

### AC-002 (ubiquitous)
THEN every event-detail capability SHALL be projected by jin-core
VERIFY: test: cargo test -p jin-core event_detail_capabilities

### AC-003 (state-driven)
GIVEN an active Jin-owned non-recurring Event without an originating Task
THEN its detail projection SHALL report `display_kind=event`
VERIFY: test: cargo test -p jin-core event_detail_capabilities::plain_event

### AC-004 (state-driven)
GIVEN an Event carries `derived_from`, including a missing or inactive Task reference
THEN its detail projection SHALL report `display_kind=time-block`
VERIFY: test: cargo test -p jin-core event_detail_capabilities::time_block

### AC-005 (state-driven)
GIVEN a recurring Event from any source
THEN its M1 detail projection SHALL report `can_edit=false`
VERIFY: test: cargo test -p jin-core event_detail_capabilities::recurring_view_only

### AC-006 (state-driven)
GIVEN a Google-authoritative Event
THEN its M1 detail projection SHALL report `can_delete=false`
VERIFY: test: cargo test -p jin-core event_detail_capabilities::google_view_only

### AC-007 (state-driven)
GIVEN an Event has one or more overlapping mutation restrictions
THEN its detail projection SHALL choose the read-only reason by cancelled → recurring_milestone_1 → external authority/source precedence
VERIFY: test: cargo test -p jin-core event_detail_capabilities::reason_matrix

### AC-008 (state-driven)
GIVEN a legacy Task file without `agenda_bucket`
THEN the Task SHALL deserialize with no explicit agenda bucket
VERIFY: test: cargo test -p jin-core serde_default_legacy_task_agenda_bucket

### AC-009 (event-driven)
GIVEN a Task has `agenda_bucket=flexible`
WHEN a new Time block commits successfully
THEN the Task SHALL have no explicit agenda bucket
VERIFY: test: cargo test -p jin-core promote::tests::successful_block_clears_flexible

### AC-010 (event-driven)
GIVEN a Task has `agenda_bucket=flexible`
WHEN the Task becomes done
THEN the Task SHALL have no explicit agenda bucket
VERIFY: test: cargo test -p jin-core tasks::tests::completion_clears_flexible

### AC-011 (event-driven)
GIVEN a Task has `agenda_bucket=flexible`
WHEN the Task becomes cancelled or deleted
THEN the Task SHALL have no explicit agenda bucket
VERIFY: test: cargo test -p jin-core tasks::tests::inactive_clears_flexible

### AC-012 (state-driven)
GIVEN a mutable Time block is the last active block of an active originating Task
THEN its projection SHALL report `can_return_task_to_flexible=true`
VERIFY: test: cargo test -p jin-core event_detail_capabilities::last_block_active_task

### AC-013 (state-driven)
GIVEN another active Time block derives from the same Task
THEN return-to-flexible eligibility SHALL be false
VERIFY: test: cargo test -p jin-core event_detail_capabilities::another_active_block

### AC-014 (state-driven)
GIVEN a Time block has a missing or inactive originating Task
THEN return-to-flexible eligibility SHALL be false
VERIFY: test: cargo test -p jin-core event_detail_capabilities::originating_task_unavailable

### AC-015 (event-driven)
GIVEN an eligible Time block and `return_to_flexible=false`
WHEN the remove operation succeeds
THEN only the Event SHALL become cancelled
VERIFY: test: cargo test -p jin-core remove_time_block::tests::remove_only

### AC-016 (event-driven)
GIVEN an eligible Time block and `return_to_flexible=true`
WHEN the remove operation succeeds
THEN the originating Task SHALL have `agenda_bucket=flexible`
VERIFY: test: cargo test -p jin-core remove_time_block::tests::remove_and_return

### AC-017 (ubiquitous)
THEN Time block removal SHALL preserve the originating Task identity, due date, list, status, priority, body, section, tags, position, reminders, and parent
VERIFY: test: cargo test -p jin-core remove_time_block::tests::preserves_task_fields

### AC-018 (unwanted-behavior)
GIVEN return eligibility changes after detail load
WHEN removal requests `return_to_flexible=true`
THEN the core SHALL reject the stale return request without partially applying it
VERIFY: test: cargo test -p jin-core remove_time_block::tests::revalidates_eligibility

### AC-019 (unwanted-behavior)
GIVEN a crash is injected between canonical writes
WHEN startup recovery runs
THEN canonical Event and Task state SHALL converge to the journaled transaction invariant
VERIFY: test: cargo test -p jin-core remove_time_block::tests::recovers_each_crash_boundary

### AC-020 (event-driven)
GIVEN a completed remove transaction
WHEN the same request is retried
THEN the operation SHALL return the canonical completed result without additional semantic mutation
VERIFY: test: cargo test -p jin-core remove_time_block::tests::retry_idempotent

### AC-021 (ubiquitous)
THEN Google provider payloads SHALL omit `agenda_bucket` and Jin-local context edges
VERIFY: test: cargo test -p jin-core google::mapping::tests::local_context_never_serialized

### AC-022 (state-driven)
GIVEN event detail is visible
THEN the global Add Event control SHALL be hidden from layout and accessibility trees
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-023 (state-driven)
GIVEN a mutable plain Event detail
THEN the header SHALL expose Edit and Delete actions
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-024 (state-driven)
GIVEN a mutable Time block detail
THEN the destructive header action SHALL be labelled Remove
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-025 (state-driven)
GIVEN an eligible Time block removal confirmation
THEN it SHALL show an unchecked `Return task to flexible agenda` checkbox
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-026 (state-driven)
GIVEN an ineligible Time block removal confirmation
THEN it SHALL contain no return-to-flexible checkbox
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-027 (event-driven)
GIVEN event edit mode contains unsaved changes
WHEN Cancel is activated
THEN canonical Event data SHALL remain unchanged
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-028 (event-driven)
GIVEN a detail mutation succeeds
WHEN the command resolves
THEN the detail SHALL refetch canonical Event data before rendering success
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-029 (event-driven)
GIVEN detail was opened from a calendar mode, date, and scroll position
WHEN Back is activated
THEN that calendar state SHALL be restored
VERIFY: Playwright MCP: calendar detail return-state scenario

### AC-030 (state-driven)
GIVEN the system locale is active
THEN event detail copy and temporal formatting SHALL use the system locale
VERIFY: test: pnpm vitest run src/__tests__/event_locale.test.ts

### AC-031 (event-driven)
GIVEN a supported language override is selected
WHEN event detail rerenders
THEN its visible and accessibility copy SHALL use the override
VERIFY: test: pnpm vitest run src/__tests__/event_locale.test.ts

### AC-032 (state-driven)
GIVEN a Google-source event detail offers local context actions
THEN it SHALL display the approved `Private to Jin` privacy copy
VERIFY: test: pnpm vitest run src/__tests__/events_controller.test.ts

### AC-033 (state-driven)
GIVEN the native detail surface at supported widths, themes, scaling, languages, and reduced-motion settings
THEN the summary hierarchy SHALL remain readable without clipped primary actions or unintended horizontal scrolling
VERIFY: evidence: Playwright artifacts plus owner native Tauri visual sign-off

### AC-034 (unwanted-behavior)
GIVEN a crash is injected during create-Time-block after any staged write boundary
WHEN operation recovery runs
THEN application-visible Task and Event state SHALL converge before create success is returned
VERIFY: test: cargo test -p jin-core promote::tests::recovers_each_create_boundary

### AC-035 (event-driven)
GIVEN a create or remove request reuses a completed operation ID
WHEN the request is retried
THEN the core SHALL return the original semantic result without creating or applying a second mutation
VERIFY: test: cargo test -p jin-core recoverable_operations::tests::operation_id_idempotent

### AC-036 (event-driven)
GIVEN a create or remove operation passed canonical precondition checks
WHEN its first canonical write is attempted
THEN a locked durable recovery record SHALL already contain every target before image, post image, and SHA-256 hash
VERIFY: test: cargo test -p jin-core recoverable_operations::tests::stages_under_lock_before_write

### AC-037 (state-driven)
GIVEN an affected Task or Event canonical read is requested while an operation is incomplete
THEN the read path SHALL run operation recovery before returning canonical data
VERIFY: test: cargo test -p jin-core recoverable_operations::tests::recover_before_read

### AC-038 (state-driven)
GIVEN an incomplete operation target matches a staged before or post hash
THEN recovery SHALL apply the deterministic mapping `{before: roll-forward, post: rollback}`
VERIFY: test: cargo test -p jin-core recoverable_operations::tests::known_hash_recovery_matrix

### AC-039 (unwanted-behavior)
GIVEN an incomplete operation target matches neither staged before nor staged post hash
WHEN recovery inspects the target
THEN recovery SHALL persist a blocked conflict without canonical overwrite, index refresh, or sync enqueue
VERIFY: test: cargo test -p jin-core recoverable_operations::tests::divergent_hash_blocks

## Confidence

90% → AUTO_PROCEED after FORGE amendments.

- Requirements are locked and the rescue dependency is archived.
- The core policy and UI boundaries are explicit.
- Recovery remains the highest-risk slice; 6 criteria and failure injection bind its behavior.
- Native visual sign-off remains an implementation exit gate.

## Rejected Alternatives

- **Presentation-only redesign:** retains duplicated policy and cannot provide safe return semantics.
- **Infer flexibility from due/list/no-block:** conflates scheduling intent with deadlines or organization and cannot represent an explicit return choice.
- **Make only remove recoverable:** leaves promotion/create able to expose an Event before its link or Task marker convergence.
- **Two GUI commands for removal and Task update:** exposes partial state and stale eligibility races.
- **SQLite transaction as authority:** contradicts canonical Markdown and rebuildability.
- **Unknown-hash overwrite:** can destroy newer external or concurrent canonical edits.
- **Global localization in M1:** expands scope beyond the Calendar/Event commitment surface.
- **Provider denylist:** new local fields could leak by omission; explicit allowlist fails safer.
- **Recurrence editing before temporal audit:** risks loss of `original_start` value type or timezone identity.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| ADR-0001 exception drifts from implementation | P0 | Amend with the core implementation; final validation must confirm alignment before archive |
| Promotion exposes half-created Time block | P0 | Shared recoverable protocol; AC-034–AC-038 |
| Multi-file removal exposes partial return | P0 | Same protocol; preserved AC-015–AC-020 |
| Concurrent or external edit is overwritten | P0 | Hash matrix and durable blocked conflict AC-039 |
| Lock deadlock or stale lock blocks startup | P0 | Scoped lock ownership, crash fixtures, idempotent recovery, visible error |
| Index or sync observes pre-convergence state | P0 | Side effects ordered after convergence and absent on conflict |
| Flexible query surfaces inactive work | P0 | Canonical `todo|doing` guard; fail-closed fixtures |
| Capability policy diverges across DTO and mutation | P0 | Shared pure predicate and detail-only DTO |
| Local context reaches Google | P0 | Explicit outbound allowlist and serialization tests |
| Invalid locale override breaks Calendar | P1 | Registry validation and System Default fallback |
| Calendar-only localization leaves mixed global shell copy | P2 | Explicitly bounded M1 scope; no claim of global localization |
| Browser QA is mistaken for native proof | P1 | Separate native Tauri evidence and owner sign-off |

## Implementation Slices and Dependencies

| Slice | Primary evidence/files | Deliverable | Depends on |
|---|---|---|---|
| L0 lifecycle baseline | `.spectra/changes/archive/2026-08-26-calendar-pr47-rescue/` | archived dependency evidence | none |
| C1 recovery facility | `jin-core/src/ops/recovery.rs`, `jin-core/src/store/fs.rs` | lock, staged images/hashes, operation IDs, conflict state | L0 |
| C2 flexible model | `jin-core/src/model/task.rs`, `jin-core/src/model/mod.rs`, `jin-core/src/dto/task.rs`, `jin-core/src/dto/event.rs`, `jin-core/src/dto/mod.rs`, index schema/query/rebuild | `agenda_bucket`, DTO re-exports, migration, fail-closed query | C1 |
| C3 detail predicate | `jin-core/src/ops/events.rs`, detail DTO/API | shared pure policy, `EventDetailCapabilitiesDto` | C2 |
| C4 create-Time-block | `jin-core/src/ops/promote.rs`, link/event ops | recoverable create and clear-flexible | C1, C2, C3 |
| C5 remove/return | new/factored core op | recoverable cancel and optional flexible return | C1, C2, C3 |
| B1 bridge | `jin-gui/src-tauri/src/commands`, `jin-gui/src-tauri/src/error.rs`, bridge tests, `jin-gui/src/types/dto.ts`, `jin-gui/src/types/error.ts`, `jin-gui/src/invoke.ts`, operation-ID call sites | detail DTO parity, structured errors, one compound command per operation | C4, C5 |
| P1 provider | `jin-core/src/google/mapping.rs`, sync-state tests | explicit allowlist and post-convergence enqueue | C4, C5 |
| U1 locale | new Calendar/Event locale registry, settings selector, formatters | `en`, `pt-BR`, System Default, validated override | B1 |
| U2 detail | event render/controller/styles/index HTML | tranquil detail and contextual actions | B1, U1 |
| V1 verification | core/bridge/gui tests, Playwright artifacts, native QA | mechanical evidence and sign-off | all |

Execution order: `L0 → C1 → C2 → C3 → C4/C5 → B1/P1 → U1 → U2 → V1`.

## Migration and Rollout

1. Add serde-defaulted `agenda_bucket`; do not eagerly rewrite legacy Tasks.
2. Add versioned index migration and prove rebuild parity from canonical files.
3. Ship recovery primitives and tests before changing promotion or removal.
4. Migrate promotion first behind operation-ID tests, then removal/return.
5. Ship core detail DTO before enabling GUI mutation actions.
6. Add locale registry and provider allowlist before native sign-off.
7. Keep recurring Event mutation disabled throughout M1.
8. Keep the implementation-time ADR-0001 amendment aligned, validate it before archive, and then start the M2 `original_start` audit.

Rollback must not strip `agenda_bucket` or discard unresolved operation journals. A rollback build must tolerate the new optional Task key and blocked-conflict records; otherwise release uses a forward fix.

## Verification Plan

- `cargo test -p jin-core` including failure injection at every operation boundary.
- Tauri bridge tests for typed detail capabilities and compound commands.
- Google mapping allowlist tests plus sync enqueue ordering tests.
- Frontend unit tests for detail state matrix, exact copy, locale registry, override fallback, refetch, and Back restoration.
- EARS lint over all 39 criteria.
- Tonberry conformance in recorded `block` mode.
- Deterministic Playwright MCP evidence for Calendar/Event surface.
- Native Tauri visual QA and owner sign-off, explicitly distinct from browser evidence.

## Provenance

- **Scribe version:** IDG 1.10.0.
- **Document type:** amended full-tier ESL implementation specification.
- **Generated:** 2026-08-26.
- **Source artifacts:** frozen RAMZA plan and 33 frozen criteria; FORGE DECIDE amendments supplied by the orchestrator; lifecycle manifest; cited ADR/core/UI evidence; archived rescue baseline.
- **CHT scores:** C:5/5 H:5/5 T:4/5 → DELIVER.
- **Coverage:** 8 stories, 39 EARS criteria, file-level sequence, recovery model, localization boundary, provider privacy, migration/rollout, risks, ADR action, and M2 audit.
- **Flags:** native visual sign-off and final validation of the implementation-time ADR amendment remain archive gates; no source dispute remains.
