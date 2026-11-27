---
spec: engram/1.0
name: jin-capture-review-conversion
id: egr_8da71d38
version: 1
intent:
  does: Preserve Capture Review state and safe conversion of captured notes into linked records.
  use_when: Changing review defer or process actions, return dates, review queues, captured-note task creation,
    or event attachment.
  not_when: Editing standalone notes without Capture Review state.
compatibility: {}
capabilities:
  requires: []
  produces: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - capture review
  - defer captured note
  - convert capture to task
  negative:
  - standalone note editing
  body_digest: a7046a7744b9ede01a60f293ce5561ee026361a0dc89a5ccfcd7b6118d541e69
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: a7046a7744b9ede01a60f293ce5561ee026361a0dc89a5ccfcd7b6118d541e69
assets: {}
extensions: {}
---
## Procedure
1. Read `jin-core/src/model/review.rs`, `ops/capture_review.rs`, and `ops/linked_creation.rs` before changing the UI contract.
2. Preserve Pending, Deferred, and Processed meanings. Require `return_on` for a Deferred item and allow conversion only from an open review item.
3. Use the linked-creation operation with the expected note revision. It creates a task and source-side reference together, or attaches the note to an existing event with `prep_for`, then marks the source Processed only after the operation converges.
4. Retry a lost response only with the same operation ID and identical input, which returns the converged result. A fresh conversion after processing must reject the closed review item.
5. Refresh review counts and queue rendering from returned state after a mutation.
6. Run `cargo test -p jin --test capture_review_cli`, focused core review tests, `pnpm --dir jin-gui exec vitest run src/__tests__/capture_review.test.ts`, and relevant linked-creation tests.

## Pitfalls
- A deferred item without a return date cannot re-enter review predictably.
- A stale second conversion click must not create another task, attach another event, or resurrect an open review item.

## Examples
+ Defer a captured note to a stated date, then create its linked task or attach its note to an existing event while transitioning the source to Processed.
- Create an independent calendar event → not this engram.

## Provenance
- Derived from Capture Review models, linked-creation operations, CLI coverage, and GUI review tests.
