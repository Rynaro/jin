---
spec: engram/0.2
name: jin-rfc5545-time-discipline
id: egr_e3437c59
version: 1
provenance: authored
intent:
  does: "Preserve RFC-5545 temporal distinctions, IANA timezone identity, and explicit DST resolution policy"
  use_when: "changing events, agenda dates, due timestamps, recurrence-ready fields, timezone conversion, or Google time mapping"
  not_when: "sorting records by non-temporal fields or changing unrelated UI layout"
triggers:
  positive:
    - "change all-day timed or floating event handling"
    - "resolve an IANA timezone or daylight saving transition"
    - "modify RFC 5545 event fields or recurrence-ready storage"
    - "map Google Calendar times into Jin events"
  negative:
    - "sort tasks alphabetically without interpreting dates"
context_affinity: [jin-core, rfc5545, timezone, dst, events]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-core-operation-pattern]
yields: [temporally-correct-change]
composes: [jin-google-sync-safety, jin-verification-gates]
inhibits: []
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in event model and VG9"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Model dates and date-times distinctly using `TemporalValue` and `ValueType` in `jin-core/src/model/event.rs`; do not infer all-day from midnight.
2. Preserve `floating`, `start_tzid`, and `end_tzid` separately so a wall time is never silently converted into a fixed instant.
3. Validate IANA zone names and resolve anchored wall time through `jin-core/src/time/mod.rs`.
4. Honor the explicit DST policy: use the earlier instant for fall-back ambiguity and shift one hour forward for a standard spring gap, surfacing the warning note.
5. Keep canonical RFC-5545-ready fields in event frontmatter while treating expanded occurrences as derived index data.
6. Run `jin-core/tests/s5_temporal_correctness.rs` and adjacent event/agenda integration tests for disk round-trip and UTC projection behavior.

## Pitfalls
- Using the host local timezone implicitly makes results machine-dependent.
- Collapsing all-day, floating, and zoned date-times into one timestamp loses user intent.
- Calling `unwrap()` on `chrono_tz::LocalResult` hides DST ambiguity and gaps.

## Examples
+ Store an all-day event as date values with no tzid and verify it remains all-day after rebuild.
- Convert every 09:00 floating event to UTC using the machine timezone.

## Provenance
- Derived from `jin-core/src/model/event.rs`, `jin-core/src/time/mod.rs`, ADRs, and `s5_temporal_correctness.rs`.
