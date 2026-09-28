# Research and Jin/calendar dichotomy

Retrieved 2026-09-16. External findings are paraphrased from official product and standards documentation. The repository audit is read-only. This is decision evidence, not a moodboard or a request to copy another product literally.

## Research thesis

Effective calendars combine a spatial field with a stable editing context. The field answers “when and how full?”; the companion answers “what, whose calendar, who is invited, and what will happen when I save?” The interface feels calm when inactive complexity is folded away, not when destination, permissions, recurrence, or delivery state is hidden.

## Official product evidence

| Product | Verified behavior | Lesson for Jin | Boundary |
|---|---|---|---|
| Google Calendar | Users can create from a date/time, navigate views with keyboard commands, edit from event details, and answer Yes/No/Maybe from an event. Google documents time proposals in its own product, recurrence scope, and timezone behavior. [Create](https://support.google.com/calendar/answer/72143), [keyboard and screen-reader use](https://support.google.com/calendar/answer/6101541), [responses](https://support.google.com/calendar/answer/37135) | Grid entry, direct RSVP, and visible capability are expected. Keyboard operation is a complete workflow, not an afterthought. | Jin's public API baseline has no native proposed-time contract. No proposal UI or transport enters this plan. |
| Apple Calendar | Day/Week create by dragging a time range or double-clicking; event information opens compactly; events move and resize directly. Calendar and notification surfaces both carry RSVP. Timezone support affects view and per-event zone. [Create/edit](https://support.apple.com/guide/calendar/icalwr13-events/mac), [invitations](https://support.apple.com/guide/calendar/reply-to-invitations-icl1019/mac), [advanced timezone settings](https://support.apple.com/guide/calendar/icl26670/mac) | A spatial action can produce a draft while detail remains close. Invitations should use the same response state in both surfaces. | Apple provider-specific proposals and automatic behaviors are evidence of expectations, not features Jin can claim. |
| Fantastical | Natural-language quick entry updates a draft preview; users can create by dragging a range, edit in adjacent detail, move events, and resize edges. It also provides calendar sets and timezone preferences. [Create](https://flexibits.com/fantastical/help/adding-events-and-tasks), [edit/drag](https://flexibits.com/fantastical/help/editing-events-and-tasks), [calendar sets](https://flexibits.com/fantastical/help/calendar-sets), [settings](https://flexibits.com/fantastical/help/settings) | Title-first entry and progressive disclosure can coexist with precise manual fields. Direct manipulation must update the same draft as the form. | Jin keeps its current natural-language parser and exact route model; it does not add templates, sets, or provider features here. |
| Notion Calendar | Selecting a slot starts creation, calendars have stable visible identity and default destination, and event context supports participants, rooms, RSVP, calendar assignment, and direct edits. Timezones and grid density are first-class settings. [Events](https://www.notion.com/help/manage-your-calendars-and-events), [settings](https://www.notion.com/help/notion-calendar-settings), [timezones](https://www.notion.com/help/time-zones) | Destination and calendar color belong in the draft header and every event presentation. Save state and external notification state need separate language. | Jin does not add provider transfer, rooms, scheduling links, or availability products through this UX project. |
| HEY Calendar | Official help describes a continuous Day line, Week overview, optional event fields, calendar-derived color, and drag-adjustable draft placement before creation. [Overview](https://help.hey.com/article/800-calendar-overview), [events](https://help.hey.com/article/844-events) | Keep visible free space and let optional fields stay quiet until needed. | Photos, named days, countdowns, circles, and other expressive features are decorative/product expansion; they are deferred. |

## Accessibility evidence

- WCAG 2.2 requires a single-pointer alternative for any author-defined drag operation; keyboard equivalence alone is insufficient. Jin's date/time fields are the primary click/tap alternative, and every drag result must be expressible there. [Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- A modal must make the background inert, trap Tab/Shift+Tab, support Escape, and restore focus. A non-modal companion must not claim `aria-modal` or trap focus. [ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- A composite calendar grid can expose one page-level tab stop and manage arrows internally. When a cell contains multiple controls, entering and leaving its internal controls must be explicit. [ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- WCAG's target-size minimum is 24 CSS pixels with exceptions; Jin retains its stronger 44px coarse-pointer target. [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Pointer actions need an abort path and must not commit on pointer-down. Jin commits a move/resize only after explicit Save, never during a drag gesture. [Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)

## Current Jin evidence

The [baseline manifest](../../../.artifacts/playwright-mcp/calendar-experience-baseline.md) records reproducible fixture evidence at 1280×800 and 390×844. It shows five compositions for one event workflow: calendar grid, static create modal, full detail replacement, full-page edit article, and Today preview modal. The compact edit fixture has no document overflow; this does not validate all responsive or native states.

Read-only code audit found:

- The Events route intentionally uses Month/Week/Day as its browse surface, but every event control only opens full detail.
- Calendar create has the broadest draft; full edit is capability-driven; Today has an intentionally compact preview/editor; Capture has a smaller event contract; Notifications owns a separate scope dialog.
- The time grid already has overlap geometry, all-day lanes, now marker, night expansion, date/event callbacks, and scroll restoration. It has no empty-slot selection, drag, resize, or calendar-grid keyboard model.
- Core and Event detail already model permissions, recurrence scopes, recurrence-rule support, exact Google route, Meet, RSVP, pending/paused sync, stale edit tokens, and DST resolution policy.
- `JinModal`, semantic buttons, `jin-badge`, `jin-checkbox`, the invitation controls, and the embedded date calendar are reusable foundations.
- `calendar.css` contains competing historical layers: rounded/card/pill declarations followed by paper-field overrides. Adding another override would repeat the drift.

## The dichotomy

| Jin visual catalog | Effective calendar requirement | Resolution in this plan |
|---|---|---|
| Continuous warm paper; quiet rules; no card pile | Time needs spatial density, free-space visibility, and direct action | The grid remains one paper field. Selection, draft ghosts, and handles sit on the time geometry rather than wrapping it in panels. |
| Indigo means time, focus, selection, and linkage | Selected event, draft event, current time, saved state, and error need distinct meanings | Indigo marks selection/draft; the existing red now line marks current time; semantic state text/icons carry pending/error; Capture/add keeps `--capture-vermilion`; destructive buttons keep the established seal primitive. |
| Display type establishes an editorial surface | Calendar controls and event metadata need compact operational typography | Date/range heading uses display type; event labels, times, calendars, controls, and state use the text face. |
| Preview-first Today keeps context | Calendar users need inspection without leaving the schedule | A stable right Event Companion preserves the visible grid; the full page becomes an explicit focus-view escape hatch. |
| Real controls and truthful state | Provider capabilities vary by event and exact route | Actions appear only after current capability load; disabled reasons, sync state, and recurrence scopes come from existing projections. |
| Calmness means restraint | A useful calendar still needs creation, moving, resizing, RSVP, Join, and recovery | Actions are visible at selection time and fold away otherwise; the system never hides destination or pending/error truth. |
| Today separates scheduled and unscheduled work | Tasks with due dates are not timed commitments | Calendar Day preserves its existing due-task appendage after the time-grid scroller and Promote action; copy may clarify “unscheduled,” but tasks never appear at fabricated times. |

## Evidence limits and validation questions

No research source proves that the selected composition improves Jin retention or owner satisfaction. The implementation must test:

1. Can participants create a correctly routed 60-minute event from Day/Week in under 30 seconds without leaving the grid?
2. Can they reschedule a recurring Google event and correctly explain which instances will change?
3. Can they distinguish “saved locally”, “syncing”, “Google accepted update”, and “needs review” without assuming an email was delivered?
4. Can they recover the exact calendar position after preview/edit on desktop, compact width, keyboard-only, and large text?
5. Can they identify calendar membership in dense Month/Week views without relying on color alone?

Decorative HEY features, availability products, scheduling links, room directories, proposals, calendar transfers, and generalized calendar sets remain outside the answer to those questions.
