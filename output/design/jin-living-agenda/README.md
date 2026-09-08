# Jin — Living Agenda / busy-day refinement

This self-contained concept pressure-tests the Living Agenda direction with a realistic, crowded day. It uses nonpersistent sample data; production Jin is unchanged.

## What the prototype covers

- The agenda has 11 scheduled commitments, including two semantic conflict groups. Each group keeps both events visible inside an indigo bracket and states the real 15- or 30-minute overlap. The final busy-day state also includes two attention tasks.
- Two items due yesterday sit in Needs attention. Each can move once to Today, Tomorrow, or Done and can be restored with Undo. These changes last only for the browser session.
- Anytime follows the scheduled agenda with two actual undated items. “Today · Anytime” deliberately means an unscheduled Today task, not an agenda-time bug.
- Linked context is represented by named buttons. Product review links to Launch brief and to Customer quotes, Approved launch dates, and Decision request; the long-title case and the other entries expose only the task, event, or note that actually exists in the sample.
- Task and event links move focus to their source. Note links open a focused panel with a Back control. Agenda disclosures remain independent and Escape closes the disclosure containing focus.
- Capture traps keyboard focus, restores focus to `+ Capture` after dismissal, fits within the viewport, and scrolls internally when enlarged text makes its content taller than the screen. Its feedback says clearly that nothing is saved.
- The state control demonstrates busy day, empty, and loading. Empty and loading remove the current-focus and day-context content so “Now” is never falsely shown.
- Appearance, high contrast, text size (100%, 200%, and 310%), and reduced-motion controls are included as concept controls.

## Completed refinement and QA

[DECISION] Keep the busy-day agenda as a chronological relationship view. Final coverage includes 11 scheduled commitments, two 15/30-minute conflict groups, two attention tasks, a long Product review title, named prep controls, and independent disclosure details.

[DECISION] Preserve the source relationships in the interaction model. Plan Today appends the Today · Anytime item; Undo removes and restores it. Tomorrow and Done support the same status flow. Undo restores attention items, source-task links focus the correct task, note Back returns to the event trigger, and Escape closes the disclosure containing focus.

Keyboard and reflow checks covered Capture’s forward/back focus trap and Escape focus return, 310% text in a 320px viewport, empty/loading states without stale Now, agenda, or context content, and the explicit Reduce motion toggle stopping CSS animations. The tested OS reduced-motion preference was false; native OS override behavior remains untested.

At 100% text, body sizes reflowed at 15px, 30px, and 46.5px across 1440px, 1280px, 760px, 390px, and 320px widths without page-level horizontal scrolling. The 320px layout also remained free of page-level horizontal scrolling at 200% and 310% text.

Observed evidence includes light desktop, narrow dark, dark high-contrast, and 320px/310% Capture views. Console errors and warnings were absent. Computed contrast checks recorded 7.02:1 for dark Capture, 9.18:1 for high contrast, and 11.24:1 for the Now pill.

Evidence files: `.artifacts/playwright-mcp/living-agenda-refinement/reflow-checks.json`, `busy-1440.md`, `busy-390-dark.md`, `760-dark-high-contrast.png`, and `320-text-310.png`; deliverable screenshots are `busy-desktop-light.png` and `busy-narrow-dark.png` in this directory.

## Design decisions

Warm paper, ink, indigo, and vermilion remain purposeful: indigo carries time, focus, conflicts, and connected information; vermilion is reserved for Capture. The agenda stays chronological and shows conflicts as relationships between commitments rather than turning Today into a calendar grid.

The visual direction draws on [Linear’s attention hierarchy](https://linear.app/now/behind-the-latest-design-refresh), [Things’ focused editing](https://culturedcode.com/things/features/), and [Raycast’s discoverable keyboard navigation](https://manual.raycast.com/navigation).

## QA boundary

The document is designed to reflow at 320px, 390px, 760px, and 1440px with its own 100%, 200%, and 310% text control. Those controls are a prototype simulation, not browser zoom or operating-system dynamic type. Native Tauri/WKWebView rendering, actual browser zoom, screen-reader behavior, and operating-system text scaling still require product-level validation. Owner UX sign-off is also pending; these results are not a certification claim.

## Run

Open `index.html` in a modern browser or serve this directory with any static file server.
