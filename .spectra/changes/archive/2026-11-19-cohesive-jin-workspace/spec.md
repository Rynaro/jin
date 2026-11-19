# Cohesive Jin workspace

## Objective

Reimplement the application UI and UX as a consistent, welcoming workspace. The user identified fragmented components, unused interface elements, and mismatched styling across earlier attempts.

## Design decision

Use persistent navigation to all six primary routes with contextual sections within the same sidebar. Share one warm adaptive palette, control geometry, typography, spacing, and header treatment across routes. This makes the application identity and navigation available throughout each workflow.

On compact screens, present navigation as an accessible drawer with explicit close behavior, keyboard support, and focus restoration. Today uses an illustrated date masthead with the real Focus, timeline, and relationship content. Existing task, note, calendar, capture, and native integration contracts remain functional.

## Implementation scope

- Shared shell, navigation, responsive geometry, design tokens, shared controls, and route headers.
- Today composition and cohesive presentation across the six primary routes.
- Removal of shell UI proven unused through reference inspection.
- Existing controller/render boundaries, event handlers, accessible names, preferences, storage, and bridge payloads govern interactions.

## Acceptance

1. Every primary route is reachable through the persistent navigation and remains identifiable through current-route semantics.
2. Contextual sections are available in the same navigation surface. Compact drawer dismissal restores focus and preserves keyboard access.
3. Shared controls and route headers use the same semantic system in light and dark appearance.
4. Today displays real date, focus, timeline, and relationship data using existing projection semantics.
5. Task, note, calendar, and capture workflows retain their real controls and handlers.
6. Desktop and compact viewport checks show readable content and no unintended page overflow. Preference and focus states remain usable.
7. Build, lint, relevant existing behavior tests, and token discipline checks pass. Browser visual and interaction evidence is recorded with exact viewports and states.

Native Tauri appearance and integration require direct native verification. Browser fixture evidence records its actual coverage.

## Verification responsibility

Vivi implements. VIGIL checks independently. The owner evaluates whether the completed visual direction achieves the intended welcoming appearance.
