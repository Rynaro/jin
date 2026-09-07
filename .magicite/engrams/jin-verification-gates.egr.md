---
spec: engram/0.2
name: jin-verification-gates
id: egr_226d6b2b
version: 1
provenance: authored
intent:
  does: "Select and run Jin's layered Rust, CLI, GUI, lint, contract, and sovereignty verification gates"
  use_when: "validating a code change, choosing regression tests, or preparing a completion report"
  not_when: "performing discovery before any behavior or acceptance criteria are known"
triggers:
  positive:
    - "verify a Jin implementation change"
    - "choose focused and full regression commands"
    - "run Rust and GUI quality gates"
    - "confirm DTO CLI storage sync or accessibility contracts"
  negative:
    - "brainstorm a feature with no implementation to validate"
context_affinity: [verification, cargo, vitest, eslint, stylelint]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: []
yields: [evidence-backed-completion]
composes: [jin-sovereign-storage-boundary, jin-cli-json-contract, jin-tauri-thin-command-bridge, jin-gui-controller-transform-render]
inhibits: []
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in project test docs and manifests"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Anchor the change to focused tests nearest the touched behavior before running broad suites; never weaken existing assertions to obtain green.
2. For Rust, run targeted `cargo test -p jin-core --test <suite>` or `cargo test -p jin --test <suite>`, then `cargo test --workspace`.
3. Run `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features -- -D warnings` when Rust changes.
4. For GUI work, run `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run stylelint` from `jin-gui` as applicable.
5. Include contract gates relevant to the change: rebuild equivalence, no direct SQLite, additive writes, DTO parity, export sovereignty, offline sync, or token/a11y discipline.
6. Report exact commands, exit results, and any skipped environment-dependent visual/manual checks.

## Pitfalls
- A focused green test is not evidence that workspace-level contracts still pass.
- Snapshot-only UI verification misses type, accessibility, and token-discipline regressions.
- Running auth or sync tests against live services violates the project's offline test boundary.

## Examples
+ Run the focused temporal suite, then workspace tests and formatting after changing timezone resolution.
- Claim the GUI is verified after only `npm run build`.

## Provenance
- Derived from `docs/testing.md`, `docs/gui-testing.md`, Cargo workspace tests, and `jin-gui/package.json` scripts.
