# VIGIL Retry Verification — Unified Calendar and Reminder Time Input

**Verdict:** PASS
**Checked at:** 2026-09-01T23:46:28Z
**Branch:** `codex/unified-calendar-reminder-time-input`
**Base HEAD:** `63e7b4b63adf9066e3b378c0f679a519a6bdea75`
**Maker:** `vivi`
**Checker:** `vigil`
**Tonberry enforcement:** `block`

The complete retry acceptance matrix passes. The prior invalid-time physical
click race is closed in both the production-bundle Chromium smoke and an
independent repository Playwright MCP reproduction at 1280x800.

## Fresh-context attestation

- `fresh_context: true`
- `checker: vigil`
- `transcript_access: artifact-only`
- The checker is distinct from the maker. This retry began from the frozen
  `spec.md`, current worktree and retry delta, then independently reran every
  acceptance command and browser interaction. The maker's assertion that the
  race was fixed was not accepted as evidence.

## Prior failure closure

The earlier VIGIL pass found that invalid blur feedback moved **Set Date**
between pointer-down and pointer-up, producing `clicks: 0`. The retry adds a
scoped reserved feedback row in `jin-gui/src/styles/calendar.css:444-450` and a
production Chromium regression in
`jin-gui/tools/production-due-smoke.mjs:103-129`.

The direct physical retry used Playwright's real `locator.click()` sequence,
with an independent capture counter attached to the button. After entering
`16:2` and clicking **Set Date** once, the observed state was:

```json
{
  "clicks": "1",
  "active": "jin-due-time",
  "errorText": "Use a time like 9, 930, or 9:30.",
  "open": true,
  "time": "16:2"
}
```

Before the click, the reserved validation row measured 18px high while hidden.
After the click, the event had fired exactly once, the invalid draft remained,
the dialog stayed open, localized guidance was visible, and focus returned to
the time field. This closes the former AC-UCRT-003/008 blocker.

Evidence:

- `.artifacts/playwright-mcp/ucrt-retry-due-before-invalid-1280x800.md`
- `.artifacts/playwright-mcp/ucrt-retry-invalid-click-pass-1280x800.md`
- `.artifacts/playwright-mcp/ucrt-retry-invalid-click-pass-1280x800.png`
- `.artifacts/playwright-mcp/ucrt-retry-console.txt`

## Acceptance matrix

| ID | Result | Retry evidence |
|---|---|---|
| AC-UCRT-001 | PASS | `npm --prefix jin-gui test -- calendar_clock.test.ts`: 15/15 passed. Supported shorthand and trimming normalize to canonical `HH:mm`, including `16`, `1600`, and `16:20`. |
| AC-UCRT-002 | PASS | Same helper suite verifies invalid bounds/shapes fail closed and empty remains distinguishable for optional task time. |
| AC-UCRT-003 | PASS | Reminder suites: 43/43 passed. Production smoke and direct Chromium physical click both prove first-click delivery, invalid draft preservation, open dialog, localized feedback, and focus on `#jin-due-time`; clear/cancel/Escape/focus regressions remain green. |
| AC-UCRT-004 | PASS | Reminder suites verify preview-only typing, valid Use/Enter application, date-only time preservation, timed replacement, invalid nonmutation, visible calendar projection, and Set Date persistence boundary. |
| AC-UCRT-005 | PASS | Calendar create/detail suites: 61/61 passed. Shared helper normalizes shorthand before composition and chronological validation; timed events still require both clocks. |
| AC-UCRT-006 | PASS | TypeScript/Vite build passes. Review confirms the existing `CalendarController`, shared natural parser/formatter/error mapping, and the single pure clock helper remain the component boundaries. |
| AC-UCRT-007 | PASS | Full frontend: 46 files, 1775/1775 tests. Production build, CSS lint, production due smoke, and `git diff --check` all pass. |
| AC-UCRT-008 | PASS | Repository Playwright MCP at 1280x800 confirms direct pointer delivery, visible localized feedback, focus return, retained invalid text, open dialog, reserved feedback geometry, and zero console warnings/errors. Headless evidence passes; native Tauri rendering remains outside this gate and owner visual sign-off remains outstanding. |
| AC-UCRT-009 | PASS | Scope review confirms global capture Event and Promote-to-Event controls remain `datetime-local` at `index.html:3076`, `:3089`, and `:3216`. Focused capture/actions suites pass 102/102. |

## Command evidence

- `npm --prefix jin-gui test` — PASS, 46 files / 1775 tests.
- `npm --prefix jin-gui test -- calendar_clock.test.ts` — PASS, 15 tests.
- `npm --prefix jin-gui test -- temporal_editor_controller.test.ts tasks_lists_modal_wiring.test.ts` — PASS, 43 tests.
- `npm --prefix jin-gui test -- calendar_view_controller.test.ts event_edit.test.ts` — PASS, 61 tests.
- `npm --prefix jin-gui test -- capture_controller.test.ts actions_controller.test.ts` — PASS, 102 tests.
- `npm --prefix jin-gui run build` — PASS.
- `npm --prefix jin-gui run lint:css` — PASS.
- `npm --prefix jin-gui run test:production-due` — PASS,
  `production due editor smoke: ok`.
- `git diff --check` — PASS.
- `mcp__tonberry__verify` with `mode=block` — PASS, exit 0 and no failures.
- Tonberry transition `in_progress` -> `verified` — allowed and persisted.
- Valid verify-pass `INFORM` artifact —
  `.spectra/changes/unified-calendar-reminder-time-input/verification-vigil-pass`.

## Browser evidence summary

- URL: `http://127.0.0.1:1420/`
- Viewport: 1280x800
- Browser mode: repository Playwright MCP, headless Chromium, `en-US`, UTC,
  reduced motion
- Console: 0 errors, 0 warnings
- Physical invalid Set Date click count: 1
- Post-click active element: `#jin-due-time`
- Post-click dialog state: open
- Post-click draft: `16:2` preserved
- Native Tauri/WKWebView/WebKitGTK behavior: not exercised

**CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED**
