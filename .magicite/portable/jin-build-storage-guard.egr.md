---
spec: engram/1.0
name: jin-build-storage-guard
id: egr_9be6d637
version: 1
intent:
  does: Run Jin development gates with measured output-volume headroom and safe cleanup boundaries.
  use_when: Preparing costly Cargo or Tauri checks, diagnosing low disk space, or inspecting Jin build cleanup.
  not_when: Performing arbitrary system cleanup or modifying application behavior.
compatibility: {}
capabilities:
  requires: []
  produces:
  - kind: artifact
    id: artifact.jin-storage-report
    version: 1.0.0
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
    - pnpm
    - python3
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - Jin build storage
  - low disk Cargo check
  - Jin artifact cleanup
  negative:
  - system-wide disk cleanup
  body_digest: dbae678e4a477bbd3e837a17e1afbc3ee72231dab0f0bd5c780a2659cf5f0ed4
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: dbae678e4a477bbd3e837a17e1afbc3ee72231dab0f0bd5c780a2659cf5f0ed4
assets: {}
extensions: {}
---
## Procedure
1. Run `python3 scripts/dev_storage.py inspect` from the checkout and read `docs/development-storage.md` before an expensive gate. The normal guard starts from a 5 GiB reserve plus a 5 GiB expected-growth budget on each output volume.
2. Select the narrowest applicable command and run it through `scripts/dev_storage.py run --report PATH -- COMMAND` so output locations and headroom are recorded.
3. Keep normal Cargo profile settings consistent. Use `--full-debug` only for a debugger session and preserve normal target paths for bundle or release checks.
4. Preview `cleanup cargo --package PACKAGE` or `cleanup dist`; use `--apply` only for an explicitly authorized package-scoped Cargo cleanup after consumers stop.
5. Report command, exit status, JSON report path, minimum free bytes, overrides, cleanup performed, and remaining gates.

## Pitfalls
- Direct build commands bypass the runner's headroom and lock reporting.
- `dist` cleanup is inspection-only and user data, worktrees, shared caches, and accepted references are outside the cleanup scope.

## Examples
+ Guard a focused `jin-core` test before a full workspace verification.
- Delete global SDK or Docker caches → not this engram.

## Provenance
- Derived from `scripts/dev_storage.py`, `docs/development-storage.md`, and the maintained Jin storage skill.
