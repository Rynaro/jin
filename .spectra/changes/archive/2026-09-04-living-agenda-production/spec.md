# Living Agenda production integration

Author: RAMZA. Deliberation: FORGE. Maker: Vivi. Checker: ATLAS.

## Outcome

Integrate the approved Living Agenda visual direction into the real shell, Today, and Capture. Use warm paper and ink surfaces, indigo time/focus/relationships, vermilion Capture, open chronological rows, real localized time ranges, and honest overlap cues. Preserve all navigation, sidebar state, native dialog/controller flows, existing links, persisted appearance, dynamic type and accessibility preferences.

## Implementation contract

1. Add scoped adaptive semantic roles to `jin-gui/src/styles/tokens.css`: canvas/rail/elevated paper, indigo/tint, Capture vermilion/hover/on, timeline rule/overlap tint. Cover light, system dark and explicit dark. Dark Capture uses dark ink on the lighter vermilion; component CSS contains no raw colors.
2. Restyle existing shell and Capture button in `layout.css`, preserving collapse, tooltips, every navigation destination and mobile overlay.
3. Replace bordered Today cards with open readable rows in `today.css`; time gutter and temporal rule must never cross digits. Preserve visible wrapping task/prep-note titles and meaningful source labels. Stack time/body at narrow or large-text sizes. No scaled minimum width or clipping mask.
4. Restyle existing native Capture dialog in `forms.css`; retain all forms, validation, busy/error states, focus handling and API calls. Use internal viewport scrolling and accessible controls.
5. Extend `a11y.css` for scoped Capture/agenda treatment in reduced transparency, increased contrast and forced colors. Preserve non-color text cues.
6. Make minimal `index.html` changes to Today/date headings and event-row template for time range and hidden-until-relevant overlap cue. Preserve Stimulus targets/actions and task/note routing fallback links.
7. Add pure agenda projection in `lib/agenda/transform.ts`. Reuse `formatEventTime` for display timezone ranges and literal wall time for floating events. Compare anchored intervals by epoch and floating intervals by parsed literal wall intervals. Never compare mixed domains or invalid/non-positive intervals. Half-open intervals: touching edges do not overlap. Sweep using maximum end for transitive groups; exclude all-day items.
8. Render projection in `lib/agenda/render.ts`, preserving real sources, recurrence, originating task, prep notes and exact navigation callbacks. Expose text/ARIA overlap cue without fabricated minutes. Do not access originating-task status: Rust linked-task payload only guarantees id/title.
9. Extend meaningful transform/render/controller tests for ranges, domains, touching edges, transitive overlaps, invalid data, accessible overlap text, long titles and link routing. Preserve token discipline checks.

## Acceptance

- AC1: When Jin opens in light/dark/auto, shell and Today use adaptive paper/ink roles while all sections remain reachable and sidebar collapse persists.
- AC2: When Capture opens, all four existing modes submit through existing controllers, preserve errors/busy/focus behavior and use contrast-safe accents.
- AC3: When real agenda items load, preserve order/buckets and show localized range, title, source, recurrence and real task/prep links; activation routes to exact existing IDs.
- AC4: When comparable timed intervals overlap, both rows have contiguous indigo treatment and textual/accessible cues. Touching, invalid or mixed-domain intervals must not claim overlap.
- AC5: When loading/empty/error occurs, existing truthful states remain with no sample-data behavior.
- AC6: When width is 320/390/760/1440 or dynamic type reaches AX5 (310%), Today/Capture reflow without page horizontal scrolling or unreachable navigation/submit/close controls.
- AC7: When reduced motion/transparency, increased contrast or forced colors is active, meaning and focus remain available without color alone.

## Boundaries

No Rust/core/DTO/bridge/API changes. No new overdue task feed, rescheduling/status/Undo workflow, flexible tasks, Now state, event expansion or fabricated conflict duration. Existing guarded task operations are not replaced. Notes/Tasks/Events/Settings layouts are not redesigned. New tokens are additive and used by the scoped slice.

## Verification

Run focused Today/sidebar/Capture/appearance/token tests, then `make verify-gui`. Browser fixture matrix covers widths, light/dark/increased contrast, large text, sidebar, links, Capture keyboard flow and truthful states. Save evidence under `.artifacts/playwright-mcp/`. Native Tauri/WKWebView/WebKitGTK and owner UX sign-off remain distinct from headless evidence. Run Tonberry verification in block mode with distinct maker/checker.

## Risks

Temporal domain/DST false positives, dark accent contrast, lost row grouping, large-text/mobile reachability, and unintended global styling leakage. Mitigate with same-domain projection tests, scoped adaptive roles, structural text cues, and browser reflow checks.
