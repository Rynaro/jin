---
eidolon: ramza
kind: spec
version: 1
created_at: 2026-11-19
---

# Calendar and sidebar polish

## Scope

Resolve the four reported interface defects in the current daily workspace. Preserve the user's existing redesign work and all persistence contracts. The screenshots establish the visible defects. Source inspection establishes title validation on blur in `events/composer.ts`, an existing test asserting that behavior, and separately bordered sidebar sections in `sidebar.css`.

## Approach

Use registered SVG icons in consistently centered icon-button boxes for calendar add and dismiss controls. Eliminate font baseline alignment as a dependency while retaining accessible names and focus rings.

Validate a required event title on an intentional creation attempt. A fresh blank draft remains quiet on focus, blur, and normal dismissal. Existing meaningful draft protection, pending-save protection, valid creation, and actual save errors remain operative. Account for the pointer sequence that opens the composer so the same event cannot accidentally dismiss it.

Render the navigation rail as one adaptive surface. Remove hard horizontal dividers and isolated header, context, and footer color bands where they produce the screenshot seams. Keep the task list context readable through spacing and type hierarchy. Place Settings and Notifications beside the Jin brand in a compact header utility group, preserving their real routes, unread indicator, translated labels, keyboard access, active state, and narrow-layout navigation behavior.

## Stories

1. A person exploring the calendar can open and dismiss an unused event composer without being scolded.
2. A person creating an event receives clear validation when they intentionally attempt to save incomplete information, while their meaningful work remains protected.
3. A person moving between daily work areas sees one coherent rail and can reach settings or unread notifications from its header.

## Acceptance Criteria

- CP-1. When the calendar renders its add and close controls, the application shall center their registered SVG icons within the hit area and retain visible focus and accessible names.
- CP-2. When a pristine new event title loses focus or the user interacts with another composer field, the application shall keep the required-title error hidden until an intentional submission attempt.
- CP-3. When the user cancels, presses Escape, or clicks outside a pristine empty composer, the application shall dismiss it without a required-title error; the pointer action that opens it shall leave it open.
- CP-4. When the user intentionally submits an invalid draft, the application shall present relevant validation and prevent persistence; when the draft is meaningful or saving, the application shall retain existing dismissal protection and actual failure feedback.
- CP-5. When the sidebar is shown in light or dark appearance, the application shall present a continuous rail surface with no harsh context, utility, or footer bands, while keeping selected navigation and task context legible.
- CP-6. When the user activates header Settings or Notifications by pointer or keyboard, the application shall navigate through the existing route guards, retain translated accessible names and unread count, and keep both utilities reachable at narrow widths and increased text size.

## Rejected Alternatives

Retaining text glyphs and compensating with per-control offsets leaves rendering sensitive to font metrics. A footer restyle leaves utilities visually detached from the app identity. Removing all draft validation would hide meaningful failure feedback. The selected implementation uses shared geometry, header placement, and interaction-aware validation.

## Risks

Click-outside capture can race with the opening pointer event or trigger premature blur feedback. Moving route elements can invalidate selectors or duplicate handlers. Sidebar tokens must remain coherent in dark appearance and drawer layout. Targeted behavior tests and browser exercise must cover these paths.

## Confidence

Confidence is high for scope and decomposition because the supplied screenshots match concrete source behavior. Optical alignment, rail blending, and responsive geometry require rendered evidence. Browser evidence cannot establish native Tauri rendering or owner visual sign-off.

## Dispatch and verification

Vivi owns implementation and focused regression updates. Vigil independently checks CP-1 through CP-6 against the final diff and runnable evidence. Run focused event composer tests, project type and styling checks appropriate to touched files, and deterministic Playwright interaction checks for blank dismissal, attempted invalid creation, valid creation, utility navigation, and unread state. Capture affected calendar and sidebar surfaces in light and dark appearance, with narrow viewport and increased text scale spot checks. Record any unavailable native or owner checks honestly. ESL lifecycle is full; RAMZA planning-tool size is lite due localized changes without dependencies or public API changes.
