# Jin GUI — Test Strategy and VG-GUI Traceability Matrix

> **Story GUI-S6.** Authoritative test-strategy reference for the Jin GUI MVP.
> Maps every VG-GUI validation gate to its named enforcing test(s), documents
> the headless/visual split required by the spec, and collects the owner visual
> verification checklist required for milestone sign-off (VG-GUI-8).
>
> See `docs/testing.md` for the core (`jin-core` + `jin` CLI) test strategy.
> See `.spectra/plans/gui-mvp.md §8.6` for the gate definitions.

---

## 0. Headless-honesty declaration (VG-GUI-8)

```
CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED
```

The GUI test harness proves that:

- The command bridge correctly marshals jin-core ops and returns correct DTOs
- The bridge crate contains no direct rusqlite dependency (VG4 preserved)
- The `today_agenda` hero flow surfaces `originating_task` + `prep_notes` end-to-end
- All `JinErrorDto` exit-code mappings (3/4/5/6/7/2) are correct
- Frontend logic transforms (sort, group, filter), renders, and routes correctly
- CSS token discipline is enforced (no raw hex in components, SF not bundled, Inter is)
- Accessibility fallbacks are structurally present (media-query AND `[data-*]` toggles)

**What CI does NOT and cannot prove:**

- Liquid-Glass rendering quality (blur, specular edge, vibrancy on Linux/macOS)
- Light/dark adaptive appearance correctness and two distinct dark background tiers
- Motion/transitions and their `prefers-reduced-motion` override behavior
- Dynamic-Type reflow at AX sizes (no text clipping)
- Tap-target ergonomics (44 pt feel on the owner's actual hardware)
- Sidebar inset + soft scroll-edge effect
- OAuth loopback browser hand-off (PKCE + 127.0.0.1 redirect on the owner's machine)
- Cross-platform glass divergence (WebKitGTK Linux vs WKWebView macOS)

**Consequence:** a green CI build NEVER means the UI looks correct. Visual
correctness requires the owner's explicit sign-off via the checklist in §5.
No story may be marked "visually done" from a headless build alone.

---

## 1. Test layers

### Layer G1 — Bridge integration tests (Rust)

**Location:** `jin-gui/src-tauri/tests/bridge.rs`
**Run:** `cargo test -p jin-gui`
**Count:** 16 tests

These tests call the `*_fn` command functions directly — no Tauri runtime
required, fully headless and CI-safe. All use a `TempDir` temp root; no
global env mutation.

| Test name | Gate(s) |
|---|---|
| `vg4_vg_gui_1_no_rusqlite_direct_dep` | VG-GUI-1 |
| `vg_gui_2_today_agenda_originating_task_and_prep_notes` | VG-GUI-2, VG-GUI-4 |
| `bridge_error_not_initialized_maps_to_code_7` | VG-GUI-3 |
| `bridge_error_not_found_maps_to_code_3` | VG-GUI-3 |
| `bridge_error_auth_status_uninitialized_returns_code_7` | VG-GUI-3 |
| `bridge_error_invalid_edge_type_maps_to_code_2` | VG-GUI-3 |
| `error_dto_serializes_correctly` | VG-GUI-3 |
| `bridge_create_note_round_trip` | VG-GUI-2 |
| `bridge_create_task_round_trip` | VG-GUI-2 |
| `bridge_task_status_transition` | VG-GUI-2 |
| `bridge_create_event_round_trip` | VG-GUI-2 |
| `bridge_capture_note` | VG-GUI-2 |
| `bridge_capture_task` | VG-GUI-2 |
| `bridge_promote_and_attach_round_trip` | VG-GUI-2, VG-GUI-7 |
| `bridge_export_creates_files` | VG-GUI-2 |
| `bridge_app_config_returns_config` | VG-GUI-2 |

### Layer G2 — Frontend logic units (TypeScript / vitest)

**Location:** `jin-gui/src/__tests__/*.test.ts`
**Run:** `npm test` (in `jin-gui/`)
**Count:** 603 tests across 12 files

All tests run in Node/jsdom — no Tauri runtime, no real display. They cover
pure logic and DOM-structure assertions. Visual rendering is never exercised.

| File | Primary coverage |
|---|---|
| `today_controller.test.ts` | VG-GUI-2 (agenda transform + render: originating_task, prep_notes, source badge, recurring flag) |
| `dto_shapes.test.ts` | VG-GUI-2 (DTO type shapes + isJinErrorDto guard) |
| `token_discipline.test.ts` | VG-GUI-5 (token presence, no raw hex, font license) + VG-GUI-6 (a11y CSS structure) |
| `appearance_controller.test.ts` | VG-GUI-6 (data-attribute toggles, localStorage persistence) |
| `tasks_controller.test.ts` | VG-GUI-6 (color-independence: status by glyph + label + color) |
| `notes_controller.test.ts` | XSS-safety (sanitization gate), VG-GUI-6 (color-independence) |
| `events_controller.test.ts` | VG-GUI-6 (color-independence: source badge), tz formatting |
| `actions_controller.test.ts` | VG-GUI-7 (edge vocabulary, re-fetch SP3) |
| `capture_controller.test.ts` | VG-GUI-7 (payload construction, validation) |
| `settings_controller.test.ts` | VG-GUI-3 (auth status formatting), VG-GUI-7 (GCP wizard) |
| `router.test.ts` | Shell navigation routing |
| `invoke.test.ts` | Bridge invoke wrappers (all §4.2 commands exercise the correct command names) |

### Layer G3 — CSS discipline (stylelint)

**Location:** `jin-gui/src/styles/**/*.css`
**Run:** `npm run lint:css` (in `jin-gui/`)
**Config:** `jin-gui/stylelint.config.js` + `jin-gui/stylelint-plugin-jin.js`

Rules enforced:

- `jin/no-raw-hex-in-components` — raw hex only allowed in `tokens.css`
- `color-named: never` — no named colors (`red`, `white`, etc.) in component CSS
- `color-no-invalid-hex` — malformed hex strings caught early

`tokens.css` is excluded from rule 1 (it is the token source). `index.css` and
`main.css` (pure `@import` files) are also excluded.

---

## 2. VG-GUI gate traceability matrix

| Gate | Description | Enforcing test(s) | File(s) | Layer | Headless/Visual |
|---|---|---|---|---|---|
| **VG-GUI-1** | No direct rusqlite in jin-gui | `vg4_vg_gui_1_no_rusqlite_direct_dep` | `src-tauri/tests/bridge.rs` | G1 | Logic |
| **VG-GUI-2** | DTO-envelope parity + hero flow end-to-end | `vg_gui_2_today_agenda_originating_task_and_prep_notes`; `AgendaEventDto — VG-GUI-2 fields`; `renderTodayView — originating_task`; `renderTodayView — prep_notes` | bridge.rs; dto_shapes; today_controller | G1 + G2 | Logic |
| **VG-GUI-3** | Error-state mapping (codes 3/4/5/6/7/2) | `bridge_error_not_found_maps_to_code_3`; `bridge_error_not_initialized_maps_to_code_7`; `bridge_error_auth_status_uninitialized_returns_code_7`; `bridge_error_invalid_edge_type_maps_to_code_2`; `error_dto_serializes_correctly` | bridge.rs | G1 | Logic |
| **VG-GUI-4** | Hero fields: `originating_task` + `prep_notes` present | `vg_gui_2_today_agenda_originating_task_and_prep_notes` | bridge.rs | G1 | Logic |
| **VG-GUI-5** | Token discipline: role tokens only; SF not bundled; Inter (OFL) is | `VG-GUI-5: tokens.css defines required semantic tokens` (17 tests); `VG-GUI-5: no raw hex in component CSS files`; `VG-GUI-5: font licensing — Inter bundled, SF Pro not`; stylelint (`jin/no-raw-hex-in-components`, `color-named: never`) | token_discipline.test.ts; stylelint | G2 + G3 | Logic |
| **VG-GUI-6** | A11y fallbacks: reduced-transparency + increased-contrast + reduced-motion via media-query AND `[data-*]` toggle; color-independence; ARIA labels | `VG-GUI-6: a11y fallbacks are present in a11y.css` (8 tests); `applyToRoot` / `togglePref` tests; source badge aria-label tests; `taskStatusLabel` + `taskStatusGlyph` tests; XSS sanitization gate | token_discipline; appearance_controller; tasks_controller; today_controller; notes_controller | G2 | Logic |
| **VG-GUI-7** | Pure-consumer: no GUI logic; re-fetch via core; deferred items have no affordances | VG-GUI-1 (no rusqlite); `bridge_promote_and_attach_round_trip`; `Post-mutation refresh (SP3)` tests in actions_controller | bridge.rs; actions_controller | G1 + G2 | Logic |
| **VG-GUI-8** | Headless honesty: CI proves logic only; visuals require owner sign-off | _Documentation / policy gate_ — see §0 declaration, §5 checklist, and Makefile + CI labeling | Makefile `verify-gui`; CI `[VG-GUI-8]` step; this document | — | **Policy** |

### Gate status: all covered

No VG-GUI gate lacked an explicit test at the time GUI-S6 landed. VG-GUI-8 is a
documentation/policy gate (not a code-logic gate) and is enforced by the
labeling in the Makefile, the CI step, and this document.

---

## 3. Per-gate detail

### VG-GUI-1 — No direct rusqlite (= core VG4 preservation)

**Gate assertion:** `jin-gui/src-tauri/Cargo.toml` contains no `rusqlite`
dependency — the bridge crate never opens a SQLite file directly.

**Enforcing test:** `vg4_vg_gui_1_no_rusqlite_direct_dep` in `bridge.rs`.
This test reads the crate's own `Cargo.toml` at compile time via
`include_str!("../Cargo.toml")` and asserts that no non-comment line contains
the string `"rusqlite"`. Any future accidental addition of rusqlite as a
dependency will immediately break this test.

**Note:** The primary VG4 enforcement is the `pub(crate) mod index` visibility
in `jin-core/src/lib.rs` (compile-time proof); the bridge test is the explicit
GUI-layer complement.

### VG-GUI-2 — DTO-envelope parity + hero flow end-to-end

**Gate assertion:** Every command returns the DTO envelope
`{ jin_dto_version, kind, data, warnings }`; the hero flow
(`today_agenda` → `AgendaEventDto`) populates `originating_task` and
`prep_notes` after a task→promote→note→attach sequence.

**Enforcing tests:**

- **Bridge (G1):** `vg_gui_2_today_agenda_originating_task_and_prep_notes` —
  full round-trip: `create_task` → `promote` → `create_note` → `attach_note` →
  `today_agenda_fn`. Asserts `originating_task.id` + `originating_task.title`
  and `prep_notes[0].id` + `prep_notes[0].title` match the created entities.
- **DTO shape (G2):** `AgendaEventDto — VG-GUI-2 fields` in `dto_shapes.test.ts` —
  TypeScript compile-time proof that `AgendaEventDto.originating_task` is
  `LinkedTaskRef | null` and `prep_notes` is `LinkedNoteRef[]`.
- **Render (G2):** `renderTodayView — originating_task` + `renderTodayView — prep_notes`
  in `today_controller.test.ts` — 18 tests asserting that promoted events render
  the task title, task id, and note links into the DOM and that `onNavigate` is
  called with the correct `section` + `id` when clicked.

### VG-GUI-3 — Error-state mapping

**Gate assertion:** Exit-code-equivalents 3/4/5/6/7/2 map to the correct
`JinErrorDto { code, kind, retriable }` shapes.

| Code | Kind | Test |
|---|---|---|
| 2 | `usage` | `bridge_error_invalid_edge_type_maps_to_code_2` |
| 3 | `not_found` | `bridge_error_not_found_maps_to_code_3` |
| 7 | `integrity` | `bridge_error_not_initialized_maps_to_code_7` |
| 7 | `integrity` | `bridge_error_auth_status_uninitialized_returns_code_7` |
| — | serialization | `error_dto_serializes_correctly` |

Code 4 (`sync_conflict`) and code 5 (`auth`) are not exercised in the bridge
test suite because they require a live sync state machine with cassette
responses (code 4) or OAuth tokens (code 5). These error states are documented
as `[GAP G3]` in the spec; they are exercised in the core test suite
(`s63_conflict_resolution.rs`, `s61_auth.rs`). The GUI bridge tests cover the
three error conditions that are fully exercisable headless.

### VG-GUI-4 — Hero-field presence

Covered fully by the VG-GUI-2 bridge test
(`vg_gui_2_today_agenda_originating_task_and_prep_notes`), which is the
same round-trip test.

### VG-GUI-5 — Token discipline

Three layers of enforcement:

1. **`token_discipline.test.ts` — token presence (17 tests):** Reads
   `src/styles/tokens.css` directly and asserts every required semantic token
   exists: `--label`, `--label-secondary`, `--bg-base`, `--bg-secondary`,
   `--bg-elevated`, `--separator`, `--separator-opaque`, `--accent`,
   `--system-red/green/orange/yellow`, `--fill-primary`, all 11 HIG text-style
   size tokens, `--font-text` (with `-apple-system` + `Inter`),
   `--dynamic-type-scale`, spacing tokens, radius/hit-target tokens, motion
   tokens, and the dark-mode override block with two elevated tiers.

2. **`token_discipline.test.ts` — no raw hex in components:** Reads every
   `.css` file in `src/styles/` except `tokens.css` and asserts no line
   contains a hex color pattern (`#RGB`, `#RRGGBB`, etc.).

3. **`token_discipline.test.ts` — font licensing:** Asserts
   `@fontsource/inter` is in `package.json` dependencies and that no CSS file
   bundles SF Pro via a `@font-face src: url(...)` reference.

4. **Stylelint (G3):** `jin/no-raw-hex-in-components` rule enforces the no-raw-hex
   constraint at lint time (independent of the vitest check); `color-named: never`
   enforces no named colors.

**Visual-only aspects of VG-GUI-5:** Contrast ratios (4.5:1 / 7:1 targets),
glass material rendering, and Dynamic-Type reflow are owner-verified.

### VG-GUI-6 — A11y dual-fallback

Three enforcement points:

1. **`token_discipline.test.ts` — CSS structure (8 tests):** Reads
   `src/styles/a11y.css` and asserts that each of the three fallbacks has
   **both** a media query AND a manual `[data-*]` attribute selector, and that
   the reduced-transparency fallback sets `backdrop-filter: none`.

2. **`appearance_controller.test.ts` — runtime toggle logic:** Asserts that
   `applyToRoot(root, prefs)` correctly sets `data-reduce-transparency`,
   `data-increase-contrast`, `data-reduce-motion`, and `data-appearance` on
   the root element, and that `togglePref` flips the correct boolean.
   localStorage persistence is also tested.

3. **Color-independence tests:** `tasks_controller.test.ts` asserts every task
   status renders a text label AND a glyph (icon name) — never color-only.
   `today_controller.test.ts` asserts the source badge carries a text label
   ("Jin" / "Google") and an `aria-label`. `notes_controller.test.ts` asserts
   the same for note status.

4. **XSS-safety (Markdown sanitization):** `notes_controller.test.ts` test
   `renders script tags as literal text — NOT executed (sanitization gate)`
   asserts that `<script>` injected as note body markdown becomes literal text
   in `textContent` and that `window.__xss_notes` is not set. This is a
   defense-in-depth test even though Jin data is local.

**Visual-only aspects of VG-GUI-6:** Actual contrast ratios on-screen, the
visual presentation of reduced-transparency vs opaque surfaces, and Dynamic-Type
reflow at AX sizes are owner-verified.

### VG-GUI-7 — Pure-consumer

Complemented by VG-GUI-1 (no rusqlite) and by:

- `bridge_promote_and_attach_round_trip` — verifies that promote + attach flow
  through `jin-core` (not independent GUI logic).
- `actions_controller.test.ts` — `buildPromotePayload`, `buildAttachPayload`,
  `buildLinkPayload` tests verify that the GUI constructs the exact invoke
  arguments and does not invent or modify the semantics.

No edit affordances are present for deferred items (recurrence editing, block
notes editor, multi-account) — verified by the absence of such features in the
codebase.

### VG-GUI-8 — Headless honesty

**Gate assertion:** CI proves logic only; visual correctness requires the
owner's §7.4 sign-off; no story claims visuals from a headless build.

**Enforcement mechanisms (not code-logic tests):**

- `make verify-gui` prints `[VG-GUI-8] LOGIC VERIFIED — visuals NOT verified.`
  after all gates pass.
- The CI `verify-gui` job has a named final step
  `[VG-GUI-8] LOGIC VERIFIED — visuals NOT verified` that echoes the labeling.
- Every test file in `src/__tests__/` carries a header comment stating that
  visual correctness is owner-verified via `cargo tauri dev`, never claimed by
  the test suite.
- This document declares the split explicitly in §0 and lists the owner
  visual checklist in §5.

---

## 4. Headless vs visual-only classification

| Concern | Headless (CI green = verified) | Visual-only (owner must verify) |
|---|---|---|
| Bridge DTO envelope shape | ✓ | |
| originating_task + prep_notes in AgendaEventDto | ✓ | |
| Error-code → JinErrorDto mapping | ✓ | |
| CSS token presence and no-raw-hex | ✓ | |
| Inter bundled; SF Pro not bundled | ✓ | |
| A11y fallback CSS structure | ✓ | |
| data-attribute toggles (logic) | ✓ | |
| Color-independence (text + glyph + label) | ✓ | |
| XSS sanitization (script tags as text) | ✓ | |
| Agenda transform (sort, group, isEmpty) | ✓ | |
| Task/Notes/Events filter + sort logic | ✓ | |
| Payload construction (promote/attach/link) | ✓ | |
| TypeScript type correctness | ✓ | |
| Vite production build succeeds | ✓ | |
| **Glass rendering** (blur quality, specular edge, vibrancy) | | owner |
| **Light/dark appearance** (colors, two dark tiers) | | owner |
| **Motion/transitions** (reduced-motion override) | | owner |
| **Dynamic-Type reflow** (AX sizes, no clipping) | | owner |
| **44 pt tap targets** (ergonomics on hardware) | | owner |
| **Sidebar inset + soft scroll-edge** | | owner |
| **OAuth loopback** (PKCE + browser hand-off) | | owner |
| **WebKitGTK vs WKWebView** glass divergence | | owner |

---

## 5. Owner visual verification checklist (GM milestone sign-off)

This checklist is extracted from the spec `gui-mvp.md §7.4` and represents
the minimum owner sign-off required to mark a milestone "visually done."
No story may claim visual correctness from a headless build alone.

Run `cargo tauri dev` on the target Linux desktop (or macOS) and check each
item. Record the build hash / commit when signing off.

### GM2 — Look & shell (GUI-S1 → GUI-S2) visual sign-off

- [ ] Glass (sidebar, toolbar, cards) renders with legible vibrancy — blur is visible, text readable through the material
- [ ] Light mode and dark mode switch correctly (manual toggle in Settings + system preference)
- [ ] Dark mode shows two distinct background tiers (deep black base vs elevated surfaces)
- [ ] Reduced-transparency toggle (`Settings → Accessibility → Reduced transparency`) produces fully opaque, legible surfaces
- [ ] Increased-contrast toggle (`Settings → Accessibility → Increased contrast`) produces stark separators and solid secondary labels
- [ ] Reduced-motion toggle (`Settings → Accessibility → Reduced motion`) stops all animation — transitions are instant
- [ ] Sidebar collapses to two-column and then single-column on narrow windows without clipping
- [ ] All sidebar items ≥ 44 pt tall and clearly tappable/clickable
- [ ] Focus rings are visible on keyboard navigation throughout the shell
- [ ] Dynamic-Type at AX3 scale (Settings → Text Size → AX3) reflows without clipping any text

### GM3 — Hero & content (GUI-S3 → GUI-S6) visual sign-off

- [ ] Today view shows today's events sorted by time in `display_tz`, all-day events grouped at the top
- [ ] A promoted event (task → promote) shows its originating task inline, tappable to the Task detail
- [ ] An event with attached prep notes shows the note list, each note tappable to the Note detail
- [ ] A recurring event is labelled "Recurring (not expanded)" — not omitted, not expanded
- [ ] Capture sheet springs from the "+" button and its trigger anchor correctly
- [ ] Event source badge displays "Jin" or "Google" as text (not color-only)
- [ ] Task status is conveyed by color AND glyph AND label (e.g. done = green circle-check + "Done")
- [ ] Promote action creates a new event that appears in Today with the originating task
- [ ] Attach action adds the note to the event's prep-notes list after refresh

### GM4 — Sync & ship (GUI-S7 + full §7.4 checklist) visual sign-off

- [ ] Glass renders with legible vibrancy on Linux (blur quality acceptable; if poor, owner may default to solid via the reduced-transparency toggle)
- [ ] Light↔dark switch is correct on macOS (two dark tiers distinct)
- [ ] Reduced-transparency toggle yields opaque legible surfaces on both platforms
- [ ] Increased-contrast toggle yields stark separators
- [ ] Reduced-motion toggle stops all animation
- [ ] Dynamic-Type at AX3 reflows without clipping
- [ ] 44 pt targets feel right (buttons, sidebar items, hit areas)
- [ ] Today shows a promoted event's originating task + reachable prep notes
- [ ] capture→promote→attach→sync round-trips visibly (end-to-end hero flow)
- [ ] OAuth loopback completes: `Settings → Connect Google` opens the system browser, PKCE redirect returns, status flips to "Connected" with account + expiry

---

## 6. How to run `make verify-gui`

```
make verify-gui
```

This single command (from the repo root) runs in order:

1. `cargo fmt --check` — Rust formatting gate
2. `cargo clippy -p jin-gui --all-targets -- -D warnings` — Rust lint gate
3. `cargo test -p jin-gui` — bridge integration tests (16 tests: VG-GUI-1 through VG-GUI-4)
4. `npm ci --silent` — install/verify frontend dependencies
5. `npx tsc --noEmit` — TypeScript type-check gate
6. `npm test` — vitest frontend logic units (603 tests: VG-GUI-2 through VG-GUI-7)
7. `npm run lint:css` — stylelint CSS token discipline (VG-GUI-5)
8. `npx vite build` — production build gate (catches bundler/tree-shaking issues)

All steps run headless. The last printed line is the VG-GUI-8 label:

```
[VG-GUI-8] LOGIC VERIFIED — visuals NOT verified.
           Owner visual sign-off required: docs/gui-testing.md section 5.
```

Individual targets:

```
make build-gui       # cargo build -p jin-gui only
make test-gui        # cargo test -p jin-gui only (bridge tests)
make verify          # core (jin-core + jin CLI) gate only — unchanged
make verify-all      # core gate + GUI gate in sequence
```

---

## 7. CI alignment

The `.github/workflows/ci.yml` `verify-gui` job runs the equivalent steps as
individual actions (not via `make verify-gui` because the CI uses
`actions/setup-node` for Node while the local Makefile uses NVM):

| CI step | Makefile equivalent |
|---|---|
| `Build jin-gui command bridge` | `cargo build -p jin-gui` |
| `Run jin-gui bridge tests` | `cargo test -p jin-gui` |
| `Clippy — jin-gui` | `cargo clippy -p jin-gui -- -D warnings` |
| `Fmt check — jin-gui` | `cargo fmt -p jin-gui --check` |
| `Install frontend dependencies` | `npm ci` |
| `TypeScript type check` | `npx tsc --noEmit` |
| `Vitest frontend tests` | `npm test` |
| `Stylelint CSS token discipline (VG-GUI-5)` | `npm run lint:css` |
| `Vite production build` | `npx vite build` |
| `[VG-GUI-8] LOGIC VERIFIED — visuals NOT verified` | Makefile echo + this doc |

The CI job and the Makefile target are kept in sync — any new gate added to
the Makefile should be reflected in the CI workflow and vice versa.

---

## 8. `[GAP]` notes

- **VG-GUI-3 codes 4/5:** Sync-conflict (code 4) and auth-expired (code 5)
  error states are not exercised in the GUI bridge test suite because they
  require a live sync state machine with cassette HTTP responses or an OAuth
  token store. These are fully covered in the core test suite
  (`s63_conflict_resolution.rs`, `s61_auth.rs`). The GUI bridge tests cover
  all three headless-exercisable error conditions (not_found, not_initialized,
  invalid_edge_type).

- **VG-GUI-8 WebKitGTK vs WKWebView `[GAP G1]`:** `prefers-reduced-transparency`
  and `prefers-contrast` media query support is inconsistent on WebKitGTK. The
  manual `[data-*]` toggles are mandatory (not optional) for exactly this
  reason. The structural presence of both mechanisms is verified headless; the
  actual rendering is owner-verified on the Linux desktop.

- **VG-GUI-8 OAuth loopback `[GAP G3]`:** The PKCE + system-browser + 127.0.0.1
  redirect flow is owner-machine-only and not exercisable headless. It is
  listed in the GM4 visual sign-off checklist.

## Visual QA harness (headless screenshots)

Closes part of the VG-GUI-8 gap: renders the **real** built frontend with the
**real** CSS, mocking the Tauri `invoke` bridge with fixture data, and captures
PNGs of the ToDo views + modals — so styling regressions (missing CSS on a
class, undefined design tokens, broken layout) are visible without launching the
desktop app.

```sh
cd jin-gui
npm ci
npx playwright install chromium          # one-time: download the browser
npm run screenshots -- /tmp/jin-shots     # builds dist/ then writes PNGs
```

- Output: `01-list-view.png`, `02-board-view.png`, `03-new-list-modal.png`.
- Harness: `jin-gui/tools/screenshot.mjs` (fixtures + injected `__TAURI_INTERNALS__` mock).
- **Linux sandboxes** where Chromium can't find system libs (`libnspr4.so: cannot
  open shared object file`): prefix with `LD_LIBRARY_PATH=/run/host/usr/lib64` (the
  host libs are mounted). macOS needs no such prefix.
- This is **local visual QA**, not CI. CI stays headless-honest (§0): a green
  build still never means the UI looks correct — owner sign-off remains required.

## Agent browser workflow (Playwright MCP)

Owner-local MCP configuration registers `@playwright/mcp@0.0.79` and loads
`.agents/playwright/mcp.config.json`. The local configuration is generated for
the owner's environment, ignored by Git, and is not part of the public project
snapshot. The portable project configuration provides a headless, isolated,
deterministic Chromium context and saves MCP output below
`.artifacts/playwright-mcp/`.

Start the existing Vite server; do not introduce a second test server:

```sh
npm --prefix jin-gui run dev:agent
```

Agents then navigate to `http://127.0.0.1:1420`. The MCP origin allowlist and
the fixture's own origin check are both pinned to that URL. The init script at
`jin-gui/tools/tauri-fixture-init.js` injects a deterministic Tauri bridge only
for that origin, preserves a real bridge if one already exists, returns fresh
clones of fixture data, and rejects commands the harness has not modeled.

### Setup and drift checks

- Run `node scripts/validate-playwright-mcp.mjs` after changing MCP wiring,
  config, skills, fixture data, or the agent dev command. The default check
  launches the pinned browser and fails with the exact install command when it
  is unavailable. Use `--static-only` only for offline configuration drift
  checks; it does not establish browser readiness.
- MCP clients read their local server configuration at startup. Restart the
  relevant agent host after changing its owner-local configuration or
  `.agents/playwright/mcp.config.json`.
- The server version is deliberately exact. Do not replace
  `@playwright/mcp@0.0.79` with `latest` or a range; revalidate the
  configuration schema when intentionally upgrading.
- If Chromium is absent, install the browser once with
  `npx -y @playwright/mcp@0.0.79 install-browser`. This download requires
  network access; an offline validation run should report the missing browser,
  not loosen the version pin.

The canonical agent playbooks are
`.agents/skills/jin-playwright-mcp/SKILL.md` and
`.agents/skills/jin-gui-visual-qa/SKILL.md`; `.claude/skills/` exposes relative
directory symlinks to the same files so the instructions cannot drift between
hosts.

Playwright MCP evidence remains headless browser evidence. It does not exercise
the native Tauri bridge, jin-core, filesystem operations, OAuth, or platform
WebView behavior, and it does not replace the owner visual sign-off in §5.
