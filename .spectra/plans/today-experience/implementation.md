# Today experience implementation

Status: implemented-pending-owner-signoff (v2). The revised frontend implementation is in the managed worktree `/Users/henrique/.codex/worktrees/today-spec/jin`, based on `public/main` `30dfdd8ad1e9a1b12b34ac580802f48a9cc3926f` (2026-09-28). Browser and native verification passed; owner subjective design sign-off remains pending.

The implementation covers the Today contract in the following seams:

- `jin-gui/index.html` keeps one global Capture affordance, adds the compact workspace toolbar with Open Calendar navigation, and preserves Today as the startup page.
- `jin-gui/src/styles/today.css` provides the compact toolbar, focal selected-date masthead, truthful count treatment, bounded sparse single-column timeline and attention layout, localized compact due status, the Today-scoped 36rem event modal, and native safe-area handling.
- `jin-gui/src/controllers/today_controller.ts` carries core-authoritative midnight rollover refresh, event and agenda retry states, inline task completion pending/error behavior, post-render focus restoration, and real-data gating for the connected rail.
- `jin-gui/src/lib/agenda/render.ts` preserves authoritative lane ownership and event-linked relationship identity while rendering the selected-date agenda, event-title source metadata, bounded sparse states, and an optional connected rail only when real relationships exist.
- `jin-gui/src/__tests__/today_controller.test.ts` covers the revised Today controller and interaction contract.

The implementation preserves Today as the startup page, the authoritative projection and DTO truth rules, Calendar-supported event content, keyboard and reduced-motion behavior, and the spec’s scope boundaries. It does not add Notes or Tasks widgets, new scheduling semantics, provider or persistence changes, or background services. The first build was rejected during review because the visual change was too small and overflow remained; this record covers the revised v2 build.

Verification evidence:

- Current focused tests: 112 Today tests, 23 fixture tests, and 3 icon registry tests passed, 138 total. TypeScript checks also passed.
- Sparse and rich desktop browser QA at 1237px was screenshot-inspected with no overflow. At 320px, sparse and rich states were screenshot-inspected; the timeline marker remains separated, source metadata wraps, linked preparation notes wrap after repair, and all Today descendants report no `scrollWidth`/`clientWidth` overflow.
- Browser screenshot evidence: [desktop sparse](/Users/henrique/workspace/personal/jin/.artifacts/playwright-mcp/today-v2-desktop-verified.png), [desktop rich](/Users/henrique/workspace/personal/jin/.artifacts/playwright-mcp/today-v2-rich-verified.png), [320px sparse](/Users/henrique/workspace/personal/jin/.artifacts/playwright-mcp/today-v2-320-verified.png), and [320px rich notes](/Users/henrique/workspace/personal/jin/.artifacts/playwright-mcp/today-v2-rich-note-verified.png).
- Open Calendar remains route-only: it preserves Calendar’s existing date and does not transfer Today’s selected day. The button is labeled Calendar, so this stays within the existing navigation scope.
- Native verification passed using `/Users/henrique/workspace/personal/jin/target/debug/bundle/macos/Jin.app`: the final debug bundle executable timestamped 2026-09-28 13:58:04 passed `codesign --verify --deep --strict`, launched through CUA, and opened directly to Today with the expected accessibility state. At the native 1200x800 window, the compact toolbar showed Calendar and Today, sparse data stayed centered and bounded with no horizontal scrollbar, and real user data was unchanged. Read-only task and shared-event previews rendered correctly; Escape returned focus to each originating button according to accessibility inspection. The native Today window was left open for review.
- No full frontend suite was run for this revision.

Evidence limits: implementation and browser/native verification are complete; owner subjective design sign-off remains pending.
