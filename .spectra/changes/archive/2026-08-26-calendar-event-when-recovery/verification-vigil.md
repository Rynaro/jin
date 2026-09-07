# VIGIL Verification — Calendar Event When Recovery

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified commit: `745477516232886ebebb756c864cc8353f091c20`
- Date: 2026-08-26
- Tier: full
- Acceptance: 26/26 checks pass

## Scope and independence

VIGIL independently reviewed the complete spec, manifest, FORGE deliberation, implementation diff, and final two-file localization repair. No implementation files were edited by the checker. Crystalium preflight returned two unrelated Notes records; no recalled record influenced the verdict.

## Acceptance evidence

- AC-001–AC-009: the Add Event modal contains the shared range Calendar and no native date input; fresh state focuses Title, is all-day, and retains hidden 09:00–10:00 defaults. Pointer and APG keyboard flows produced normalized cross-month ranges, accurate `aria-multiselectable`/`aria-selected`, endpoint/interior non-color markers, one roving tab stop, and unchanged task single-mode behavior.
- AC-010–AC-016: deterministic en/pt-BR parser tables passed. Browser input `tomorrow at 11:30pm` produced Aug 27–28 with 23:30–00:30; invalid `99pm` showed localized guidance without mutating that draft. Date-only application preserved timed state/times. `amanhã às 14h` produced a synchronized 14:00–15:00 one-day draft.
- AC-017–AC-021: serialization/validation/async tests passed. Browser creation of inclusive Aug 30–Sep 2 all-day input invoked exactly one `create_event` with canonical start `2026-08-30` and exclusive end `2026-09-03`, then closed/reset.
- AC-022–AC-023: complete Month/Day/Week, M1/M2, authority, conflict, Time-block, focus/scroll, and editor regression suites passed; browser Day retained a 25-label chronological rail and three fixture Event controls. Task due-date smoke retained single selection, no multiselect/commit control, one roving tab stop, and close-on-selection.
- AC-024: an open-dialog en→pt-BR switch preserved the English input and cached result while localizing preview, summary, Calendar, weekday/month labels, When, Cancel, Close, dialog heading, submit text, and submit accessible name. Exact final values were `Novo evento`, `Criar`, and `Criar evento`.
- AC-025: at 1280×800 and 480/360 responsive widths, the dialog used internal vertical scrolling and the document never overflowed. At 360px the quick-input row stacked and the Calendar fit its container. Dark mode and reduced motion were exercised headlessly. Native owner visual proof remains separate.
- AC-026: all recorded automation, build, style, formatting, diff, and ESL gates passed.

## Automated gates

- Focused final suite: 6 files, 442/442 tests passed.
- Broader acceptance suite before the final repair: 10 files, 579/579 passed.
- Full GUI suite at final HEAD: 41 files, 1,700/1,700 passed.
- Production build: passed; established non-blocking bundle-size advisory only.
- CSS lint, Cargo formatting, and `git diff --check`: passed.
- Final repair delta from `cfc62487`: only `calendar_view_controller.ts` and its regression test, 8 added lines.
- Browser console: 0 warnings, 0 errors (2 informational messages).

## Browser artifacts

- `.artifacts/playwright-mcp/event-when-7454775-pt-dialog-1280x800.png`
- `.artifacts/playwright-mcp/event-when-7454775-pt-dialog-360x800.png`
- `.artifacts/playwright-mcp/event-when-7454775-pt-dialog-dark-1280x800.png`
- `.artifacts/playwright-mcp/event-when-7454775-console.txt`

`CI STATUS: LOGIC VERIFIED — OWNER ACCEPTANCE RECORDED VIA PROGRESSION`

Owner acceptance of the corrected Add Event shared Calendar surface is evidenced
indirectly by product progression: the owner proceeded from that surface to
requesting the same interaction on Edit, then explicitly approved the integrated
native result. This is recorded as implicit acceptance through progression, not
as an explicit standalone Add Event native visual approval. The deterministic
browser harness remains the direct Add Event rendering evidence and is not
represented as proof of native Tauri behavior.
