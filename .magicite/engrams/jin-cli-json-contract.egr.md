---
spec: engram/0.2
name: jin-cli-json-contract
id: egr_27443114
version: 1
provenance: authored
intent:
  does: "Keep Jin CLI commands thin and preserve the stable JSON envelope and exit-code contract"
  use_when: "adding CLI flags, subcommands, JSON fields, validation failures, or command output"
  not_when: "changing only jin-core internals with no CLI-visible behavior"
triggers:
  positive:
    - "add or change a jin CLI subcommand"
    - "modify --json output or the Envelope DTO"
    - "map a JinError to a process exit code"
    - "keep CLI output compatible with scripts"
  negative:
    - "change a Tauri-only command that the CLI never exposes"
context_affinity: [jin-cli, clap, json, dto, exit-codes]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-core-operation-pattern]
yields: [stable-cli-contract]
composes: [jin-verification-gates]
inhibits: [jin-tauri-thin-command-bridge]
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in jin CLI output and integration tests"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
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
