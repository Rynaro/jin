---
spec: engram/0.2
name: jin-gui-controller-transform-render
id: egr_392dbde4
version: 1
provenance: authored
intent:
  does: "Implement Jin GUI behavior with controllers orchestrating pure transforms and centralized render helpers"
  use_when: "changing desktop UI state flow, filtering, sorting, rendering, selection, or user interaction"
  not_when: "the request changes canonical persistence or a core domain invariant"
triggers:
  positive:
    - "add behavior to a Jin Stimulus controller"
    - "extract a pure GUI transform for headless tests"
    - "change list detail selection or rendering flow"
    - "keep controller transform render responsibilities separated"
  negative:
    - "modify canonical Markdown storage or index rebuild logic"
context_affinity: [jin-gui, stimulus, controller, transform, render]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-tauri-thin-command-bridge]
yields: [testable-gui-flow]
composes: [jin-hig-token-accessibility, jin-verification-gates]
inhibits: [jin-sovereign-storage-boundary, jin-core-operation-pattern]
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in existing GUI layering"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Trace the feature from the Stimulus controller in `jin-gui/src/controllers/` through `src/invoke.ts` and the domain's `src/lib/*/` helpers.
2. Put deterministic filtering, sorting, labels, state derivation, and DTO-to-view-model work in a pure `transform.ts` or state module.
3. Keep DOM construction and updates in the domain `render.ts`; reuse document templates and centralized UI primitives.
4. Let the controller own async invokes, event wiring, optimistic state, race handling, and error presentation—not business invariants.
5. Preserve single-source interaction state such as task selection and hydrate details through authoritative detail calls where list DTOs are intentionally partial.
6. Test pure behavior headlessly and add controller wiring tests for events, async failures, and DOM state.

## Pitfalls
- Embedding transform rules in event handlers makes them difficult to test and easy to duplicate.
- Rendering unsanitized user strings with `innerHTML` crosses the content safety boundary.
- Hydrating a detail pane from a partial list projection can silently discard body fields.

## Examples
+ Follow `tasks_controller.ts` → `tasks/transform.ts` → `tasks/render.ts`, with tests in `src/__tests__/tasks_controller.test.ts`.
- Add persistence rules to a controller because only the GUI currently needs them.

## Provenance
- Derived from `jin-gui/src/controllers/tasks_controller.ts`, `jin-gui/src/lib/tasks/transform.ts`, `render.ts`, and their tests.
