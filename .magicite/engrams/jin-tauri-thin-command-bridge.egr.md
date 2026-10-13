---
spec: engram/1.0
name: jin-tauri-thin-command-bridge
id: egr_3a2708a8
version: 1
intent:
  does: Extend Jin's Tauri boundary as a thin typed adapter over jin-core with exact TypeScript/Rust argument parity
  use_when: adding or changing a Tauri command or the frontend invoke wrapper
  not_when: the feature can be completed entirely inside an existing frontend DTO and command surface
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
  - add a Tauri command for a Jin operation
  - change invoke.ts arguments or return DTOs
  - fix snake_case payload mismatch between TypeScript and Rust
  - expose jin-core behavior to the desktop GUI
  negative:
  - implement business logic directly in the browser controller
  body_digest: 3a87ae4a9be0b41edf6bb224c708c4fe14f8d98228f92bc0e1d453a891246aa5
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 3a87ae4a9be0b41edf6bb224c708c4fe14f8d98228f92bc0e1d453a891246aa5
    content_sha256: d30f80eb188b50c06c0c69fafc0a32554a355e967a6bc3eb1c517cc2dcc706d8
  journal:
  - version: 1
    timestamp: '2026-08-18T00:00:00Z'
    author: vivi
    event: authored
    note: Grounded in Tauri command and invoke parity
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
  - typed-tauri-bridge
  composes:
  - jin-verification-gates
  inhibits:
  - jin-cli-json-contract
  context_affinity:
  - jin-gui
  - tauri
  - invoke
  - rust
  - typescript
  exports:
    skill_md: true
---
## Procedure
1. Add the testable `*_fn` adapter in `jin-gui/src-tauri/src/commands/`, taking `&Path` plus deserialized inputs and returning DTOs or `JinErrorDto`.
2. Keep validation that converts transport strings to core enums at this boundary; keep domain rules in `jin-core`.
3. Register only the thin `#[tauri::command]` wrapper through `commands/mod.rs` and `src-tauri/src/lib.rs`.
4. Add the matching typed function in `jin-gui/src/invoke.ts` using the Rust command name and exact snake_case payload keys.
5. Update `jin-gui/src/types/dto.ts` only when the shared serialized DTO shape changes.
6. Verify bridge shape in Rust command tests plus `jin-gui/src/__tests__/invoke.test.ts` and `dto_shapes.test.ts`.

## Pitfalls
- Camel-casing a nested key in the invoke payload can pass TypeScript while Tauri rejects deserialization at runtime.
- Letting a command read SQLite or rewrite a model directly forks `jin-core` behavior.
- Making Rust-required fields optional in TypeScript defers a compile-time contract failure to runtime.

## Examples
+ Mirror `moveTask`: TypeScript maps `listId` to nested `list_id`, and Rust parses `MoveTaskInput` before calling core ops.
- Query `.jin/index.sqlite` in a Tauri command to avoid adding an API DTO.

## Provenance
- Derived from `jin-gui/src/invoke.ts`, `jin-gui/src-tauri/src/commands/tasks.rs`, and bridge contract tests.
