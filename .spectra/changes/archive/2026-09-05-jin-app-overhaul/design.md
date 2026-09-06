# Design Rationale

## Decision

Use a sequential semantic-system renewal led by dedicated adaptive roles. Events lands first and proves calendar paper, rules, header hierarchy, event records, and long-form editing. Notifications and Settings then consume the settled material and state language. Shared dialogs, Capture, and utility controls close the system. Today, Tasks, and Notes receive regression-only corrections.

This design keeps calendar geometry intrinsic to its existing Month/Week/Day renderers and makes any necessary internal scrolling keyboard reachable at narrow widths and AX5. Event, notification, and settings capabilities remain authoritative; visual quietness cannot hide provider, read-only, recurrence, pending, conflict, disabled, warning, or error truth.

## Token strategy

Add narrow semantic roles for calendar paper/rules, shared operational washes, dialog elevation, and shared state presentation when current roles are insufficient. Do not broadly retheme generic background/fill tokens because they already serve accepted surfaces and would create a large regression radius. Component styles consume semantic roles and retain calendar/source colors plus semantic success, warning, and error colors.

## Structure

Prefer CSS changes in each owning stylesheet. Add render hooks only when type/spacing hierarchy cannot be targeted without changing semantic structure. Keep Stimulus targets/actions, accessible roles/names, listbox behavior, live regions, hidden legacy Events list, dialog primitives, controller ownership, and payloads intact.

## Deliberation

The selected semantic-system approach scored highest because it creates one maintainable visual language without changing architecture. Isolated route redesigns were easier locally but would perpetuate duplication. A universal card system contradicted the approved open-paper direction. No architectural tradeoff or new dependency is required.
