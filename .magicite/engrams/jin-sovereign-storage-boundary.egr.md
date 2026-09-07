---
spec: engram/0.2
name: jin-sovereign-storage-boundary
id: egr_a81df514
version: 1
provenance: authored
intent:
  does: "Preserve Jin's canonical human-readable files, derived SQLite index, and operational sync-state boundary"
  use_when: "changing persistence, export, indexing, store layout, or any code that could make SQLite authoritative"
  not_when: "working only on presentation styling with no persistence or export effect"
triggers:
  positive:
    - "change Jin canonical storage or the .jin index"
    - "add persisted fields to notes tasks events lists or tags"
    - "modify export sovereignty or deterministic index rebuild behavior"
    - "decide whether data belongs in owner files index or sync state"
  negative:
    - "adjust a GUI-only CSS token without touching persisted data"
context_affinity: [jin-core, storage, sovereignty, index, export]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: []
yields: [sovereignty-preserving-storage-change]
composes: [jin-core-operation-pattern, jin-verification-gates]
inhibits: [jin-gui-controller-transform-render]
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in ADR 0002 and rebuild/export gates"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Classify every byte as canonical owner data, derived index data, or operational sync state using `docs/adr/0002-storage-format.md` and `jin-core/src/config.rs`.
2. Put canonical records through `jin-core/src/model/` plus `jin-core/src/store/fs.rs`; never make `.jin/index.sqlite` the only copy of user meaning.
3. Route reads through `jin-core/src/ops/api.rs` DTOs and keep raw SQLite rows private to `jin-core/src/index/`.
4. After canonical writes, refresh the derived projection through `ops::api::refresh`; keep rebuild ordering deterministic.
5. Check export inclusions and exclusions in `jin-core/src/ops/export.rs`, especially that tokens and volatile sync files never enter the sovereign export.
6. Verify with `jin-core/tests/vg1_rebuild_equivalence.rs`, `vg4_no_direct_sqlite.rs`, `vg6_additive_write.rs`, and `jin/tests/s8_export_sovereignty.rs`.

## Pitfalls
- Writing a field only to SQLite makes a disposable cache authoritative and violates the core storage decision.
- Exporting `.jin/sync/tokens.enc`, `outbox.jsonl`, or `sync-state.sqlite` leaks secrets or operational state.
- Rebuilding from filesystem iteration without deterministic sorting can make machines diverge.

## Examples
+ Add a task field to Markdown frontmatter, project it in rebuild, expose it through a DTO, then extend rebuild/export tests.
- Add a GUI query that reads `.jin/index.sqlite` directly because it appears faster.

## Provenance
- Derived from `docs/adr/0002-storage-format.md`, `jin-core/src/store/fs.rs`, `jin-core/src/ops/api.rs`, and sovereignty verification tests.
