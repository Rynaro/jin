---
spec: engram/1.0
name: jin-cli-json-contract
id: egr_27443114
version: 1
intent:
  does: Keep Jin CLI commands thin and preserve the stable JSON envelope and exit-code contract
  use_when: adding CLI flags, subcommands, JSON fields, validation failures, or command output
  not_when: changing only jin-core internals with no CLI-visible behavior
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
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - add or change a jin CLI subcommand
  - modify --json output or the Envelope DTO
  - map a JinError to a process exit code
  - keep CLI output compatible with scripts
  negative:
  - change a Tauri-only command that the CLI never exposes
  body_digest: add03d685e6ed5dd6c2c971e9fa768b6c2e24b93d240a79859fd400fb7531ed7
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: add03d685e6ed5dd6c2c971e9fa768b6c2e24b93d240a79859fd400fb7531ed7
    content_sha256: bb3b1f4b1a019a1c29a6510b2bbf5910b0c2081ead00b8d58f7f947d79ba94e5
  journal:
  - version: 1
    timestamp: '2026-08-18T00:00:00Z'
    author: vivi
    event: authored
    note: Grounded in jin CLI output and integration tests
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
  - stable-cli-contract
  composes:
  - jin-verification-gates
  inhibits:
  - jin-tauri-thin-command-bridge
  context_affinity:
  - jin-cli
  - clap
  - json
  - dto
  - exit-codes
  exports:
    skill_md: true
---
## Procedure
1. Define argument shape and mutual exclusions in `jin/src/main.rs`; reject invalid input before invoking mutation logic.
2. Delegate behavior to `jin_core::ops` and keep command arms limited to adaptation and presentation.
3. Serialize machine output through `jin/src/output.rs` and the shared `jin_core::dto::Envelope` rather than ad hoc JSON.
4. Map failures through `jin/src/exit_code.rs`; preserve usage, not-found, conflict, auth, and internal distinctions.
5. Keep human output and `--json` semantically aligned without parsing the human form in tests.
6. Exercise the compiled binary against a temporary store in `jin/tests/`, asserting exit status and envelope fields.

## Pitfalls
- Printing an error-shaped fallback with exit code zero makes automation treat failures as success.
- Adding a JSON field in one command while omitting the shared DTO creates CLI/GUI parity drift.
- Reimplementing a core invariant inside clap handling makes the CLI the accidental source of truth.

## Examples
+ Extend the DTO, emit it with `print_json`, and add a real-binary assertion in `jin/tests/s4_tasks_notes_crud.rs`.
- Print a custom JSON object directly from a new command arm.

## Provenance
- Derived from `jin/src/main.rs`, `jin/src/output.rs`, `jin/src/exit_code.rs`, and CLI integration suites under `jin/tests/`.
