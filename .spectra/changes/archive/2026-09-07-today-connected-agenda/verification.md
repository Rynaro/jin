# Today connected agenda verification

Implementation completed on `codex/today-connected-agenda`. Vivi implemented the
feature; ATLAS independently reviewed the projection, relationships, semantics,
and lifecycle. The root orchestrator verified the reported corrections, ran the
final checks, and inspected browser evidence.

## Behavior and contracts

- AC001–012: six fixed-clock core tests cover timezone due values, invalid values,
  open-task eligibility, lane precedence, promoted-task exclusion, noncurrent
  dates, concurrent focus, next ordering, distinct end timezones, DST overlap,
  invalid intervals, and exact-end exclusion. Legacy AgendaDto remains unchanged.
- AC013–021: controller tests cover minute boundaries, document visibility, route
  departure/return, disconnecting pending requests, task/event mutation signals,
  stale replies, failed refresh preservation, and restoring a failed date input.
  Browser interactions opened Capture and the correct event/task/note details.
- AC022–025: render tests cover plural focus reachability, task-only days,
  deduplicated linked entities with actual event associations, and hidden empty
  context. Browser DOM checks found no unnamed Today controls, nested buttons,
  or missing heading-label references; event keyboard focus was visible.
- AC026–031: browser geometry checked 320, 390, 760, 1280, and 1440 CSS pixels,
  plus 3.1 accessibility text scale at 390 and 1280. No document overflow was
  found. Light, dark, forced colors, reduced motion, and increased contrast /
  reduced transparency states were exercised. A fresh touch context confirmed
  every visible Today button is at least 44px high. No runtime dependency or
  persistence/schema change was introduced.

## Checks

- `make verify`: passed, including all five serialized determinism passes.
  The existing OAuth loopback test required an unsandboxed local test port.
- Final `cargo test -p jin-core today_projection_tests`: 6 passed, including
  integration cases added after the full core gate.
- Rust GUI clippy and bridge tests: passed.
- Final frontend suite: **1,905 tests passed across 51 files**.
- TypeScript / Vite production build and CSS lint: passed. Vite reports its
  existing large-chunk advisory.
- Production due-editor browser smoke: passed; Chromium needed an unsandboxed
  macOS launch after the sandbox denied its Mach-port registration.
- Native debug `.app` bundle built; macOS signing verifier passed for
  `dev.jin.gui`.
- Jin visual-language skill validator and `git diff --check`: passed.

Browser URL: `http://127.0.0.1:1420/`. Evidence is under
`.artifacts/playwright-mcp/today-connected-*` (desktop, mobile, dark, forced
colors, accessibility text, and keyboard). Browser fixtures are deterministic
sample data, not evidence of a live native command bridge. The accessibility
check was a targeted DOM/keyboard review, not an axe audit.

**CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED.** Browser appearance was
reviewed; native WebKit appearance, motion feel, and physical tap ergonomics
remain separate owner checks. The native bundle was built and signature-checked,
not visually approved.

## Lifecycle fallback

Tonberry composed the initial manifest and advanced it to `in_progress`, then
its transport closed during assessment and verification. The local catalogue
reports Tonberry is not installed. Following the graceful-degradation rule in
`.eidolons/cortex/esl-protocol.md`, the root recorded the completed review and
archived the local dossier without claiming a Tonberry conformance pass.
No external memory operation was performed.

## Preview follow-up verification — 2026-09-08

The subsequent user-approved interaction replaces direct task/event navigation
with an in-place preview; its explicit Go to task/event control opens the full
detail route. Prep-note navigation is unchanged. This supersedes the original
direct-navigation expectation in AC-TODAY-021. The timeline now has one continuous
rail and no row dividers cutting through its markers.

- Final GUI suite: **1,911 tests passed across 51 files**, including routed edit
  identity/scope, stale canonical-field preservation, and save-after-close cases.
- CSS lint, TypeScript/Vite build, production due-editor smoke, and diff check
  passed. Native debug app build and macOS signing verification passed.
- Browser verification exercised task status/priority and local/routed event
  title/location saves, Today refresh, Escape, focus return, and explicit Go
  navigation. Widths 320–1440 and accessibility text scale 3.1 were checked;
  dialog bounds and scroll access were verified separately from page overflow.
- Light, dark, and forced-colors previews were visually inspected. Evidence:
  `.artifacts/playwright-mcp/today-preview-*` and `today-continuous-timeline.png`.
- The rebuilt native Tauri app was opened and inspected: task preview, read-only
  Google event preview, Close/focus return, and Go to event all worked. Native
  user records were not modified; mutation checks used browser fixtures.

These are agent verification results; they do not claim owner visual sign-off
or a Tonberry conformance pass.
