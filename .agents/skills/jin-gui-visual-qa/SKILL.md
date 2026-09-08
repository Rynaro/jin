---
name: jin-gui-visual-qa
description: Perform repeatable visual QA of the Jin GUI with Playwright MCP, collecting browser evidence and separating headless findings from owner visual sign-off. Use for layout, styling, responsive, accessibility-appearance, and visual-regression checks.
---

# Jin GUI Visual QA

For visual-language and drift reviews, read the canonical
[`visual-language dossier`](../../../docs/visual-language/README.md) first.
This skill owns browser evidence and proportional review; it does not replace
owner sign-off for native Tauri rendering.

Run `npm --prefix jin-gui run dev:agent`, then use the repository `playwright` MCP at `http://127.0.0.1:1420`.

## Evidence loop

1. Confirm the page loaded and record console warnings/errors.
2. Capture an accessibility snapshot before each visual state.
3. Exercise the requested flow using accessible locators; wait for the intended state, not an arbitrary delay.
4. Capture screenshots into `.artifacts/playwright-mcp/` with names that identify the view and state.
5. Check at least layout integrity, clipping/overflow, focus visibility, text readability, empty/loading/error states relevant to the change, and reduced-motion behavior.
6. Report the exact URL, viewport, state/steps, console findings, artifacts, and any untested native behavior.

Use the fixed 1280×800 MCP context as the reproducible baseline. Add viewport
sizes when the task includes responsive behavior or the changed layout crosses
a responsive seam, and record each size used.

## Design fidelity and drift review

Use this mode for a design-system change, a broad visual pass, or when a local
edit may affect accepted neighboring surfaces. Select the smallest matrix that
exercises the changed seams; use 320, 390, 760, and 1440 when the work spans
mobile, accessibility, or the shared system. Record the sizes and states used.

Check the affected surface against the dossier:

- semantic roles are used instead of raw component colors, and seal/brand,
  capture vermilion, today seal, indigo focus/selection, and semantic danger
  remain distinct;
- type, continuous paper fields, spacing, geometry, material depth, and motion
  match the owning surface rather than accumulating rounded cards or shadows;
- the closest stylesheet owns the rule and no late override or global patch is
  masking an earlier authority;
- real DOM semantics, labels, focus, current/selected/pressed states, handlers,
  and controller state remain truthful;
- neighboring accepted routes retain their hierarchy and behavior;
- large text reflows, component-only intrinsic scrolling remains focusable,
  and page-level overflow does not appear;
- relevant light/dark, contrast, forced-colors, reduced-transparency, and
  reduced-motion states remain legible.

Do not require the full matrix for a local change that does not cross those
seams. Capture an accessibility snapshot before each visual state, inspect
console warnings/errors, and report untested states explicitly. Browser
evidence can identify drift; only the owner can approve native WebKit/Tauri
appearance, motion feel, and tap ergonomics.

Headless evidence can identify regressions but cannot approve Liquid Glass quality, native WKWebView/WebKitGTK rendering, motion feel, tap ergonomics, OAuth hand-off, or real Tauri bridge behavior. Keep `CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED` until the owner completes the sign-off checklist in `docs/gui-testing.md`.
