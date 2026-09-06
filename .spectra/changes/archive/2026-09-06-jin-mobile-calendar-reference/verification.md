# Jin Mobile Calendar Reference — Verification

## Result

ATLAS independently reviewed the final implementation and accepted AC1–AC6 with no scope drift or overlapping target changes. Automated verification, browser interaction and layout evidence, accessibility presentation, and final native packaging passed. Native Tauri owner visual approval remains pending and is not claimed here.

## Automated verification

- Every non-browser portion of the repository GUI gate passed: Rust suites of **48 + 67 + 3 tests**, the frontend suite of **1,895 tests across 51 files**, TypeScript, CSS lint, and the production build.
- Chromium could not launch for the smoke portion inside the sandbox because macOS returned an `EPERM` rendezvous error. The same production due-editor smoke was rerun outside that sandbox constraint and passed.
- Final CSS corrections passed focused CSS lint, production build, and `git diff --check`.
- The final native application, including the forced-colors correction, built and signed successfully at `target/debug/bundle/macos/Jin.app`. Evidence: `/private/tmp/jin-mobile-reference-native.log`.

## Browser evidence

Deterministic browser verification used the real Events route at `http://127.0.0.1:1420`.

- At standard text scale, 320 and 390 CSS px had no document-level horizontal overflow. Date type computed to 17 CSS px, the today circle to 32 CSS px, and each compact week to 72 CSS px.
- The dense four-event fixture kept the first three source-colored bars plus `+1` strictly inside its date cell. Each real chip button retained a 24 CSS px hit height.
- Activating the mobile bar for event A opened the correct authoritative event detail. Activating date September 10 opened the existing Day view with all four events.
- At 760 and 1440 CSS px, desktop event titles remained visible and month rows retained their accepted 120 CSS px height.
- In the repository accessibility text mode with dynamic scale **3.1**, both 320 and 390 CSS px avoided document overflow. The existing `.calendar-month-grid-scroller` retained `tabindex="0"` and the original 58rem calendar field, keeping calendar-only horizontal scrolling keyboard reachable.
- In forced colors, the final event-bar pseudo-element resolved to black/System `ButtonText`, with its forced-color handling explicitly retained.

Saved evidence:

- `.artifacts/playwright-mcp/mobile-reference-final-light.png`
- `.artifacts/playwright-mcp/mobile-reference-final-dark.png`
- `.artifacts/playwright-mcp/mobile-reference-final-dense.png`
- `.artifacts/playwright-mcp/mobile-reference-desktop-after.png`

## Acceptance evidence

| Criterion | Evidence | Verdict |
| --- | --- | --- |
| AC1 Mobile reference composition | Mobile max-700 rules preserve seven equal columns, remove vertical borders, retain horizontal week separators, and produce 72px compact weeks | Accepted |
| AC2 Jin date states | Today uses the Jin seal circle, inherited wash is cleared, indigo focus remains visible, and controller selection state is unchanged | Accepted |
| AC3 Event truth | Real first-three chip buttons retain data, localized aria labels, handlers, palette color, focus, 24px hitboxes, and `+N` | Accepted |
| AC4 Existing date flow | Focused tests and browser interaction prove date-to-Day and chip-to-authoritative-detail navigation | Accepted |
| AC5 Desktop boundary | Compact rules are max-700 and AX-excluded; 760/1440 retain titles and 120px rows | Accepted |
| AC6 Responsive accessibility | 320/390 standard and accessibility scale 3.1 have no page overflow; the calendar scroller is keyboard focusable; dark and forced colors were reviewed | Accepted |

## Lifecycle and review boundary

Tonberry verification in block mode passed every MUST requirement and all six acceptance criteria. The missing C8 fresh-context attestation remains advisory. The follow-up Tonberry assessment exited successfully after skipping the ESL assessment because the Docker daemon was unavailable. No Crystalium or other external-memory transfer was performed.

The final bundle proves the latest code packages successfully. Browser evidence proves deterministic layout and interaction behavior. The owner has not yet visually approved this change inside the native Tauri window, so native visual sign-off remains a separate pending review.
