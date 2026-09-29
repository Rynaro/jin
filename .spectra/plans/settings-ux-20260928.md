---
eidolon: ramza
version: 3.0.0
kind: spec
status: ready-for-vivi
created_at: '2026-09-28T21:12:00Z'
target_repos: [jin]
stories_count: 3
validation_gates_count: 4
---
# Settings: compact, legible, predictable

## Scope
Intent class: CHANGE. Improve the existing four Settings panes, preserve dirty source changes, add a truthful text-size control and one supported workspace preference. No backend/schema changes, new settings search, new navigation rail, fake state, arbitrary typography scale, or new global design system. Canonical `docs/visual-language/README.md` supersedes older skill language: neutral macOS-like chrome, system type, restrained separators, shared 28/32px controls, 44px coarse-pointer targets. Complexity gate: 5/12 (standard). RAMZA right-sizing computed trivial; explicit lite override records the researched design/inventory scope.

## Approach
Use compact aligned settings rows on one neutral continuous field. Keep the four existing pane keys, persistence and controllers. Align pane content to the workspace's leading edge, use a readable 760px maximum width, 16–24px desktop outer inset, a compact pane header, 16–24px group gaps, and 8px row rhythm. At narrow widths or enlarged text stack label and control, allow controls to wrap, and preserve document overflow protection. Remove duplicate foundational Settings overrides by consolidating at the owning selectors; do not append another patch block.

General groups: Appearance (theme, text size), Accessibility (existing three overrides), Workspace (Notes layout), Language (existing calendar/events locale). Use sentence-case short labels and one-line practical descriptions. Replace technical Dynamic Type wording with “Scales text throughout Jin.” Keep accessibility system-preference behavior and current overrides unchanged. No new global accessibility toggles.

Text size: preserve the existing twelve `DYNAMIC_TYPE_STEPS` values (.82, .88, .94, 1, 1.12, 1.24, 1.35, 1.6, 1.9, 2.35, 2.75, 3.1). Settings uses a native range with index 0–11 and step 1, mapping to canonical values before the existing appearance persistence pathway. Do not change First Run's scale-valued range contract accidentally. Use a practical 220–300px desktop track rather than the current ~112px track; it becomes full width in stacked rows. Show actual body size as `17 × scale` CSS px (maximum two fractional digits) and scale percentage. Default is index 3, 17 px, 100%; mark that position on the track with a visible tick plus “Default” text and a compact “Use default” button enabled off-default. A native exact-value select beside the slider offers the same twelve body sizes; this is preferred over a free numeric field that silently snaps input. Both controls must communicate actual values, and the slider's aria-valuetext must contain body size/percentage rather than raw index. Live feedback and loaded persisted values use the same formatter. Root is 16px × scale while body is 1.0625rem: do not report root px as body px. Avoid a heavyweight preview card; the live Settings content already provides feedback.

Notes layout: add compact List/Cards selection using existing `jin_notes_explorer_view` storage utility, labelled “Notes layout” with “Preferred layout when browsing notes.” Preserve the Notes toolbar control and all loaded note identities/order. This is one persisted preference, not a new separate default. Ensure Settings selection and subsequent Notes route use the same state even when controllers remain mounted; use a small shared preference-change event or reread on route activation consistent with existing lifecycle. Do not duplicate localStorage parsing.

Notifications: put permission status, explanation and permitted actions in natural content flow, removing the large empty gap; keep real granted/denied/restricted/browser behavior, existing accessible action names, pending state and errors. Calendars: tighten account/summary layout; normalize action icons to shared ~14–16px visual size within full control targets; make calendar palette targets adequately sized with visible selected state without replacing enabled-sync checkboxes with local visibility controls. Data & Storage: retain folder, export/import and diagnostics contracts; use compact labeled rows and the existing disclosure for technical details, not extra empty cards.

## Evidence and research
ATLAS browser baseline at 1280×800 found 114px General rows, a 129×16px raw-scale slider without numeric meaning, a 93px Notifications gap, and 22×22px calendar palette buttons. Compact 390×844 General reached 1230px tall but had no document horizontal overflow. The 720px readable measure is healthy; preserve 720–760px rather than expanding across the whole workspace. Baseline screenshots and accessibility snapshots use `.artifacts/playwright-mcp/atlas-settings-*`. No browser warnings/errors observed. Duplicate late Settings overrides remain a cascade risk. Existing uncommitted Settings/index changes must be integrated, including pending initial-pane hydration work. Code contracts: `src/lib/appearance/preferences.ts`, `src/controllers/appearance_controller.ts`, `src/lib/notes/explorerPrefs.ts`, `src/controllers/settings_controller.ts`, and `src/controllers/notes_controller.ts` under `jin-gui`.

Apple explicitly supports pairing sliders with exact values, real-time feedback and helpful ticks. Jin will adapt this with a precise supported-size picker and default tick. [Apple Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders?changes=_4)
Apple recommends useful defaults, few settings, related panes, and keeping task options close to their context. We keep existing route selectors while surfacing only the persisted Notes layout as a useful preference. [Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings?changes=_9)
A slider needs a meaningful accessible value plus Arrow/Home/End behavior. Native range supplies the fundamental interaction; expose readable units through aria-valuetext. [W3C Slider Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)
Target size is at least 24×24 CSS px subject to WCAG exceptions; apply Jin's larger shared 28/32px desktop and 44px coarse-pointer targets rather than shrinking hit areas with icons. [WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Preference inventory
| Preference | Decision | Reason |
|---|---|---|
| Theme, text scale, contrast, motion, transparency | Improve existing controls | Real appearance persistence already exists |
| Notes List/Cards layout | Add to General/Workspace | Existing persisted presentation preference, useful as a stable default |
| Calendar/events language | Retain and clarify scope | Existing setter; does not translate whole app |
| Notification permission and test | Improve grouping | Existing status/actions; never invent reminder schedules |
| Account sync enablement and calendar colors | Retain and improve targets | Real backend-enabled state and color preference |
| Storage/export/import/diagnostics | Retain and improve density | Existing actions/read-only fields |
| Sidebar expansion | Keep contextual | Globally reachable visibility command; can hide its own Settings navigation |
| Tasks List/Board, calendar Month/Week/Day, calendar visibility | Keep contextual | Operational task/view choices, not general setup |
| Last event destination | Keep contextual | Remembered editor choice, not an independent default contract |
| Timezone, default calendar, schema version | Read-only diagnostics | Existing config getter but no supported setter |
| App/core versions, week start, time format, launch behavior, autosave/reminder schedule | Defer | No established UI setter/bridge contract |

## Stories
### Story 1: Clear compact panes
As a user, I can scan Settings without large empty gaps or mismatched controls. Timebox: 1d. Risk P1. Executor: Sol 6 Medium, adapt existing markup/primitives; scoped CSS consolidation, no global redesign.
### Story 2: Exact text size and default
As a user, I can see and choose a supported numeric body size and recover the default. Timebox: 1d. Risk P1. Executor: use canonical appearance steps, keep persistence and First Run compatibility; add focused controller tests.
### Story 3: Preferred Notes layout
As a user, I can discover my persisted Notes layout preference in Settings. Timebox: 1d. Risk P2. Executor: share explorer preference utility and mounted-controller synchronization; test switching both ways.

## Acceptance Criteria
### AC-001 (ubiquitous)
THEN all four existing pane keys SHALL retain their routing behavior.
VERIFY: focused settings_controller tests including existing dirty tests.
### AC-002 (state-driven)
GIVEN a stored supported text scale
THEN Settings SHALL display its actual body size and percentage.
VERIFY: table-driven tests at default, .88 and 3.1.
### AC-003 (event-driven)
WHEN the native size range changes to any index 0–11
THEN appearance persistence SHALL receive the corresponding canonical scale.
VERIFY: range mapping/controller tests for all supported indices.
### AC-004 (event-driven)
WHEN Use default is activated off-default
THEN persisted text scale SHALL become 1.
VERIFY: appearance/settings controller test and browser interaction.
### AC-005 (state-driven)
GIVEN the text-size control is visible
THEN its default position SHALL be identifiable by a text-labelled tick.
VERIFY: screenshot and DOM audit at default and a nondefault size.
### AC-006 (event-driven)
WHEN the size picker is used
THEN slider and visible numeric value SHALL reflect the selected supported size.
VERIFY: focused controller tests and keyboard browser exercise.
### AC-007 (state-driven)
GIVEN the range is focused
THEN keyboard adjustment SHALL expose meaningful body-size aria-valuetext.
VERIFY: browser Arrow/Home/End exercise plus accessibility snapshot.
### AC-008 (event-driven)
WHEN Notes layout is changed in Settings
THEN the next Notes route activation SHALL render that persisted layout.
VERIFY: mounted-controller route transition test plus browser exercise.
### AC-009 (event-driven)
WHEN Notes layout is changed in its contextual toolbar
THEN reopening Settings SHALL show the same selection.
VERIFY: two-way preference synchronization test.
### AC-010 (ubiquitous)
THEN Notifications permission actions SHALL remain adjacent to their explanatory content in normal flow.
VERIFY: desktop screenshot and bounding-box inspection.
### AC-011 (state-driven)
GIVEN 320, 390, 760 or 1440 CSS px viewport with relevant default/large-text states
THEN Settings SHALL avoid document-level horizontal overflow.
VERIFY: browser scrollWidth/clientWidth checks and screenshots.
### AC-012 (state-driven)
GIVEN light/dark, forced-colors or increased-contrast presentation
THEN Settings controls SHALL retain visible focus and non-color selected-state cues.
VERIFY: targeted visual/accessibility checks.
### AC-013 (ubiquitous)
THEN control targets SHALL use shared desktop/coarse-pointer geometry independently of compact icon size.
VERIFY: target bounding-box inspection including calendar palette.
### AC-014 (ubiquitous)
THEN existing provider, notification, storage and appearance payload contracts SHALL remain unchanged.
VERIFY: focused controller suites, tsc/build and fixture console audit.

## Validation
1. Run relevant settings, appearance and Notes preference/controller tests; cover range mapping, real units/default/reset, two-way Notes synchronization and preserved initial pane hydration.
2. Run package style/token checks, TypeScript/build and git diff --check once after edits; do not broaden unrelated failing work.
3. Playwright MCP at http://127.0.0.1:1420: record initial accessibility snapshot/console, then all four panes at 1280×800; focused 320/390/760/1440 checks as above; large text, dark, forced colors, reduced motion/transparency and coarse pointer where changed; screenshots under .artifacts/playwright-mcp/. Use fixture errors as harness gaps, not permissive fallbacks.
4. Inspect accepted neighboring Notes/Calendar surfaces after preference/global-token interactions. Browser checks do not approve native Tauri rendering, OAuth or real bridge behavior; preserve CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED until owner native sign-off.

## Confidence
Mechanical confidence score: 91.25% — AUTO_PROCEED. Existing contracts and accepted design primitives make this a bounded frontend change. Native rendering remains owner-verifiable; arbitrary text sizes are intentionally excluded.

## Rejected Alternatives
- Spacing-only cleanup scored 82.5: low risk but fails precise text-size/default discoverability and preference addition.
- New search/category architecture scored 70.5: extra lifecycle and navigation complexity for four panes.
- Compact native Settings scored 91.5 and is selected.

## Risks
Preserve pre-existing dirty changes. Index-based range must not break First Run scale values. Notes controller remains mounted: reread/event synchronization is required. Large-text controls must reflow, not get fixed-height clipping. Existing provider sync and calendar display visibility are distinct concepts.

## Executor contract
```json
{"executor":"vivi","model":"gpt-6-sol","reasoning":"medium","selected_approach":"compact-native-settings","source_scope":["jin-gui/index.html","jin-gui/src/styles/settings.css","jin-gui/src/controllers/settings_controller.ts","jin-gui/src/controllers/settings_controller.test.ts","jin-gui/src/controllers/appearance_controller.ts","jin-gui/src/controllers/appearance_controller.test.ts","jin-gui/src/lib/appearance/**","jin-gui/src/lib/notes/explorerPrefs*","jin-gui/src/controllers/notes_controller.ts","jin-gui/src/controllers/notes_controller.test.ts"],"conditional_scope":["jin-gui/src/styles/a11y.css","jin-gui/tools/tauri-fixture-init.js"],"output":"source changes, focused validation, browser artifacts, remaining native limitations","preserve_dirty_changes":true,"backend_changes":false,"new_dependencies":false}
```
