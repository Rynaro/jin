# First-time setup guide verification

**Verdict: PASS — logic verified.** Vivi implemented the change and VIGIL
independently reviewed the final source and reran the complete Rust and frontend
test suites after the completion/recovery test seams landed. No release-blocking
behavior defect remains in the reviewed scope.

## Acceptance evidence

| Acceptance checks | Evidence and result |
| --- | --- |
| AC-BOOT-1, AC-BOOT-2, AC-BOOT-3 | Rust launch-resolution tests prove that a valid initialized legacy root starts `Ready`, a fresh default enters `FirstRun` without initialization, and an in-progress marker with its selected root and step takes precedence over an initialized default. Durable state round-trip coverage exercises the schema and candidate data. **Pass.** |
| AC-BOOT-4, AC-ENV-1 | Resolver tests cover missing explicit roots, persisted-root precedence, corrupt Jin configuration, and the locked `JIN_ROOT` path. Source review confirms the scheduler is started only for `LaunchState::Ready`; unavailable roots receive setup/recovery without root-dependent jobs. **Pass.** |
| AC-ROOT-1, AC-ROOT-2 | Filesystem tests cover missing, empty, initialized, non-empty uninitialized, file, and relative candidates. Source review confirms selection writes only external first-run progress and does not initialize the candidate. Picker cancellation has controller coverage. **Pass.** |
| AC-FINISH-1, AC-FINISH-2 | Command-level tests prove the durable order `in_progress -> initialize -> persist root -> completed`. An injected root-pointer failure leaves the state in progress, and a later retry succeeds. **Pass.** |
| AC-FINISH-3 | The restart outcome test requires a native restart before services can attach. Source review confirms `complete_first_run` requests restart only after the completion helper returns successfully. **Pass.** |
| AC-UI-1 | `launch_bootstrap.test.ts` proves that only `Ready` registers product controllers; `FirstRun`, `RootUnavailable`, and bridge failure register setup only. The recovery controller test keeps the product shell hidden while native restart is requested. **Pass.** |
| AC-UI-2, AC-UI-3 | Controller tests cover the durable active step, completed progress, heading focus, selected storage, effective persisted appearance preferences, disabled actions during Finish, and retryable Finish failure. The browser walkthrough also exercised saved-step reload/focus and live dark/motion settings. **Pass.** |
| AC-UI-4 | Final browser QA exercised widths 320, 390, 760, and 1440, plus 3.1 accessibility text scaling. Geometry, scrolling, keyboard reachability, horizontal overflow, light/dark appearance, and console output passed. Evidence is under `.artifacts/playwright-mcp/first-time-setup-*`. **Pass.** |
| AC-RECOVERY-1 | A command-level recovery test proves `initialize -> persist replacement -> completed` without replaying tutorial steps. Controller and browser recovery checks cover replacement selection and restored-root retry; the latter requests native restart instead of exposing a partially started Ready process. **Pass.** |

The command wiring review also confirmed one-step setup transitions, the Review
gate before Finish, live launch-state reevaluation on retry, environment-root
recovery lockout, and immutable process root behavior through restart.

## Final checks

- `cargo fmt -p jin-gui --check`: passed.
- `cargo clippy -p jin-gui --all-targets -- -D warnings`: passed.
- `cargo test -p jin-gui`: **131 passed** (61 library, 67 bridge, 3 routing).
- `npm --prefix jin-gui test -- --run`: **1,952 passed across 53 files**.
- `npm --prefix jin-gui run lint:css`: passed.
- `npm --prefix jin-gui run build`: passed; this runs `tsc --noEmit` before the
  Vite production build. Vite emitted its existing large-chunk advisory.
- `git -c core.fsmonitor=false diff --check`: passed.

## Verification limits

- The manifest's standalone `npm --prefix jin-gui run typecheck` command is not
  defined. The production build performed the same TypeScript check through
  `tsc --noEmit` and passed.
- `node scripts/validate-playwright-mcp.mjs` remains blocked by the repository's
  pre-existing `.mcp.json` shape assertion (`mcpServers.playwright` is
  undefined). The active Playwright walkthrough passed, and the fixture script
  passed `node --check`; no Playwright MCP conformance result is claimed.
- Browser checks used the deterministic fixture. They do not prove the native
  Tauri dialog or restart implementation, native WebKit rendering, or Linux and
  macOS visual appearance. No native UI visual sign-off is claimed.

The native storage/resumption/recovery logic, service gates, frontend bootstrap,
and guided setup behavior satisfy the recorded acceptance checks within these
limits.
