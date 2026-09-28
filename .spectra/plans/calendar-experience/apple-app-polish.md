---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-09-23
target_repos: [jin]
stories_count: 4
validation_gates_count: 9
---
# Modern Apple-inspired app foundation and equal Month rows

## Scope

User intent: Jin should feel like a coherent modern Apple application, using the supplied Apple Calendar image as the visual target. Apply this direction to shared shell, navigation, controls, fields and UI headings across Today, Tasks, Notes, Calendar, Notifications, Settings and Capture. Repair Month's uneven week heights. This explicitly supersedes the earlier warm paper, editorial serif, ink-primary and brush-navigation direction for application UI, including the Calendar-only restriction in `apple-calendar-design.md`.

Preserve Jin's brandmark/wordmark, content hierarchy, Notes prose readability, existing information architecture and all behavior. Preserve S1–S7 route identity, auth/capability checks, Meet/RSVP/recurrence, pending state, sparse payloads, inspector placement, dirty guards and focus lifecycle. No backend, dependencies, native titlebar imitation, invented Year/search functionality, navigation redesign, commit, push or external export. Existing dirty changes belong to the active work and must remain. Implementation is authorized; Astra high plans, Sol high implements.

## Diagnosis and evidence

The app currently mixes modern event UI with squared controls, black primaries, a vermilion Capture block, brush selection marks, large serif headings and warm nested panels. Calendar's `--calendar-toolbar: var(--fill-secondary)` produces a heavy gray slab. Changing Calendar margins again would leave the app-wide mismatch intact. Shared primitives already exist, but route overrides and repeated `.btn-*` declarations compete with them.

Month's failure is structural: `calendar-day-grid` is a flex column of independently sized week grids; cells have only minimum heights. The renderer hardcodes three chips plus a `tap-target` overflow button. Content therefore expands only the busy week. Root measured week heights `[89, 89, 89, 134.1875, 89, 89]` at 1280×800 with eight events on August 20. Equal minimum heights alone do not solve this.

Primary references are the user's Apple screenshot `codex-clipboard-0843f28c-504a-4db9-adeb-7a89563d4654.png` and Jin screenshot `codex-clipboard-3924d335-ecb1-495e-922a-a12da5fb90a0.png`, both in the provided local clipboard directory. Apple shows airy near-white chrome, rounded segmented tracks, quiet circular/capsule controls, thin rules, system type and equal calendar rows. Root's `.artifacts/playwright-mcp/modern-before-{today,tasks,notes,month,settings,notifications,capture}-1280.png` supplies current app evidence. The public [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), inspected by root, supports materials for navigation/controls above content and accessible contrast/transparency fallbacks. These are visual references, not claims of native verification or a requirement to reproduce native optical glass effects.

## Approach

### One shared visual foundation

Adapt existing `.jin-chrome`, `.jin-control`, workspace headers, segmented controls and semantic surface tokens. No new component library or decorative wrapper layer. Content remains flat and readable; controlled elevation belongs to toolbars, controls and actual overlays.

| Role | Concrete target at normal fine-pointer scale |
| --- | --- |
| Canvas and panes | Neutral white/light-gray adaptive surfaces; remove beige/indigo washes from workspace chrome and list panes. Keep hierarchy through spacing, separators and subtle surface distinction, not nested paper cards. |
| Shell/sidebar | Very light neutral material, hairline boundary, restrained depth; inset rounded selected navigation row with clear weight/shape. Remove brush stripe, dry-brush header rule and obsolete decorative watermark treatment. Preserve sidebar width, collapsed state, brandmark and route order. |
| Capture entry | Inset capsule button with quiet elevated neutral fill, accent plus and readable label. Remove warm red rectangle/ink border flourish. Keep its existing location, shortcut and prominence. |
| Toolbar | Airy near-white adaptive chrome with light separator. Keep current real controls and layout, with roughly 44–52px normal height. No heavy gray bar or fake window decorations. |
| Toolbar controls | Text controls use compact capsules; icon-only actions use circles. Roughly 28–32px fine-pointer control height, consistent icon rhythm, subtle border/highlight and hover fill. Dense list actions can remain quiet icon buttons. Coarse targets retain 44px minimum. |
| Segmented controls | Rounded soft-neutral capsule track, selected inset surface with restrained edge/shadow, shared spacing/type. Apply to Calendar view switch and existing Tasks/Notes/Settings/Capture segmented controls without changing their semantics. |
| Actions | Shared primary actions use accessible system-accent fill/contrasting text; secondary actions use quiet neutral material; destructive actions use semantic red. Brand ink/seal color no longer substitutes for action semantics. Preserve calendar identity colors and red Today. |
| Fields | One consistent neutral surface, thin border, 8–10px normal corner radius, visible accent focus. Retain labels, help/error spacing and readable input type. Avoid pill-shaped multiline fields. |
| Overlays | One restrained shadow and rounded surface per real modal/popover, approximately 14–18px normal radius. Remove nested elevation and route-specific paper fills. Retain compact Event inspector layout and visible footer. |
| Typography | Existing system text stack for application headings, tabs, forms and navigation; compact semibold route titles with consistent hierarchy. Remove giant serif Today and UI titles in Tasks/Notes/Settings/Notifications. Preserve brand typography and Notes document/prose measure; do not shrink the root type scale or flatten content heading levels. |

All raw color values remain in `tokens.css`. Add only needed semantic roles for chrome/control edge, elevation and selected surfaces. Update light, automatic dark and explicit appearance overrides together. Reuse existing material infrastructure with solid reduced-transparency fallback; do not add animated shine, extra blur layers, or permanent compositing to every control. Keep focus rings, disabled states and non-color selected cues distinct. Dynamic Type grows/reflows controls rather than clipping them to these normal-scale targets.

### Month: one geometry authority, accessible overflow

Keep six weeks and all 42 date cells. Make the Month content shell allocate its remaining viewport height to a weekday header plus one equal-track day grid. Use six equal tracks (`repeat(6, minmax(0, 1fr))`) in the normal desktop bounded layout; week rows and cells must permit shrinking rather than letting intrinsic content grow one track. Measure available space through the existing content shell, not a screenshot-specific viewport subtraction.

Replace the renderer's hardcoded `slice(0, 3)` with a **common chip capacity** derived from that row size and the actual date header, chip, gap and overflow-control dimensions. Reserve overflow space consistently before counting chips, and calculate `+N` from the real hidden event count. More events may be shown in taller windows; busy cells must never expand their week. All event access remains through visible chips and a named overflow action opening the existing Day view. If the viewport is too short for a useful date/action row, switch to a common readable minimum row height and let the Month region scroll; do not hide overflow, squeeze text or drop access.

Keep the Add-on-date keyboard/coarse affordance in a reserved or overlay date-header slot so revealing/focusing it cannot change row height. It must not cover the date or clip focus. At accessibility sizes/coarse targets, use equal intrinsic minimum tracks and the existing named component scroller where the readable grid needs more space; page-wide horizontal overflow remains prohibited. Ensure overflow controls have appropriate target sizing in each pointer mode.

If measurement requires a ResizeObserver, keep it local to Month, observe stable container geometry, update only when capacity changes, and disconnect on view change/controller teardown. Do not rerender the active inspector or replace a focused chip merely because dimensions were measured. A small pure capacity helper may live beside existing calendar helpers for meaningful tests. Preserve empty-cell, range-drag, day navigation, preview and dirty-replacement guards.

## Stories and implementation order

1. **Shared foundation — P1, 1d.** As a user, I see one control and surface system throughout Jin. Owners: `jin-gui/src/styles/{tokens,components,forms,materials,typography}.css`. Establish semantic tokens, modern shared controls/fields/segments and system UI-title utilities. Consolidate competing button aliases so each variant has one owner; fields/dialog structure remain in `forms.css`. Preserve accessible preferences. Output: shared styles, no new dependencies or behavior.
2. **Shell and route adoption — P1, 1d.** As a user, I recognize the same application in every section. Owners: `styles/{layout,navigation,today,browse,settings,notifications,events,calendar,a11y}.css`; narrowly scoped shared renderer/index markup only where an existing primitive class is needed. Remove superseded serif UI headers, warm pane washes, brush selection and Capture-specific primary overrides. Retain document prose and brand. Output: visibly consistent Today/Tasks/Notes/Calendar/Settings/Notifications/Capture, not merely new tokens that old selectors override.
3. **Equal Month geometry — P1, 1d.** As a user, I scan a stable calendar regardless of event count. Owners: `styles/calendar.css`, `controllers/calendar_view_controller.ts`, optional small helper under `lib/calendar/`, relevant existing tests. Establish common rows/capacity, correct overflow counts, no focus-induced expansion, observer cleanup. Output: dense/empty months have equal rows and every event remains reachable.
4. **Convergence and regression check — P0, 1d.** As a user, I keep the workflows and accessibility already repaired. Owners: relevant existing tests, local fixture only if needed, visual artifacts and visual-language dossier. Root owns browser/native QA; Sol runs focused tests, CSS lint, build and diff check. Update `docs/visual-language/README.md` to record the new app-wide decision after convergence. Output: reviewable cross-route contact sheet and bounded regression evidence.

### Cascade and scope contract

Modify canonical sections, remove obsolete conflicting declarations and update comments. Do not append a new override tail for this pass. `components.css` owns generic controls and shared segments; `forms.css` owns fields/dialog composition; `layout/navigation.css` own shell; route files retain only layout or truly route-specific content styling; `a11y.css` remains final accessibility authority. Reuse existing route selectors rather than controller rewrites. Calendar widget/date-picker rules remain separate from route Month geometry. Tests and visual documentation are in scope; all backend, provider/data contracts and feature expansion are out.

## Acceptance Criteria

### AC-MODERN-01 (state-driven)
GIVEN Today, Tasks, Notes, Calendar, Notifications, Settings and Capture at normal scale
THEN shared shell, controls, fields and application headings shall follow the common visual recipe above.
VERIFY: cross-route contact sheet against the supplied Apple reference; no residual serif UI heading, beige workspace pane, black primary or brush selected mark.
### AC-MODERN-02 (state-driven)
GIVEN the existing Jin brandmark and Notes document content
THEN their identity and readable content hierarchy shall be preserved.
VERIFY: brand screenshot comparison and Notes content with headings, paragraph, list and code sample.
### AC-MODERN-03 (state-driven)
GIVEN a Month containing empty days and days with 1, 3, 4 and 10 or more events
THEN the six week rows shall differ in rendered height by no more than one CSS pixel.
VERIFY: bounding rectangles at 1280×800 and 1440×900, plus a short viewport and accessibility grid; busy-week baseline no longer expands.
### AC-MODERN-04 (state-driven)
GIVEN a date containing more events than its rendered chip capacity
THEN its overflow action shall expose the correct hidden count and the existing complete Day view.
VERIFY: resize across capacity thresholds, activate overflow with pointer and keyboard, compare actual event totals; no unreachable clipped chip.
### AC-MODERN-05 (event-driven)
WHEN Add-on-date receives keyboard focus or becomes visible for coarse pointer
THEN the Month row geometry shall remain stable.
VERIFY: before/after rectangles plus visible focus/date/action without overlap.
### AC-MODERN-06 (state-driven)
GIVEN narrow 390px and 320px viewports with accessibility scale through 3.1
THEN the interface shall retain reachable controls without page-wide horizontal overflow.
VERIFY: shared shell, Capture, Calendar grid's named local scroller and Event footer; coarse target/focus inspection.
### AC-MODERN-07 (state-driven)
GIVEN dark appearance, increased contrast or reduced transparency
THEN the shared foundation shall retain readable controls and distinguishable surfaces/states.
VERIFY: representative Tasks, Calendar and Capture preference matrix with solid fallback and visible keyboard focus.
### AC-MODERN-08 (event-driven)
WHEN users navigate, filter, capture or edit an event after the polish
THEN the existing route and mutation contracts shall remain intact.
VERIFY: sidebar navigation, Tasks filter, Notes selection, Settings appearance, Capture destination, Calendar exact destination/Meet validation, Preview/Edit and dirty replacement smoke checks; existing focused suites.
### AC-MODERN-09 (state-driven)
GIVEN the completed source changes
THEN the relevant automated validation shall pass.
VERIFY: focused Calendar/controller/companion tests and capacity regression tests, shared/sidebar tests if markup changed, `npm run lint:css`, `npm run build`, `git diff --check`.

## Validation and risks

Root's desktop matrix covers all seven affected surfaces; Calendar includes dense Month, Week and Preview/Create. Capture one narrow composition and AX320/3.1, plus representative dark/contrast/transparency checks. Compare total composition to the user reference before accepting small styling details. Browser evidence proves browser rendering only; root separately owns the native Tauri build/verification.

Primary risk is stale route overrides defeating tokens; audit computed styles in at least Today, Tasks, Notes and Capture. Month risk is resize feedback/focus loss; observe stable dimensions, avoid unconditional render loops and retain an overflow path. Shared style changes must not turn content lists into padded cards or shrink important labels. No schema/API/dependency changes are needed. All plan work and artifacts remain local.

## Confidence

RAMZA lite; complexity 6 (standard). Chosen shared-foundation adaptation scores 89; conservative Calendar-only retouch scores 70 and fails app-wide intent, while a new component/navigation system scores 72.5 and introduces needless migration risk. Existing primitives, screenshots and the measured Month defect give a stable implementation boundary. Parent performs independent rendered review; Sol may make routine local geometry choices within this recipe without another permission gate.

```yaml
execution:
  planner: Astra-high
  implementer: Sol-high
  order: [shared-foundation, shell-and-route-adoption, equal-month, convergence]
  preserve: [brand, prose-hierarchy, behavior, accessibility, existing-dirty-work]
  month: {weeks: 6, rows: equal, chip-capacity: shared-measured, overflow: existing-day-view}
  forbidden: [backend, dependencies, fake-native-controls, external-export, commit, push]
  approval: already-authorized
```
