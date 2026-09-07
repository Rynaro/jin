# VIGIL Verification — calendar-pr47-rescue

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Maker commit: `8155136a22cebcfa66e2db7498a85dba39c403ee`
- Verified: 2026-08-26
- Change tier: `full`

## Independence and scope

Maker and checker are identity-distinct (`Vivi` != `VIGIL`). The diff from the declared base `62f5523` through the maker commit changes exactly the four paths declared by `spec.yaml`:

- `.spectra/changes/calendar-pr47-rescue/spec.yaml`
- `jin-core/src/ops/events.rs`
- `jin-gui/src/__tests__/calendar_view_controller.test.ts`
- `jin-gui/src/controllers/calendar_view_controller.ts`

Independent review found no undeclared product changes or behavioral scope drift. The implementation maps directly to AC-CAL-01 through AC-CAL-04. This verification does not invoke a lifecycle drift transition and leaves `drift_checked` unchanged, as requested by the orchestrator.

## Acceptance results

| Criterion | Result | Independent evidence |
|---|---|---|
| AC-CAL-01 | PASS | Core focused tests cover atomic in-place edit/delete while retaining the canonical event identity and Jin linkage; the full core suite passes. |
| AC-CAL-02 | PASS | Core focused tests reject non-Jin, cancelled, recurring-master, and recurring-instance mutation paths. Controller tests confirm unsupported records do not expose edit/delete controls. |
| AC-CAL-03 | PASS | Deterministic Playwright evidence at 1280x800 reaches Month, Week, Day, and canonical detail. Fixed Month/Week captures show both navigation chevrons (`placeholders: 0`, `visibleNavSvgs: 2`). The Day event opens its canonical detail; the tested recurring/all-day detail exposes Attach/Link but no edit/delete controls. |
| AC-CAL-04 | PASS | Core and controller tests cover half-open all-day and multi-day projection. Week evidence shows Company All-Hands on Aug 25 and Aug 26 and excludes the exclusive Aug 27 end. |

## Mechanical verification

All commands were run independently at the exact maker commit.

- `cargo test -p jin-core ops::events::tests` — PASS, 4/4 focused tests.
- `cargo test -p jin-core` — PASS, 200/200 unit tests plus all integration suites and the doc test.
- `npm test -- --run src/__tests__/calendar_view_controller.test.ts` — PASS, 24/24 tests.
- `npm test` — PASS, 37 files and 1,589/1,589 tests.
- `npm run build` — PASS (`tsc` and Vite); only the existing informational chunk-size warning was emitted.
- `cargo fmt --all -- --check` — PASS.
- `git diff --check` — PASS.

## Visual verification

Deterministic browser evidence was collected from the isolated Jin development server with viewport 1280x800 and reduced motion. The checker independently inspected the retained artifacts in the main repository at `.artifacts/playwright-mcp/`:

- `calendar-rescue-month-fixed-1280x800.{md,png}` — Month reachable; both navigation chevrons visible.
- `calendar-rescue-week-fixed-1280x800.{md,png}` — Week reachable; both navigation chevrons visible; half-open multi-day projection is correct.
- `calendar-rescue-day-1280x800.{md,png}` — Day reachable and event card interactive.
- `calendar-rescue-detail-1280x800.{md,png}` — canonical detail opens; unsupported recurring/all-day item remains view-only.
- `calendar-rescue-console-fixed.txt` — zero console errors and zero warnings.

Evidence SHA-256 values:

- Month PNG: `1c0cfa9ba421866ef4f81ffb46bc0c76298586a95c706d4fb1eb1d62761fb994`
- Week PNG: `754485ba133dbe64ef7f60eefdb39064cfd1ce45ae51038445158fba82404d0a`
- Day PNG: `769f334b3308320afcc335f374bab0154b7f331d747ebe8ec3b07acbc5615040`
- Detail PNG: `a8a182df33716592d40a9d937b4745cb9776a81821dfc760f6db2f20e38c1680`
- Console capture: `336675d281b9ae8565ae4a46139a04ab2bb831307cec8f008d72476ff7d3e707`

The owner/operator native Tauri visual sign-off was attested as received on 2026-08-25. Together with the deterministic headless evidence, the required visual gate is PASS. The browser evidence is not represented as proof of native behavior; native acceptance rests on that owner sign-off.

## Tonberry preflight

The pinned Tonberry image was run offline with `--network none` in block mode against this worktree:

`ghcr.io/rynaro/tonberry@sha256:df6ec882ed2b932483b9cb44449b2e2a233d8e71901e9c6307f627df3979be73`

Read-only status preflight exited 0 and reported no failures: C1, C2a, C2b, C3, and all four C7 acceptance checks were OK. After composing the accompanying `verify_pass` envelope, final block-mode `verify --json` also exited 0 with C1, C2a, C2b, C3, C6, and all four C7 acceptance checks OK; it reported `Result: OK (exit 0)`.

No lifecycle transition, drift mutation, or archive action was performed.
