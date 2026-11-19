# Independent verification — calendar and sidebar polish

Checker: VIGIL. Maker: Vivi. Date: 2026-11-19.
This checker inherited conversation context; this is a distinct-identity review, not a fresh-context attestation. Product source was not modified by the checker.

## Direct checker evidence

Command run in `jin-gui`: `npm test -- src/__tests__/event_companion.test.ts src/__tests__/event_composer.test.ts src/__tests__/calendar_view_controller.test.ts src/__tests__/sidebar_controller.test.ts src/__tests__/sidebar_state.test.ts`.

Result: **113 tests passed in 5 files**. Log: `a temporary local evidence filesh-tests.log`.

Reviewed the spec, acceptance checks, companion capture handlers and teardown, composer input/validation code, localized title messages, sidebar markup/controller/styles, and regressions. No blocking mismatch found:

- CP-1: Registered plus and x icons replace text glyphs; accessible button labels remain. Panel icon hydration is present.
- CP-2: Title blur no longer marks the title touched. English and Portuguese tests cover cleared-title blur, explicit Enter validation, IME suppression, and valid Enter save.
- CP-3: Real month-grid regression covers add opening, outside pointerdown/pointerup/click dismissal without underlying date activation, then a subsequent click opening a fresh draft. Capture is scoped to the calendar workspace. Listener teardown restores subsequent input.
- CP-4: Meaningful draft discard decisions and pending-save Escape/Cancel protection pass. Sidebar navigation remains mediated by the existing guard because outside capture ignores targets outside the calendar workspace.
- CP-5: Context rail is transparent with zero border and no reserved footer strip. Header utilities use the shared surface. Rendered platform verification is supplied separately below.
- CP-6: Settings and Notifications remain unique actual router links with current-state and unread hooks. Existing drawer focus handling and DOM-order keyboard trapping remain tested. Badge removes the conflicting metadata class and explicitly uses the semantic on-fill foreground.

## Parent-supplied rendered evidence

Parent reports Chromium pointer checks: month plus (14px SVG in 32px target) and companion close (16px SVG in 30px target) each have center deltas dx=0, dy=0. Tabbing away from blank title produces zero errors. Physical pointer click in the grid dismisses the inspector; subsequent explicit add opens another date and Cancel closes it.

The checker also inspected `.artifacts/playwright-mcp/polish-composer-en.png`: no title error on the blank composer, centered close icon, and coherent title/body/footer alignment.

Parent final production browser results: valid local event save persisted; outside click on a meaningful draft showed the guard; Keep editing preserved exact text and Discard closed. Blank-title blur stayed quiet, explicit Enter showed the localized required text, and typing cleared it. Portuguese header labels with four unread notifications worked. Both header utilities remained keyboard reachable in a 390px drawer at 310% text scale. Badge states 0, 4 and 99+ and light/dark appearances passed inspection.

Parent final checks: 2,266/2,266 Vitest tests, CSS lint and TypeScript, Cargo format and GUI clippy, 150 GUI Rust tests, 12 calendar projection tests, production due and notes-writing smoke matrices all passed. Five-reference comparison passed after four affected references were visually reviewed and updated; compact Today was unchanged. Evidence is in `jin-gui/visual-references/cohesive-workspace-v1` and `.artifacts/playwright-mcp/polish-grid-plus.png`, `polish-composer-en.png`, `polish-sidebar-dark.png`, `polish-today-preview.png`. Logs: `a temporary local evidence filesh-{vitest-final,rust,projection,notes,due,utility-qa,sign}.log`.

Parent native check: signed `dev.jin.gui` Mac app verified by `make verify-macos-app`. Native Portuguese WebKit at 1200×800 used an isolated local vault. Bell opened Notifications and Ajustes opened Settings. Tab away from blank Calendar title showed no error; a single adjacent-date pointer click closed the inspector without replacement. Reopening and Return showed “Adicione um título.”; Fechar closed. Parent inspected the continuous sidebar in Today, Calendar and Notes with no former horizontal band and clear header actions.

## Verdict

CP-1 through CP-6 pass on the combined direct checker and explicitly attributed parent evidence. No spec/implementation drift was found. No product source was edited by this checker. Native behavior was checked by the parent, not independently replayed here. Owner aesthetic sign-off is not claimed.

Tonberry transitioned the change to verified, passed block verification, persisted a clean drift verdict, and archived it at `.spectra/changes/archive/2026-11-19-calendar-and-sidebar-polish`. Post-archive block verification passed C1–C6 and all six C7 acceptance checks, exit code 0. The verify envelope truthfully records inherited context. Post-archive `assess` was attempted but its MCP transport closed; the existing lock already records block enforcement and was not changed.
