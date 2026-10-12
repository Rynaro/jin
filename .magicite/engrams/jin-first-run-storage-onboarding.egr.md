---
{
  "spec": "engram/1.0",
  "name": "jin-first-run-storage-onboarding",
  "id": "egr_0f2a9103",
  "version": 1,
  "intent": {
    "does": "Preserve first-run storage selection, resumable setup, and unavailable-root recovery.",
    "use_when": "Changing Jin onboarding steps, storage initialization, setup persistence, or root recovery.",
    "not_when": "Migrating existing user data or changing ordinary calendar sync."
  },
  "compatibility": {
    "os": [
      "linux",
      "macos"
    ]
  },
  "capabilities": {
    "requires": [],
    "produces": [
      {
        "kind": "artifact",
        "id": "artifact.jin-verification-report",
        "version": "1.0.0"
      }
    ]
  },
  "risk": {
    "filesystem": "write-project",
    "subprocess": {
      "mode": "declared-tools",
      "tools": [
        "cargo",
        "pnpm"
      ]
    },
    "network": {
      "mode": "none",
      "destinations": []
    },
    "secrets": "none"
  },
  "routing": {
    "positive": [
      "first-run setup storage",
      "resume interrupted onboarding",
      "unavailable root recovery"
    ],
    "negative": [
      "ordinary calendar sync"
    ],
    "body_digest": "2df93be7284553af0231a3338581aeabf708f60b654ddf5cc5aff6cf72ac011e"
  },
  "origin": {
    "channel": "authored",
    "verification_status": "pending",
    "content_hashes": {
      "body_sha256": "2df93be7284553af0231a3338581aeabf708f60b654ddf5cc5aff6cf72ac011e"
    }
  },
  "assets": {},
  "extensions": {}
}
---
## Procedure
1. Read `docs/first-time-setup.md`, `jin-gui/src/controllers/first_run_controller.ts`, and existing first-run tests before editing setup behavior.
2. Preserve Welcome, Storage, Functions, Settings, and Review progression, resumable pending state, and the Ready/FirstRun/RootUnavailable boundary before scheduler startup.
3. Validate storage choices: missing directory, empty directory, or initialized Jin root may be accepted; reject files, invalid paths, and unrelated non-empty directories. Do not copy or migrate user data during setup.
4. Preserve authoritative `JIN_ROOT`, immutable runtime root selection, and atomic pointer/completion persistence. Interrupted setup must resume; accepted completion or root recovery must follow the existing native restart path.
5. Run `pnpm --dir jin-gui test -- src/__tests__/first_run_controller.test.ts` and `pnpm --dir jin-gui build`; select existing Rust first-run tests when native initialization or persistence changes.
6. Cover picker cancellation, interrupted resume, unavailable-root retry, keyboard focus, reduced motion, and text sizing using existing fixtures. Report native picker/restart behavior separately; fixtures do not establish native success.

## Pitfalls
- Never mark setup complete before storage initialization and pointer persistence succeed.

## Examples
+ "Resume an interrupted storage step without initializing an unrelated directory" → this engram
- "Migrating existing user data or changing ordinary calendar sync." → NOT this engram

## Provenance
- Authored for current Jin contracts on 2026-10-12; pending independent operator review.
