---
spec: engram/0.2
name: jin-core-operation-pattern
id: egr_2074d709
version: 1
provenance: authored
intent:
  does: "Implement Jin mutations through model validation, ops orchestration, canonical file writes, refresh, and DTO projection"
  use_when: "adding or changing a headless operation consumed by the CLI or Tauri bridge"
  not_when: "the requested behavior is a pure frontend transformation with no core mutation"
triggers:
  positive:
    - "add a Jin core CRUD operation"
    - "change task note event list tag attach link or promote behavior"
    - "expose a new operation to both CLI and GUI"
    - "preserve file-first writes followed by index refresh"
  negative:
    - "refactor a pure TypeScript transform or renderer"
context_affinity: [jin-core, ops, model, store, dto]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-sovereign-storage-boundary]
yields: [shared-headless-operation]
composes: [jin-cli-json-contract, jin-tauri-thin-command-bridge, jin-verification-gates]
inhibits: [jin-gui-controller-transform-render]
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in jin-core operation modules"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Start from the public behavior in `jin-core/src/ops/api.rs` and find the matching domain module under `jin-core/src/ops/` before adding a new abstraction.
2. Parse and validate external strings at the consumer boundary, then pass typed `Create*Params` or `Edit*Params` into the operation.
3. Enforce domain invariants in the operation/model layer before calling `jin-core/src/store/fs.rs`.
4. Write the canonical Markdown record first, then call `ops::api::refresh` in the CLI or Tauri mutation path.
5. Return a DTO from `jin-core/src/dto/`; do not expose filesystem structs or index rows as public contracts.
6. Add a core test for invariants and an integration test through at least one real consumer path.

## Pitfalls
- Duplicating business rules in `jin/src/main.rs` or Tauri commands creates divergent consumers.
- Refreshing before the file write indexes stale state.
- Treating an optional edit field as a clear operation loses the established nested-option and explicit `clear_*` semantics.

## Examples
+ Follow `jin-gui/src-tauri/src/commands/tasks.rs`: parse input, call `ops::tasks`, refresh, and return `TaskDto`.
- Update a task by issuing SQL directly from a command handler.

## Provenance
- Derived from `jin-core/src/ops/api.rs`, `jin-core/src/ops/tasks.rs`, `jin-core/src/store/fs.rs`, and `jin-gui/src-tauri/src/commands/tasks.rs`.
