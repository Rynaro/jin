# Jin visual language

This is the normative guide for Jin's GUI presentation: its visual character,
interaction vocabulary, responsive behavior, accessibility contract, and the
places in code that own each decision. It describes the interface that exists
after the visual overhaul and gives future work a stable way to extend it.

The logo at [`docs/assets/jin.png`](../assets/jin.png) is the starting
reference: warm paper, a near-black brush mark, flowing indigo and vermilion
color, and a small red seal. Those are observable cues, not a coded origin
story. Jin's name and any symbolism beyond the asset and source comments are
not specified here. [`design.md`](../../design.md) is historical Apple/HIG
research and inspiration; it is not the current product specification.

![Jin logo reference](../assets/jin.png)

## The character

Jin should feel like a calm, personal working surface. Content has room to
breathe on a continuous paper field. Ink-like text gives the product a human
edge, while indigo marks focus, time, and linkage. Vermilion is used sparingly
for capture and today's point of attention; the seal is a brand mark and an
explicit-intent accent. The interface can be warm and expressive without
turning every surface into a card, ornament, or illustration.

Use this test when a change feels uncertain: does it make the owner's work
easier to see, understand, and act on? If it adds a surface, border, motion, or
color, it should explain the hierarchy or state it represents.

## Foundations

### Type

The shared type contract lives in [`tokens.css`](../../jin-gui/src/styles/tokens.css)
and [`typography.css`](../../jin-gui/src/styles/typography.css). The text face
is the operational voice; the mono face is for code and technical values; the
display face is the OS-provided Mincho/serif voice for brand and editorial
headings. The HIG-derived scale has eleven rem-based steps, with 17/22 as the
body baseline and `--dynamic-type-scale` as the root multiplier.

Use the display face for a prominent title at roughly 20px or larger when its
editorial voice helps. Keep controls, labels, metadata, prose, and editor body
text in `--font-text`. Long writing uses the existing Notes measure and rhythm
(`--notes-prose-measure: 66ch`, `--notes-prose-size: 1.125rem`,
`--notes-prose-line: 1.7`). A title should establish the page; it should not
compete with the user's document.

### Color

Raw colors and adaptive light/dark values belong in [`tokens.css`](../../jin-gui/src/styles/tokens.css).
Components consume semantic roles. The most important distinctions are:

| Role | Meaning | Examples |
| --- | --- | --- |
| Workspace and paper | Continuous working fields and quiet context | `--workspace-canvas`, `--agenda-canvas`, `--notes-writing-paper` |
| Ink | Primary text, muted metadata, strokes, and restrained brush marks | `--ink-primary`, `--ink-muted`, `--ink-stroke` |
| Generic system accent | Standard control/link accent where the component already uses it | `--accent` |
| Indigo | Operational focus, timeline, selection, linkage, and time | `--agenda-indigo`, `--tasks-selected-edge`, `--notes-quote-rule` |
| Seal/cinnabar | Brand seal and explicit intent | `--seal`, `--seal-strong`, `--seal-tint` |
| Capture vermilion and today seal | Capture/Add uses vermilion; the compact calendar's today marker uses the seal role in its implemented standard-scale treatment | `--capture-vermilion`, `--seal`, `--seal-on` |
| System danger/error | Failure or error state | `--system-red`, `--state-danger-wash` |

Seal, capture, and semantic danger can be warm neighbors but are not
interchangeable. The compact calendar today marker and the existing explicit
destructive button primitive use the seal role; Capture uses vermilion; live
error/failure surfaces use semantic danger roles where implemented. Reuse the
existing primitive instead of choosing a warm color by appearance. A selected
item must not be conveyed by red when indigo is the role. Every state also
needs text, shape, icon, position, or another non-color cue.

The current shared `.btn-danger` primitive uses the seal fill and seal-on
contrast, so it is the existing explicit-action contract in
[`components.css`](../../jin-gui/src/styles/components.css). Preserve that
contract when touching existing destructive buttons; new error and danger
surfaces should use the semantic state roles (`--system-red` and
`--state-danger-wash`) where their meaning is failure or warning rather than a
brand/intent button.

Adaptive base, secondary, and tertiary backgrounds plus three elevated tiers
give the workspace depth without making every region a panel. Explicit
appearance settings win over system appearance. Keep
the automatic light/dark behavior and the manual `data-*` preferences intact.

### Space, shape, and material

The spacing vocabulary is built from 4px and 8px relationships. Shared geometry
includes the desktop rail, 28px compact controls, 32px prominent controls, 44px
coarse-pointer targets, 40px task rows, 68px note rows, and the 760px reading
width. These are tokens, not reasons to force fixed heights at enlarged text.

Rounding belongs to controls, pills, badges, popovers, and elevated dialogs.
Lists, calendars, settings sections, documents, and writing surfaces should
read as continuous fields; do not wrap each row in a rounded gray container.
Glass and blur are for chrome and transient elevated UI. They are not a default
background for content. Reduced transparency replaces glass with an opaque
token surface, preserves a separator where needed, and removes blur. Shadows
describe actual elevation or a capture affordance; they do not group ordinary
content.

### Motion

Motion duration and easing custom properties are defined with the shared tokens
in [`tokens.css`](../../jin-gui/src/styles/tokens.css); [`motion.css`](../../jin-gui/src/styles/motion.css)
consumes them in utilities and keyframes. Motion should explain where content came from, where a transient
surface belongs, or how state changed. It must not decorate an idle screen or
hide latency. Respect both `prefers-reduced-motion` and the manual
`data-reduce-motion` setting; reduced motion makes transitions effectively
instant and disables scroll animation.

## Interaction language

Use the existing button, field, row, tab/segmented, link, disclosure, and
dialog primitives in [`components.css`](../../jin-gui/src/styles/components.css)
and [`forms.css`](../../jin-gui/src/styles/forms.css). Primary actions have a
clear filled or high-contrast treatment; secondary actions are quieter; icon
buttons retain a programmatic accessible name, visible focus, and a real
target. Focus is a visible
indigo/system cue and is distinct from selected, current, today, success, and
error states.

Preserve real DOM semantics and controller actions. Keep `aria-current`,
`aria-selected`, `aria-pressed`, disabled state, live regions, focus
restoration, event handlers, payloads, and existing storage behavior. Styling
must never invent a saved, loading, sync, permission, provider, conflict, or
success state, and it must not hide the control that represents one.

For system states, use the smallest truthful treatment:

| State | Presentation |
| --- | --- |
| Loading/pending | Existing progress or pending label, with restrained motion when allowed |
| Empty/not found | Plain explanation and the next useful action |
| Offline/queued | Explicit state text and retry or queue action where the controller provides one |
| Success | Confirmation tied to the completed action, then return attention to content |
| Warning/failure/conflict | Clear text, supporting icon/shape, and the action needed to resolve it |
| Read-only | Explain the constraint near the disabled or unavailable action |
| Destructive confirmation | Name the object and consequence; use the existing explicit destructive primitive |

## Responsive and accessible behavior

The maintained visual anchors are 320, 390, 760, and 1440 CSS pixels. They are
regression references, not a new universal breakpoint system: the closest
feature stylesheet owns its actual seam. At accessibility text scale the root
uses a 3.1 multiplier at its largest step. Content reflows before scrolling;
intrinsic structures such as a seven-column calendar may use a focusable,
component-only horizontal scroller, but the document itself must not overflow.

Check the states relevant to the change in light, dark, automatic appearance,
increased contrast, reduced transparency, reduced motion, forced colors, and
coarse-pointer sizing. Test long labels, large text, keyboard navigation,
visible focus, and color independence. [`a11y.css`](../../jin-gui/src/styles/a11y.css)
is the final cross-surface fallback authority. A feature stylesheet may keep a
large-text rule when its intrinsic geometry requires it.

Playwright MCP provides deterministic browser evidence for layout, DOM
semantics, and interactions. It cannot approve native Tauri rendering, motion
feel, tap ergonomics, OAuth hand-off, or the real bridge. Those remain owner
inspection items in [`docs/gui-testing.md`](../gui-testing.md).

## Surface recipes

Each recipe names the visual purpose and the behavior styling must leave alone.

| Surface | Recipe and invariants | Owners |
| --- | --- | --- |
| Shell, brand, navigation | Keep the rail quiet and legible; current route remains discoverable; Capture remains a distinct entry point; collapse/overlay behavior and keyboard navigation stay intact. Keep the logo mark sparse and do not turn it into a repeating texture. | [`layout.css`](../../jin-gui/src/styles/layout.css), [`navigation.css`](../../jin-gui/src/styles/navigation.css), [`sidebar_controller.ts`](../../jin-gui/src/controllers/sidebar_controller.ts) |
| Today | Keep date/time hierarchy and the indigo timeline readable on a warm agenda field. Preserve task/note/event links, source badges, ordering, and the capture action. Empty and error states remain actionable. | [`today.css`](../../jin-gui/src/styles/today.css), [`today_controller.ts`](../../jin-gui/src/controllers/today_controller.ts) |
| Capture, forms, dialogs | Give one clear action path, readable fields, and transient elevation. Preserve labels, validation, focus return, submit/cancel behavior, and real destination/provider choices. Reduced transparency must leave dialogs legible. | [`forms.css`](../../jin-gui/src/styles/forms.css), [`components.css`](../../jin-gui/src/styles/components.css), [`capture_controller.ts`](../../jin-gui/src/controllers/capture_controller.ts), [`temporal_editor_controller.ts`](../../jin-gui/src/controllers/temporal_editor_controller.ts) |
| Tasks | Treat the list as a paper ledger and the inspector as a focused companion. Preserve selected/current state, status glyph plus label, drag/drop, keyboard actions, filtering, and error surfacing. Large text turns row heights into minimums. | [`browse.css`](../../jin-gui/src/styles/browse.css), [`tasks_controller.ts`](../../jin-gui/src/controllers/tasks_controller.ts), [`a11y.css`](../../jin-gui/src/styles/a11y.css) |
| Notes browser/editor | Keep folders and notes as open list fields rather than rounded cards. Give the CM6 editor a continuous writing desk, readable measure, quiet toolbar, and truthful save state. Preserve Markdown editing, selection, links, search, and large-text reflow. | [`browse.css`](../../jin-gui/src/styles/browse.css), [`a11y.css`](../../jin-gui/src/styles/a11y.css), [`notes_controller.ts`](../../jin-gui/src/controllers/notes_controller.ts), [`editor.ts`](../../jin-gui/src/lib/notes/editor.ts), [`render.ts`](../../jin-gui/src/lib/notes/render.ts) |
| Events | Month, Week, and Day share date hierarchy and truthful source/color. On standard-scale screens ≤700px, Month uses compact week rows, horizontal rules, a circular today marker, and small event indicators; event bars retain a usable target and +N disclosure, date tap opens Day, event tap opens detail. | [`calendar.css`](../../jin-gui/src/styles/calendar.css), [`calendar_view_controller.ts`](../../jin-gui/src/controllers/calendar_view_controller.ts), [`events_controller.ts`](../../jin-gui/src/controllers/events_controller.ts) |
| Notifications | Prioritize message, source, time, and action in the master/detail triage. Preserve read/unread and selected state, filters, per-item actions, live updates, and empty/error states; status is never color-only. | [`notifications.css`](../../jin-gui/src/styles/notifications.css), [`notifications_controller.ts`](../../jin-gui/src/controllers/notifications_controller.ts) |
| Settings | Keep the page document-like with four navigable panes, clear groups, and readable controls. Preserve pane routing, appearance toggles, account/provider semantics, persistence, and keyboard focus. | [`settings.css`](../../jin-gui/src/styles/settings.css), [`settings_controller.ts`](../../jin-gui/src/controllers/settings_controller.ts) |

The same rules apply to shared empty, loading, error, and confirmation surfaces:
they inherit the owning surface's field and type hierarchy rather than becoming
generic gray cards.

## Ownership and cascade

[`index.css`](../../jin-gui/src/styles/index.css) defines the authority order:

1. `tokens.css` — raw adaptive colors, semantic roles, type, geometry, and material values.
2. `typography.css`, `spacing.css`, `materials.css`, and `components.css` — shared primitives.
3. `navigation.css`, `motion.css`, `layout.css`, then `today.css`, `browse.css`, `forms.css`, `settings.css`, `calendar.css`, and `notifications.css` — composition and route-specific behavior.
4. `a11y.css` — final cross-surface accessibility fallbacks.

The closest surface stylesheet owns its responsive rule. Add a new semantic
token only when the current roles cannot express a real design distinction;
keep raw color values in `tokens.css`. Consolidate a rule at its owning seam
instead of adding a late override block. A controller change is justified only
when the required presentation state does not exist in the DOM; it must preserve
flow, targets, actions, payloads, storage, focus, and lifecycle.

### Small patterns

Use a role and the owning surface together. The calendar's current-day cell
already has a real state hook and the calendar stylesheet owns its treatment:

```css
/* calendar.css: existing mobile rule, scoped away from accessibility scale */
@media (max-width: 700px) {
  :root:not([data-text-scale="accessibility"]) .calendar-day-cell--today {
    background: transparent;
    box-shadow: none;
  }
  :root:not([data-text-scale="accessibility"]) .calendar-day-cell--today .calendar-day-button {
    background: var(--seal);
    color: var(--seal-on);
  }
}
```

Keep focus and selection independently visible:

```css
.jin-list-row[aria-selected="true"] { background: var(--tasks-selected-wash); }
.jin-list-row:focus-visible { outline: 2px solid var(--agenda-indigo); outline-offset: 2px; }
```

Let large text reflow while retaining the existing phone navigation target:

```css
@media (max-width: 639px) {
  :root[data-text-scale="accessibility"] .jin-sidebar:not(.is-collapsed),
  :root[data-text-scale="accessibility"] .jin-sidebar.is-collapsed {
    width: 100vw;
    max-width: 100vw;
  }
}
```

These are patterns for existing contracts, not a request to add new selectors
or features. Prefer the current class and state hooks in the affected surface.

## Drift traps

Review these before accepting a visual change:

- a late override stacked over generic or paper authority;
- broad background/fill token changes with a large route blast radius;
- raw colors in components, or one warm red reused for seal, capture, today, danger, and error;
- gray rounded cards, nested paper rectangles, or decorative shadows around lists, calendars, settings, or documents;
- display type applied to controls, metadata, or long body copy;
- literal copying of a reference that introduces fake state, hides controls, or adds product behavior;
- page-level overflow, fixed heights at enlarged text, or a non-focusable component scroller;
- normal-scale compact rules leaking into accessibility scale;
- `!important` or a final global patch without a documented narrow authority reason;
- tests reduced to selector snapshots that no longer protect real behavior.

The repository has accumulated historical seams around 560, 639, 640, 700,
720, 760, 860, 900, and 1079px. Inspect them when changing a feature; do not
turn that history into a mandatory breakpoint system.

## Maintenance loop

For a proposed UI change, first identify the surface, state, and owner. Read
this dossier and the relevant renderer/controller, then choose existing roles
and primitives. State desktop, mobile, and accessibility intent before editing.
Make the smallest owning-style change, preserve real semantics, and add or
adjust a focused behavior test when interaction is affected. Verify the
smallest responsive and preference matrix that exercises the actual seams,
record screenshots and console findings, and inspect neighboring accepted
surfaces. Update this dossier only after a visual rule is implemented and
accepted; it is a record of the product, not a speculative mood board.

The implementation workflow is in
[`.agents/skills/jin-visual-language`](../../.agents/skills/jin-visual-language/SKILL.md).
The browser evidence workflow, including the native sign-off boundary, is in
[`.agents/skills/jin-gui-visual-qa`](../../.agents/skills/jin-gui-visual-qa/SKILL.md).
