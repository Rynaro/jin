# VIGIL Verification — Calendar Chronological Grid Restoration

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified commit: `761fc0a693c413b14c86b85df6b819e78a511708`
- Date: 2026-08-26
- Tier: full
- Acceptance: 24/24 checks pass

## Independence and scope

VIGIL independently reviewed the complete specification, manifest, FORGE deliberation, implementation history, and final delta. The final delta from `d5d6dbf4d8258f5269dad84685f28db463b4b1a7` changes only GUI source/tests and addresses the remaining detached-render initial-scroll race. No implementation files were edited during verification.

Crystalium recall was attempted as required but the memory transport was unavailable; the manifest's recorded preflight remains `ran: true, records: 0`.

## Acceptance verdict

- AC-001–AC-010: Day/Week structure, shared projection, half-open clipping, overlap determinism, short-event geometry, all-day lanes, malformed-input fail-closed behavior, and wall-time fidelity pass focused model/controller tests and source audit.
- AC-011–AC-016: locale/hour-cycle copy, source and Time-block semantics, keyboard order/detail activation, Back focus/scroll restoration, and canonical M2 edit resolution pass focused/full GUI coverage and browser smoke.
- AC-017–AC-020: now-marker timer lifecycle, initial scrolling, and early/late nighttime state pass fake-timer/controller coverage and exact-worktree browser reproduction.
- AC-021–AC-024: Task separation, responsive containment, supported visual states, and the complete regression suite pass DOM tests, responsive browser evidence, build/CSS gates, and the 1,663-test GUI suite.

## Final regression reproduction

The deterministic Playwright fixture was loaded from this exact worktree on `127.0.0.1:1420`; the stale main-checkout fixture injected by the browser harness was replaced page-locally with `/tools/tauri-fixture-init.js?exact=761fc0a` before exercising the controller.

- Normal default Today (Calendar hidden) → Events activation, occupied Day at 02:00: pre-activation `scrollTop=0`, `clientHeight=0`, `scrollHeight=0`, `initialized=false`, `pending=true`; after activation `scrollTop=54px` (expected `54px`), `initialized=true`, `pending=false`, observer cleared, RAF cleared.
- Same hidden-route flow, empty Day: post-activation `scrollTop=157px` (compressed projection target `156.6px`), with pending observer/RAF cleared.
- Same hidden-route flow, occupied Week at 02:00: post-activation `scrollTop=54px`, exactly seven day columns, with pending observer/RAF cleared.
- Manual-scroll protection: after initial application, a user scroll to `233px` followed by two `activateSection()` calls remained `233px`; controller state matched and `pending=false`, observer cleared, RAF cleared. A rerender after manual nighttime collapse likewise preserved `scrollTop=205px` and `scrollLeft=61px`.
- Expanded nighttime control: compact `44×44px` control, accurate localized event/time summary and `aria-expanded`; measured 00:00–05:00 label text did not intersect the control in Week. Manual collapse survived same-view rerender.
- Responsive 720px viewport: document width `720/720`, internal timeline `478/1008`, seven columns retained through internal horizontal scrolling; no document overflow.
- Browser console: 0 warnings, 0 errors (2 informational messages).

Evidence:

- `.artifacts/playwright-mcp/chron-grid-vigil-761fc0a-week-1280x800.png`
- `.artifacts/playwright-mcp/chron-grid-vigil-761fc0a-week-1280x800.md`
- `.artifacts/playwright-mcp/chron-grid-vigil-761fc0a-week-720x800.png`
- `.artifacts/playwright-mcp/chron-grid-vigil-761fc0a-console.txt`

## Automated gates

- Focused GUI: 5 files, 133/133 tests passed.
- Full GUI: 40 files, 1,663/1,663 tests passed.
- GUI build: passed (`tsc --noEmit && vite build`); only the established non-blocking chunk-size advisory appeared.
- CSS lint: passed.
- Rust formatting: passed at the final commit.
- Diff whitespace check: passed.
- Relevant unchanged Rust evidence: core Event tests 18/18 and bridge tests 64/64 passed; clippy with `-D warnings` passed. The final fixes contain no Rust changes, so these exact-base results remain applicable.

## Visual-status boundary

`CI STATUS: LOGIC VERIFIED — NATIVE VISUALS OWNER-APPROVED`

The owner/operator explicitly approved the native Tauri Day and Week visual
result on 2026-08-26 at 15:22 local time. The exact verified build opened
without a startup banner or error and showed the Portuguese Day one-column and
Week seven-column chronological timelines with their shared hour rail,
separators, all-day lane, 09:00–10:30 duration placement, current-time marker,
visible `Source: Jin`, and internally contained Week grid. Empty Madrugada and
Noite ranges remained calmly collapsed with accessible summary controls. No
clipping or document-level overflow was observed, and the QA application was
closed cleanly.

This owner-observed native evidence remains distinct from the green headless
browser evidence; Playwright is not represented as proof of native WebView or
window behavior.

## Promotion hand-off

Tonberry generated `promotion.envelope.json` during archive. IDG attempted the
optional CRYSTALIUM hand-off once with a schema-complete envelope bound to the
archived spec digest. The memory gate rejected transmission of the internal
calendar specification to an unverified external destination without
payload-specific owner authorization. No workaround or retry was attempted.
The durable local promotion intent remains available for a later explicitly
authorized hand-off.
