# Connected planning workflows

Jin should let someone find an event, prepare notes, capture a decision as a task, and reserve calendar time without retyping it. The existing source files and links keep the history of that work.

## Decisions

- Search the live workspace on demand and open results through the existing guarded router. Preserve note editor shortcuts. Search results expose their type and identifying context.
- Start local prep notes from a calendar event using the stored event identity. The note carries the existing prep-for relationship. Provider-backed events remain read-only to this operation.
- Preserve selected note text in both the document and the new task’s body. Review its title and list before creating it. Return authoritative detail and revision data and make the relationship navigable from either end.
- Stage each contextual creation with its relationship as one recoverable operation. Duplicate submissions and retries reuse the result. Reject stale note revisions and missing sources.
- Schedule task time with a reviewed start, duration, and destination. Existing callers retain the one-hour default and promotion preserves task identity.

## Acceptance

1. When a workspace search is opened, the user can filter and open matching notes, tasks and events through the existing guarded routes.
2. When the user selects note prose, Jin preserves the passage and can create a titled task with a persistent typed relationship to its source note.
3. When a user starts a prep note from an event, Jin opens the linked local note with an editable meeting outline and can navigate back to the correct event.
4. When an interrupted linked creation is retried with the same operation identity, the canonical files and index resolve to one object and its relationship.
5. When a task is scheduled, the user can choose its start and block duration through the task and Calendar entry points.
6. When controls are exercised on compact screens and with a keyboard, they remain reachable and preserve editor and navigation guards.

## Verification

Use focused Rust and GUI regressions, a production build and the connected browser flow. Check the bounded layout, keyboard interaction and visual evidence in the changed states.
