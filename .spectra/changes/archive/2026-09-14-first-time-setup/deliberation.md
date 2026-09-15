---
eidolon: forge
kind: deliberation
performative: DECIDE
change_id: first-time-setup
---

# FORGE Deliberation — First-time setup

## Decision

Use a native launch gate plus a frontend-only five-step guide, finishing with
restart. This preserves the existing immutable `AppState.root` contract while
letting a user choose storage before any Jin data is initialized.

## Accepted choices

- Resolve launch mode before `ops::init` and scheduler startup. `Ready` starts
  the normal application, `FirstRun` starts only setup and appearance, and
  `RootUnavailable` presents durable recovery.
- Store resumable setup metadata outside the candidate root. A crash before,
  during, or after initialization remains recoverable on the next launch.
- Initialize only when Finish is activated. Persist the completed root pointer
  only after successful initialization, then request a process restart.
- Keep `JIN_ROOT` authoritative; it cannot be replaced from the UI. A missing
  persisted root may select and initialize a replacement without replaying
  tutorial content.
- Reuse existing appearance preferences for auto/light/dark, text size, and
  reduced motion. Do not introduce provider, permission, account, or sync setup.

## Alternatives rejected

- Auto-initializing `~/Jin` before the WebView: removes user storage choice and
  makes first use irreversible.
- Mutable root state: would require reinitializing every command and background
  service in-process and risks mixed-root operation.
- Storing progress in the selected folder: loses the only recovery record when
  the candidate cannot be written or is moved.
- Browser-only folder selection: cannot provide the platform folder picker or
  validate the native filesystem contract.

## Verification obligations

Validate pending-state precedence, corrupt root handling, explicit-root
authority, candidate validation, atomic persisted updates, retryable failures,
restart behavior, disconnected normal controllers, keyboard focus, rail state,
and fixture restart emulation. Native rendering remains owner-reviewed.
