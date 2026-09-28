# Today experience implementation plan

Status: implemented-pending-native-review. This plan records the RAMZA → FORGE implementation handoff; frontend changes are recorded in [implementation.md](implementation.md). Native Tauri owner sign-off is pending, and no acceptance or merge is recorded here.

## Seams

1. Router/startup seam: preserve `createInitialStateFromHash` and Today fallback (`jin-gui/src/controllers/router_controller.ts:46-50`). Add a focused regression for startup and current-day re-entry, including fallback focus after a detail control disappears.
2. Markup/navigation seam: remove the duplicate Today Capture action from `jin-gui/index.html:303-311`; keep the sidebar Capture path. Reshape only the contextual Today top bar and existing Today targets. No Notes/Tasks widgets.
3. Projection truth seam: reuse the existing Today projection, task DTO, relationship DTOs, and authoritative current-date values. Gate preview body/tags/list rendering on actual `get_task` values. Do not add list resolution or provider claims.
4. Render seam: keep `jin-gui/src/lib/agenda/render.ts` lane ownership and relationship deduplication. Preserve all lane items; permit focus and context repetition with event IDs intact. Use schedule-only clear copy.
5. Modal seam: inspect shared `JinModal`/event preview presentation and Calendar’s shared content before adjusting geometry. Preserve Today semantics, Escape, focus trap/return, and fallback restoration. Treat selector causality as an open diagnosis.
6. Style seam: update Today-owned CSS for intrinsic single-column fallback, continuous timeline, contextual rail, modal readability, and reduced-motion rules. Avoid staged entrance animation and fixed heights.
7. Lifecycle/state seam: make loading, success, initial failure, retry, and current-date re-entry explicit controller states. New error/retry/status semantics are proposed work and require tests for stale responses and interrupted focus.

## Proportional verification

Run focused frontend controller/render tests for startup, duplicate Capture wiring, DTO-gated task preview, modal Escape/focus return, all authoritative lanes, connected-work event IDs, empty/task-only/all-day/noncurrent states, initial failure/retry, midnight re-entry, and reduced motion. Run CSS lint and the TypeScript/Vite build. Run browser visual checks at representative desktop/compact/large-text/dark/contrast/forced-color states, including page overflow and modal bounds. Use native inspection only for owner sign-off; browser fixtures do not prove native bridge behavior.

Run Rust/core tests only if the implementation changes a core projection or DTO. Do not require the blanket full workspace suite for a frontend-only change.

## Handoff decisions

FORGE should resolve only remaining trade-offs: the smallest useful top-bar density, shared modal geometry versus context-specific sizing, and the exact empty/retry copy. Any disagreement must preserve the truth constraints above and be recorded in the final RAMZA spec.
