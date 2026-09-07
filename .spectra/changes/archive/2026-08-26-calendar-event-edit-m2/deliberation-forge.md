# FORGE Deliberation — calendar-event-edit-m2

- Verdict: `one-off-only`
- Lifecycle decision: `DECIDE`
- Decision gate: DG-01 resolved; DG-02 dormant
- Date: 2026-08-26

## Decision

M2 will edit only active, Jin-authoritative, non-recurring plain Events and Time blocks. Every recurring master and occurrence remains view-only. Recurrence becomes a dedicated follow-up beginning with temporal-losslessness remediation; only after that foundation passes may a later milestone offer Jin-only `This occurrence` and `Entire series`. `This and following` and every Google recurrence mutation remain deferred.

## Evidence

The current repository cannot identify and round-trip an occurrence losslessly:

- `EventFrontmatter.original_start` is `Option<TemporalValue>` but has no dedicated value-type, floating, or TZID companion (`jin-core/src/model/event.rs`).
- Index rebuild renders `original_start` to one string column; `EventRow` and its DTO projection omit the field (`jin-core/src/index/{schema,rebuild,query}.rs`, `jin-core/src/dto/event.rs`).
- Rust and TypeScript DTOs expose only `original_start: string | null`, losing explicit temporal semantics at the bridge (`jin-core/src/dto/event.rs`, `jin-gui/src/types/dto.ts`).
- Google inbound mapping discards the parsed `originalStartTime` value type and TZID; outbound mapping reuses `event.start_tzid` (`jin-core/src/google/mapping.rs`).
- Current mutation policy deliberately rejects any recurrence marker (`jin-core/src/ops/events.rs`).

The archived M1 evidence confirms the bounded detail surface, focus/modal behavior, responsive presentation, and native owner approval. No concrete native or accessibility evidence contradicts detail-resident editing, so DG-02 is not activated.

## Trade-off

Adding `This occurrence` plus `Entire series` now offers visible user value, but it would combine four distinct risk systems with the already substantial edit milestone: temporal schema repair, exception/master identity, recoverable multi-file mutation, and series-aware stale-conflict UX. A wrong occurrence target or DST normalization is quiet data corruption—the opposite of tranquil agenda management.

Keeping M2 one-off-only delivers the higher-frequency edit path sooner, keeps each Save a recoverable single-Event operation, preserves a simple conflict model, and allows recurrence foundations to be verified independently. The extra milestone boundary is deliberate risk containment, not abandonment of the differentiator.

## Follow-up entry criteria

A recurrence-foundation change must prove before recurrence editing design:

1. `original_start` preserves date/date-time type, wall value, floating/anchored semantics, and occurrence-specific IANA TZID across canonical YAML, index rebuild/query, Rust/TypeScript DTOs, and Google mapping.
2. Exception-to-master identity and DST-boundary fixtures round-trip without normalization drift.
3. `This occurrence` defines exception creation/update and sequence semantics.
4. `Entire series` defines master updates, existing exceptions, and recoverable multi-file convergence.
5. Series/occurrence stale conflicts preserve drafts and never auto-write.

## Exact Vivi boundary

Vivi may implement M2 S1–S6 for active Jin-owned non-recurring Events and Time blocks only: core capability authorization, opaque edit tokens, idempotent recoverable single-Event edits, detail-resident Save/Cancel, draft-preserving conflicts, canonical refetch, focus restoration, localization, and mouse/keyboard parity. Vivi must not add recurrence selectors, mutate recurrence metadata, repair `original_start`, change Google authority, or substitute a modal absent new contradictory evidence and a reopened FORGE decision.

## Memory preflight

Crystalium recall and execution checkpoint were attempted as required, but the MCP transport was closed. The lifecycle already records `memory_preflight.ran=true` with zero records; no direct memory-store access was attempted.
