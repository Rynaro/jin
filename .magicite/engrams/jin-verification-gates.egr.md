---
spec: engram/1.0
name: jin-verification-gates
id: egr_226d6b2b
version: 1
intent:
  does: Select and run Jin's layered Rust, CLI, GUI, lint, contract, and sovereignty verification gates
  use_when: validating a code change, choosing regression tests, or preparing a completion report
  not_when: performing discovery before any behavior or acceptance criteria are known
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
  - verify a Jin implementation change
  - choose focused and full regression commands
  - run Rust and GUI quality gates
  - confirm DTO CLI storage sync or accessibility contracts
  negative:
  - brainstorm a feature with no implementation to validate
  body_digest: 7a2875db8ddb50eb2df0507487962574a9667c1489a0f9b8115da0e4a31faf14
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 7a2875db8ddb50eb2df0507487962574a9667c1489a0f9b8115da0e4a31faf14
    content_sha256: 474a0958eb9ea812d139a7db693a18b5db1971198d9fc5aa206ff959cdc32cde
  journal:
  - version: 1
    timestamp: '2026-08-18T00:00:00Z'
    author: vivi
    event: authored
    note: Grounded in project test docs and manifests
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
  yields:
  - evidence-backed-completion
  composes:
  - jin-sovereign-storage-boundary
  context_affinity:
  - verification
  - cargo
  - vitest
  - eslint
  - stylelint
  exports:
    skill_md: true
---
## Procedure
1. Anchor the change to focused tests nearest the touched behavior before running broad suites; never weaken existing assertions to obtain green.
2. For Rust, run targeted `cargo test -p jin-core --test <suite>` or `cargo test -p jin --test <suite>`, then `cargo test --workspace`.
3. Run `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features -- -D warnings` when Rust changes.
4. For GUI work, run `pnpm --dir jin-gui test` and `pnpm --dir jin-gui build` (TypeScript and Vite); for stylesheet changes run `pnpm --dir jin-gui lint:css`.
5. Include contract gates relevant to the change: rebuild equivalence, no direct SQLite, additive writes, DTO parity, export sovereignty, offline sync, or token/a11y discipline.
6. Report exact commands, exit results, and any skipped environment-dependent visual/manual checks.

## Pitfalls
- A focused green test is not evidence that workspace-level contracts still pass.
- Snapshot-only UI verification misses type, accessibility, and token-discipline regressions.
- Running auth or sync tests against live services violates the project's offline test boundary.

## Examples
+ Run the focused temporal suite, then workspace tests and formatting after changing timezone resolution.
- Claim the GUI is verified after only `pnpm --dir jin-gui build`.

## Provenance
- Derived from `docs/testing.md`, `docs/gui-testing.md`, Cargo workspace tests, and `jin-gui/package.json` scripts.
