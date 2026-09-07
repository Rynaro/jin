# VIGIL Verification — Calendar Event Edit When Surface

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified commit: `1f9d8032c114e5a673e7cb725928167d54ac5fb8`
- Date: 2026-08-26
- Tier: full
- Acceptance: 22/22 checks pass

## Independence and scope

VIGIL independently reviewed the complete spec, manifest, FORGE deliberation, implementation diff, and regression surface. No production files were edited by the checker. Crystalium recall was attempted but its transport was unavailable.

## Acceptance evidence

- AC-001–AC-005: eligible Jin detail renders the shared range Calendar/relative When surface in-place with no native date input, Source identity retained, and Title focused. Exact timed/all-day initialization, inclusive projection, exact baseline passthrough/change-revert, and pointer/keyboard range behavior pass pure/DOM suites and browser inspection.
- AC-006–AC-012: browser timed relocation preserved a 90-minute duration across midnight (`Aug 27 23:00` → `Aug 28 00:30`); date-only relocation shifted both endpoints together while preserving clocks. A direct one-day Calendar resize retained overnight clocks, became locally invalid, showed validation, and invoked no command. All-day plus `tomorrow at 11:30pm` became a synchronized one-hour timed interval (`23:30` → next-day `00:30`). Leap/year inclusive-end serialization, malformed/zero/backwards validation, and toggle retention pass the focused matrices.
- AC-013–AC-019: draft preservation, exact no-op behavior, pending guard, stale endpoint detection, Review/Use-latest baseline/token behavior, retriable failures, Cancel/Escape focus restoration, Mod+Enter, and Description newline all pass controller tests. Browser Escape from focused edit input cancelled without mutation and restored focus to `Editar Sprint Planning`.
- AC-014: live en→pt-BR switching preserved the English relative text and selected interval while localizing Edit, When, Use, preview/summary, Calendar month/weekdays/actions, Save/Cancel, times, and accessible labels.
- AC-020–AC-021: Google/recurring/cancelled authority, Time-block identity/linkage, Add Event, task single Calendar, Month/Day/Week chronology, detail Back, focus, and scroll regression suites all pass.
- AC-022: exact-worktree browser QA at 1280×800, 720×800, and 480×800 retained Calendar width, sticky actions, and internal `.jin-content-body` scrolling with no document overflow. Dark/reduced-motion behavior remains covered; console recorded zero warnings and zero errors. Native owner proof remains separate.

## Automated gates

- Focused GUI: 8 files, 513/513 tests passed.
- Full GUI: 41 files, 1,713/1,713 tests passed.
- Production build: passed; established non-blocking chunk-size advisory only.
- CSS lint, Cargo formatting, and `git diff --check`: passed.
- Browser console: 0 warnings, 0 errors (2 informational messages).

## Browser artifacts

- `.artifacts/playwright-mcp/event-edit-when-1f9d8032-pt-1280x800.png`
- `.artifacts/playwright-mcp/event-edit-when-1f9d8032-pt-480x800.png`
- `.artifacts/playwright-mcp/event-edit-when-1f9d8032-console.txt`

The Playwright MCP initially exposed its known stale primary-checkout fixture; VIGIL replaced only the page-local mock bridge with `/tools/tauri-fixture-init.js?exact=1f9d8032` served by this exact worktree before recording authoritative interaction evidence.

`CI STATUS: LOGIC VERIFIED — NATIVE VISUALS OWNER-APPROVED`

The owner/operator explicitly approved the native Tauri visual result on
2026-08-26, closing the native owner-sign-off portion of AC-022. The
deterministic browser harness remains separate evidence and is not represented
as proof of native Tauri rendering.
