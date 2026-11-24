# Calendar editor and timeline interactions

## Intent

Remove visual collisions from Calendar entry surfaces and make timeline
creation and navigation feel direct in Month, Week, and Day.

## Acceptance checks

1. `CAL-UX-1` Given an existing entry preview or edit state, when its title is
   focused or edited, then title typography stays consistent, the field clears
   the close control, and the meeting action label is centered.
2. `CAL-UX-2` Given the new-entry composer, when a calendar is selected, then
   its source-color indicator and title remain separately legible at normal and
   large text sizes.
3. `CAL-UX-3` Given a selectable empty range in Week or Day, when the user
   drags across it, then the new-entry composer opens with the selected start
   and end. Existing event drag, resize, keyboard, and all-day behavior remain
   intact.
4. `CAL-UX-4` Given Day is selected through the persistent view picker, then
   its heading has no redundant back control, presents a complete 24-hour
   chronology without compact night controls, and retains readable all-day
   labeling beside the Calendar source rail. Week retains its night controls.

## Boundaries

The change preserves event data, sync behavior, detail-panel navigation, and
the existing Month and Week range controls.
