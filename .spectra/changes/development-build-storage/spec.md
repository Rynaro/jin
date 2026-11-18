# Development build storage

Contributors and automated development sessions need predictable disk use before
Cargo and Tauri verification fills their machines. Provide a portable Python
standard-library runner shared by local entrypoints, agents and CI.

## Scope

Resolve Cargo output paths, guard every relevant volume using configurable reserve
and expected growth, apply routine verification settings, sample free space and
emit machine-readable reports. Coordinate guarded builds and explicit cleanup
through a checkout lock. Expose checkout-owned dev-profile Cargo output for one selected Jin package as
the cleanup scope. Frontend dist is report-only. Keep worktree-local output paths compatible with packaging.
Wire the existing CI and Make targets into the runner and publish a repository skill.

## Acceptance

### AC-STORAGE-01

Given a build command and resolved output volumes, when available space is below reserve plus budget, the runner SHALL refuse before spawning the child and report the shortfall.

Verify with unit tests with a deliberately oversized budget.

### AC-STORAGE-02

Given a child command that succeeds or fails, when the guarded run completes, the runner SHALL record before, sampled minimum and after free bytes, effective settings and child status, and propagate failure.

Verify with unit tests and CLI subprocess smoke.

### AC-STORAGE-03

Given routine verification without explicit Cargo profile overrides, when the child is spawned, the runner SHALL disable incremental compilation and dev/test debug symbols while preserving caller overrides and full-debug mode.

Verify with unit tests with captured child environment.

### AC-STORAGE-04

Given a cleanup request, when the target is outside the checkout, has a separate build directory, contains tracked files or links, or a guarded build holds the lock, the runner SHALL refuse destructive cleanup and preserve the candidate.

Verify with temporary-repository safety tests.

### AC-STORAGE-05

Given a checkout-owned Cargo target for one selected Jin package in the dev profile, when the user previews then explicitly applies that scope, the runner SHALL preview and apply through native Cargo clean, coordinate access through Cargo locking and report the result.

Verify with temporary-repository cleanup tests.

### AC-STORAGE-06

Given existing CI core, GUI and Windows verification gates, when a build or test command runs, the workflow SHALL retain its checks, use guarded builds and upload storage reports even on failure.

Verify with workflow review and Python test matrix on Ubuntu, macOS and Windows.

### AC-STORAGE-07

Given a contributor or agent following the development-storage skill, when the task needs verification or disk recovery, the skill SHALL select scoped checks, explain budget tuning and debugger tradeoffs, and require explicit cleanup scope.

Verify with skill validator and documented command smoke checks.
