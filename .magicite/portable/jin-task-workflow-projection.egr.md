---
spec: engram/1.0
name: jin-task-workflow-projection
id: egr_d8650137
version: 1
intent:
  does: Keep task workflow setup and board projection consistent from core operation through visible task
    projection.
  use_when: Changing initial workflow setup, board columns, task moves, filters, or board subtask display.
  not_when: Changing an isolated task field outside workflow presentation.
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
  - task board workflow
  - initial list board setup
  - board column movement
  negative:
  - isolated task field
  body_digest: 07f5d5d9d1f0f856863d39ee4a508ba37455443431a77e48445768381ad5f979
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 07f5d5d9d1f0f856863d39ee4a508ba37455443431a77e48445768381ad5f979
assets: {}
extensions: {}
relations:
  requires:
  - id: egr_46aa32ca
    version: 1
---
## Procedure
1. Trace the change through `jin-core/src/ops/workflows.rs`, `jin-core/src/ops/lists.rs`, and the task controller plus `jin-gui/src/lib/tasks/` transforms and renderers.
2. Keep setup preview and apply separate. Setup applies only to an unconfigured legacy list, rejects Inbox as a Board, and hashes the target, list, and every member task before Apply. A stale uncommitted preview needs a fresh preview. The operation journal may replay a converged result for its original operation identity.
3. Keep the full board family available before filtering. Render and select only visible cards while retaining parent-child context and child progress.
4. Preserve the one-level parent invariant through the linked-domain operation rather than duplicating it in the renderer.
5. Run focused workflow/list Rust tests, `pnpm --dir jin-gui exec vitest run src/__tests__/tasks_workflow_bulk.test.ts`, relevant task-controller tests, and `pnpm --dir jin-gui build`.

## Pitfalls
- Filtering before building hierarchy loses child progress and breadcrumbs.
- UI-only conversion bypasses the core snapshot and replay protection.

## Examples
+ Set up an unconfigured list as a Board after previewing the columns, while using the full family for context and rendering only visible filtered cards.
- Change global keyboard focus styling → not this engram.

## Provenance
- Derived from `ops/workflows.rs`, task controller transforms, and workflow bulk regression tests.
