---
eidolon: ramza
version: 1.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-04T18:42:01Z
thread_id: 01a06bc8-d754-7d44-876f-bf86556694a9
target_repos:
  - Rynaro/jin
stories_count: 6
validation_gates_count: 37
evidence_anchors_count: 18
confidence: 0.9225
---

# Navigation sidebar unification

Change ID: `navigation-sidebar-unification`

## Scope

Intent class: `CHANGE`.

Create one authoritative internal navigation component contract and migrate every genuine Jin navigation rail to it. Main navigation remains the geometric reference: 184px standard rail, 32px rows, `0 10px` padding, 8px anatomy gap, 6px radius, 13px/18px typography, and the shared selected wash plus ink marker.

In scope:

- A new `navigation.css` contract with rail, list, row, icon, label, meta, and actions anatomy.
- Closed row variants for nested trees and rows with trailing actions.
- One shared navigation-width token that aliases the existing 184px Main rail width at standard text scale.
- Main navigation links and Settings category buttons.
- Notes folder tree, All Notes, and saved collections.
- Tasks smart views and user lists, including color swatch, count/meta, edit/delete actions, and drag state.
- Normalized active semantics: `aria-current="page"` for page/scope navigation and `aria-selected="true"` on WAI-ARIA tree items.
- Compact, accessibility text, forced-colors, increased-contrast, reduced-transparency, reduced-motion, and coarse-pointer behavior.
- Static, unit, integration, and deterministic visual verification.

Explicitly excluded:

- Notes content list rows and task content list/board items.
- Notifications master-list rows.
- Today agenda, event, and calendar rows.
- Menus, dialogs, transient popovers, editor/detail panes, form choices, and action toolbars.
- Router behavior, backend/Tauri commands, DTOs, persistence, data fetching, business logic, or a runtime custom element.
- Redesigning Main's collapsed width or changing compact product information architecture.

Dirty-worktree boundary:

- `jin-gui/index.html`, `jin-gui/src/styles/settings.css`, `jin-gui/src/controllers/settings_controller.ts`, `jin-gui/src/lib/settings/navigation.ts`, `jin-gui/src/__tests__/settings_controller.test.ts`, and `jin-gui/src/__tests__/notes_visual_system.test.ts` contain the user's in-progress Settings overhaul.
- Treat their current worktree contents as the immutable baseline for this migration. Apply narrow additive/class-level patches; never restore, replace wholesale, or regenerate these files from `HEAD`.
- Before editing, capture the Settings-specific diff/hook inventory. Before handoff, prove every pre-existing Settings target, ID, action, navigation behavior, scrolling contract, and test remains.

Deferred:

- A framework custom element or TypeScript view component. The current surfaces are a mix of static HTML, templates, and controller-created DOM; the lowest-risk common layer is semantic classes plus native ARIA.
- Consolidating section headers, rail collapse controls, create buttons, or feature-specific drag/menu behavior. They compose with navigation anatomy but are not navigation rows.
- Removing legacy feature class names used by tests/controllers. They remain compatibility/behavior hooks even after visual ownership moves.

Assumptions and risk if wrong:

- Existing `--space-1`, `--radius-sm`, `--text-footnote-size`, and `--text-footnote-line` remain 8px, 6px, 13px, and 18px. If their values change, the shared component follows the token system and visual baselines require review.
- A 184px rail can support Tasks' two 26–28px actions only with a reserved trailing slot and robust label truncation. If owner QA finds the actions unusable, adjust the actions variant anatomy, not the shared rail width.
- WAI-ARIA tree selection must remain on each folder `li`; page/scope navigation should use `aria-current="page"` on its interactive/row owner. Do not flatten these semantics into one state attribute.
- The current Settings scroll fixes are correct and unrelated to navigation styling. Any required change to those behaviors is plan drift.

Complexity (`ramza-score --rubric complexity`): `10/12` → `human_loop`. Right-size score: `5` → `full`.

Human-loop authorization is satisfied by the user's explicit request for a cross-surface shared component, their exact eligible/excluded surface list, and the supplied geometry/state contract. Any expansion beyond those boundaries returns to the user.

Declared product-file scope:

1. `jin-gui/index.html`
2. `jin-gui/src/styles/tokens.css`
3. `jin-gui/src/styles/index.css`
4. `jin-gui/src/styles/components.css`
5. `jin-gui/src/styles/navigation.css` (new)
6. `jin-gui/src/styles/layout.css`
7. `jin-gui/src/styles/browse.css`
8. `jin-gui/src/styles/settings.css`
9. `jin-gui/src/styles/a11y.css`
10. `jin-gui/src/lib/lists/render.ts`
11. `jin-gui/src/controllers/notes_controller.ts`
12. `jin-gui/src/__tests__/notes_visual_system.test.ts`
13. `jin-gui/src/__tests__/lists_controller.test.ts`
14. `jin-gui/src/__tests__/notes_controller.test.ts`
15. `jin-gui/src/__tests__/settings_controller.test.ts`

Any product-file expansion requires a RAMZA amendment before implementation continues.

## Approach

Select **shared semantic anatomy classes with feature compatibility hooks** (`91/100`, elite).

### Authoritative component contract

Add `navigation.css` after `components.css` and before feature composition styles. It owns these public internal classes:

| Class | Responsibility |
|---|---|
| `.jin-navigation-rail` | Standard navigation width, minimum sizing, continuous context surface, edge separator. |
| `.jin-navigation-list` | Width, zeroed list defaults, vertical stack, no row gaps. |
| `.jin-navigation-row` | 32px minimum height, `0 10px` padding, 8px gap, 6px radius, 13/18 typography, hover/focus/selected surface, positioning. |
| `.jin-navigation-row__icon` | Fixed standard icon track and nonshrinking geometry. |
| `.jin-navigation-row__label` | Flexible `minmax(0,1fr)` label, ellipsis, logical alignment. |
| `.jin-navigation-row__meta` | Trailing count/badge slot with tabular/nonshrinking content. |
| `.jin-navigation-row__actions` | Reserved trailing action slot; stable geometry across idle, hover, focus, and coarse-pointer modes. |
| `.jin-navigation-row--tree` | Chevron/icon/label/meta/action tracks plus existing `--tree-depth` indentation. |
| `.jin-navigation-row--actions` | Meta and actions share a reserved trailing grid area without shifting label geometry. |

Use the existing tokens rather than restating dimensions where possible. Introduce `--navigation-rail-width: var(--app-rail-width)` and make `--context-rail-width` a compatibility alias to it; remove the standard 208px drift. Accessibility may override the source width token so all real navigation rails expand consistently at large text.

`navigation.css` owns all shared row hover, focus-visible, selected wash, and ink-marker rendering. `components.css`, `layout.css`, `browse.css`, `settings.css`, and `a11y.css` retain only primitives, feature composition, state-specific overrides, and global accessibility modes. Static tests reject duplicate ownership of the canonical dimensions and selected marker.

### State semantics

- Main and Settings retain `aria-current="page"` on the active link/button only.
- Notes All Notes and saved collections use `aria-current="page"`; inactive rows remove the attribute instead of setting false.
- Tasks smart views and lists migrate from `aria-current="true"` to `aria-current="page"`; inactive rows remove it.
- Notes folder tree keeps `aria-selected="true|false"` on `role="treeitem"`. The shared selector styles the descendant row without moving selection semantics to its nonfocusable wrapper.
- Feature classes such as `jin-nav-item`, `settings-nav__item`, `folder-row__btn`, `notes-collection-row`, and `lists-rail__row` remain for controller/test compatibility, but do not own canonical visuals.
- Exactly one active page/scope row per independent navigation group remains the controller responsibility; the shared CSS only reflects semantic state.

### Consumer mapping

| Surface | Shared composition | Preserved specialization |
|---|---|---|
| Main | rail/list/row/icon/label/meta | collapsed rail, tooltip, notification badge, router classes. |
| Settings | rail/list/row/label | four-pane persistence, desktop workspace scroll, compact/AX route scroll, category-button focus. |
| Notes folders | rail/list/tree row/icon/label/meta/actions | WAI-ARIA tree, depth, chevron, menus, collapse/reveal, drag/drop. |
| Notes collections | list/row/icon/label/actions | All Notes behavior, rename/delete controls, saved-query loading. |
| Tasks smart views | rail/list/row/icon/label/meta | fixed ordering, counts, scope dispatch. |
| Tasks lists | list/actions row/icon/label/meta/actions | color swatch, edit/delete, default list, drag reordering. |

For the Tasks actions variant, reserve the trailing slot at all times. Idle shows meta; hover/focus-within shows actions in the same grid area. Do not use `display:none` or `aria-hidden="true"` on a container with focusable buttons. Keyboard focus must reveal actions; coarse-pointer mode must make them discoverable without hover. Long labels truncate before they can displace the action slot.

### Migration discipline

1. Add tokens, import, and shared stylesheet with compatibility selectors while all existing classes still work.
2. Before migrating Main or current Settings markup, persist the exact dirty Settings baseline under `.spectra/plans/navigation-sidebar-unification.evidence/`; then migrate with narrow patches and verify the preserved hook/behavior inventory.
3. Migrate Notes static/template rows and controller-created collection rows; verify tree semantics and full-width All Notes.
4. Migrate Tasks renderer-created smart/list rows; verify 184px action/meta geometry and behavior.
5. Remove duplicated feature visual declarations only after every consumer and focused test is green.
6. Run negative-scope guards so content rows and transient UI never acquire navigation classes.

No stage may use whole-file replacement, `git checkout`, reset, or generated rewrites against dirty Settings files.

### Rollback strategy

- Keep legacy feature classes throughout the migration, so each consumer can roll back by removing only the new shared classes while preserving controller selectors.
- Land/test in the staged order above. If a consumer fails, revert that consumer's class additions and feature-selector removals without removing the shared contract already used by earlier green stages.
- Do not remove `--context-rail-width` during this change; keep it as an alias, allowing a one-line width rollback while consumers stabilize.
- Delay deletion of duplicate selectors until the corresponding static ownership assertion is ready. A failing final cleanup can restore the last feature declaration without changing markup.
- Because Settings files are already dirty, rollback uses reverse patches scoped to this plan's hunks, never checkout from `HEAD`.

### Evidence anchors

- Main navigation markup: `jin-gui/index.html:70-180`.
- Main canonical row geometry: `jin-gui/src/styles/layout.css:700-755`.
- Width tokens: `jin-gui/src/styles/tokens.css:188-190`.
- Minimal existing rail primitive and duplicated selection selectors: `jin-gui/src/styles/components.css:365-410`.
- Notes rail/static collections: `jin-gui/index.html:346-405`.
- Notes folder template: `jin-gui/index.html:939-960`.
- Notes collection DOM creation/state: `jin-gui/src/controllers/notes_controller.ts:810-845`.
- Notes tree selection: `jin-gui/src/lib/notes/render.ts:110-140` (behavior reference, no edit planned).
- Notes feature styling: `jin-gui/src/styles/browse.css:1331-1535` and `4035-4350`.
- Tasks rail markup: `jin-gui/index.html:1015-1050`.
- Tasks dynamic row construction: `jin-gui/src/lib/lists/render.ts:105-150` and `220-320`.
- Tasks row/action styling: `jin-gui/src/styles/browse.css:3350-3470` and `4369-4425`.
- Current Settings shared-Main-row adaptation: `jin-gui/index.html:1842-1890` and `jin-gui/src/styles/settings.css`.
- Shared accessibility state selectors: `jin-gui/src/styles/a11y.css:105-205` and `294-320`.
- CSS import cascade: `jin-gui/src/styles/index.css`.
- Structural regression suite: `jin-gui/src/__tests__/notes_visual_system.test.ts`.
- Tasks renderer tests: `jin-gui/src/__tests__/lists_controller.test.ts`.
- Notes behavior tests: `jin-gui/src/__tests__/notes_controller.test.ts`.

Pattern assessment: **adapt (88%)**. Main and Settings already share most canonical geometry and state vocabulary; the change promotes that proven pattern, adds explicit anatomy/variants, and migrates Notes/Tasks without changing their controllers' behavioral boundaries.

## Stories

### Story 1: Establish the shared navigation contract

As a frontend maintainer, I want one authoritative navigation component stylesheet, so that rail geometry and state visuals cannot drift by feature.

Timebox: `1.5d`. Risk: `P0`. Executor: `mid` tier.

Tasks: add the width token/alias; import `navigation.css`; implement the closed anatomy and semantic-state selectors; remove generic navigation ownership from `components.css`; add static ownership tests.

Output: new shared contract available without changing any consumer behavior.

### Story 2: Migrate Main and preserve Settings work

As a user, I want Main and Settings navigation to remain the reference experience, so that unification starts from the current accepted baseline.

Timebox: `1d`. Risk: `P0`. Executor: `mid` tier.

Tasks: persist `settings-baseline.patch` and `settings-baseline.json`; add shared anatomy classes to Main/Settings; retain router/settings hooks; move canonical Main visual rules from layout into navigation; keep collapsed/notification/Settings scroll behavior feature-owned; produce `settings-preservation.json` before handoff.

Output: visually unchanged Main and Settings using the shared component.

### Story 3: Migrate Notes navigation

As a Notes user, I want folders and collections to share Main's rail rhythm, so that All Notes, saved views, and nested folders feel like one navigation system.

Timebox: `1.5d`. Risk: `P1`. Executor: `mid` tier.

Tasks: migrate rail/lists/static rows/template/controller-created collections; normalize collection `aria-current`; apply tree variant without moving `aria-selected`; preserve menus, drag/drop, keyboard tree behavior, collapse/reveal; prove All Notes fills width.

Output: 184px Notes navigation with stable nested-row anatomy and existing behavior.

### Story 4: Migrate Tasks navigation and action slots

As a Tasks user, I want smart views and lists aligned with Main without clipped actions, so that dense navigation stays readable and operable.

Timebox: `2d`. Risk: `P0`. Executor: `mid` tier.

Tasks: migrate renderer class composition; normalize `aria-current="page"`; implement smart/actions variants; reserve stable meta/action geometry; remove invalid hidden semantics around focusable actions; verify counts, long labels, hover/focus/coarse actions, editing, deletion, and drag reorder.

Output: 184px Tasks navigation with nonshifting labels and reachable actions.

### Story 5: Remove duplicate styling and harden accessibility

As a maintainer, I want feature CSS to own only specialization, so that future changes flow through one shared source.

Timebox: `1d`. Risk: `P1`. Executor: `mid` tier.

Tasks: remove duplicate row dimensions/selected markers; centralize forced-colors/increased-contrast/coarse-pointer rules; keep opaque structural rails; validate AX width and compact overrides; add negative-scope guards.

Output: no duplicate canonical navigation visual ownership.

### Story 6: Verify the migration as one system

As a release owner, I want behavior and visual evidence at every navigation surface, so that a CSS consolidation cannot hide interaction regressions.

Timebox: `1d`. Risk: `P1`. Executor: `mid` tier.

Tasks: focused suites after each stage; CSS lint/build/full tests; deterministic Playwright geometry and interaction matrix; compare Settings baseline; write an AC-indexed evidence manifest; independent VIGIL verification against frozen criteria.

Output: green gates, screenshots/measurements, and no unplanned file drift.

## Acceptance Criteria

The normative EARS criteria are frozen in `.spectra/plans/navigation-sidebar-unification.criteria.md`, `AC-NAV-001` through `AC-NAV-037`.

## Confidence

`ramza-score --rubric confidence`: `92.25%` → `AUTO_PROCEED`.

Independent critique: cycle 2 passed at `4.8/5` (`clarity 5`, `completeness 5`, `actionability 5`, `efficiency 4`, `testability 5`) after naming the durable baseline/evidence schemas and mechanically freezing the criteria. Author `ramza-nav-author` and checker `ramza-nav-critic-01` are distinct in state.

## Rejected Alternatives

- **CSS aliases over existing feature classes** — `71.5/100`, solid. Lowest churn, but preserves duplicated anatomy, makes selector ownership unverifiable, and cannot express tree/actions variants coherently.
- **Data attributes as the component API** — `80/100`, solid. Semantically workable, but conflates behavior/state data with visual composition and is harder to discover in static markup and renderer tests.
- **Runtime Web Component** — `72.5/100`, solid. Strong encapsulation, but static HTML, templates, and controller-created rows would require lifecycle/slot plumbing disproportionate to a CSS/ARIA unification.

## Risks

| Risk | Tag | Mitigation |
|---|---|---|
| Dirty Settings work is overwritten during broad HTML/CSS edits. | P0 | Snapshot diff/hook inventory; narrow patches only; explicit final preservation criterion. |
| 184px Tasks rail clips two actions or starves the label. | P0 | Reserved actions variant, long-label fixtures, bounding-box tests, coarse-pointer mode. |
| Selection semantics are flattened incorrectly across page navigation and trees. | P0 | Closed `aria-current="page"` vs `aria-selected="true"` contract with per-consumer tests. |
| Removing duplicated CSS changes cascade unexpectedly. | P1 | Compatibility-first staging; remove rules only after migrated consumer is green; static ownership assertions. |
| Keyboard users cannot reveal Tasks actions. | P0 | No `display:none`/hidden ancestor for focusable actions; focus-within tests and browser keyboard pass. |
| AX widths reduce workspace below usable size. | P1 | Preserve existing AX override, test desktop/narrow reflow, truncate only labels. |
| Feature selectors used by controllers/tests are removed as “dead CSS.” | P1 | Preserve feature class names as behavioral compatibility hooks. |
| Shared classes leak onto content rows. | P1 | Explicit exclusion list and negative static class assertions. |
| Main collapsed mode inherits full-rail layout unexpectedly. | P1 | Keep collapse rules feature-owned and run sidebar/router suites. |

## Verification

Self-consistency check: consumer-first, dependency-layer-first, and risk-first decompositions independently produced the same six execution units: shared contract, Main/Settings migration, Notes migration, Tasks migration, accessibility/ownership cleanup, and verification. Five of six boundaries were identical and the risk-first pass only combined Main/Settings baseline capture with contract staging, yielding `83%` boundary overlap, above the full-tier `70%` requirement.

Run from `jin-gui/`:

```sh
npm test -- src/__tests__/notes_visual_system.test.ts src/__tests__/lists_controller.test.ts src/__tests__/notes_controller.test.ts src/__tests__/settings_controller.test.ts
npm run lint:css
npm run build
npm test
npm run dev:agent
```

Deterministic browser matrix:

| Mode | Viewports | Required evidence |
|---|---|---|
| Standard light/dark | 1280x800 | Main, Settings, Notes, Tasks rail width; 32px rows; padding/gap/radius/type; active wash/marker. |
| Narrow | 720x800, 390x844 | Existing compact composition, no clipped actions, no page-level horizontal overflow. |
| Accessibility text | 1280x800, 390x844 | Shared expanded width behavior, label truncation, workspace remains usable. |
| Coarse pointer | 1280x800, 390x844 | 44px targets and discoverable Tasks actions without hover. |
| Forced colors/contrast/transparency | 1280x800 | Visible non-color-only active state and opaque continuous rails. |
| Keyboard | 1280x800 | Main routing, Settings pane selection/focus, Notes tree/collection navigation, Tasks action reveal. |

Geometry assertions measure rail/row/child bounding boxes, not screenshots alone. Exercise long Notes collection/folder names, four folder depths, long Tasks list names, zero/three-digit counts, and two trailing actions. Console must remain free of new errors/warnings.

### Durable verification evidence

All downstream verification output lands under `.spectra/plans/navigation-sidebar-unification.evidence/` and is excluded from the 15-file product scope.

- `settings-baseline.patch`: the pre-implementation `git diff --binary HEAD --` for the six existing dirty Settings files, captured before the first product edit.
- `settings-baseline.json`: baseline `HEAD`, patch SHA-256, dirty-file list, sorted Settings targets, IDs, actions, relevant data attributes/pane keys, documented desktop/compact/AX scroll assertions, and focused Settings test command/result.
- `settings-preservation.json`: the same final sorted hook/state fields, a baseline-to-final set comparison, the final focused Settings test result, and an explicit list limited to approved navigation-class additions or ownership moves.
- `geometry.json`: per surface/mode/viewport computed rail width, row height, inline padding, gap, radius, font size/line height, marker width/insets, child bounds, `scrollWidth`, and `clientWidth`.
- `console.json`: console errors/warnings keyed by surface and scenario.
- `screenshots/<ac-id>-<surface>-<viewport>-<mode>.png`: browser evidence named deterministically.
- `manifest.json`: every artifact keyed by AC ID, viewport, color/accessibility/pointer mode, baseline revision, command/scenario, result, and relative evidence path.

Geometry tolerance is `±0.5 CSS px` for the 184px rail, 32px row, 10px inline padding, 8px gap, 6px radius, 13px font, 18px line height, and 3px marker width. Child containment allows at most `0.5 CSS px` rounding beyond rail bounds. Horizontal overflow passes only when `scrollWidth <= clientWidth + 1 CSS px`. Selected-wash computed colors must match exactly across standard-mode consumers; forced-color values are compared by semantic system color, not RGB.

## Agent handoff

```yaml
from: ramza
to: vivi
performative: DELEGATE
tier: standard
objective: Implement the frozen shared navigation-sidebar component migration without overwriting the dirty Settings baseline.
scope: .spectra/plans/navigation-sidebar-unification.handoff.yaml
criteria: .spectra/plans/navigation-sidebar-unification.criteria.md
constraints:
  - Migrate only eligible navigation surfaces; enforce negative exclusions.
  - Preserve feature hooks/controllers and current Settings scroll/focus behavior.
  - Keep legacy feature classes while moving canonical visuals to navigation.css.
  - Stop for RAMZA amendment before editing outside the 15-file scope.
verification:
  - focused Vitest suites
  - npm run lint:css
  - npm run build
  - npm test
  - deterministic Playwright geometry, keyboard, coarse-pointer, and accessibility matrix
  - AC-indexed evidence manifest under .spectra/plans/navigation-sidebar-unification.evidence/
```
