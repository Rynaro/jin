---
name: jin-gui-visual-qa
description: Perform repeatable visual QA of the Jin GUI with Playwright MCP, collecting browser evidence and separating headless findings from owner visual sign-off. Use for layout, styling, responsive, accessibility-appearance, and visual-regression checks.
---

# Jin GUI Visual QA

Run `npm --prefix jin-gui run dev:agent`, then use the repository `playwright` MCP at `http://127.0.0.1:1420`.

## Evidence loop

1. Confirm the page loaded and record console warnings/errors.
2. Capture an accessibility snapshot before each visual state.
3. Exercise the requested flow using accessible locators; wait for the intended state, not an arbitrary delay.
4. Capture screenshots into `.artifacts/playwright-mcp/` with names that identify the view and state.
5. Check at least layout integrity, clipping/overflow, focus visibility, text readability, empty/loading/error states relevant to the change, and reduced-motion behavior.
6. Report the exact URL, viewport, state/steps, console findings, artifacts, and any untested native behavior.

Use the fixed 1280×800 MCP context as the reproducible baseline. Change viewport only when the task explicitly includes responsive behavior, and record each size used.

Headless evidence can identify regressions but cannot approve Liquid Glass quality, native WKWebView/WebKitGTK rendering, motion feel, tap ergonomics, OAuth hand-off, or real Tauri bridge behavior. Keep `CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED` until the owner completes the sign-off checklist in `docs/gui-testing.md`.
