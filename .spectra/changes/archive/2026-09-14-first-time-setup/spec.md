# First-time setup

## Objective

Give a newly installed Jin a five-step, Ubuntu-style setup before ordinary Jin
controllers, core operations, or background jobs begin. The user chooses the
storage folder, sees Jin's basic functions, applies basic appearance settings,
reviews the effective choices, and restarts into a ready workspace.

## Fixed decisions

- Native startup resolves `Ready`, `FirstRun`, or `RootUnavailable` before
  `ops::init` or scheduler startup. `AppState.root` is immutable for a process.
- Resolution order remains `JIN_ROOT`, persisted store root, then `~/Jin`.
  `JIN_ROOT` is authoritative and read-only in setup. A missing explicit root
  never falls through to another location.
- `first_run_state.json` lives in OS app configuration, not the selected data
  folder. It is schema version 1 and records `in_progress|completed`, the five
  named steps, and the optional absolute selected root.
- Setup accepts an empty folder, a missing candidate directory, or an existing
  initialized Jin root. It rejects a file and a non-empty uninitialized folder.
- Finishing revalidates the root, initializes it, atomically persists the root
  pointer, marks setup complete, then requests restart. Errors remain retryable
  and retain in-progress state.
- Existing initialized roots with no pending marker open normally. A pending
  marker wins on non-`JIN_ROOT` launches so interrupted setup resumes. A missing
  grandfathered persisted root offers bounded replacement-root recovery without
  replaying tutorial steps.

## Experience

The frontend exposes only the setup controller and existing appearance
controller until launch is ready. The five steps are Welcome, Storage,
Functions, Settings, and Review. The rail names the current step, completed
steps, and moves focus to the active heading. Storage uses the native folder
picker; cancellation changes nothing. Settings are restricted to existing
appearance mode, text size, and reduced motion. Review lists the selected
storage path and effective appearance preferences.

## Scope

- `jin-gui/src-tauri/src/{main.rs,lib.rs,state.rs,root_resolver.rs}`
- `jin-gui/src-tauri/src/commands/first_run.rs` and command registration
- setup bridge wrappers/types, controller, markup, stylesheet, fixture, and
  focused tests

No data migration, mutable-root refactor, synchronization setup, permissions,
accounts, or settings redesign is included.

## Verification

- Rust tests cover root precedence, durable state, valid/invalid candidates,
  pending-marker resumption, corrupt roots, and unavailable-root recovery.
- Frontend tests cover launch gating, step transitions, picker cancellation,
  appearance persistence, review data, error state, and restart emulation.
- Required gates: Rust fmt/clippy/tests; TypeScript, frontend test, CSS lint,
  build; fixture validator; and deterministic Playwright evidence.
