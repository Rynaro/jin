---
spec: engram/1.0
name: jin-linked-domain-invariants
id: egr_46aa32ca
version: 1
intent:
  does: Preserve Jin's stable-ID links, additive promotion, tombstones, backlinks, and one-level task hierarchy
  use_when: changing links, backlinks, attach, promote, delete, parent/subtask, or linked-record edits
  not_when: working on records that neither create nor consume cross-object relationships
capabilities:
  requires: []
  produces: []
  alternatives: []
  conflicts_with: []
relations:
  requires: []
  before: []
  supersedes: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - change note task event links or backlinks
  - promote a task to an event without consuming the task
  - add or edit task parent subtask behavior
  - handle dangling targets or tombstoned linked records
  negative:
  - change an isolated visual preference with no record links
  body_digest: 084ed796e9743505b694ac31e62d30a000423190efb416708641501b70e4efa0
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 084ed796e9743505b694ac31e62d30a000423190efb416708641501b70e4efa0
    content_sha256: 3a9d3def2278e35a7a515fd860cf66c7bd3abd5f5419908a84ed06801aee36f6
  journal:
  - version: 1
    timestamp: '2026-08-18T00:00:00Z'
    author: vivi
    event: authored
    note: Grounded in link, promote, tombstone, and parent tests
legacy:
  plasticity:
    storage_strength: 0.0
    exposure_count: 0
    outcome:
      success: 0
      failure: 0
    last_applied:
    excitability: 0.05
    last_checkpoint:
    status: nascent
  needs:
  - jin-core-operation-pattern
  yields:
  - link-invariant-preserving-change
  composes:
  - jin-sovereign-storage-boundary
  - jin-verification-gates
  context_affinity:
  - jin-core
  - links
  - backlinks
  - promote
  - subtasks
  exports:
    skill_md: true
---
## Procedure
1. Treat ULID-based references as identity links independent of filenames or mutable titles; inspect `jin-core/src/model/edge.rs` and `ops/link.rs`.
2. Store only source-side canonical edges and let `jin-core/src/index/rebuild.rs` derive reverse backlinks.
3. Keep deletion soft through domain tombstone states so references can surface as dangling rather than silently disappearing.
4. Preserve promotion as an additive write: create the event with `derived_from`, leave the task file byte-unchanged, and derive its backlink on rebuild.
5. For task parents, reject self-parenting, missing parents, and depth greater than one in `jin-core/src/ops/tasks.rs`.
6. Verify edit stability, dangling behavior, additive writes, and parent round-trips in `jin-core/tests/m1_dangling_tombstone.rs`, `vg6_additive_write.rs`, `jin/tests/cli_backlinks.rs`, and `s4_tasks_notes_crud.rs`.

## Pitfalls
- Storing both forward and reverse edges canonically creates two sources of truth.
- Renaming a record by changing its stable ID breaks every link.
- Deleting the source task during promotion violates additive-write and sovereignty guarantees.

## Examples
+ Edit a task title while retaining its ID and confirm an event's `derived_from` backlink still resolves.
- Cascade-delete a promoted event when its source task is soft-deleted.

## Provenance
- Derived from the linked-domain models, `ops/link.rs`, `ops/promote.rs`, and end-to-end link tests.
