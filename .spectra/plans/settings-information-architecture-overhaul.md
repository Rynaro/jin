---
eidolon: ramza
version: 1.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-04T09:49:15Z
thread_id: 01a06bc8-d754-7a11-8b8b-4c57bc657690
target_repos:
  - Rynaro/jin
stories_count: 4
validation_gates_count: 26
evidence_anchors_count: 12
confidence: 0.91
---

# Settings information architecture overhaul

Change ID: `settings-information-architecture-overhaul`

## Scope

Intent class: `CHANGE`.

Replace the current 3,277px single settings document with a stable category rail and one visible content pane. Preserve every existing setting and behavior while making the page easier to scan, navigate, and use at desktop, compact, and accessibility text sizes.

In scope:

- A full-width Settings split shell built from Jin's existing `jin-split-view`, `jin-context-rail`, and `jin-workspace-pane` primitives.
- Four categories in fixed order: **General**, **Calendars & Sync**, **Notifications**, and **Data & Storage**.
- One visible pane at a time, a visible pane title, an accessible active navigation state, and persistence of the last valid pane in localStorage.
- Grouped, token-backed surfaces with clearer title, explanatory copy, status, and action hierarchy.
- A compact top category navigator below 720px and explicit accessibility-text reflow.
- Desktop standard-text scroll containment: a route-bounded shell, a full-height rail, and the settings workspace as the sole vertical scroller.
- Route/document scrolling retained for compact and accessibility-text layouts, where natural-height reflow is required.
- Native progressive disclosure for advanced Google OAuth guidance and app diagnostics.
- Preservation of all current Stimulus targets, IDs, data actions, async loading/error behavior, notification focus restoration, and dynamically generated Google account/calendar cards.
- Focused unit/static-contract coverage and deterministic desktop/compact visual QA.

Out of scope:

- Backend, Tauri command, DTO, sync, authentication, export, notification, calendar-color, or appearance behavior changes.
- New settings, settings search, deep-linkable category routes, keyboard arrow-key tab semantics, or a generalized navigation component.
- Changes to `jin-gui/src/lib/settings/render.ts`; existing render helpers continue to receive the same target elements.
- Redesigning controls outside Settings or changing global navigation.
- Rewriting dynamic account/card construction beyond adding classes or containment hooks needed by the new layout.

Deferred:

- Settings search. Four stable destinations are faster and less complex now; add search only when labels and dynamic account actions have an explicit index contract.
- URL/hash deep links to individual settings panes. Local persistence satisfies return visits without expanding the router surface.
- A shared reusable preference-navigation component. Promote the local pattern only after a second product surface needs it.

Assumptions and risk if wrong:

- `jin-content-body` can be bounded to the available route height in desktop standard-text mode without changing global route behavior. If its parent sizing contract changes, desktop shell height and workspace overflow need revalidation.
- The current controller stays connected while the user switches internal panes. If Stimulus reconnects on pane hiding, data loads and color-picker lifecycles must be guarded before shipping.
- A 720px compact breakpoint fits Jin's current content/sidebar geometry. Owner QA may adjust the exact token-safe breakpoint without changing the IA.
- Native `hidden` removes inactive panes from layout and the accessibility tree. If a target WebView diverges, use the existing `.hidden` utility as a redundant state, not a custom display protocol.

Complexity (`ramza-score --rubric complexity`): `7/12` → `extended`. Right-size score: `2` → `lite`.

Declared implementation scope:

- `jin-gui/index.html`
- `jin-gui/src/styles/settings.css`
- `jin-gui/src/controllers/settings_controller.ts`
- `jin-gui/src/lib/settings/navigation.ts` (new)
- `jin-gui/src/__tests__/settings_controller.test.ts`
- `jin-gui/src/__tests__/notes_visual_system.test.ts`

Any product-file expansion requires a RAMZA scope amendment before execution continues.

## Approach

Use the selected **persistent single-pane category navigation** hypothesis (`90.5/100`, elite).

### Information architecture

| Destination | Pane title and contents |
|---|---|
| General | Appearance mode, event/calendar language, text size, reduce transparency, increase contrast, reduce motion. |
| Calendars & Sync | Local Jin calendar color; Google account setup and dynamic account/calendar cards; changes awaiting review; manual sync and result/error surfaces. Pending review precedes routine sync. |
| Notifications | Permission status, explanation, contextual primary/secondary actions, test/check actions, live result, and error. |
| Data & Storage | Store root and change-folder action; export workflow; collapsed **About & diagnostics** disclosure containing display timezone, calendar ID, and schema version. |

### Shell and visual hierarchy

- Keep the route-level `<section data-controller="settings">` as the controller boundary. In desktop standard-text mode, bound it to the available route height and suppress route-level vertical scrolling so the workspace pane owns scrolling.
- Make `.settings-view` a `jin-split-view` with a 208px `jin-context-rail` and a flexible `jin-workspace-pane`; remove the current 720px max width from the shell.
- Put the `Settings` identity and category controls in the rail. Each category is a native button with a stable `data-settings-pane-key`, a matching `aria-controls`, and `aria-current="page"` only while active.
- Give each pane a visible title and short purpose line. Center pane content with `inline-size: min(100%, 720px)` inside the flexible workspace, so line length stays calm without constraining the shell.
- Retain `.settings-section` as the behavior-neutral grouping hook but restyle it as a subtle token-backed grouped surface. Keep row separators inside groups; use an attention modifier for pending review and status-led composition for Notifications.
- Use only existing tokens and primitives; do not introduce raw color values or decorative glass/paper effects.
- In desktop standard-text mode, size the split shell to `100%` of the available route block size, make the side rail stretch rather than `align-self: start`, and give only the workspace pane `overflow-y: auto`. The rail must remain full-height and stationary while pane content scrolls.
- Do not make the desktop rail sticky inside a moving route document; its stability comes from the bounded shell and independently scrolling workspace.

### Navigation state contract

- Add `jin-gui/src/lib/settings/navigation.ts` with a closed key union (`general`, `calendars`, `notifications`, `data-storage`), `DEFAULT_SETTINGS_PANE`, `SETTINGS_PANE_STORAGE_KEY`, safe load/save helpers, and a pure DOM state applicator.
- Use a narrow storage key such as `jin.settings.pane`. Reads validate against the closed key set; missing, invalid, or throwing storage returns `general`. Writes silently no-op when storage is unavailable, matching existing Jin preference helpers.
- Add plural `settingsNavItem` and `settingsPane` Stimulus targets. `connect()` applies the restored pane before starting asynchronous settings loads, then leaves all existing initialization calls in place.
- `selectPane(event)` validates the activating button's key, applies the state, and persists it. Switching panes changes no backend/controller state and triggers no data refetch.
- Applying a pane sets `hidden` on every inactive pane, removes stale active classes/ARIA from every inactive nav item, exposes one active pane, and sets one `aria-current="page"` marker.
- After applying a category, reset the Settings workspace element's `scrollTop` to `0`; add a dedicated `settingsWorkspace` target so the controller does not reset the route or document scroll position.
- Navigation does not move focus automatically. The initiating category button retains focus after the scroll reset; existing notification-operation focus restoration remains authoritative inside the Notifications pane.

### Responsive and accessibility contract

- Above 720px at standard text scale, use the route-bounded two-column split, stretch the rail to the shell's full height, disable route overflow, and make the workspace pane the sole vertical scroller.
- At 720px and below, stack the rail above the workspace, restore route/document `overflow-y: auto`, let the shell return to natural height, disable workspace vertical scrolling, and turn category controls into a compact horizontally scrollable strip with visible focus and active treatments.
- Under `data-text-scale="accessibility"`, apply the same natural-height route/document scrolling contract regardless of viewport, stack the shell, disable the workspace scroller, and allow category items to reflow so enlarged labels do not create page-level horizontal overflow.
- Preserve 44px tap targets through existing `tap-target`/control conventions, visible `:focus-visible`, reduced-transparency fallbacks, increased-contrast separators, reduced-motion behavior, and forced-colors readability.

### Evidence and pattern fit

- Current route markup and content inventory: `jin-gui/index.html:1842-2373`.
- Current fixed-width/flat settings styles: `jin-gui/src/styles/settings.css:22-635`.
- Existing targets and connection lifecycle: `jin-gui/src/controllers/settings_controller.ts:90-236`.
- Async notification focus contract: `jin-gui/src/controllers/settings_controller.ts:380-440`.
- Dynamic account/calendar UI: `jin-gui/src/controllers/settings_controller.ts:476-565`.
- Existing settings render helpers: `jin-gui/src/lib/settings/render.ts`.
- Existing split-view primitives: `jin-gui/src/styles/components.css:9-44`.
- Existing outer route scroll host: `jin-gui/src/styles/layout.css:507-513`.
- Existing tests: `jin-gui/src/__tests__/settings_controller.test.ts` and `jin-gui/src/__tests__/notes_visual_system.test.ts:189-210`.
- Notion separates workspace/account settings into navigable categories: <https://www.notion.com/help/workspace-settings> and <https://www.notion.com/en-gb/help/account-settings>.
- Linear separates preference areas and groups notification behavior: <https://linear.app/docs/account-preferences> and <https://linear.app/docs/notifications>.
- Figma distinguishes account, community, and notification settings: <https://help.figma.com/hc/en-us/articles/1500006061462-View-and-manage-account-settings>.
- Discord gives Accessibility a dedicated destination: <https://support.discord.com/hc/en-us/articles/1500010454681-Accessibility-Settings-Tab>.
- Apple recommends stable panes, visible active context, restored pane selection, and restrained settings surfaces: <https://developer.apple.com/design/human-interface-guidelines/settings>.

Pattern assessment: **adapt (80%)**. Jin already owns the split-view geometry, rail-row active markers, safe localStorage precedent, hidden-pane controllers, token system, and accessibility cascade. The change adapts these patterns locally instead of inventing a new global component.

## Stories

### Story 1: Recompose the settings document into four destinations

As a Jin user, I want settings grouped by intent, so that I can find a control without scanning unrelated workflows.

Timebox: `1d`.
Risk tag: `P1`.
Executor hint: `mid` tier — preserve hooks exactly and use the file-level action plan below.

Action plan:

1. In `jin-gui/index.html`, wrap the existing settings content in the split shell, add four nav buttons and four labelled panes, and move existing sections without renaming/removing their behavior hooks.
2. Demote existing section headings one level beneath each visible pane title while preserving meaningful labels.
3. Place app diagnostics in a native `<details>` disclosure; keep store-folder and export actions immediately visible.
4. Order Calendars & Sync as local/account setup → pending review → sync.

Output contract: valid semantic HTML with four matching button/pane keys and a byte-for-byte inventory match for existing target/id/action attribute values.

### Story 2: Add persistent, behavior-neutral pane selection

As a returning Jin user, I want Settings to reopen where I left it, so that repeated setup work stays efficient.

Timebox: `1d`.
Risk tag: `P1`.
Executor hint: `mid` tier — extract pure navigation/storage functions and keep controller orchestration thin.

Action plan:

1. Add the closed pane key and safe storage/DOM helpers in `jin-gui/src/lib/settings/navigation.ts`.
2. Add only the new plural nav/pane targets and `selectPane` action to `SettingsController`.
3. Apply the restored pane before asynchronous loads in `connect()`.
4. Reset only `settingsWorkspaceTarget.scrollTop` on category change while leaving focus on the activating button.
5. Prove pane switching does not call `invoke`, recreate color pickers, or disturb notification operation state.

Output contract: deterministic helper API, one visible pane invariant, one active nav invariant, safe fallback, and no backend side effects.

### Story 3: Establish responsive grouped surfaces

As a Jin user on desktop or a narrow window, I want stable navigation and readable groups, so that Settings feels native to the rest of Jin.

Timebox: `1.5d`.
Risk tag: `P1`.
Executor hint: `mid` tier — extend `settings.css` with existing tokens/primitives and explicit compact/AX modes.

Action plan:

1. Remove the shell max-width, bound the desktop standard-text shell to the route, stretch the rail to full height, and make the workspace the sole vertical scroller while keeping pane content capped at 720px.
2. Style nav items with existing rail-row selected/hover/focus vocabulary.
3. Convert `.settings-section` from flat divider blocks to subtle grouped surfaces, including pending-review and notification status hierarchy.
4. Add the 720px compact and accessibility-scale overrides that restore natural-height route/document scrolling, plus reduced-transparency/high-contrast compatibility and overflow containment.

Output contract: no new raw colors, exactly one vertical scroll owner per responsive mode, no horizontal page overflow, and no regressions to existing 44px targets.

### Story 4: Lock the IA and behavior with tests and visual evidence

As a maintainer, I want the new settings structure mechanically guarded, so that later feature additions do not recreate the long flat document.

Timebox: `1d`.
Risk tag: `P1`.
Executor hint: `mid` tier — combine unit, static-contract, build, lint, and deterministic browser checks.

Action plan:

1. Extend `settings_controller.test.ts` for key validation, storage failure, sole-pane visibility, active state, persistence, workspace scroll reset with retained category-button focus, no-refetch switching, dynamic-card containment, and notification focus regression.
2. Replace the obsolete flat/transparent section assertion in `notes_visual_system.test.ts` with split-shell, category order, hook-preservation, grouped-surface, responsive, AX, and token-contract assertions.
3. Run focused tests first, then CSS lint, TypeScript/Vite build, and the full Vitest suite.
4. Use Jin's deterministic Playwright workflow to inspect 1280x800, 720x800, and 390x844 in light/dark plus one accessibility-text pass; record dimensions, overflow, active states, keyboard focus, and console output.

Output contract: all commands green and visual evidence showing one pane, stable navigation, readable hierarchy, no clipped controls, and zero new console errors.

## Acceptance Criteria

The normative, freezeable EARS criteria are in `.spectra/plans/settings-information-architecture-overhaul.criteria.md` and comprise `AC-SET-001` through `AC-SET-026`.

Amendment 1 adds the verified scrolling contract: desktop standard-text mode uses a route-bounded shell, full-height rail, and workspace-owned scrolling; compact and accessibility-text modes retain route/document scrolling; category changes reset only workspace scroll while preserving category-button focus.

Implementation is accepted only when every criterion passes its named verification method. Existing behavior tests are regression requirements, not optional evidence.

## Confidence

`ramza-score --rubric confidence`: `91%` → `AUTO_PROCEED`.

Confidence is high because the requested IA is explicit, ATLAS mapped all behavior-bearing hooks, Jin already has the required shell/state patterns, and verification is bounded to six frontend files. Remaining uncertainty is visual tuning in the target WebView, addressed by owner/deterministic browser QA rather than architecture changes.

## Implementation order

1. Add and test `lib/settings/navigation.ts` key validation, safe persistence, and DOM state application.
2. Restructure `index.html` into the four-pane shell while preserving all existing hooks and content.
3. Wire controller targets/actions and initialize the saved/default pane before current async work.
4. Replace the flat Settings CSS shell/sections with split, grouped, compact, and AX-safe rules.
5. Update static visual-system contracts and add controller-level navigation regressions.
6. Run focused tests, CSS lint, build, full tests, then deterministic browser/console/keyboard QA.

Do not start by deleting old CSS selectors; first make the new markup pass behavior tests, then rewrite selectors and remove only rules proven unreachable.

## Rejected Alternatives

- **Sticky anchor index over the existing long document** — `79.5/100`, solid. It is the smallest change, but all 3,277px remain in layout and account growth keeps making the first section dominate. It also cannot satisfy the one-pane or restore-last-pane requirements.
- **Accordion-first single column** — `77/100`, solid. It reduces initial height and uses native disclosures, but hides category context, makes active location ambiguous, and turns ordinary settings into repeated expand/collapse work. Native `<details>` remains appropriate only for advanced OAuth guidance and diagnostics.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| Moving 78 controls drops or duplicates a Stimulus target, ID, or action. | P0 | Snapshot the pre-change hook inventory and assert the complete expected set after restructuring; keep render helper interfaces unchanged. |
| Inactive pane ancestry interferes with async notification focus restoration. | P1 | Preserve controller connection, do not auto-focus pane headings, and add a notification-operation regression with Notifications active. |
| Dynamic Google cards overflow or appear outside their pane. | P1 | Keep the existing target container intact, add min-width/overflow containment, and assert rendered card ancestry. |
| A short `align-self: start` rail moves inside an oversized route-level scroll document. | P1 | Bound the desktop standard-text shell to the route, stretch the rail to full height, and make only the workspace vertically scrollable. |
| Desktop overflow rules leak into compact or AX layouts and trap enlarged content. | P1 | Explicitly restore natural-height route/document scrolling and disable workspace scrolling at `max-width: 720px` and under accessibility text scale. |
| Mobile horizontal navigation or AX text creates page-level horizontal scroll. | P1 | Limit horizontal scrolling to the compact nav strip; force reflowing stacked navigation at accessibility scale; assert document scroll width. |
| Existing visual-system test encodes the obsolete flat-section design. | P2 | Replace only that assertion with the new semantic grouped-surface contract; retain all unrelated token and control guards. |
| Owner preference differs on breakpoint or density after visual review. | P2 | Treat token-safe spacing/breakpoint adjustment within the declared CSS scope as tuning; category model and behavior remain frozen. |

## Verification commands

Run from `jin-gui/` in this order:

```sh
npm test -- src/__tests__/settings_controller.test.ts src/__tests__/notes_visual_system.test.ts
npm run lint:css
npm run build
npm test
npm run dev:agent
```

With the deterministic dev server running, use the repository Playwright MCP workflow to verify:

1. `1280x800` standard text: full-width route-bounded split, 208px full-height rail, General default, one visible pane, centered content, route overflow disabled, and workspace-only vertical scrolling.
2. `720x800` and `390x844`: compact top navigation, natural-height route/document scrolling, workspace overflow visible, reachable categories, no clipped actions, and no page-level horizontal overflow.
3. Accessibility text at `1280x800` and `390x844`: natural-height route/document scrolling remains available and the workspace is not a nested vertical scroller.
4. Keyboard: Tab reaches categories in DOM order, Enter/Space selects, workspace scrollTop becomes zero, focus stays on the activating button, focus ring stays visible, and the active category exposes `aria-current="page"`.
4. Persistence: select each category, reconnect/reload, confirm the valid last pane returns; inject an invalid storage value and confirm General.
5. Dynamic/async: render multiple Google accounts/calendars; run notification Check/Allow/Test flows; confirm focus restoration and no category-triggered network calls.
6. Accessibility/theme: light, dark, reduce transparency, increase contrast, reduce motion, and AX text scale.
7. Console: zero new errors or warnings during initial load, pane switches, account rendering, sync, notification status, and export validation.

## Agent handoff

```yaml
from: ramza
to: vivi
performative: DELEGATE
tier: standard
objective: Implement the frozen Settings information-architecture overhaul without changing backend behavior or existing Settings hooks.
scope:
  - jin-gui/index.html
  - jin-gui/src/styles/settings.css
  - jin-gui/src/controllers/settings_controller.ts
  - jin-gui/src/lib/settings/navigation.ts
  - jin-gui/src/__tests__/settings_controller.test.ts
  - jin-gui/src/__tests__/notes_visual_system.test.ts
constraints:
  - Use workspace-only vertical scrolling in desktop standard-text mode; retain route/document scrolling in compact and AX modes.
  - Reset workspace scrollTop on category changes without moving focus off the category button.
  - Preserve every existing target, id, data action, async state, and dynamic renderer contract.
  - Use existing Jin tokens and primitives; add no raw colors or dependency.
  - Stop for RAMZA amendment before editing outside declared scope.
acceptance_criteria: .spectra/plans/settings-information-architecture-overhaul.criteria.md
verification:
  - npm test -- src/__tests__/settings_controller.test.ts src/__tests__/notes_visual_system.test.ts
  - npm run lint:css
  - npm run build
  - npm test
  - deterministic Playwright visual and accessibility QA at 1280x800, 720x800, and 390x844
```
