---
spec: engram/1.0
name: jin-notes-editor-draft-integrity
id: egr_940587c0
version: 1
intent:
  does: Keep Jin note-editor drafts safe across autosave, conflicts, metadata changes, and revision previews.
  use_when: Changing note editing, autosave, title, tags, attachments, history, or note conflict behavior.
  not_when: Changing read-only note rendering or global Find.
compatibility: {}
capabilities:
  requires: []
  produces: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - note editor autosave
  - note draft conflict
  - note revision preview
  negative:
  - read-only note rendering
  body_digest: a7615e5c39e883d889ed443da9c2e28a27d8ed8e58a419c21c92e40acb1e8bed
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: a7615e5c39e883d889ed443da9c2e28a27d8ed8e58a419c21c92e40acb1e8bed
assets: {}
extensions: {}
---
## Procedure
1. Read `jin-gui/src/controllers/notes_controller.ts` and the G-SAVE coverage in `__tests__/notes_controller.test.ts` before editing draft flow.
2. Mount or destroy the editor only for a note switch or explicit replacement. Save requests must not remount it or discard the active caret and draft.
3. Serialize body and metadata mutations. Flush pending saves before changing scope, title, tag, attachment, history restoration, or selected note.
4. Associate selection responses with their request and ignore stale responses. Use `expected_revision` before advancing local revision. On conflict, pause autosave until the user explicitly resolves it. Copying the local draft preserves it but does not resolve the stale revision.
5. Render revision previews through the existing sanitizer and preserve the selection when inserting editor content. Run `pnpm --dir jin-gui exec vitest run src/__tests__/notes_controller.test.ts` and `pnpm --dir jin-gui build`.

## Pitfalls
- A delayed save response after rename and navigation can overwrite the newly selected note.
- Silent conflict replacement loses user draft text.

## Examples
+ Flush an active body draft before applying a tag change, then retain the caret in the same editor.
- Change global workspace search ranking → not this engram.

## Provenance
- Derived from notes controller guarded-save paths and focused headless editor tests.
