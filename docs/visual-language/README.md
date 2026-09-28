# Jin visual language

This is the normative guide for Jin's GUI presentation: its visual character,
interaction vocabulary, responsive behavior, accessibility contract, and the
places in code that own each decision. It describes the interface that exists
after the visual overhaul and gives future work a stable way to extend it.

The logo at [`docs/assets/jin.png`](../assets/jin.png) supplies Jin's identity:
a brush mark, indigo and vermilion color, and a small red seal. These cues stay
in the mark and authored content. The application chrome follows modern macOS
Calendar: neutral adaptive surfaces, system type, compact controls, and clear
blue actions. [`design.md`](../../design.md) is historical research; this guide
records the implemented product.

![Jin logo reference](../assets/jin.png)

## The character

Jin should feel like a calm native workspace. The shell, route headers, lists,
forms, and Calendar share a near-white adaptive canvas and quiet separators.
System type carries navigation and working content; compact capsules and
segmented controls identify actions without decorating the workspace. Blue
marks selection and enabled action, while Calendar uses red for the current
date. Keep the brush-mark identity in the brand and allow a user's Notes prose
to keep its own reading voice.

Use this test when a change feels uncertain: does it make the owner's work
easier to see, understand, and act on? If it adds a surface, border, motion, or
color, it should explain the hierarchy or state it represents.

## Foundations

### Type

The shared type contract lives in [`tokens.css`](../../jin-gui/src/styles/tokens.css)
and [`typography.css`](../../jin-gui/src/styles/typography.css). Use
`--font-text` for route headings, dates, controls, labels, and metadata across
Today, Tasks, Notes, Calendar, Notifications, Settings, and Capture. The mono
face is for code and technical values. The display face may remain in the
brand or authored document content, not shared app chrome. The HIG-derived
scale has eleven rem-based steps, with 17/22 as the body baseline and
`--dynamic-type-scale` as the root multiplier.

Long writing keeps a focused Notes measure and calm body rhythm
(`--notes-prose-measure: 66ch`, `--notes-prose-size: .9375rem`,
`--notes-prose-line: 1.5`). A title should establish the page; it should not
compete with the user's document.

### Color

Raw colors and adaptive light/dark values belong in [`tokens.css`](../../jin-gui/src/styles/tokens.css).
Components consume semantic roles. The most important distinctions are:

| Role | Meaning | Examples |
| --- | --- | --- |
| Canvas and chrome | Neutral adaptive working fields and toolbar context | `--workspace-canvas`, `--workspace-chrome`, `--agenda-canvas`, `--calendar-toolbar` |
| Text and separators | Readable primary/secondary labels and light structure | `--label`, `--label-secondary`, `--separator` |
| System accent | Selection, links, and Calendar/source identity | `--accent`, `--agenda-indigo`, `--calendar-color-value` |
| Readable accent text | Small informative blue labels on light or dark surfaces | `--accent-text` |
| Action fills | Accessible enabled primary/destructive buttons | `--action-primary-fill`, `--action-danger-fill`, `--color-on-accent` |
| Calendar today and danger | Red current-date marker and semantic error/danger, with distinct context | `--calendar-today`, `--calendar-today-ink`, `--system-red` |
| Brand | Jin seal and logo accents, not generic app actions | `--seal`, `--capture-vermilion` |

System blue identifies links and selected state; the darker action-fill role
keeps white text readable on small primary buttons. Small blue text uses
`--accent-text`, rather than a color chosen for a calendar dot or stroke.
Shared `.btn-primary` and `.btn-danger` use the accessible action-fill roles
in [`components.css`](../../jin-gui/src/styles/components.css). Brand,
Capture, Calendar today, and danger are separate roles. Every state also needs
text, shape, icon, position, or another non-color cue.

Adaptive base, secondary, and tertiary backgrounds plus three elevated tiers
give the workspace depth without making every region a panel. Explicit
appearance settings win over system appearance. Keep
the automatic light/dark behavior and the manual `data-*` preferences intact.

### Space, shape, and material

The spacing vocabulary is built from 4px and 8px relationships. Shared geometry
includes one 248px desktop navigation slot, 28px compact controls, 32px prominent controls, 44px
coarse-pointer targets, 36px plain task rows, 68px note rows, and the 760px reading
width. These are tokens, not reasons to force fixed heights at enlarged text.

Rounding belongs to compact controls, selected navigation rows, soft segmented
groups, popovers, and dialogs. Lists, calendars, settings sections, documents,
and writing surfaces remain continuous fields with light separators. Toolbar
chrome is opaque enough to read without depending on blur; reduced
transparency removes residual glass. Use one shadow for actual elevation, not
another shadow inside the same dialog.

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
| Destructive confirmation | Name the object and consequence; use the shared accessible destructive action fill |

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
| Shell, brand, navigation | One 248px sidebar holds the shared header and the active route's context. The labeled section switcher exposes all six routes; Notes folders, Tasks lists, and Settings categories use that same slot without a second rail. Collapse releases the full width; under 960px or at accessibility text scale, one drawer contains the same controls and returns focus on dismissal. Capture stays in the shared header. Real macOS Tauri uses an overlay titlebar with native traffic lights and a reserved safe region; browser and other platforms have no extra top spacer. | [`sidebar.css`](../../jin-gui/src/styles/sidebar.css), [`navigation.css`](../../jin-gui/src/styles/navigation.css), [`sidebar_controller.ts`](../../jin-gui/src/controllers/sidebar_controller.ts), [`router_controller.ts`](../../jin-gui/src/controllers/router_controller.ts) |
| Today | Use a system-type date hierarchy on the shared neutral canvas. Keep Focus as a subtle surface and reserve blue for active cues. Preserve task/note/event links, source badges, ordering, focus items, Capture, and truthful schedule/task states. | [`today.css`](../../jin-gui/src/styles/today.css), [`today_controller.ts`](../../jin-gui/src/controllers/today_controller.ts), [`render.ts`](../../jin-gui/src/lib/agenda/render.ts) |
| Capture, forms, dialogs | Give one clear action path, readable fields, and transient elevation. Preserve labels, validation, focus return, submit/cancel behavior, and real destination/provider choices. Reduced transparency must leave dialogs legible. | [`forms.css`](../../jin-gui/src/styles/forms.css), [`components.css`](../../jin-gui/src/styles/components.css), [`capture_controller.ts`](../../jin-gui/src/controllers/capture_controller.ts), [`temporal_editor_controller.ts`](../../jin-gui/src/controllers/temporal_editor_controller.ts) |
| Tasks | A List is a binary unchecked/completed workflow with compact continuous rows; a Board is a real container with user-named columns typed Queue, In Progress, Done, or neutral open stage. Every Board has a chosen initial Queue/neutral column and a Done column; In Progress is optional. Existing unclassified work keeps its status semantics until the owner previews and applies setup. The contextual toolbar names the active scope and keeps New task, filters, and Board columns reachable when navigation is hidden; the sidebar plus creates Lists and Boards. On desktop, the compact one-column inspector sits beside the workspace; on narrow/large-text screens it is a focus-contained sheet. Completion uses a visible circle within a larger target and never opens the inspector. Whole-card Board dragging begins after a pointer threshold; ordinary title clicks still open detail, and Escape cancels without consuming the next click. Preserve exact column/status placement, cancelled/invalid-task repair access, keyboard and bulk actions, validation, draft guards, and error surfacing. Native macOS Tasks toolbar occupies the traffic-light-safe titlebar row; browser and other platforms get no extra spacer. | [`browse.css`](../../jin-gui/src/styles/browse.css), [`sidebar.css`](../../jin-gui/src/styles/sidebar.css), [`tasks_controller.ts`](../../jin-gui/src/controllers/tasks_controller.ts), [`render.ts`](../../jin-gui/src/lib/tasks/render.ts), [`a11y.css`](../../jin-gui/src/styles/a11y.css) |
| Notes explorer/editor | Browse fills the available workspace width under a compact fixed toolbar: scope and loaded count, global search, List/Cards, and New note. The default continuous List aligns document, title/excerpt, and date/location/tags lanes; Cards present the same ordered note IDs and plain excerpts on restrained paper surfaces. Only the body scrolls. The existing formatting toolbar belongs in full-width document chrome and wraps to its own chrome row when needed; capsule groups contain round icon states. The title, CM6 edit text, Read rendering, and footer share one writing column with system type and readable body spacing. Native macOS browse and detail chrome occupy the titlebar safe row, including a traffic-light-safe navigation reveal when the sidebar is hidden. Preserve Markdown editing, selection, links, search, autosave, and truthful save state. | [`browse.css`](../../jin-gui/src/styles/browse.css), [`sidebar.css`](../../jin-gui/src/styles/sidebar.css), [`a11y.css`](../../jin-gui/src/styles/a11y.css), [`notes_controller.ts`](../../jin-gui/src/controllers/notes_controller.ts), [`editor.ts`](../../jin-gui/src/lib/notes/editor.ts), [`render.ts`](../../jin-gui/src/lib/notes/render.ts) |
| Events | Month, Week, and Day share a full-width neutral canvas, system-type date hierarchy, unified toolbar, segmented view control, and red current-date marker. Month has six equal-height week rows and measures one common event capacity from actual row geometry; +N gives access to hidden events, while short/large-text layouts scroll within the grid. Timed rows use a neutral surface, leading calendar-color mark, and local start time; all-day rows use a subtle calendar-color band. A compact anchored inspector leaves the calendar interactive on wide screens; Today, Capture, and narrow screens use the same content in a modal. Preserve exact destination, provider, recurrence, validation, and unsaved-draft guards. | [`calendar.css`](../../jin-gui/src/styles/calendar.css), [`events.css`](../../jin-gui/src/styles/events.css), [`calendar_view_controller.ts`](../../jin-gui/src/controllers/calendar_view_controller.ts), [`companion.ts`](../../jin-gui/src/lib/ui/companion.ts) |
| Notifications | Prioritize message, source, time, and action in the master/detail triage. Preserve read/unread and selected state, filters, per-item actions, live updates, and empty/error states; status is never color-only. | [`notifications.css`](../../jin-gui/src/styles/notifications.css), [`notifications_controller.ts`](../../jin-gui/src/controllers/notifications_controller.ts) |
| Settings | Keep four navigable panes on neutral surfaces with clear groups and a soft appearance segment. Preserve pane routing, appearance toggles, account/provider semantics, persistence, and keyboard focus. | [`settings.css`](../../jin-gui/src/styles/settings.css), [`settings_controller.ts`](../../jin-gui/src/controllers/settings_controller.ts) |

The same rules apply to shared empty, loading, error, and confirmation surfaces:
they inherit the owning surface's field and type hierarchy rather than becoming
generic gray cards.

### Notes interaction contract

Notes selection uses a neutral inset row with a separate focus ring. Collections
are saved views: the sidebar explains that their notes remain in folders, and
each row has one keyboard-accessible menu. The simple-rule editor shows an
honest summary; imported advanced query trees stay read-only in that editor.
The List distinguishes title, excerpt, date, folder, tags, and loaded count
without turning empty metadata into a badge. Cards use those same fields and
order; switching views does not fetch note bodies. Search results state that
they cover all notes, while clearing search restores the prior scope. A stale
folder, collection, or search result cannot replace a newer selection.

Document chrome owns Tags, History, Attach, formatting, and Copy controls.
Tags and collection menus stay inside the viewport and return focus when
dismissed. History keeps its revision selector and snapshot independently
reachable, with a compact selector at accessibility text size. Note-to-event
attachment shows the current note and requires a selected event identity; it
does not expose an ID field. Copy feedback reports actual clipboard success or
failure. Managed local images may hydrate in Edit and Read without altering
Markdown; checked tasks use one clear square recipe in both modes, including a
visible forced-colors mark. [`render.ts`](../../jin-gui/src/lib/notes/render.ts),
[`editor.ts`](../../jin-gui/src/lib/notes/editor.ts), and
[`codeChrome.ts`](../../jin-gui/src/lib/notes/codeChrome.ts) own those states.

Notes reading and editing share 15px/1.5 body rhythm and a compact, neutral
link-card treatment. Pasting one complete web URL into an empty paragraph makes
the canonical `jin-card` Markdown link; pasting over selected prose makes an
inline link in one undoable edit. Code spans, fences, and ordinary prose keep
their source. Read and History links, plus explicit Edit link actions, show the
same Cancel-first destination dialog before opening HTTP(S) in the system
browser. Browser navigation and new windows from the native main webview are
restricted to Jin's exact app origin; OAuth keeps its separate system-browser
flow. [`externalLinks.ts`](../../jin-gui/src/lib/ui/externalLinks.ts),
[`livePreview.ts`](../../jin-gui/src/lib/notes/livePreview.ts), and
[`external_links.rs`](../../jin-gui/src-tauri/src/external_links.rs) own this
boundary.

### Today contract

Today reads the dedicated `TodayProjectionDto` through `today_projection`. The
legacy `AgendaDto` and `today_agenda` contract remain stable for their existing
consumers. Core resolves `current_date`, `is_current_date`, task eligibility,
and focus in `config.display_tz` from one transactional projection. Open work
is shown in disjoint `attention`, `due`, and `flexible` lanes in that precedence
order; tasks already represented by a promoted event stay reachable through the
event and do not repeat in a standalone lane. A task due value is metadata, not
a scheduled start, end, duration, or estimate.

Focus keeps every active timed event directly accessible and adds the earliest
resolved future event when one exists. Core resolves anchored and floating
intervals to real instants before comparison, so the browser does not infer
time authority. The controller refreshes only the current day while the Today
route is active, pauses while that route or the document is hidden, refreshes
on return, listens for task/event mutation signals, cancels on disconnect, and
ignores stale responses from older date requests.

The header uses the localized selected-date eyebrow, the system-type `Today`
title, compact date navigation, and the existing Capture button. Event titles
and task controls open preview-first modals that keep Today visible and place a
clear `Go to event` or `Go to task` action first; prep-note controls keep their
existing detail routes. Promoted events retain event identity and use a square
marker plus `Task time block`; ordinary events use a circular marker plus
`Event`. Connected work deduplicates linked task and note entities by kind and
id while retaining the agenda event ids/titles that establish each association.
The rail is hidden when no relationship exists; empty schedule copy describes
the schedule only, even when task lanes contain work.

The visual composition stays a continuous neutral field: the agenda owns the
primary measure, the Connected work rail is a readable secondary field, and a
single indigo timeline runs without row dividers behind markers aligned to each
event's content. Header actions wrap and the rail follows agenda/task lanes on
compact screens; large text uses intrinsic geometry and the document remains
free of horizontal overflow. Keep these rules with the Today owner rather than
introducing generic cards or route-wide tokens.

## Ownership and cascade

[`index.css`](../../jin-gui/src/styles/index.css) defines the authority order:

1. `tokens.css` — raw adaptive colors, semantic roles, type, geometry, and material values.
2. `typography.css`, `spacing.css`, `materials.css`, and `components.css` — shared primitives.
3. `navigation.css`, `motion.css`, `layout.css`, then `today.css`, `browse.css`, `forms.css`, `settings.css`, `calendar.css`, and `notifications.css` — composition and route-specific behavior.
4. `sidebar.css` — unified navigation slot, contextual rail placement, adaptive drawer, and native macOS top clearance.
5. `a11y.css` — final cross-surface accessibility fallbacks.

The closest surface stylesheet owns its responsive rule. Add a new semantic
token only when the current roles cannot express a real design distinction;
keep raw color values in `tokens.css`. Consolidate a rule at its owning seam
instead of adding a late override block. A controller change is justified only
when the required presentation state does not exist in the DOM; it must preserve
flow, targets, actions, payloads, storage, focus, and lifecycle.

### Small patterns

Use a role and the owning surface together. The calendar's current-day control
has a real state hook and the calendar stylesheet owns its treatment:

```css
.calendar-day-button[aria-current='date'] {
  background: var(--calendar-today);
  color: var(--calendar-today-ink);
}
```

Keep focus and selection independently visible:

```css
.jin-list-row[aria-selected="true"] { background: var(--tasks-selected-wash); }
.jin-list-row:focus-visible { outline: 2px solid var(--agenda-indigo); outline-offset: 2px; }
```

Let large text reflow inside the one drawer, while keeping the Close control and each route reachable:

```css
:root[data-text-scale='accessibility'] .jin-shell { --sidebar-width: 100vw; }
:root[data-text-scale='accessibility'] .jin-section-switcher__label { white-space: normal; }
```

These are patterns for existing contracts, not a request to add new selectors
or features. Prefer the current class and state hooks in the affected surface.

## Drift traps

Review these before accepting a visual change:

- a late override stacked over the owning component or surface rule;
- broad background/fill token changes with a large route blast radius;
- raw colors in components, or one red reused for seal, capture, today, danger, and error;
- decorative brush rules, nested panels, or decorative shadows around lists, calendars, settings, or documents;
- display type applied to shared route headings, controls, or metadata;
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

## Calendar extensions

Before adding Calendar or Event Companion fields, follow the [Calendar extension checklist](../../.spectra/plans/calendar-experience/extension-checklist.md) (shared section placement, summary copy, mode/capability/state matrix, owner, duplicate-removal list, cross-entry regression coverage).
