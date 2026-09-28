# Today experience implementation

Status: implemented-pending-native-review. The frontend implementation is complete in the managed worktree `/Users/henrique/.codex/worktrees/today-spec/jin`, based on `public/main` `30dfdd8ad1e9a1b12b34ac580802f48a9cc3926f` (2026-09-28). Native Tauri owner sign-off is pending. No PR or commit was created.

The implementation covers the Today contract in the following seams:

- `jin-gui/index.html` removes the duplicate page Capture action and keeps the sidebar Capture path.
- `jin-gui/src/styles/today.css` reshapes the Today top bar, timeline, contextual work presentation, empty composition, responsive layout, reduced-motion behavior, and the 36rem event modal scope for the active Today route.
- `jin-gui/src/controllers/today_controller.ts` carries the Today state, preview behavior, core-authoritative midnight rollover refresh, retry/status flow, agenda retry pending suppression, and exact focus restoration.
- `jin-gui/src/lib/agenda/render.ts` preserves authoritative lane ownership and event-linked relationship identity while rendering the Today agenda and connected work.
- `jin-gui/src/__tests__/today_controller.test.ts` covers the Today controller and interaction contract.

The implementation preserves Today as the startup page, the authoritative projection and DTO truth rules, Calendar-supported event content, keyboard and reduced-motion behavior, and the spec’s scope boundaries. It does not add Notes or Tasks widgets, new scheduling semantics, provider or persistence changes, or background services.

Verification evidence:

- Focused tests: 107 Today tests and 23 EventCompanion tests passed, 130 total.
- CSS lint and the production build passed; the normal `dist` output was protected because it already existed.
- Browser checks on a fresh `#today` route showed the populated and empty states at 1280px, plus 390px and 320px narrow states, with no overflow; the Today event modal measured 36rem at 1280px and 288px at 320px; the task dialog fit; after a 1-second native dialog timing path, Escape restored focus to the exact opener; the console had no errors.
- Retry and lifecycle checks cover core-authoritative midnight rollover refresh, event retry with exact focus restoration, and agenda retry pending suppression.
- Full frontend suite: 2,109 passed and 1 failed because `dto_shapes` invokes Cargo and its isolated target filled the disk. The generated target was cleaned afterward; no core code was touched.

Evidence limits: browser checks do not establish native Tauri/WebKit behavior. Native owner visual sign-off and the unavailable cross-language `dto_shapes` run remain pending.
