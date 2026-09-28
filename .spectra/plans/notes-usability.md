---
eidolon: ramza
version: 0.1.0
status: ready-for-vivi
created_at: 2026-09-23T23:29:56Z
kind: spec
target_repos: [jin]
stories_count: 6
validation_gates_count: 12
---
# Notes usability: clear controls, stable reading, useful collections

## Scope

CHANGE, RAMZA → Vivi, standard tier; Astra6High planning and Sol6High implementation. User authorizes implementation. Preserve existing dirty work. This is frontend work using existing APIs, with no dependencies, storage migrations, new backend, or raw query language.

In: collection actions/rule editing/explanation, scoped Notes selection and browse hierarchy, tag popover/tooltips, history layout, Note → Event attachment picker, managed-image Edit preview, matching checkbox appearance, truthful code-copy feedback. Preserve native toolbar, sidebar drawer, autosave/conflict/restore guards, Markdown source, asset safety and keyboard semantics.

Deferred: paper-card/gallery mode. The current excerpt/date/tag DTO supports an improved list immediately; a second view adds preference, keyboard and drag/drop contracts without solving the reported failures. No rich-text conversion, external-image fetching, or fabricated revision diff. History currently provides a revision snapshot, not a computed diff.

## Approach

Use existing surface owners and consolidate their rules. No new global theme. Notes selection becomes a soft neutral inset row with label weight and selected semantics; remove the blue leading stripe. Preserve the separate visible keyboard focus ring, brand mark and semantic action colors.

Confirmed source causes:
- `notes_controller.ts:renderCollections` puts literal Rename/Delete text inside icon-sized controls. `updateCollectionQuery` already exists but has no user-facing edit path.
- `render.ts:renderTags` destroys/rebuilds focused tag controls and has only a CSS-positioned toggle, without outside-dismiss/Escape/focus restoration. CSS tooltip centers unbounded nowrap text at every button.
- `browse.css` history gives the outer inner-dialog `overflow:auto`, a min-height grid and separately scrolling preview. The revision list can grow the dialog instead of receiving remaining height.
- Notes `openAttachDialog` emits no context, so `actions_controller.ts` exposes legacy Note ID/Target ID/Edge kind. Event-prep and note-connect already demonstrate contextual identity-backed choices.
- `jinManagedImagePreview()` creates a managed-image placeholder for inactive source lines; only Read calls image hydration. Finish this existing behavior with managed local assets only.
- Edit uses `.cm-task-glyph`; Read uses disabled `.task-list-item-checkbox`. Copy code only changes a hidden label on failure and gives no success feedback.

Chosen hypothesis: reusable existing contracts with narrow interaction repairs. Conservative CSS-only cleanup cannot fix Attach, collections or image hydration. A gallery/rich-text rewrite adds unnecessary interaction and storage risk. The chosen approach keeps all content and identity contracts intact.

## Stories

### S1 — A useful, restrained browser and collection sidebar
As a writer, I want to understand and manage saved collections without crowding my folders. Timebox: 2d. Risk: P1. Executor: Sol6High, implement in the existing controller/DOM owners.
- Replace collection Rename/Delete pair with one labeled ellipsis button using the existing Notes folder menu behavior where possible. Menu: Edit rules, Rename, Delete collection. Pointer, keyboard, Escape, outside click and return focus work inside the navigation drawer; selecting a menu action does not select the collection or prematurely close the drawer.
- Introduce one short explanation by Collections/new-collection: “Saved views that update as your notes change. Notes stay in their folders.” Delete confirmation explicitly preserves notes.
- Use existing `updateCollectionQuery(id, query)` to edit supported rules. Reuse the create dialog in edit mode, preserving collection identity. Initial UI: All notes, Tag, Status, Text contains; status uses actual supported values, Tag suggests `listTags()` values while permitting a valid new value; all hides/disables the irrelevant value field. Show plain-language rule summary in the active collection header and edit dialog.
- Do not flatten imported complex queries: unsupported all/any/not/property/link trees must remain unchanged, with a truthful summary and explanation that this editor cannot change their rules. Rename/delete remain available. Do not imply simple edits preserve an unsupported tree.
- Improve All Notes/folder/collection lists with clear title, restrained scope description/count derived from loaded data, title/excerpt/date hierarchy, quiet tag metadata and useful scope-specific empty states. Search remains the existing global search; do not label its results folder-scoped. Preserve note drag/drop and open actions.
- Remove selected Notes folder/collection stripe at its owning selector. Use neutral selected fill plus stronger label/icon, keep `aria-selected`/`aria-current` and focus ring. Scope Notes only; do not recolor Calendar or Tasks.

### S2 — Tags and tooltips stay usable at every edge
As a writer, I want compact metadata controls that do not fall off the window. Timebox: 1d. Risk: P1.
- Keep a compact Tags popover with heading, grouped tag+remove chip, labeled add/rename input and an explicit Add/Save action; Enter remains supported. Include empty state and clear cancel-rename path. Mutation pending/error comes from the real callback; update only after success.
- Use a viewport-clamped anchored surface with max width/height, internal scroll when needed, reposition on resize/scroll. Escape/outside click closes it and restores trigger focus; opening moves to input. Async edits keep useful input/chip focus instead of dropping to body after `replaceChildren`; destroyed note views release handlers/observers.
- Replace/upgrade Notes tooltips with one small bounded positioning helper if no suitable shared helper exists. Hover and focus show wrapped/clamped text; Escape dismisses; tooltip has no actions and does not steal focus. Avoid overflow:hidden on chrome to solve clipping. Do not convert the tag popover into a tooltip.

### S3 — History with a stable selector and preview
As a writer, I want to browse many revisions while retaining the preview and Restore control. Timebox: 1d. Risk: P1.
- Header/status and footer are fixed rows inside a viewport-bounded dialog. Middle body has `min-block-size:0`; desktop columns are a compact revision list and flexible preview with independent overflow. Remove ancestor vertical overflow/min-height that lets the list move the preview/footer away.
- Narrow/large-text uses bounded revision selection above the remaining-height preview (or a labeled revision select), not a long combined document. Keep all revisions reachable. Preview is a snapshot; label it accurately. Mark selected revision semantically and visually; loading a different revision disables Restore until its request resolves. Maintain current request guards, sanitizer, media cleanup and restore confirmation/flush semantics.

### S4 — Attach this note to an event by name
As a writer, I want to choose an event without knowing database identifiers. Timebox: 2d. Risk: P1.
- Add explicit `note-event` context to Notes Attach dispatch. Dialog title “Attach to event”; current note identity is fixed, displayed by title. Search/select candidates from `listEvents()` by event title with actual date/calendar information when available; duplicate labels still map to exact IDs. Default edge is `prep-for`, hidden from this ordinary flow. No arbitrary typed string is accepted as a selected entity.
- Reuse contextual choice infrastructure, with request-generation guards and reset on every open/close. Distinguish loading, no events, no match and load failure. Disable submit until a real event is selected; double-submit is blocked. Existing Event → Note prep and generic Link flows must still work after switching modes.
- Await/verify the existing Notes pending-edit guard before leaving a note. Prefer keeping the note open after successful attach, announce success and refresh canonical links/backlinks; do not silently navigate away. Existing attach API and event-context refresh signals remain authoritative.

### S5 — Predictable Markdown preview and checkboxes
As a writer, I want local images visible while composing and consistent task marks between modes. Timebox: 2d. Risk: P1.
- Complete the existing standalone managed-image decoration: hydrate inactive image lines through `resolveImageAttachment` and the existing verified MIME/hash rules. Reuse safe DOM construction; no arbitrary URL/raw HTML image path. Focus/cursor/selection entering the line reveals source; leaving renders image. A selection crossing the line never loses source. Keep meaningful alt text and source-edit keyboard action.
- Widget lifecycle owns pending hydration and object URL revocation on replacement/destroy; late responses cannot attach to stale notes/widgets. Cache/reuse active image resolution sensibly to avoid re-requesting every keystroke, with bounded lifetime. Failure leaves understandable source/placeholder access. Do not match image syntax inside fenced code; never mutate Markdown or dirty the note merely by previewing it.
- Use one Notes checkbox visual recipe for Edit widget and inert Read checkbox: same square size, corner, fill, alignment and solid legible check. Preserve Edit's source toggle and keyboard handler; Read remains noninteractive and exposes checked/disabled semantics. Do not use a font-dependent thin Unicode check. Verify no double list bullet.

### S6 — Truthful copy feedback
As a reader, I want to know whether code was copied. Timebox: 1d. Risk: P2.
- On fulfilled clipboard write, show check/Copied in the existing code header and announce via polite status; reset to Copy after a short interval. Failure visibly says Copy unavailable; it never claims success. Handle missing clipboard API as well as rejected promises, repeated clicks, and detached views without stale UI/timers. Preserve exact copied text and wrap behavior.

## Ownership and implementation order

Single writer: Sol. Root owns browser/native QA, Astra independent review. Product files: `jin-gui/index.html`; `src/controllers/{notes,actions}_controller.ts`; `src/lib/notes/{render,editor,livePreview,codeChrome}.ts`; optional focused `src/lib/ui` anchored helper; `src/styles/browse.css`; narrow Notes-only `sidebar.css` and `tokens.css` only if a semantic role is missing. `markdown.ts` only if needed to share inert checkbox hooks without weakening sanitizer. Tests beside existing Notes/actions/Markdown suites. Update visual dossier after acceptance.

Order: S1 collection/sidebar/browse → S4 identity-backed Attach → S3 history → S2 tags/tooltips → S6 copy → S5 managed images/checkbox consistency. Build once core flows cohere, then root reviews rendered matrix. Do not pile final overrides on historical CSS; replace owning rules and inspect a11y authority.

## Acceptance Criteria

### AC-01 (event-driven)
WHEN a collection menu opens in the drawer
THEN each action shall be keyboard reachable without changing the active collection.
VERIFY: controller/menu interaction test plus root Escape/focus smoke.
### AC-02 (event-driven)
WHEN a supported collection rule is edited
THEN the existing collection identity shall retain the exact submitted query after reload.
VERIFY: updateCollectionQuery payload/controller test.
### AC-03 (unwanted-behavior)
GIVEN an imported complex collection query
WHEN its edit surface opens
THEN the original query shall remain unchanged by unsupported simple-rule controls.
VERIFY: complex-query preservation test.
### AC-04 (event-driven)
WHEN a tag mutation succeeds near a viewport edge
THEN focus shall remain in the bounded tag editing flow.
VERIFY: root 320/390/AX edge and keyboard checks; focused mutation test.
### AC-05 (state-driven)
GIVEN many revisions and a long snapshot
THEN the history footer shall remain visible while the revision list scrolls.
VERIFY: root desktop, short-height and AX geometry checks.
### AC-06 (event-driven)
WHEN a named event is attached from Notes
THEN attach_note shall receive the current note ID and exact selected event ID with prep-for.
VERIFY: duplicate-title payload and mode-reset tests.
### AC-07 (unwanted-behavior)
WHEN an old picker response resolves after close or mode change
THEN it shall not replace the current picker choices.
VERIFY: deferred-promise actions test.
### AC-08 (event-driven)
WHEN the cursor leaves a managed-image source line
THEN its safe local image shall render without changing the document.
VERIFY: decoration/hydration test plus root real editor smoke.
### AC-09 (event-driven)
WHEN an image widget is removed before resolution completes
THEN its eventual object URL shall be released.
VERIFY: lifecycle test with mocked URL API.
### AC-10 (state-driven)
GIVEN equivalent checked Markdown in Edit and Read
THEN both modes shall use the same visible checkbox geometry.
VERIFY: root screenshot comparison and Edit toggle/Read inert tests.
### AC-11 (event-driven)
WHEN copying code succeeds or fails
THEN the visible status shall report the actual result.
VERIFY: clipboard success/rejection/unavailable tests.
### AC-12 (state-driven)
GIVEN Notes at 320, 390, 760 or 1280 CSS pixels including enlarged text
THEN the document shall remain free of horizontal overflow.
VERIFY: root browser matrix, light/dark, keyboard focus, reduced transparency; console review.

## Confidence

High confidence: UI owners and all required backend APIs exist. Main risks are stale async picker/image completions, preserved complex collection queries and CSS height ownership. Browser evidence plus focused lifecycle tests cover these; no native claims from browser simulation. Parent supplies independent rendered validation.

```yaml
handoff:
  from: ramza
  to: vivi
  tier: standard
  implementer: Sol6High
  approval: already_authorized
  backend_changes: false
  preserve_dirty_work: true
  order: [S1, S4, S3, S2, S6, S5]
  validation: [focused_behavior_tests, typecheck, style_checks, build, root_visual_matrix]
```
