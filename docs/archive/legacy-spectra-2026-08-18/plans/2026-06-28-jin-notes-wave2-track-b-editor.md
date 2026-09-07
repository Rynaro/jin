# Jin Notes — Wave 2, Track B: Obsidian-style live note editor — Spec (decision-ready)

- **Methodology:** SPECTRA 4.10.0 · standard tier · single-pass cycle
- **Date:** 2026-06-28
- **Intent type:** CHANGE (frontend-only: TS/Stimulus + 2 new runtime deps; **NO Rust changes**)
- **Complexity:** 8/12 → extended thinking (2× depth)
- **Confidence:** 87% → AUTO_PROCEED
- **Hand-off:** spectra → apivr (**Vivi**, coder)
- **Conventions file:** none present (`.spectra/setup/spectra-conventions.md` absent) → generic defaults
- **Upstream scout:** ATLAS Wave-2 report, Track B (episodic crystal `0ca90347`, **not surfaced by recall** — only the Wave-1 crystal `5216e65c` returned, mirroring Track A). Every ATLAS anchor below was re-read in source before speccing; corrections/confirmations are noted per item.

> Scope is **Wave 2, Track B (live editor) ONLY**. The backend save path is **DONE** (ATLAS-confirmed and re-verified) — this track wires the existing `edit_note` command to a new per-block live-preview editor inside the (Track-A-shipped) 3-pane Notes detail. No Rust, no new Tauri commands, no schema work.

---

## 0. Firsthand verification of ATLAS Track B anchors

| ATLAS finding | Verdict (firsthand) |
|---|---|
| Save path exists & unused by Notes view: `editNote` → `edit_note` → `ops::notes::edit_note`; body-only change = in-place overwrite; command calls `api::refresh`. | **CONFIRMED.** `editNote(id, input)` at `jin-gui/src/invoke.ts:68-78` calls `invoke('edit_note', { id, input })`. `edit_note_fn` at `jin-gui/src-tauri/src/commands/notes.rs:71-86` calls `notes::edit_note` then `api::refresh(root)`. **Exact param shape (the open question): `editNote(id, { title?, body?, add_tags?, rm_tags? })`** — a body-only save is `editNote(id, { body })` (title omitted ⇒ unchanged ⇒ in-place overwrite ⇒ folder + title preserved). No Rust change needed. |
| Current detail render: `renderNoteDetail` writes `bodyEl.textContent = note.body_markdown ?? ''` into `.note-detail__body`. | **CONFIRMED but partially stale.** Track A already restructured `renderNoteDetail` (added folder rail, 3-pane). The body block is intact at `jin-gui/src/lib/notes/render.ts:199-204` (`bodyEl.className='note-detail__body'; bodyEl.textContent = note.body_markdown ?? ''`). This read-only body is exactly what the editor replaces. |
| No markdown/sanitizer infra; repo discipline = template-clone + `textContent`; every `innerHTML` in app code is `= ''` (clearing only). | **CONFIRMED.** `jin-gui/package.json:17-23` has no parser/sanitizer; `grep markdown-it|dompurify src/` ⇒ zero hits (the chokepoint is the FIRST consumer). `render.ts` uses `innerHTML=''` (clearing) + `textContent` only. The editor introduces the FIRST controlled HTML insertion — it MUST go through DOMPurify and MUST NOT assign raw markdown via `innerHTML`. |
| Security gate: existing XSS test asserts `<script>` body renders as literal text and no `window.__xss_*` set — MUST stay green. | **CONFIRMED.** `jin-gui/src/__tests__/notes_controller.test.ts:486-499` (`renders script tags as literal text — NOT executed`). With markdown-it `html:false`, raw HTML in source is escaped to literal text **by construction** ⇒ this assertion survives. **Immovable gate** (G-XSS). |
| Stimulus exemplar: `capture_controller.ts` + `lib/capture/*` (thin controller + pure render/transform split, textarea body). Follow `lib/notes/` split. | **CONFIRMED.** `lib/capture/transform.ts` = pure validation/payload (no DOM); `lib/notes/transform.ts` = pure filter/sort; `lib/notes/render.ts` = DOM. Capture body is a `<textarea>` (`capture_controller.ts:107`). Track B mirrors this: pure `markdown.ts` + pure `blocks.ts` + DOM `editor.ts` + thin controller wiring. |
| Node ≥20 for frontend gates (system node v16 crashes vitest). | **CONFIRMED.** A Node 24 runtime was available through the local version manager. `package.json` engines already pin `node >=20`. Run Vitest with a Node 20+ runtime. |

**Latest stable deps (verified via `npm view`, 2026-06-28):** `markdown-it@14.2.0`, `dompurify@3.4.11` (**ships bundled TS types** — `@types/dompurify` NOT needed and is deprecated), `@types/markdown-it@14.1.2` (markdown-it has no bundled types — **needed as a devDependency**).

---

## 1. CLARIFY (skip-justified)

Intent is unambiguous; the owner **locked** the load-bearing product decisions: render+sanitize = `markdown-it (html:false)` + `DOMPurify`; interaction = per-block live preview (rendered HTML when idle, raw `<textarea>` when focused, re-render on blur, reassemble+save on commit); editor lives in the existing Notes detail pane; backend is DONE. The six delegated decisions (D-SANITIZE, D-BLOCKING, D-FOCUS, D-SAVE, D-EMPTY/NEW, D-SCOPE) are resolved in §3 with firsthand evidence. No blocking questions. CRYSTALIUM recall surfaced only the Wave-1 episodic crystal (`5216e65c`); the ATLAS Track-B crystal `0ca90347` did not surface, so all anchors were verified directly in the tree (§0).

| Axis | Value |
|---|---|
| WHO | Owner (product) → Vivi (executor). This spec is the handoff. |
| WHAT | A live, Obsidian-style note-body editor: the detail body splits into markdown **blocks**; each block shows sanitized rendered HTML when idle and editable raw markdown when focused; on blur the block re-renders and (if changed) the full body is reassembled and saved via the existing `edit_note`; the detail then reflects canonical disk. |
| WHY | Wave 1/Track A made notes browsable + foldered but the body is read-only. Track B makes notes **editable** with Apple-/Obsidian-faithful inline preview — the core daily-use capability. |
| CONSTRAINTS | Frontend-only (no Rust); `markdown-it html:false` + DOMPurify (latest); per-block live preview; single sanitize chokepoint; lossless block round-trip; XSS gate stays green; autosave-on-blur; anti-shallow REAL tests (adversarial sanitize suite + round-trip property tests + controller-driven save test + live-preview swap test); frontend gates need Node ≥20; anchor every change at file:line; v1 stays shippable (defer non-core). |

---

## 2. SCOPE

**In scope**
- **Deps:** add `markdown-it@^14` + `dompurify@^3` (runtime) and `@types/markdown-it@^14` (dev) to `jin-gui/package.json`; pin the resolved latest in the lockfile.
- **Sanitize chokepoint:** new `jin-gui/src/lib/notes/markdown.ts` — ONE configured `markdown-it` singleton + DOMPurify config; exports `renderMarkdownFragment(src) -> DocumentFragment` (the single place HTML is produced + sanitized; returns a fragment so app code never assigns `innerHTML`).
- **Block transform:** new `jin-gui/src/lib/notes/blocks.ts` — pure `parseBlocks(body) -> Segment[]` / `serializeBlocks(segments) -> string` with a **partition-concatenation** round-trip invariant (lossless, fence-aware), plus a block-substitution helper.
- **Editor render:** new `jin-gui/src/lib/notes/editor.ts` — `renderNoteEditor(container, body, callbacks)`: builds per-block DOM (rendered fragment when idle, `<textarea>` raw when focused), focus/blur swap, active-block tracking, empty-body placeholder.
- **Detail wiring:** `renderNoteDetail` (`render.ts:199-204`) replaces the read-only `textContent` body with a `renderNoteEditor` mount; add an optional `onBodyCommit` callback param (backward-compatible).
- **Controller save:** `NotesController` imports `editNote`; tracks `currentNoteId` + `lastSavedBody`; new `commitBody(id, body)` = dirty-check → `editNote(id,{body})` → `getNoteById(id)` canonical re-fetch → reconcile re-render; on error → existing `app:error` dispatch + keep local edit.
- **CSS/tokens:** rendered-markdown + per-block editor states in `jin-gui/src/styles/browse.css` (replaces the `pre-wrap` mono dump at `:336-348`), token-driven.
- **Tests (anti-shallow):** adversarial sanitization suite; block round-trip property tests; live-preview swap test; controller-driven save test (real Stimulus); save-error test; chokepoint-singleton guard; **migrate** the existing body-render tests; **keep the XSS gate green**.

**Out of scope (this track) — D-SCOPE deferrals**
- Live `[[wikilink]]` autocomplete; slash commands; markdown toolbar/format buttons.
- Image paste / upload / embed (and `<img>` rendering — owner's allow-list omits `img`; see D-SANITIZE).
- Table **editing** UX (tables **render** read-only via markdown-it; no grid editor).
- Task-list **checkbox rendering** (requires `markdown-it-task-lists` = a 3rd dep, violating the 2-dep lock — the DOMPurify allow-list is forward-compatible but v1 ships markdown-it core only; `- [ ]` renders as a literal list item).
- Keyboard block navigation (arrow/Tab between blocks); Escape-to-cancel-edit; drag-to-reorder blocks.
- New-note-into-editor auto-focus (D-EMPTY/NEW: opening a note shows the editor in rendered mode; auto-entering edit on a brand-new empty note is deferred polish).
- Syntax highlighting inside code fences; find/replace; collaborative/multi-cursor editing.

**Deferred / seams** — task-list rendering (plugin); contenteditable-based blocks (textarea chosen, see D-FOCUS); block-level undo/redo; per-block save (whole-body save chosen).

**Assumptions (risk-if-wrong)**
- **A1:** `editNote(id, {body})` (body-only) takes the in-place overwrite branch and preserves title + folder; `edit_note_fn` calls `api::refresh` so the index reflects the new body. Risk-if-wrong: save corrupts/relocates the note. **Confirmed** (`invoke.ts:68-78`, `commands/notes.rs:71-86`; Track A's D-EDIT-PRESERVE confirms the same-title branch overwrites in place, folder-safe).
- **A2:** `getNoteById(id)` reads `body_markdown` fresh from disk (Wave-1 D3), so re-fetch after save reflects canonical bytes. Risk-if-wrong: editor drifts from disk. **Confirmed** (`invoke.ts:49-51`; dto.ts:39-45 documents `body_markdown` present on `get_note`, read from disk).
- **A3:** markdown-it `html:false` escapes raw HTML in source to literal text (so `<script>`/`<img onerror>` never become live nodes) — the XSS gate holds by construction; DOMPurify is defense-in-depth on the rendered HTML. Risk-if-wrong: XSS regression (top risk). **Confirmed by markdown-it semantics**; double-proven by the adversarial suite (G-SANITIZE) + the existing gate (G-XSS).
- **A4:** DOMPurify binds to the ambient `window` (real webview in production; jsdom in vitest). Risk-if-wrong: tests can't sanitize. **Confirmed**: vitest tests use `@vitest-environment jsdom` (see notes_controller.test.ts:1) ⇒ `window` is global ⇒ `import DOMPurify from 'dompurify'` works headless.

---

## 3. DECISIONS

### D-SANITIZE — one chokepoint: `markdown-it (html:false)` → `DOMPurify` → `DocumentFragment`. [LOCKED libs; config DECIDED]

**Location (single chokepoint):** `jin-gui/src/lib/notes/markdown.ts`. ONE module-level `markdown-it` instance + ONE DOMPurify config. **No other module may import `markdown-it`/`dompurify`** (enforced by K-B3). The chokepoint returns a **sanitized `DocumentFragment`** (not an HTML string) so callers use `appendChild`/`replaceChildren` — app code never assigns `innerHTML` of user content (the only `innerHTML` is inside DOMPurify itself).

```ts
// the ONLY markdown-it + DOMPurify consumer in the codebase
const md = new MarkdownIt({
  html: false,        // LOCKED — raw HTML in source → escaped literal text (XSS gate by construction)
  linkify: true,      // autolink bare http/https/mailto URLs (linkify-it never autolinks javascript:)
  breaks: false,      // CommonMark default — single \n is NOT <br> (keeps preview faithful to source; round-trip-neutral)
  typographer: false, // deterministic, source-faithful output (no smartquote mangling)
});
// markdown-it's DEFAULT validateLink (blocks javascript:/vbscript:/file:/data:) is KEPT — do NOT override it.

const SANITIZE: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6',
    'p','br','hr','blockquote','pre','code','span','div',
    'em','strong','del','s','sub','sup',
    'ul','ol','li',
    'input',                                   // forward-compat: inert task-list checkbox (see note)
    'a',
    'table','thead','tbody','tfoot','tr','th','td',
  ],
  ALLOWED_ATTR: ['href','title','class','type','checked','disabled'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,  // href must be http(s)/mailto — blocks javascript:/data:/vbscript:/file:
  FORBID_TAGS: ['script','style','iframe','object','embed','form','svg','math','link','meta','base'],
  FORBID_ATTR: ['style','srcset','formaction','xlink:href','href:'], // belt-and-suspenders; on* are stripped by default
  RETURN_DOM_FRAGMENT: true,
};

export function renderMarkdownFragment(src: string): DocumentFragment {
  return DOMPurify.sanitize(md.render(src), SANITIZE) as unknown as DocumentFragment;
}
```

- **`img` is intentionally NOT allowed** (owner allow-list omits it; image support is deferred). Markdown `![alt](url)` ⇒ the `<img>` is stripped by DOMPurify.
- **`style` is forbidden** — markdown-it emits `style="text-align:…"` for table-cell alignment; v1 loses cell alignment (minor; flagged R-RENDER-FIDELITY). Avoids any CSS-vector surface.
- **`class` is allowed** so ```js fences carry `class="language-js"` (no execution risk; class only references stylesheet rules).
- **Task-list checkboxes:** the allow-list permits `input[type=checkbox][checked][disabled]` (inert; safe — no `on*` survive) for forward-compat, but v1 ships **no** task-list plugin (2-dep lock), so `- [ ]` renders as literal text in an `<li>`. Real checkboxes are deferred.
- **Defense-in-depth chain:** (1) `html:false` ⇒ no raw HTML elements ever; (2) markdown-it `validateLink` ⇒ `[x](javascript:…)` is not linkified; (3) DOMPurify `ALLOWED_TAGS`/`ALLOWED_URI_REGEXP`/`FORBID_*` ⇒ strips anything that slips through and neutralizes `href`. Any ONE layer is sufficient; all three run.

**Rejected:** returning an HTML *string* from the chokepoint (would force a caller `innerHTML=` assignment — violates the no-raw-innerHTML discipline). Rejected for the fragment return.

### D-BLOCKING — lossless, fence-aware **partition** of the body; round-trip is identity by construction. [DECIDED — trickiest correctness surface]

Model the body as an **ordered partition** of alternating segments (no information discarded):

```ts
type Segment = { kind: 'block' | 'gap'; text: string };
// INVARIANT (round-trip): serializeBlocks(parseBlocks(body)) === body  for ANY body.
```

`parseBlocks(body)`:
1. `body === ''` ⇒ `[]` (the editor synthesizes a placeholder block; see D-EMPTY).
2. Tokenize into physical lines **with terminators preserved** via `body.match(/[^\n]*\n|[^\n]+$/g)` — every char is covered exactly once; `\r` rides with its line (CRLF preserved); a final `\n` makes the last token end in `\n` (trailing-newline preserved); no trailing `\n` ⇒ last token has none.
3. Walk tokens tracking `inFence` (toggle on a line whose trimmed start matches `/^ {0,3}(`{3,}|~{3,})/`). A token is **blank** iff `/^\s*$/.test(token.replace(/\n$/, ''))`.
4. Group runs: consecutive **non-blank** tokens — OR any token while `inFence` (blank lines inside a fence stay in the block) — form a `block` segment; consecutive blank tokens while NOT `inFence` form a `gap` segment. `segment.text` = concatenation of its tokens, appended in order.

`serializeBlocks(segments) = segments.map(s => s.text).join('')`. **This equals the original byte-for-byte** because the tokens are an exact partition and segments preserve order + concatenation — *the invariant does not depend on fence-detection correctness* (imperfect fence logic only changes where block boundaries fall, never fidelity). This de-risks the #2 risk into a structural guarantee.

- **Editable units** = the `block` segments (each carries a stable index into the `Segment[]`). `gap` segments (blank-line runs, incl. leading/trailing) are data-only — preserved, invisible, not rendered (visual spacing comes from block CSS margins).
- **Edit substitution:** `segments[i].text = newRawMarkdown; serializeBlocks(segments)` ⇒ the reassembled body with only block `i` changed and all gaps intact.
- **Known limitation (R-RENDER-FIDELITY):** block = blank-line-delimited unit, so a *loose* list (items separated by blank lines) or a multi-paragraph list item splits into multiple blocks that render as separate lists. Round-trip stays lossless; only the rendered preview differs from a whole-document render. Accepted for v1 (documented).

**Rejected:** split-on-blank-line that discards separators then rejoins with a canonical `\n\n` — lossy (collapses multi-blank gaps, drops trailing newline, mangles CRLF). Rejected for the partition model.

### D-FOCUS — click-to-edit / blur-to-render; one active block; `<textarea>` (not contenteditable). [DECIDED]

- **Idle:** each block renders as a `<div class="note-block" data-block-index="i">` containing `renderMarkdownFragment(segments[i].text)` (sanitized). Clickable.
- **Enter edit:** click (or focus) a block ⇒ set `activeIndex = i`; replace that block's rendered node with a `<textarea class="note-block__editor">` whose `value = segments[i].text` (raw markdown source); focus it; caret at end (click-position caret mapping deferred). Only ONE block is in raw mode at a time.
- **Blur (commit):** read the textarea `value`; if changed, `segments[i].text = value`, re-render that block via `renderMarkdownFragment` (instant local preview), clear `activeIndex`, then invoke the editor's `onCommit(serializeBlocks(segments))` (→ D-SAVE). Clicking a second block while one is active: the first textarea blurs first (commits), then the second enters edit — natural via event ordering.
- **Caret/active tracking:** the editor closure holds `activeIndex` + the `Segment[]` model; rendered blocks carry `data-block-index`. No global state.
- **Textarea over contenteditable:** matches the capture-body exemplar (`capture_controller.ts:107`), avoids contenteditable's paste-sanitization/normalization/caret pitfalls, and keeps the raw markdown 1:1 with the source. **Rejected:** contenteditable raw-edit (caret + paste sanitization complexity, no v1 benefit).
- **Deferred:** keyboard nav between blocks; Escape-to-cancel (blur commits in v1).

### D-SAVE — autosave-on-blur, whole reassembled body via `editNote`, dirty-checked, re-fetch to reconcile. [DECIDED — recommended + justified]

**When:** on **block blur** (the D-FOCUS commit boundary). **Why blur (not keystroke-debounce, not explicit button):** blur is the natural per-block commit point in the live-preview model; it avoids debounce timers and per-keystroke disk+index thrash, needs no extra UI chrome, and gives a deterministic, testable trigger. Per-keystroke/debounce rejected (thrashes `api::refresh`); explicit-save-button rejected (un-Obsidian, extra UI, easy to lose edits).

**Flow (`NotesController.commitBody(id, body)`):**
1. **Dirty-check:** `if (body === this.lastSavedBody) return;` (no redundant write/refresh on focus→blur with no change).
2. `await editNote(id, { body });` — body-only ⇒ in-place overwrite, title + folder preserved (A1).
3. `const fresh = await getNoteById(id);` — canonical re-fetch from disk (A2). `this.lastSavedBody = fresh.body_markdown ?? '';`
4. **Reconcile:** re-render the detail from `fresh` (full `renderNoteDetail`, since a body edit can also change the note's `updated`/links/backlinks). Editor returns to rendered (idle) mode — the user already blurred. (Skip the re-render only if another block is already active, to avoid clobbering an in-progress edit.)
5. **On error:** `catch (isJinErrorDto)` ⇒ `this.dispatch('error', { detail: err, prefix: 'app', bubbles: true })` (existing app error channel) **and keep the local edit** (do NOT overwrite the user's text); leave `lastSavedBody` unchanged so the next blur retries.

`onBodyCommit` is threaded from the controller into `renderNoteDetail` into `renderNoteEditor` as `onCommit`; the controller binds `(body) => this.commitBody(this.currentNoteId, body)`.

### D-EMPTY/NEW — empty body ⇒ one placeholder block; new-note-into-editor DEFERRED. [DECIDED]

- **Empty / whitespace-only body** (`parseBlocks` yields zero `block` segments): render ONE empty `note-block note-block--empty` showing a placeholder ("Start writing…", via `textContent`), clickable into an empty `<textarea>`. Committing it sets the body to the typed text (pure-whitespace-only originals are treated as empty — a degenerate case; documented minor limitation).
- **New note:** creating a note (existing CaptureController flow) navigates to its detail, which now shows the editor in **rendered** mode (placeholder for an empty body); the user clicks to edit. **Auto-entering edit mode on create is deferred** (optional polish) to keep v1 tight — editing existing notes is the core.

### D-DEPS — exactly 2 new runtime deps + 1 dev type-dep; pin resolved latest. [DECIDED — honors the 2-dep lock]

Runtime: `markdown-it` (14.2.0), `dompurify` (3.4.11). Dev: `@types/markdown-it` (14.1.2). DOMPurify ships its own types (no `@types/dompurify`). Install with `npm install markdown-it dompurify` + `npm install -D @types/markdown-it`, then pin the resolved versions and commit the lockfile. The task-list plugin is **out** (would be a 3rd runtime dep).

---

## 4. STORIES (ordered, with dependencies)

```
K-B1 (deps add) ─▶ B1 (sanitize chokepoint) ─┐
                   B2 (block transform) ──────┤
                                              ├─▶ B3 (per-block editor render) ─▶ B4 (wire detail + controller save + migrate tests)
                   K-B2 (CSS/token hookup) ───┘ (supports B3)
K-B3 (chokepoint-singleton guard) — after B1
```

**Build order:** K-B1 → B1 → B2 → B3 (+ K-B2) → B4, with K-B3 after B1. B1 and B2 are independent (parallelizable). B3 needs both + the CSS (K-B2). B4 is terminal (wires everything + migrates the existing tests + the controller-driven save gate).

---

### STORY B1 — Sanitize chokepoint `lib/notes/markdown.ts` + adversarial suite · **P0** · ≤1.5d
**Depends on:** K-B1. **Blocks:** B3, B4, K-B3.

**As a** Jin user, **I want** my note markdown rendered to safe HTML through one audited chokepoint, **so that** preview is faithful and no note body can ever execute script.

**Action plan**
1. **Create** `jin-gui/src/lib/notes/markdown.ts` per D-SANITIZE: one `markdown-it` singleton (`html:false`, `linkify:true`, `breaks:false`, default `validateLink` kept) + the DOMPurify `SANITIZE` config; export `renderMarkdownFragment(src: string): DocumentFragment` (`RETURN_DOM_FRAGMENT: true`). This is the ONLY `markdown-it`/`dompurify` import in the app.
2. **Do not** expose an HTML-string variant in the production surface (tests query the returned fragment).

**Files/anchors:** `jin-gui/src/lib/notes/markdown.ts` (new) · imports added by K-B1 to `jin-gui/package.json:17-23,24-32`

**Acceptance — GIVEN/WHEN/THEN**
- **AC-B1.1 (positive control) GIVEN** `# H\n\n**b** *i* \`c\`\n\n- a\n- b\n\n> q\n\n\`\`\`js\nx\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |`, **WHEN** `renderMarkdownFragment` runs, **THEN** the fragment contains `h1`, `strong`, `em`, `code`, `ul>li`, `blockquote`, `pre>code.language-js`, and `table` nodes.
- **AC-B1.2 (safe link survives) GIVEN** `[ok](https://example.com)`, **THEN** the fragment has one `a[href="https://example.com"]`.
- **AC-B1.3 (script) GIVEN** `<script>window.__x=1</script>`, **THEN** no `<script>` node exists; the literal text `<script>` appears (escaped by `html:false`); `window.__x` is `undefined`.
- **AC-B1.4 (img/onerror) GIVEN** `<img src=x onerror=alert(1)>`, **THEN** no `<img>` node and no element carries an `onerror`/`on*` attribute.
- **AC-B1.5 (md js link) GIVEN** `[click](javascript:alert(1))`, **THEN** no anchor has an `href` beginning `javascript:`.
- **AC-B1.6 (raw a js href) GIVEN** `<a href="javascript:alert(1)">x</a>`, **THEN** no anchor exists (raw HTML escaped); literal text present.
- **AC-B1.7 (obfuscated set) GIVEN** each of `<scr<script>ipt>alert(1)</script>`, `<svg onload=alert(1)>`, `<iframe src=javascript:alert(1)>`, `<a href="jAvAsCrIpT:alert(1)">x</a>`, `<details open ontoggle=alert(1)>`, `&lt;script&gt;`, **THEN** for every case: no `script/iframe/object/embed/svg` node, no element with any `on*` attribute, no `javascript:`/`data:` href, and no `window.__*` flag set.
- **AC-B1.8 (fragment, not string) GIVEN** any input, **THEN** the return value is a `DocumentFragment` (callers never receive a string to `innerHTML`).

**Validation gates** — G-SANITIZE (anti-shallow adversarial), G-XSS (the existing gate stays green — re-run). **Risk:** **P0** (top risk: XSS regression). Use a shared helper `assertInert(fragment)` (no dangerous tags, no `on*`, no unsafe href) across cases.

---

### STORY B2 — Block transform `lib/notes/blocks.ts` + round-trip property tests · **P0** · ≤1.5d
**Depends on:** none (parallel to B1). **Blocks:** B3, B4.

**As a** Jin user, **I want** my note body to split into editable blocks and reassemble exactly as written, **so that** editing one block never corrupts or loses the rest of the note.

**Action plan**
1. **Create** `jin-gui/src/lib/notes/blocks.ts` per D-BLOCKING: `Segment` type; `parseBlocks(body) -> Segment[]` (token partition, fence-aware, terminators preserved); `serializeBlocks(segments) -> string` (concatenation); plus `editableBlocks(segments) -> {index:number; text:string}[]` and `substituteBlock(segments, index, text) -> Segment[]` helpers. All pure (no DOM, no side effects) — mirrors `lib/notes/transform.ts`.

**Files/anchors:** `jin-gui/src/lib/notes/blocks.ts` (new)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-B2.1 (identity property) GIVEN** a spread of bodies — `''`, `'\n'`, headings, tight + loose lists, paragraphs, a code fence containing blank lines, trailing newline, no trailing newline, multiple consecutive blank lines, CRLF (`\r\n`), unicode (emoji + CJK) — **WHEN** `serializeBlocks(parseBlocks(body))` runs for each, **THEN** the result `=== body` byte-for-byte.
- **AC-B2.2 (fence integrity) GIVEN** `` `\`\`\`\nline1\n\nline2\n\`\`\`` `` (blank line inside a fence), **THEN** `editableBlocks` yields ONE block containing the entire fence (the internal blank line did NOT split it).
- **AC-B2.3 (paragraph split) GIVEN** `'A\n\nB'`, **THEN** `editableBlocks` yields two blocks `'A'` and `'B'` and a `gap` `'\n\n'` between them.
- **AC-B2.4 (substitution) GIVEN** `'# T\n\nfirst\n\nsecond\n'`, **WHEN** `substituteBlock(parse, idxOf('first'), 'FIRST')` then `serializeBlocks`, **THEN** result `=== '# T\n\nFIRST\n\nsecond\n'` (only block changed; gaps + trailing newline intact).
- **AC-B2.5 (empty) GIVEN** `''`, **THEN** `parseBlocks('') === []` and `serializeBlocks([]) === ''`; **AND** `editableBlocks([]) === []` (the editor supplies the placeholder).

**Validation gates** — G-ROUNDTRIP (anti-shallow property), G-BLOCKS (unit). **Risk:** **P0/P1** (2nd risk: silent data loss). The identity invariant is structural — make the property test iterate a generated/curated table, not a single happy path.

---

### STORY B3 — Per-block live-preview editor `lib/notes/editor.ts` + CSS + swap test · **P1** · ≤2d
**Depends on:** B1, B2, K-B2. **Blocks:** B4.

**As a** Jin user, **I want** each block to show formatted text until I click it (then raw markdown) and re-format when I click away, **so that** editing feels live and Obsidian-like.

**Action plan**
1. **Create** `jin-gui/src/lib/notes/editor.ts`: `export interface NoteEditorCallbacks { onCommit?: (reassembledBody: string) => void | Promise<void> }` and `export function renderNoteEditor(container: HTMLElement, body: string, callbacks: NoteEditorCallbacks): void`.
   - `container.replaceChildren()` (clear — DOM API, not `innerHTML`); `const segments = parseBlocks(body)` (B2) held in closure with `let activeIndex: number | null = null`.
   - For each `block` segment: build `<div class="note-block" data-block-index="i">`, `block.replaceChildren(renderMarkdownFragment(segments[i].text))` (B1 fragment). If `onCommit` is defined, attach click→`enterEdit(i)`.
   - `enterEdit(i)`: replace the rendered block node with a `<textarea class="note-block__editor">` (`value = segments[i].text`), focus, caret end, `activeIndex = i`; on `blur`→`commitBlock(i, textarea.value)`.
   - `commitBlock(i, value)`: if `value !== segments[i].text` ⇒ `segments[i].text = value`, re-render that block (B1), `activeIndex = null`, `callbacks.onCommit?.(serializeBlocks(segments))`.
   - **Empty body** (no `block` segments): render one `note-block note-block--empty` placeholder (D-EMPTY); click ⇒ empty textarea; commit creates the first block.
   - `onCommit` **undefined** ⇒ render-only (blocks not clickable) — the read-only fallback for non-editing callers.
2. **CSS** (via K-B2): `.note-block` (rendered-markdown typography: headings, `p`, `ul/ol`, `blockquote`, `pre/code`, `table`), hover affordance, `.note-block__editor` (textarea, mono, auto-height), `.note-block--empty` placeholder; replaces `.note-detail__body` `pre-wrap` dump at `browse.css:336-348`.

**Files/anchors:** `jin-gui/src/lib/notes/editor.ts` (new) · `jin-gui/src/lib/notes/markdown.ts` (B1) · `jin-gui/src/lib/notes/blocks.ts` (B2) · `jin-gui/src/styles/browse.css:336-348` (K-B2)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-B3.1 (idle = rendered) GIVEN** `renderNoteEditor(container, '# Hello\n\nWorld', { onCommit })`, **THEN** container has a `.note-block` with an `h1` "Hello" and a `.note-block` with a `p` "World" (rendered HTML when not focused).
- **AC-B3.2 (focus = raw) GIVEN** the idle editor, **WHEN** the first `.note-block` is clicked, **THEN** it becomes a `<textarea>` whose `value === '# Hello'` (raw markdown source).
- **AC-B3.3 (blur = re-render + commit) GIVEN** the textarea from B3.2, **WHEN** its value is set to `'## Hi'` and `blur` fires, **THEN** `onCommit` is called with `'## Hi\n\nWorld'` (reassembled) AND the block re-renders to an `h2` "Hi".
- **AC-B3.4 (no-op blur) GIVEN** a focused block whose value is unchanged on blur, **THEN** `onCommit` is NOT called.
- **AC-B3.5 (empty placeholder) GIVEN** `renderNoteEditor(container, '', { onCommit })`, **THEN** container shows one `.note-block--empty` placeholder; clicking it yields an empty editable textarea.
- **AC-B3.6 (XSS inert) GIVEN** body `'<script>window.__xss_block=1</script>'`, **THEN** the idle block shows the literal `<script>` text and `window.__xss_block` is `undefined`.

**Validation gates** — G-SWAP (anti-shallow live-preview), G-XSS (block-level). **Risk:** P1. Headless-testable in jsdom like `renderNoteDetail`/`renderFolderRail`.

---

### STORY B4 — Wire editor into detail + controller save (autosave-on-blur + re-fetch) + migrate tests · **P1** · ≤2d
**Depends on:** B1, B2, B3. **Blocks:** none (terminal).

**As a** Jin user, **I want** clicking away from an edited block to save to disk and the detail to reflect what's saved, **so that** my edits persist without a save button and I always see the real note.

**Action plan**
1. **Modify** `renderNoteDetail` (`render.ts:149-204`): add a 7th optional param `onBodyCommit?: (body: string) => void | Promise<void>`. Replace the body block (`:199-204`) — keep `const bodyEl = document.createElement('div'); bodyEl.className = 'note-detail__body';` then `renderNoteEditor(bodyEl, note.body_markdown ?? '', { onCommit: onBodyCommit })` instead of the `textContent` assignment. (Backward-compatible: callers without `onBodyCommit` get render-only blocks.)
2. **Modify** `NotesController` (`notes_controller.ts`): import `editNote` (add to the `../invoke` import at `:44`); add state `private currentNoteId: string | null = null;` and `private lastSavedBody = '';` (`:84-87`). In `loadDetail` (`:218-258`) after `getNoteById`: set `this.currentNoteId = note.id; this.lastSavedBody = note.body_markdown ?? '';` and pass `(body) => this.commitBody(note.id, body)` as the new 7th arg to `renderNoteDetail` (`:237-244`).
3. **Add** `private async commitBody(id: string, body: string): Promise<void>` per D-SAVE: dirty-check vs `lastSavedBody`; `await editNote(id, { body })`; `const fresh = await getNoteById(id)`; `this.lastSavedBody = fresh.body_markdown ?? ''`; reconcile re-render via `renderNoteDetail(this.viewElements, this.viewTemplates, fresh, …callbacks)` + `initIcons()`; on `isJinErrorDto` ⇒ `this.dispatch('error', { detail: err, prefix:'app', bubbles:true })` and keep local edit.
4. **Migrate** the existing body tests in `notes_controller.test.ts` (see §6 Test migration) — KEEP G-XSS green.

**Files/anchors:** `jin-gui/src/lib/notes/render.ts:149-204` (esp. `:199-204`) · `jin-gui/src/controllers/notes_controller.ts:44,84-87,218-258,287-313` · `jin-gui/src/invoke.ts:68-78` (`editNote` — reuse, no change) · `jin-gui/src/__tests__/notes_controller.test.ts:467-509,622-679` (migrate)

**Acceptance — GIVEN/WHEN/THEN**
- **AC-B4.1 (controller-driven save) GIVEN** a real Stimulus `Application` with the production `index.html` body, `getNoteById` mocked to a note with body `'# T\n\nfirst\n\nsecond\n'`, and `editNote`/`getNoteById` mocked, **WHEN** the note detail opens (dispatch `jin:open-detail`), a block is clicked, its textarea value is changed to `'FIRST'`, and `blur` fires, **THEN** `editNote` is called with `{ body: '# T\n\nFIRST\n\nsecond\n' }` (reassembled — NOT a hand-fed render call).
- **AC-B4.2 (re-fetch reconciles) GIVEN** AC-B4.1, **WHEN** the post-save `getNoteById` resolves with a *canonical* body `'# T\n\nFIRST\n\nsecond\n'` (e.g. backend-normalized), **THEN** the editor re-renders from the re-fetched body (the edited block shows the canonical rendered HTML) — proving the re-fetch path ran, not just the local optimistic render.
- **AC-B4.3 (dirty-check) GIVEN** a block focused and blurred with no change, **THEN** `editNote` is NOT called.
- **AC-B4.4 (save error) GIVEN** `editNote` rejects with a `JinErrorDto`, **WHEN** a changed block blurs, **THEN** an `app:error` event is dispatched AND the block retains the user's edited text (not lost).
- **AC-B4.5 (XSS gate green) GIVEN** a note body `'<script>window.__xss_notes = true</script>'` opened through the controller, **THEN** `.note-detail__body` contains the literal `<script>` text and `window.__xss_notes` is `undefined` (the existing gate, unchanged in spirit).

**Validation gates** — G-SAVE (anti-shallow controller-driven), G-SAVE-ERROR, G-XSS, G-DETAIL-MIGRATE. **Risk:** P1; test-migration care (R-TEST-MIGRATION).

---

### Kupo micro-tasks

- **K-B1 — Add the 2 runtime deps + the type dep** (≤0.25d, blocks B1). `npm install markdown-it dompurify` + `npm install -D @types/markdown-it` (via the nvm v24 path); pin resolved latest (`markdown-it@14.2.0`, `dompurify@3.4.11`, `@types/markdown-it@14.1.2`); update `jin-gui/package.json:17-23,24-32` + lockfile; verify `tsc --noEmit && vite build` resolves the new imports. **Gate G-BUILD.**
- **K-B2 — Editor CSS / token hookup** (≤0.5d, supports B3). Replace `.note-detail__body` (`browse.css:336-348`) and add `.note-block`, `.note-block__editor`, `.note-block--empty` — rendered-markdown typography (headings/p/list/blockquote/pre-code/table) + textarea + hover/active affordance, all via existing tokens (`--label`, `--bg-secondary`, `--radius-*`, `--space-*`, `--font-mono`, `--separator`, `--fill-tertiary`, `--hit-target`); passes `npm run lint:css` (stylelint). **Gate G-CSS.**
- **K-B3 — Chokepoint-singleton guard test** (≤0.25d, after B1). A test that greps `jin-gui/src/**` and asserts no module other than `lib/notes/markdown.ts` imports `markdown-it` or `dompurify` (prevents a bypass that skips sanitization). **Gate G-CHOKEPOINT.**

---

## 5. VALIDATION GATES

Anti-shallow mandate (owner): **real adversarial sanitization, real round-trip properties, real controller-driven save — never happy-path or hand-fed renders.** G-SANITIZE, G-ROUNDTRIP, G-SWAP, G-SAVE are the load-bearing anti-shallow gates; G-XSS is the immovable hard constraint.

| Gate | Story | Type | Assertion | Where |
|---|---|---|---|---|
| **G-XSS** (hard) | B1/B3/B4 | Frontend (MUST stay green) | `<script>` body ⇒ literal text, `window.__xss_*` unset; no execution at chokepoint, block, and controller layers | `notes_controller.test.ts:486-499` (kept) + new cases in markdown/editor tests |
| **G-SANITIZE** | B1 | Frontend (anti-shallow adversarial) | script/img-onerror/js-link/raw-a-js/svg-onload/iframe/obfuscated/entities ⇒ NO dangerous tag, NO `on*`, NO `javascript:`/`data:` href; positive controls render | new `markdown.test.ts` |
| **G-ROUNDTRIP** | B2 | Frontend (anti-shallow property) | `serializeBlocks(parseBlocks(body)) === body` over a diverse spread (fences w/ blank lines, CRLF, trailing newline, unicode, empty) | new `blocks.test.ts` |
| **G-BLOCKS** | B2 | Frontend unit | fence blank-line stays in block; blank-line splits paragraphs; substitution reassembles with gaps intact | `blocks.test.ts` |
| **G-SWAP** | B3 | Frontend (anti-shallow) | idle block = rendered HTML; focused block = raw markdown textarea; blur ⇒ re-render + `onCommit(reassembled)`; no-op blur ⇒ no commit | new `editor.test.ts` |
| **G-SAVE** | B4 | Frontend (anti-shallow, controller-driven) | real Stimulus + production `index.html`; mock invoke; click block → change → blur ⇒ `editNote` called with reassembled body; post-save `getNoteById` re-fetch ⇒ rendered HTML reflects canonical | `notes_controller.test.ts` (new describe) |
| **G-SAVE-ERROR** | B4 | Frontend | `editNote` rejects ⇒ `app:error` dispatched + local edit preserved | `notes_controller.test.ts` |
| **G-DETAIL-MIGRATE** | B4 | Frontend (migration) | migrated body tests assert rendered HTML (`h1`, `p`) + empty/null ⇒ placeholder, WITHOUT weakening non-execution | `notes_controller.test.ts:467-509,622-679` |
| **G-CHOKEPOINT** | K-B3 | Frontend (anti-drift) | no module but `lib/notes/markdown.ts` imports `markdown-it`/`dompurify` | new guard test |
| **G-BUILD** | K-B1 | Build | `tsc --noEmit && vite build` resolves the new deps | CI/build |
| **G-CSS** | K-B2 | Lint | `npm run lint:css` (stylelint) passes on the new editor styles | CI/lint |

**Project-level command gates (all must pass):** `npm test` (Vitest — **Node ≥20**) · `tsc --noEmit && vite build` · `npm run lint:css`. No `it.skip` / `#[ignore]` on the gates above. No Rust gates (frontend-only track).

---

## 6. EXPLORE — selected approach, rejected alternatives, test migration

**Selected:** ADAPT the established `lib/notes/` (pure transform + DOM render) and `lib/capture/` (pure transform + thin controller, textarea body) splits, plus Track A's controller-driven Stimulus test pattern (`notes_controller.test.ts` VG-FE/VG1.4). Four cohesive modules — `markdown.ts` (sanitize chokepoint), `blocks.ts` (pure lossless partition), `editor.ts` (DOM live-preview), controller wiring — map 1:1 to the four risk surfaces (XSS / round-trip / preview / save) and to the four anti-shallow gates. Maximizes pattern-fit; the only genuinely new primitive is the markdown→DOMPurify chokepoint (a textbook combination).

**Rejected alternatives (prevents re-exploration):**
- **Whole-document re-render on every keystroke (debounce save)** — thrashes `editNote`→`api::refresh`, fights the per-block model, and loses the deterministic blur trigger. Rejected for autosave-on-blur (D-SAVE).
- **Render the full body as one HTML blob (no blocks)** — simpler render, but the locked interaction model is per-block, and a single contenteditable/textarea over the whole body loses the live-preview-per-block UX and complicates caret/round-trip. Rejected (locked decision).
- **contenteditable raw blocks** — paste-sanitization, DOM-normalization, and caret bugs with no v1 benefit; textarea keeps raw markdown 1:1 with source. Rejected (D-FOCUS).
- **Chokepoint returns an HTML string** — forces a caller `innerHTML=` (violates the no-raw-innerHTML discipline). Rejected for the `DocumentFragment` return (D-SANITIZE).
- **Split-on-blank-line then rejoin with canonical `\n\n`** — lossy (collapses multi-blank gaps, drops trailing newline, mangles CRLF). Rejected for the partition model (D-BLOCKING).
- **Add `markdown-it-task-lists` for real checkboxes** — a 3rd runtime dep, violating the locked 2-dep budget. Deferred (allow-list is forward-compatible).
- **Allow `<img>` / `style`** — broadens the sanitization surface beyond the owner's allow-list with no v1 need. Rejected (deferred image support; minor table-alignment loss accepted).

**Test migration (G-DETAIL-MIGRATE) — explicit, because changing the body render changes existing green tests:**
| Existing test (`notes_controller.test.ts`) | Disposition |
|---|---|
| `:486-499` `renders script tags as literal text — NOT executed` | **KEEP GREEN (hard constraint).** With `html:false`, `<script>` source ⇒ escaped literal text in a `<p>`; `.note-detail__body` textContent still contains `<script>`; `window.__xss_notes` still unset. |
| `:468-478` `renders body text in the detail body element` (expects raw `# Title` in textContent) | **MIGRATE.** Body now renders markdown ⇒ assert an `h1` "Title" + a `p` "Paragraph content." inside `.note-detail__body` (rendered HTML when idle). |
| `:480-484` `renders an empty body gracefully` (toBe `''`) | **MIGRATE.** Empty body ⇒ assert a `.note-block--empty` placeholder present (no rendered content). |
| `:501-508` `renders body without undefined when body_markdown is undefined` | **MIGRATE.** Same as empty → placeholder. |
| `:648-664` VG1.4 `body from mocked getNoteById appears in .note-detail__body` (toBe exact plain text) | **MIGRATE.** Plain text ⇒ assert a `p` whose textContent equals the text (rendered, not raw dump). |
| `:666-678` VG1.4 `null body_markdown renders as empty string` | **MIGRATE.** Null ⇒ placeholder. |

Only the **non-execution** assertion is immovable; the rest legitimately change because the read-only dump is being replaced by the editor (the track's purpose). The Kupo-distinct reviewer (checker ≠ maker) must confirm each migrated test still asserts non-execution where applicable.

---

## 7. RISK FLAGS

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| **R-XSS** | Editor introduces the FIRST controlled HTML insertion; a sanitization gap or a module bypassing the chokepoint would execute note-body script. | **P0 (top)** | Single chokepoint `lib/notes/markdown.ts` (`html:false` + DOMPurify allow-list + `ALLOWED_URI_REGEXP` + `RETURN_DOM_FRAGMENT`); defense-in-depth (escape → validateLink → DOMPurify); adversarial G-SANITIZE; existing G-XSS stays green; G-CHOKEPOINT (K-B3) forbids bypass; app code uses `appendChild`/`replaceChildren` only. |
| **R-ROUNDTRIP** | Block split/join not lossless ⇒ silent body corruption/data loss on save (the repo has shipped a same-slug data-loss bug before). | **P0/P1 (2nd)** | Partition-concatenation invariant (`serialize∘parse === id` by construction, independent of fence logic); G-ROUNDTRIP property test over fences/CRLF/trailing-newline/unicode/empty; dirty-check avoids spurious writes. |
| **R-TEST-MIGRATION** | Replacing the read-only body render breaks existing green body tests; risk of accidentally weakening the XSS gate during migration. | **P1** | Explicit migration table (§6); G-XSS non-execution assertion is immovable and re-run at chokepoint/block/controller layers; checker ≠ maker review. |
| **R-SAVE-THRASH** | Autosave-on-blur could spam `editNote`→`api::refresh`. | **P1** | Dirty-check (save only when reassembled ≠ `lastSavedBody`); blur (not keystroke) granularity. |
| **R-SAVE-DATALOSS** | A failed save loses the user's in-progress edit. | **P1** | On error: keep local edit, surface via `app:error` dispatch, leave `lastSavedBody` unchanged so the next blur retries (G-SAVE-ERROR). |
| **R-NODE** | Vitest crashes on Node 16 (system default). | **P1** | Frontend gates require **Node ≥20** (engines already pin `>=20`). |
| **R-DEPS** | Supply-chain of 2 new runtime deps. | **P2 (minor)** | Pin resolved latest (`markdown-it@14.2.0`, `dompurify@3.4.11`) + lockfile; both mature, widely-audited; DOMPurify is the industry-standard sanitizer. |
| **R-RENDER-FIDELITY** | Per-block rendering splits loose lists / multi-paragraph list items / table-cell alignment differs from a whole-doc render (round-trip still lossless). | **P2** | Accepted v1 limitation; documented (D-BLOCKING, D-SANITIZE); block = blank-line unit. |
| **R-EMPTY-WS** | A pure-whitespace-only body is treated as empty (leading whitespace gap dropped on first edit). | **P2** | Degenerate case; documented (D-EMPTY); round-trip property still holds for read (no edit). |

---

## 8. CONFIDENCE REPORT

| Factor (25%) | Score | Note |
|---|---|---|
| Pattern match | 0.88 | ADAPT of `lib/notes/`+`lib/capture/` splits + Track A's controller-driven Stimulus test pattern; chokepoint is the only new primitive (textbook markdown-it+DOMPurify). |
| Requirement clarity | 0.90 | Owner locked libs/interaction/location/backend-done; all six delegated decisions resolved with firsthand evidence. |
| Decomposition stability | 0.85 | 3 decompositions (by module / by risk-surface / by anti-shallow gate) converge on the same 4-module spine (≥70%). |
| Constraint compliance | 0.86 | XSS gate, lossless round-trip, 2-dep lock, no Rust, Node≥20, single chokepoint, anti-shallow gates all specified; residual = test-migration care + render-fidelity limitation. |
| **Overall** | **0.87** | **AUTO_PROCEED.** Residual risk = sanitization vigilance (mitigated by adversarial suite + chokepoint guard) and per-block render fidelity (deferred). |

**Recommended build order:** K-B1 → B1 → B2 → B3 (+ K-B2) → B4, with K-B3 after B1. B1/B2 parallelize. Land the chokepoint (B1) and the round-trip invariant (B2) before any UI; B4 is the integration + the controller-driven save gate.
