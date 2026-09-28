---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-09-23
target_repos: [jin]
stories_count: 4
validation_gates_count: 10
---
# One adaptive sidebar, integrated with the macOS window

## Scope

Implement the user's Apple Notes reference as a navigation composition: one elegant sidebar, more room for content, deep usable hierarchy, and a real macOS window/titlebar merger. This supersedes the 184px Main + 184px context geometry and ink-marker direction in `navigation-sidebar-unification.md`; preserve its shared navigation anatomy and behavior guarantees. Planning uses Astra high/RAMZA; implementation uses Sol high/Vivi. Implementation is authorized, with no additional approval gate.

In scope: shared navigation host/state, route discovery, Notes folders/collections, Tasks smart views/lists, Settings categories, collapse/adaptive behavior, macOS overlay titlebar and narrow native permission/config changes. Preserve current dirty work, brandmark, Notes content/editor state, route/deep-link semantics, unread counts, Calendar geometry and all event/auth/dirty guards. Calendar's Calendars popover remains its filter UI. No new data features, backend domain work, dependency, fake traffic lights, window-effect/private-API framework, commits, push or external export. Drag-resizing the sidebar is deferred; a useful single default width is sufficient.

## Diagnosis and reference

Root measured two 184px rails at 1280px, consuming 368px before working content. The folder list itself is only 167px and already truncates “Field Notes”; the primary rail is mostly empty. The old unification standardized row anatomy but intentionally left the two-level layout unchanged. Notes, Tasks and Settings each own a separate context rail; independent collapse/mobile states further fragment navigation.

The user's local `codex-clipboard-1393630c-56af-45a9-bb29-25efd0b2325d.png` shows Apple Notes' continuous sidebar reaching the native window edge, compact top controls, a readable nested tree, quiet counts and a full-width selected row. Root's `.artifacts/playwright-mcp/sidebar-before-{notes,tasks}-1280.png` and Notes 760px baseline establish Jin's starting point. The source currently uses a decorated Tauri window with no titlebar customization; `sidebar_controller.ts` only toggles a persisted icon rail/mobile class, without coordinating route contexts.

Tauri's official [window customization guide](https://v2.tauri.app/learn/window-customization/) and [configuration reference](https://v2.tauri.app/reference/config/) document macOS overlay titlebars, hidden titles and real traffic-light positioning. Installed Tauri 2.11.3 and the JS window declarations expose these facilities. The guide requires intentional drag regions; traffic-light positioning requires Overlay plus decorations. Native titlebar dimensions vary, so browser screenshots cannot prove native clearance or dragging.

## Approach

### Decisive composition

Use **one 248px sidebar** at normal desktop scale. At 1280px this returns 120px to Notes/Tasks/Settings content while widening the actual tree by 64px. No permanent secondary icon strip and no second contextual rail. Preserve the content list/editor distinction: a Notes list is working content, not another navigation rail.

The sidebar has one continuous adaptive neutral surface and one content-edge hairline. Its compact header contains the retained Jin mark, a clearly labeled current-section switcher (for example **Notes ⌄**), and real Capture/collapse controls. Use system typography, 32px normal navigation rows, rounded inset selection and restrained icons/counts. Retain 44px coarse targets. Do not add a large “Navigation” hero, nested card, duplicate sidebar title, fixed empty panel, or decorative flourish.

The section switcher is a real disclosure containing all six named routes: Today, Notes, Tasks, Events, Notifications and Settings. Use existing route anchors, icons, unread badge and router handlers. Keep the current section readable and the disclosure unmistakable; announce unread notifications from a small persistent indicator on the closed switcher and show the actual count on Notifications when opened. A simple accessible navigation popover with links is sufficient; do not assign menu semantics without implementing the full menu keyboard contract. Opening focuses the current route; Escape returns to the trigger. Route changes commit only through the existing navigation guard.

| Active route | Sidebar body |
| --- | --- |
| Notes | All Notes and saved collections, then Folders with existing nested tree and New Folder/New Collection actions. One body scroll; hierarchy gets the remaining height. |
| Tasks | Existing Smart Views and Lists, counts, color identity and list actions. One body scroll; no secondary list drawer. |
| Settings | Existing four category buttons and selection; no duplicate inner Settings navigation column. Preserve independent settings workspace scroll and saved pane. |
| Today, Events, Notifications | The full primary route list in the same sidebar body; no invented contextual items. Calendar keeps its current filter popover and toolbar. |

Within each distinct navigation group, keep exactly one selected/current item. The current app section and selected Notes folder/Task list are different states; neither replaces the other. Global Capture remains available in the common header and via its existing shortcut. Collapse hides the entire sidebar and releases its width. A persistent labeled or accessibly named **Show navigation** button remains in the content toolbar; reopening restores the current context, selection and scroll.

### Layout and controller ownership

Preserve route-owned DOM and Stimulus lifecycles. Notes targets/actions are scoped below `data-controller="notes"`; Tasks context contains its own ListsController and bubbles scope events to Tasks; Settings nav targets belong to SettingsController. **Do not clone, repeatedly portal/reparent these rails, or move all three controllers to the shell.** Those approaches break action lookup, targets and draft/editor lifecycle.

Introduce a shared visual sidebar slot governed by the shell: width, chrome height, context top/bottom bounds, expanded/hidden/drawer mode and active route. Existing active route context occupies that same left-column slot while remaining under its owning controller. Implement this through CSS placement/shared coordinates, not a second width reservation. The shell and active route workspace use the same column-width variable; context wrappers no longer allocate a separate column inside content. Shared chrome paints the continuous surface; route context wrappers have transparent backgrounds and no independent border/elevation. If context uses positioned layout, its containing block must be the shell viewport and its height must be bounded by the shared chrome bounds, not document scroll or a transformed ancestor. Keep ownership explicit in comments/tests.

One shell SidebarController coordinates this visual composition. Have RouterController publish the **committed** section (after guard acceptance), including initial Today and hash/deep-link activation. Sidebar state must not optimistically switch context on a route click that may be rejected. Use a narrowly typed event/state attribute and route-context registration/selection by stable identifiers; no second router. Existing Notes toggle/reveal and Tasks list-toggle entry points delegate to this shared controller instead of retaining independent drawers. Settings selects categories through its current controller. Do not discard/recreate route content, reload data or reset an editor merely to show/hide navigation.

Keep DOM order sensible: shared navigation controls, active contextual navigation, working content. The existing skip link must reach actual working content without forcing a pass through the context tree. Hidden routes/contexts and a closed route switcher must not expose focusable descendants. Restore focus before hiding a focused context, switching presentation or collapsing the sidebar. An open popup/dialog inside a rail remains governed by its existing overlay owner and must not be clipped by the new scroll wrapper.

### Responsive and persistence contract

Use persistent desktop sidebar when the available width is at least 960 CSS pixels at standard scale; below it, show the same navigation as a left overlay drawer. The drawer is at most the viewport minus a small safe inset, and can occupy the full width at 320px/AX scale. Accessibility text uses drawer mode whenever the rail plus useful content cannot fit; do not squeeze two enlarged columns together. Browser/native content width, not a hardcoded screen width, owns this decision. At 760px there is no permanently reserved navigation width.

The drawer combines common controls and active context visually, with one backdrop/dismiss path, explicit Close and Escape, focus containment and focus return. Because context DOM remains route-owned, inert only actual working-content regions, not an ancestor containing that context. The shared coordinator must manage the complete set of navigation roots consistently; no second independent “Task lists” or “Folders” sheet. Route/scope selection closes the drawer after successful selection/guard commit. A denied navigation preserves the draft and context. Popup/dialog focus traps take precedence over drawer Escape handling.

Desktop expanded/hidden preference persists; transient drawer-open state does not. Add a versioned parse-safe sidebar preference while accepting old `jin_sidebar.collapsed`. Import old global collapse into the corresponding initial hidden/expanded state once. Preserve `jin_notes_folder_tree.expanded` and other folder selection data. Its legacy `paneCollapsed` can initialize a Notes context preference only during migration; it must not keep the new sidebar invisibly collapsed after an explicit Show navigation action. Route return, content resize and app restart preserve folder expansion, selected scope and remembered context scroll. Reconcile mode changes immediately; unregister media/resize listeners on disconnect.

Deep trees retain WAI-ARIA tree semantics and existing Arrow/Home/End/typeahead behavior. Give labels the available row width, keep chevrons independently operable, and avoid accumulating indentation until only icons fit: use a modest indent step with a visual cap for very deep levels while retaining true `aria-level` and hierarchy semantics. Hover/focus can show the full truncated label; AX labels wrap. Trailing counts/actions use one stable slot rather than permanently reserving multiple wide action buttons. Context menus remain keyboard/coarse-accessible. Validate at least eight levels, a long folder name and a three-digit count; do not flatten the data tree.

### Real macOS window integration

Keep native decorations enabled. Use supported macOS `titleBarStyle: Overlay` and `hiddenTitle: true`, retaining native traffic lights, resizing, close/minimize/fullscreen behavior. Set a supported traffic-light position only if needed to align the native controls with the shared chrome; do not draw HTML replacements. These properties are macOS-specific; Windows/Linux keep their existing decorated window. No transparent whole-window/private-API or vibrancy dependency is required for the requested continuous visual merger.

Native macOS gets an explicit top safe region (approximately 52px initial target) and traffic-light exclusion zone (approximately 80–90px wide, verified natively). Extend the sidebar material through that region to the native edge; align compact navigation/Capture controls outside the exclusion zone. Place top route controls safely below or beside the native region without doubling it. Expose a capability/platform marker only in the real macOS Tauri runtime; ordinary browser preview and other platforms receive no empty native-titlebar spacer. Existing app brand and route identity remain visible somewhere useful without repeating “Jin” as a large titlebar label.

Mark only empty chrome areas as drag regions. Buttons, switcher, tree, text selection, fields and scrollbars must remain interactive. Add only the narrow `core:window:allow-start-dragging` permission needed for the chosen supported Tauri drag path; no broad window-control permission set. Verify inactive-window activation/drag limitations and double-click/fullscreen behavior on the actual host. Ensure first-run/recovery surfaces also honor the native safe inset. Native checks unavailable to automation must be reported as unverified, never silently replaced by browser proof.

## Stories and file ownership

1. **Shared navigation state and one sidebar layout — P1, 1d.** `jin-gui/index.html`, `src/controllers/{sidebar,router}_controller.ts`, `src/lib/sidebar/state.ts`, a small `src/lib/sidebar/` coordinator/helper if needed, `styles/{layout,navigation,tokens,a11y}.css`. Build current-section switcher, committed-route integration, single width reservation, collapse/reveal and preference migration. Output: six routes remain discoverable and content gains width.
2. **Route-context adoption — P1, 1d.** `index.html`, `controllers/{notes,tasks,settings}_controller.ts`, `styles/{browse,settings,navigation}.css`; narrow `lib/notes/{render,folderTreePrefs}.ts` or `lib/lists/render.ts` changes only for row anatomy/preserved action needs. Adopt existing context into the shared visual slot, remove independent collapse/drawer geometry, preserve scope/tree state and deep hierarchy. Output: Notes/Tasks/Settings use the same navigation width with no controller reparenting.
3. **Adaptive host and native chrome — P0, 1d.** Sidebar coordinator, `styles/{layout,navigation,a11y}.css`, `src/main.ts` or a narrow `lib/ui/window_chrome.ts`, `src-tauri/tauri.conf.json` and `capabilities/default.json`; `src-tauri/src/lib.rs` only if supported configuration/runtime initialization needs it. Implement drawer/focus lifecycle, macOS-only overlay/safe region/drag permission and platform fallback. Output: real native controls remain functional and browser/other platforms gain no dead spacer.
4. **Regression and visual convergence — P0, 1d.** Existing sidebar/router/Notes/Tasks/lists/Settings tests, focused new state/host tests, local fixture/artifacts, `docs/visual-language/README.md` after acceptance. Root owns rendered and native verification. Output: evidence below plus focused suites, CSS lint, GUI build, native check/build and diff check.

Consolidate geometry in its owner; remove superseded 184px dual-rail sizing, route-specific mobile drawer rules and old icon-rail assumptions only after replacement checks pass. Keep legacy feature classes/targets where behavior depends on them. Do not replace dirty files wholesale. No independent second sidebar store or app-wide controller rewrite.

## Acceptance Criteria

### AC-SIDEBAR-01 (state-driven)
GIVEN Notes, Tasks or Settings at 1280px standard scale
THEN navigation shall reserve exactly one 248px sidebar column.
VERIFY: rendered bounds; working content begins at the same shared edge and gains 120px versus the 368px baseline.
### AC-SIDEBAR-02 (event-driven)
WHEN the user opens the labeled section switcher from any route
THEN every existing app route shall be reachable by a named link.
VERIFY: keyboard/pointer walkthrough, current route and unread notification count, Capture access and Escape focus return.
### AC-SIDEBAR-03 (event-driven)
WHEN a navigation guard rejects a route change
THEN the committed sidebar context and active draft shall remain unchanged.
VERIFY: dirty Event/Notes flows, rejected switcher choice, accepted choice and deep links.
### AC-SIDEBAR-04 (state-driven)
GIVEN Notes with eight nested levels, long names and three-digit counts
THEN every folder and action shall remain operable with its true hierarchy exposed.
VERIFY: real tree selection/expansion, keyboard navigation, rename/menu, accessible full names and AX wrapping.
### AC-SIDEBAR-05 (event-driven)
WHEN users collapse, reopen, change route or restart after preference migration
THEN navigation shall preserve the relevant selected scope and tree expansion.
VERIFY: old global/folder preferences, corrupt storage, reopening a formerly collapsed Notes rail and new persisted state.
### AC-SIDEBAR-06 (state-driven)
GIVEN 760px, 390px or 320px/AX3.1 navigation presentation
THEN one coordinated drawer shall provide navigation without reserving a second content column.
VERIFY: reachable controls, no page overflow, one backdrop, keyboard containment, Escape/selection close, focus return and resize transitions.
### AC-SIDEBAR-07 (state-driven)
GIVEN the real macOS Tauri window
THEN the sidebar shall visually continue into native chrome without obstructing native window controls.
VERIFY: owner/native screenshot, traffic-light operation, move/resize/fullscreen and first-run/recovery clearance.
### AC-SIDEBAR-08 (state-driven)
GIVEN browser preview or a non-macOS decorated window
THEN the layout shall omit the macOS-specific empty safe region.
VERIFY: browser marker absence and platform configuration/runtime branch; native non-macOS testing reported accurately if unavailable.
### AC-SIDEBAR-09 (state-driven)
GIVEN dark appearance, increased contrast, reduced transparency or coarse pointer
THEN shared navigation shall retain readable state and reachable controls.
VERIFY: representative Notes tree and Tasks action states, visible focus, 44px coarse targets, no nested material fallback or clipping.
### AC-SIDEBAR-10 (state-driven)
GIVEN the completed implementation
THEN the scoped automated validation shall pass.
VERIFY: meaningful state/router/host/tree/scope tests, CSS lint, GUI build, native cargo check/build and `git diff --check`.

## Validation, risks and confidence

Root captures Notes/Tasks/Settings at 1280, Notes at 760, drawer at 390/320 AX, and a deep-tree fixture; compare width/focus/scroll state before and after. Also check Today, Calendar and Notifications for shared-shell regression, including Calendar's already verified equal Month rows and inspector. No data mutation merely from opening/collapsing navigation. Native screenshot and controls need actual Tauri inspection; browser simulation only checks safe-region CSS.

Main risk is breaking Stimulus ownership while merging visual regions; keep controller ancestry and test real selection/actions after route changes. Second risk is a drawer focus trap that inerts its own context; coordinate explicit working-content and navigation roots. Native overlay introduces actual top-left collision risk; use capability-gated safe regions, supported controls and measured native evidence. The default width plus modest deep-tree indentation is deliberate; resizable width and a new navigation/data framework are deferred.

## Confidence

RAMZA lite; complexity 7/12, extended reasoning within the standard dispatch. Chosen unified adaptive sidebar scores 88; narrower dual rails score 75 but leave the user's composition problem, and a new controller architecture scores 72 with unnecessary lifecycle risk. Existing row primitives, route guards and native Tauri APIs provide a stable implementation boundary. Root independently validates rendered results; no further user approval is needed.

```yaml
execution:
  chain: [RAMZA, Vivi]
  planner: Astra-high
  implementer: Sol-high
  order: [shared-shell, route-contexts, adaptive-native-host, verification]
  sidebar: {normal-width: 248, drawer-below: 960, route-discovery: named-switcher, context-ownership: existing-controller}
  native: {macos: decorated-overlay, other-platforms: existing-decorations, fake-controls: forbidden}
  preserve: [dirty-work, route-guards, editor-state, tree-semantics, scope-actions, calendar-behavior]
  approval: already-authorized
```
