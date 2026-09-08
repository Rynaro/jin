# Living Notes production visual integration

Author: RAMZA. Maker: Vivi. Checker: ATLAS.

## Outcome

Extend the validated Living Agenda and Tasks language into the real Notes workspace. Notes should feel like a quiet writing desk: warm paper and ink, indigo for the active folder, collection, note relationship and focus, and restrained chrome around the content. Browsing remains quick, but the current note title and writing surface lead the hierarchy. Preserve the existing folder tree, collections, search, source editor, reading mode, autosave, attachments, links, history, conflicts and navigation.

## Implementation contract

1. In `jin-gui/src/styles/tokens.css`, add only semantic Notes roles that existing adaptive paper/ink roles cannot express cleanly: selected-note wash/edge, editor paper and quiet note metadata. Prefer aliases to the existing adaptive agenda/workspace roles so light, system dark and explicit dark stay aligned. Component CSS contains no raw colors.
2. In `jin-gui/index.html`, add a compact, real Notes workspace identity in the list header. It contains exactly one visible `h1` for the active scope and keeps Search and New Note subordinate and reachable. Preserve every existing Notes target/action, dialog, template, role, fallback route and loading/empty/conflict state. Do not add onboarding prose, fabricated counts or a second editor/reader.
3. In `jin-gui/src/controllers/notes_controller.ts`, project the heading from existing state only: `All Notes`, the exact selected folder path/name, or the exact selected collection name. Update it on connect, folder/collection/all-notes selection and collection rename/delete recovery. Search does not rename the scope; its existing live count remains the result feedback. Make no new bridge calls and do not change list filtering, persistence, conflict guards or focus behavior.
4. In `jin-gui/src/styles/browse.css`, consolidate the two existing Notes style authorities into one scoped composition rather than appending another override block:
   - The folder/collection rail is quiet warm paper. Active rows use indigo text/wash plus a persistent edge, outline or current-state mark. Tree indentation, counts, expand/collapse, rename/delete/new-subfolder menus, collection actions and rail collapse remain keyboard and touch reachable. Long names truncate without displacing counts/actions.
   - The list header places the real scope title first, with Search and New Note as compact tools. It wraps into content-sized rows at narrow widths and large text. Search label, input, live result count and Escape behavior remain visible and truthful.
   - The note list is an open paper index. Each row keeps the exact title, update date, snippet, tags and archived status semantics. Normal desktop rows may be compact; at large text titles, snippets, tags and status wrap and rows grow. Hover, keyboard focus and any selected/current state use indigo plus a non-color edge/outline. Remove the current fixed-height/clipping treatment where it hides meaning.
   - The detail is a content-first writing surface. The actual editable note title is the strongest local element, uses the existing title save/revert behavior and has an explicit accessible name. Keep the CodeMirror editor as the only editor and the existing sanitized Read mode as the only reader. Preserve formatting, Focus, Typewriter, edit/read toggle, caret, autosave status, word/read-time footer and internal scroll behavior.
   - Keep tags, outgoing links, backlinks and attachments in the editor scroll flow with visible section headings and exact real labels. Long labels wrap instead of being reduced to ids or clipped. Keep attach/link/history actions reachable by keyboard and touch, and retain the current cross-object callbacks.
   - Conflict and history surfaces retain their exact guarded flows and local-draft protection. Their messages/actions remain prominent and the history preview stays inert text. Loading, empty and not-found states stay truthful.
   - At widths where the existing controller shows list or detail as separate states, preserve that navigation model. Do not force a new three-pane workflow or duplicate the note body.
5. In `jin-gui/src/styles/a11y.css`, add scoped Notes rules for AX5/310% text, reduced motion/transparency, increased contrast and forced colors. At 320px, folder/list/detail become one usable layer at a time; headers and toolbars wrap or scroll intentionally; title, prose, metadata and links remain visible; dialogs and editor actions remain reachable; the document has no horizontal scrolling. Do not use scaled minimum widths, fixed text-row heights, clipping masks or `overflow:hidden` on text-bearing containers to manufacture a pass.
6. In `jin-gui/src/lib/icons/index.ts`, register the already-rendered `history` icon so opening a note produces no unregistered-icon warning. Do not change the action or substitute a different meaning.
7. Extend `jin-gui/src/__tests__/notes_controller.test.ts`, `notes_visual_system.test.ts`, `icons_registry.test.ts` and token-discipline coverage where appropriate. Assert active-scope heading mapping/updates, preserved browse/detail/search callbacks, visible real row/detail content, content-sized AX rows, semantic Notes tokens and successful History icon rendering.

## Acceptance criteria

- **AC1 — scope and navigation:** When Notes opens or a folder/collection/all-notes scope changes, Jin SHALL show exactly one visible level-one heading with `All Notes` or the exact selected real name, while all Notes and global navigation destinations retain their current routing and persisted rail state.
- **AC2 — browse and search:** When real notes load or a search runs, Jin SHALL preserve order/filter semantics and expose title, update date, snippet, tags and archived status plus the existing truthful search count, loading, empty and failure states. No sample notes or invented counts SHALL appear.
- **AC3 — folder and collection workflows:** When users expand, select, create, rename or delete folders/collections, Jin SHALL call the same callbacks and bridge paths, preserve tree keyboard behavior and show active state through structure as well as color.
- **AC4 — writing continuity:** When a note opens, Jin SHALL keep one existing CodeMirror editor, current title save/revert, 600 ms autosave/flush lifecycle, formatting, Focus, Typewriter, Read mode, caret and conflict pause behavior. Visual changes SHALL NOT remount or replace the editor during ordinary edits or toggles.
- **AC5 — real relationships:** When tags, attachments, outgoing links or backlinks exist, Jin SHALL show their exact real labels and preserve navigation/attach/link callbacks. Long labels SHALL remain readable and focusable without relying on color alone.
- **AC6 — recovery:** When history, not-found or stale-write conflict flows appear, all existing status, preview, copy/reload/review/restore controls and local-draft protections SHALL remain reachable; opening a note SHALL produce no unregistered History-icon warning.
- **AC7 — responsive accessibility:** At 320, 390, 760 and 1440 CSS pixels, and at AX5/310% text, the rail, scope header, search, note list, title, editor/reader, related links and dialogs SHALL reflow without page horizontal scrolling, clipped note meaning or unreachable controls.
- **AC8 — appearance preferences:** In light/dark/auto, reduced motion/transparency, increased contrast and forced colors, paper/ink/indigo roles SHALL remain legible, while focus, current scope, archived/conflict and link states retain text, glyph, edge or outline cues beyond color.

## Boundaries

No Rust/core/DTO/bridge/API changes. No new note model, document format, full-text search behavior, collaboration workflow, command palette, AI writing feature, editor framework or navigation destination. Do not redesign Today, Tasks, Events, Settings or Capture. Preserve all Stimulus targets/actions, native dialogs, folder-tree ARIA and roving focus, collection queries, search debounce/request ordering, title/body save semantics, Markdown sanitization, attachment storage, history recovery, conflict guard and cross-object routes. Do not replace real functionality with prototype interactions.

## Verification

Run focused Notes controller, folder tree/preferences, editor/live-preview/Markdown, icons registry, router, appearance, accessibility and token-discipline tests, then `make verify-gui`. Browser evidence at 320/390/760/1440 covers light/dark, populated/empty/search states, folder and collection selection, long title/snippet/tags, editor and Read mode, related links, history/conflict presentation, rail collapse and AX5 reflow. Review all console warnings/errors. Native Tauri owner validation remains distinct from deterministic browser evidence.

## Risks

The main risks are losing mature editor behavior while simplifying chrome, hiding note metadata with fixed row geometry, toolbar overflow at large text, weak dark-mode indigo contrast, obscuring folder actions and creating a third CSS authority layer. Mitigate by retaining behavioral hooks, consolidating current Notes rules, using content-sized reflow, adding non-color state cues and testing the real editor and relationship flows.
