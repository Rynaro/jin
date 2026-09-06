# Living Agenda production verification

## Automated checks

- Frontend: 1,881 Vitest tests across 51 files passed, including Today, Capture, sidebar, appearance, and token-discipline coverage.
- Focused regression pass: 150 Today, Capture, and sidebar tests passed after the final navigation fixes.
- TypeScript: `tsc --noEmit` passed.
- Styling and packaging: Stylelint and the Vite production build passed.
- Native bridge: `cargo fmt --check`, `cargo clippy -p jin-gui --all-targets -- -D warnings`, and `cargo test -p jin-gui` passed. The Rust suite included 48 unit tests, 67 bridge tests, and 3 Google Calendar routing tests.
- Production due smoke: `node tools/production-due-smoke.mjs` passed (`production due editor smoke: ok`).
- The complete `make verify-gui` run was initially stopped by Chromium sandbox `EPERM`; its required production smoke was then rerun successfully with the approved escalated environment. This is an environment limitation of the browser runner, not an application test failure.

## Browser evidence

Playwright MCP evidence used the deterministic Jin fixture at `http://127.0.0.1:1420/`, with a 1280×800 baseline, headless UTC/en-US, and reduced motion. The responsive matrix covered 320, 390, 760, and 1440 CSS pixels at scale 1 and 3.1; no page horizontal overflow was observed. Today rows retained readable wrapping and the production agenda kept truthful loading, empty, and error behavior.

Capture was exercised in dark mode at AX5 (310%): the initial visual compression was fixed by using one internal scroll region and keeping the header, tabs, and form controls from shrinking. The corrected result was rechecked. At 390px, all four Capture tabs activated, the Capture action remained reachable by scrolling, and Escape closed the dialog. The desktop, AX5, and corrected Capture evidence is available in:

- `.artifacts/playwright-mcp/living-agenda-production-desktop.png`
- `.artifacts/playwright-mcp/living-agenda-production-today-ax5-dark.png`
- `.artifacts/playwright-mcp/living-agenda-production-capture-ax5-dark.png`
- `.artifacts/playwright-mcp/living-agenda-production-capture-ax5-dark-fixed.png`

Additional browser checks covered 1280px dark mode, increased contrast, reduced transparency, reduced motion, and forced colors. These retained focus visibility and produced no page overflow; the forced-colors run used a solid focus treatment. Escape restored focus to the Quick capture button after closing. The fresh page after the icon fix reported zero console errors and zero warnings. Evidence files include `.artifacts/playwright-mcp/living-agenda-production-dark-contrast.png` and `.artifacts/playwright-mcp/living-agenda-production-forced-colors.png`.

Final mobile navigation checks passed at 390px AX5: the overlay remained 390px wide, the 389px scroll path exposed all Capture and navigation labels, and the corrected evidence is `.artifacts/playwright-mcp/living-agenda-production-mobile-nav-ax5-fixed.png`. At 320px AX5, opening navigation, entering Capture, scrolling to submit, pressing Escape, and closing navigation completed without page overflow. Desktop sidebar collapse persisted across reload.

## Signoff boundary

**LOGIC VERIFIED — VISUALS NOT VERIFIED.** Browser checks provide headless interaction, layout, accessibility-appearance, and responsive evidence. They do not establish native Tauri/WKWebView/WebKitGTK behavior or replace owner visual sign-off. Native owner review remains required for native behavior and the final warm-paper/ink visual treatment.
