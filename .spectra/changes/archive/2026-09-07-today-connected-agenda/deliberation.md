# Deliberation

## Decision

Choose a dedicated backend-authoritative Today projection and an editorial frontend composition.

The existing `today_agenda` is trustworthy for events, timezone filtering, originating tasks, and prep notes, but it is event-only. The screenshot's scheduled task rows cannot be reproduced from standalone `TaskDto` values because tasks have a due value and flexible marker but no scheduled span. The implementation therefore treats promoted events as task time blocks and places other due/flexible tasks in untimed lanes.

A new `today_projection` command is preferred over extending the legacy `AgendaDto`. It minimizes compatibility risk, lets old CLI/GUI consumers retain their stable contract, and provides one read-consistent object for the new page.

Task slicing belongs in core. The existing frontend Tasks smart scope uses browser UTC time and cannot share the agenda's configured-display-timezone authority. Core already owns index access, display timezone, event resolution, and explicit DST policy.

Focus is plural. Selecting one arbitrary active event and attaching a count would hide commitments during real overlaps. `active_events` therefore contains all concurrent resolved intervals. `next_event` remains independent so the owner can see what follows. Core supplies resolved UTC boundaries and minute values; the browser refreshes at minute boundaries based on server-authoritative `is_current_date`.

The visual approach follows Jin's implemented language: display type establishes the day, warm continuous paper carries the work, indigo marks chronology/linkage, and vermilion is reserved for Capture. Context is a quiet rail rather than a card dashboard. Shape plus text distinguishes calendar events from task-derived time blocks.

## Alternatives rejected

### Frontend Promise.all over today_agenda and list_tasks

This is less code, but it splits read consistency and encourages browser/UTC task-date logic that can disagree with `config.display_tz`. It also leaves focus resolution exposed to naive event timestamps.

### Extend AgendaDto directly

An additive extension can be made compatible with coordinated fixtures, but it broadens a stable DTO used by existing Today and CLI paths. A dedicated projection keeps the legacy contract smaller and makes current-day work semantics explicit.

### Event-only visual reskin

This would be visually credible and technically safe, but it would preserve the existing event-only limitation and fail the user's request to augment Today into mixed daily work.

### Put every due task on the timeline

Task due values do not express a scheduled duration. Positioning them as timeline blocks would fabricate precision. Only real events belong on the chronological spine.

### Choose one active event plus a numeric count

This optimizes visual compactness by hiding exactly the information users need when commitments overlap. All active focus items remain directly accessible, with responsive layout handling density.

## Guardrails

- No fake durations, prep notes, relationships, or completion claims.
- No cross-domain pseudo-UTC comparison.
- No duplicate promoted task in standalone lanes.
- No minute timer on browsed dates or hidden documents.
- No new editor, scheduler, mutation, storage, provider, dependency, or background behavior.
- No literal copy of prototype-only controls or state labels.
