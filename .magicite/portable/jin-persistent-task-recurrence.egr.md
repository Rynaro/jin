---
spec: engram/1.0
name: jin-persistent-task-recurrence
id: egr_a0ac183d
version: 1
intent:
  does: Preserve durable Jin task recurrence planning and materialized occurrence semantics.
  use_when: Changing recurring Tasks, recurrence edits or stopping, completion successors, or scheduled
    recurrence maintenance.
  not_when: Changing Google Calendar event recurrence or a one-off task due date.
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
  - recurring Jin task
  - task recurrence planner
  - recurrence completion successor
  negative:
  - Google Calendar recurrence
  body_digest: cc00daad37b5e5bc4ba781b54f7c0c7df26bed03ea28b74bea77e26558a40358
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: cc00daad37b5e5bc4ba781b54f7c0c7df26bed03ea28b74bea77e26558a40358
assets: {}
extensions: {}
---
## Procedure
1. Start in `jin-core/src/ops/recurrence.rs` and keep canonical owner and occurrence images under the recoverable-operation lock. Refresh SQLite only after canonical convergence.
2. Preserve the durable series and instance identity. A materialized occurrence carries its series ID, revision, sequence, scheduled due date, predecessor, baseline, and detached or exception state. Slot identity prevents duplicate generation across retries.
3. Plan date-only rules in the configured display timezone and date-time rules using the due value's explicit offset. Do not substitute the host timezone. Long inactivity skips unmaterialized past slots without deleting saved overdue occurrences.
4. Keep modes distinct. Scheduled recurrence maintains its finite `upcoming_count` horizon. Completion recurrence creates exactly one successor after a completed occurrence. The scheduler intentionally uses a fresh operation ID because slot identity, not the scheduler call ID, provides idempotency.
5. Preserve finite Count exhaustion and existing exceptions. Do not refill an exhausted Count rule, invent historical instances, replace touched or detached items, or turn an edit with a stale revision into a parallel series. Retire only untouched future occurrences according to the requested scope.
6. Keep this task-owned materialization separate from Google event recurrence, which remains external event metadata and projection behavior.
7. Run `cargo test -p jin-core --test persistent_recurrence`, `pnpm --dir jin-gui exec vitest run src/__tests__/recurring_tasks.test.ts src/__tests__/tasks_controller.test.ts src/__tests__/today_controller.test.ts`, and relevant bridge or CLI recurrence coverage.

## Pitfalls
- Reusing a scheduler operation ID as the recurrence identity can block needed maintenance or create duplicates after recovery.
- Treating a locally edited occurrence as an untouched template discards an explicit exception.
- Planning date-only tasks in the host timezone changes their schedule near a date boundary.

## Examples
+ Complete a completion-mode occurrence and create one clean successor while preserving the completed record.
- Expand a Google Calendar RRULE into local Jin task files → not this engram.

## Provenance
- Derived from `ops/recurrence.rs`, `persistent_recurrence.rs`, recurrence GUI coverage, and task recurrence bridge contracts.
