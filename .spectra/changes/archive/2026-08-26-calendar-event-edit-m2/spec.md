---
eidolon: ramza
version: 1.0.0
kind: spec
status: deliberated
created_at: 2026-08-26T00:00:00Z
target_repos:
  - jin
stories_count: 6
validation_gates_count: 18
confidence: 0.88
---

# Milestone 2 — Tranquil Event Editing

## Outcome

Make editing an individual calendar item feel like a quiet continuation of its detail view: explicit, reversible, keyboard-complete, conflict-safe, and governed by Jin core capabilities. This milestone extends the approved M1 surface; it does not rebuild the event editor from zero.

## Current-capability audit

The archived M1 already delivers meaningful edit behavior:

- A core `EventDetailCapabilitiesDto.can_edit` decision for Jin-owned, non-recurring, non-cancelled items.
- An Edit action on mutable plain Events and Time blocks.
- A shared create/edit modal with title, date, all-day, start/end time, location, and description.
- Explicit Save and Cancel; Cancel does not mutate canonical data.
- Core mutation guards that preserve identity, source, authority, links, body, and recurrence metadata.
- Calendar/index refresh after save.

M2 therefore targets the gaps rather than duplicating CRUD:

- Editing currently leaves the calm detail surface for a reused creation modal.
- The GUI re-derives mutability in `CalendarViewController.isMutable` instead of trusting the detail capability projection end to end.
- The edit command has no optimistic concurrency token, operation identity, or structured conflict response.
- A successful save refreshes calendar data indirectly; the edit contract does not itself guarantee canonical detail refetch and focus restoration.
- Keyboard behavior, no-op saves, draft preservation on error, and native visual calm are not acceptance-locked.
- `original_start` does not carry an explicit value type or TZID through every representation, so recurrence mutation remains unsafe.

## Scope

### In scope

- A detail-resident edit state for currently mutable Jin-owned, non-recurring plain Events and Time blocks.
- Existing editable fields only: title, date, all-day, start/end time, location, and description.
- Core-issued opaque edit tokens derived from the current canonical Event bytes, checked under the vault operation lock.
- Idempotent edit operation IDs and recoverable single-Event convergence using the existing recoverable-operation facility.
- Structured stale-edit conflicts that preserve the user's draft and refetch the latest canonical detail without overwriting it.
- Canonical detail refetch after save, followed by return to reading state with focus restored to Edit.
- Exact `Time block`, `Source: Jin`, and `Source: Google` labels throughout read and edit states.
- Full mouse and keyboard parity, localized visible/accessibility copy, and native/browser visual verification.
- A core capability boundary that keeps every recurring master and occurrence read-only during M2.

### Out of scope

- Editing a recurrence occurrence or series.
- `This occurrence`, `Entire series`, or `This and following` mutations.
- Any Google-authoritative Event mutation, RSVP, attendee, conferencing, provider attachment, or provider deep-link mutation.
- Remediating `original_start` value-type/TZID loss, exception identity, recurrence expansion, or series mutation semantics; these belong to a dedicated recurrence-foundation change.

### Additional out of scope

- Editing cancelled Events.
- Editing Task state or content from a Time block edit.
- Changing `derived_from`, source, authority, `ical_uid`, recurrence identity, backlinks, prep notes, or Related links through the edit form.
- Autosave or blur-to-save.
- Application-wide localization.

## Capability and source matrix

| Canonical item | Read | Enter edit | Save | Delete/remove | Notes |
|---|---:|---:|---:|---:|---|
| Jin plain Event, active, non-recurring | yes | yes | yes | Delete | Existing capability, hardened in M2 |
| Jin Time block, active, non-recurring | yes | yes | yes | Remove | Edit never mutates originating Task or `derived_from` |
| Google plain Event | yes | no | no | no | Local prep/related context remains available and private to Jin |
| Google Time block-shaped mirror | yes | no | no | no | Authority wins over display kind |
| Jin recurring master or occurrence | yes | no | no | no | Dedicated recurrence-foundation follow-up |
| Google recurring master or occurrence | yes | no | no | no | Permanently view-only in this milestone |
| Any cancelled Event or Time block | yes | no | no | no | Cancelled reason keeps highest precedence |

## Interaction contract

### Calm detail-to-edit flow

1. Edit transforms the same bounded detail content into a form; the route, selected date, scroll context, source label, and Time block label remain stable.
2. Focus moves to Title. Save and Cancel occupy the existing compact header action area; destructive actions and context attachment actions are unavailable while editing.
3. Blur never commits. A no-op Save performs no canonical write and returns to reading state.
4. Successful Save refetches canonical Event detail before showing localized success feedback, restores reading state, and returns focus to Edit.
5. Cancel discards only the in-memory draft, refetches nothing, restores the original reading state, and returns focus to Edit.

### Keyboard and mouse parity

- Mouse/touch: Edit, field controls, Save, and Cancel are operable with existing Jin target sizes.
- Keyboard: Tab/Shift+Tab follow visual order; `Escape` performs Cancel; `Mod+Enter` performs Save; Enter in Description inserts a newline and never submits.
- While a save is in flight, Save is disabled, repeated activation is ignored, and focus remains within the edit surface.
- Validation and conflict messages use `aria-live`, associate field errors with controls, and never move focus unexpectedly.

### Conflict, recovery, and error behavior

- Detail load returns an opaque `edit_token` derived from canonical Event bytes. Save supplies `event_id`, `edit_token`, and `operation_id`.
- Under the per-vault operation lock, core recovers incomplete operations, reloads the Event, re-evaluates mutation policy, and compares the token before staging a write.
- A stale token returns a typed conflict without canonical write, index refresh, sync enqueue, or success notification.
- On conflict, Jin preserves the draft, refetches latest canonical detail, and shows a calm inline comparison for changed editable fields with explicit `Use latest` and `Review my draft` choices. Neither choice writes. A later Save uses a fresh token and a new operation ID.
- A retry with the same completed operation ID returns the original semantic result. Divergent recovery hashes remain blocked and fail closed.
- Validation, conflict, blocked-recovery, and unexpected errors leave the draft intact and keep Save available when retry is safe.

## Temporal-losslessness verdict

FORGE found that recurring edits are unsafe in the current representation:

- Canonical `original_start` distinguishes date from date-time in memory, but it has no dedicated value-type, floating, or TZID fields.
- The derived index stores only a rendered string for `original_start`; list-row projection drops it entirely.
- Rust and TypeScript DTOs expose only `original_start: string | null`, so value type and timezone semantics cannot survive the boundary explicitly.
- Google inbound mapping discards the value type and timezone returned for `originalStartTime`; outbound mapping reuses the Event start TZID instead of an occurrence-identity TZID.
- No safe contract currently defines exception materialization, series sequence changes, DST-boundary identity, or recoverable master-plus-exception writes.

Therefore all recurrence remains view-only in M2. A dedicated recurrence-foundation change must first make `original_start` lossless across canonical serialization, index, DTOs, and provider mapping, then define exception identity, sequence semantics, DST fixtures, and recoverable multi-file writes. Only a later recurrence-edit milestone may offer Jin-only `This occurrence` and `Entire series`; `This and following` and every Google recurrence mutation remain deferred.

## Decision gates

### DG-01 — Recurrence edit scope (resolved)

[DECISION] M2 stays one-off-only. Recurrence moves to a dedicated follow-up because the temporal representation is not lossless enough to target an occurrence safely, and adding recurrence would combine foundational model repair, multi-file recovery, series conflict UX, and the already substantial one-off editing milestone.

The follow-up may consider Jin-only `This occurrence` and `Entire series` after its foundation passes. `This and following` and all Google recurrence remain deferred.

### DG-02 — Edit surface substitution boundary (FORGE only if implementation evidence contradicts the plan)

The planned default is a detail-resident form because it preserves context and best matches the approved tranquil surface. If native accessibility or responsive evidence shows that substituting the detail article cannot preserve focus containment and readable width, FORGE must compare an in-place form with a dedicated JinModal before Vivi changes the interaction architecture.

[DECISION] DG-02 remains dormant. The approved M1 native detail surface and current accessibility contract provide no concrete contradictory evidence.

## Stories and sequence

### S1 — Lock the capability boundary (1d, P0)

- Remove GUI mutation-policy re-derivation from the edit entry path and consume the core detail projection.
- Add core/bridge/GUI contract coverage that every recurring master and occurrence remains view-only and rejected by the edit command.

### S2 — Add conflict-safe edit command (4d, P0; depends on S1)

- Add opaque edit token to detail only.
- Introduce typed edit input/result/error contracts with operation ID.
- Revalidate capability and token under the operation lock.
- Stage/recover the single Event write, then refresh the index and notify only after canonical convergence.
- Preserve non-editable fields byte-for-meaning.

### S3 — Build the detail-resident editor (4d, P1; depends on S2)

- Reuse the current field parsing and temporal-shift behavior behind a dedicated edit form module.
- Keep source/kind identity visible, use Save/Cancel, support no-op detection, and remove the edit dependency on the create modal.
- Keep Time block Task linkage visible but non-editable.

### S4 — Handle conflict and recovery gently (3d, P0; depends on S2, S3)

- Preserve drafts on every failed save.
- Render typed validation, stale, and blocked states inline.
- Refetch latest canonical detail for comparison without replacing the draft.
- Require a new explicit Save for any post-conflict mutation.

### S5 — Complete mouse, keyboard, locale, and focus behavior (2d, P1; depends on S3, S4)

- Lock Tab order, Escape Cancel, Mod+Enter Save, textarea Enter, disabled in-flight behavior, aria-live output, and deterministic focus restoration.
- Verify English and pt-BR rerendering without canonical mutation.

### S6 — Verify tranquility and invariants (3d, P0; depends on S1–S5)

- Run focused core/bridge/GUI suites, complete suites, lint/build, provider-boundary tests, Playwright MCP, and native Tauri owner review.
- Verify supported widths, themes, scaling, locales, reduced motion, and no horizontal overflow.
- Keep browser evidence separate from native proof.

## Acceptance checks

- **AC-001** GIVEN an active Jin-owned non-recurring plain Event WHEN detail capabilities are projected THEN core SHALL report it editable and the detail SHALL expose Edit.
- **AC-002** GIVEN an active Jin-owned non-recurring Time block WHEN detail capabilities are projected THEN core SHALL report it editable without granting any originating-Task mutation.
- **AC-003** GIVEN a Google-authoritative, recurring, or cancelled Event WHEN detail capabilities are projected THEN Edit SHALL be absent and no edit command SHALL be accepted.
- **AC-004** GIVEN a detail enters edit state WHEN the form renders THEN the same route, source label, Time block label when applicable, date context, and bounded reading width SHALL remain stable.
- **AC-005** GIVEN edit state WHEN Cancel or Escape is activated THEN canonical data SHALL remain unchanged and focus SHALL return to Edit in reading state.
- **AC-006** GIVEN edit state contains no changed editable field WHEN Save is activated THEN no canonical write, sequence increment, index refresh, or sync enqueue SHALL occur.
- **AC-007** GIVEN a valid changed draft WHEN Save is activated by click or Mod+Enter THEN exactly one edit operation SHALL begin and repeated activation while pending SHALL be ignored.
- **AC-008** GIVEN Description has focus WHEN Enter is pressed THEN a newline SHALL be inserted and Save SHALL not run.
- **AC-009** GIVEN a detail edit token and unchanged canonical Event WHEN core commits the edit THEN only allowed fields plus updated/sequence SHALL change.
- **AC-010** GIVEN a Time block edit WHEN core commits it THEN `derived_from` and every originating Task field SHALL remain unchanged.
- **AC-011** GIVEN canonical Event bytes changed after detail load WHEN stale Save reaches core THEN core SHALL return a typed conflict without write, refresh, sync enqueue, or success notification.
- **AC-012** GIVEN a typed stale conflict WHEN GUI handles it THEN the draft SHALL remain intact, latest canonical detail SHALL be refetched for comparison, and neither conflict choice SHALL write.
- **AC-013** GIVEN a completed edit operation ID WHEN the same request is retried THEN core SHALL return the original semantic result without a second mutation.
- **AC-014** GIVEN an incomplete edit operation with a divergent canonical hash WHEN recovery runs THEN recovery SHALL block without overwrite, index refresh, or sync enqueue.
- **AC-015** GIVEN a successful edit WHEN the command resolves THEN GUI SHALL refetch canonical detail before success feedback, remain on detail, and restore focus to Edit.
- **AC-016** GIVEN validation, conflict, blocked, or retriable failure WHEN it is rendered THEN the draft SHALL remain intact and localized accessible feedback SHALL identify the next safe action.
- **AC-017** GIVEN any recurring master or occurrence, including one with `original_start` WHEN M2 capability projection or edit authorization runs THEN it SHALL remain view-only and the edit command SHALL reject it without mutation or derived side effects.
- **AC-018** GIVEN browser and native verification at supported widths, themes, scaling, languages, input modes, and reduced motion WHEN edit interactions are exercised THEN primary actions SHALL remain reachable with no clipped content, unintended horizontal scrolling, console error, or keyboard trap.

## Verification commands

Focused commands may be refined by Vivi to match final test names, but the verification envelope must include equivalent coverage:

```sh
cargo test -p jin-core event_edit
cargo test -p jin-gui-tauri events
npm --prefix jin-gui test -- --run src/__tests__/events_controller.test.ts src/__tests__/calendar_view_controller.test.ts src/__tests__/event_edit.test.ts src/__tests__/event_locale.test.ts
cargo test -p jin-core
cargo test -p jin-gui-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
npm --prefix jin-gui test -- --run
npm --prefix jin-gui run build
npm --prefix jin-gui run lint:css
```

Playwright MCP must exercise mouse and keyboard flows, no-op Save, stale conflict, Google/recurring/cancelled view-only states, Jin plain Event, and Jin Time block. Native Tauri verification and owner sign-off remain distinct final evidence.

## Handoff

FORGE resolved DG-01 in favor of a one-off-only M2 and left DG-02 dormant. Vivi may transition the change to `in_progress` and implement S1–S6 within the exact boundary above. Recurrence-foundation work must be proposed as a separate ESL change rather than entering this milestone opportunistically.
