# Jin Notes — CodeMirror 6 Full-Pane "Source Editor" (Wave-2 Track B, v2)

- **Spec ID:** `2026-06-28-jin-notes-cm6-source-editor`
- **Methodology:** SPECTRA 4.10.0 · **Tier:** standard (single-pass cycle) · **Intent:** CHANGE
- **From → To:** `spectra` → `apivr` (consumer: **Vivi**, loop-native coder) · **Performative:** PROPOSE
- **Scope:** **FRONTEND-ONLY** (`jin-gui/`) — zero Rust / Tauri / schema / SQL changes
- **Supersedes (design):** per-block live-preview editor spec `2026-06-28-jin-notes-wave2-track-b-editor.md` (the anti-pattern this kills). Sanitize chokepoint + save backbone from that spec are **reused, not re-specified**.
- **Confidence:** 0.88 → AUTO_PROCEED (factor breakdown in §13)

> One-line objective: **Replace the per-block inline-textarea note editor with a single full-pane CodeMirror 6 source editor** — markdown with syntax highlighting (not full live-preview), raw markdown on disk, a Reading-view toggle through the existing sanitize chokepoint, debounced caret-safe autosave through the existing `editNote` path.

---

## 1. CLARIFY

**WHO** — Project owner (confirmed all LOCKED decisions). Consumer agent: **Vivi**. Affected users: Jin note-takers.
**WHAT** — Swap the editing surface in the Notes detail pane from N inline textareas (one per block) to ONE continuous CM6 editor over the whole body buffer; add a Reading-view toggle; rewire autosave to be caret-safe.
**WHY** — The current per-block model is an anti-pattern: each paragraph is its own `<textarea>`, Tab unfocuses, there is no single caret/buffer, and every save re-renders the whole detail (caret loss). The owner wants a cozy, real note-taking feel.
**CONSTRAINTS** — CM6 foundation; raw markdown is the on-disk source of truth; reuse the sanitize chokepoint and the `editNote` save path; honor light/dark theming via existing tokens; anti-shallow tests that bite mutation; Node ≥20 for vitest.

**CLARIFY questions: NONE blocking.** Every plan-shaping decision is owner-LOCKED. The four open `D-*` decisions are resolved inline in §6/§7 (engineering choices within the locked envelope, not requirements ambiguity).

**Assumptions (risk-if-wrong):**
- **A1** `editNote(id,{body})` (body-only) takes the in-place-overwrite branch (title+folder preserved) and **returns the updated `NoteDto`** with a fresh `updated` timestamp — verified at `invoke.ts:68-78` (returns `NoteDto`); backend confirmed DONE in crystal `9a893cc6`. *If wrong:* metadata reconcile loses the new timestamp (cosmetic) — autosave correctness unaffected.
- **A2** CM6 `EditorView` constructs and renders document **text into `.cm-content` text nodes under jsdom** (no real layout) sufficiently for content/identity/selection assertions. *If wrong:* test strategy degrades to the module-boundary mock fallback for some controller tests (see §7 D-TEST-STRATEGY) — **the caret-safe and XSS gates must still use a real mount** (S1 smoke test de-risks this FIRST).
- **A3** CM6's `EditorView` renders document text **exclusively as text nodes** (no HTML-injection path), so the editor view is XSS-proof by construction — stronger than markdown-it `html:false`. *If wrong:* (it is not — this is structural to CM6) the reading-view chokepoint still guards rendered HTML.

---

## 2. SCOPE

**Intent type:** CHANGE (replace existing component) with a CREATE-within-spec module (new `editor.ts` body).

**Complexity: 11/12 (high → extended reasoning engaged).**
| Dimension | Score | Why |
|---|---|---|
| Technical depth | 3/3 | CM6 integration, custom keymap commands, caret-safe out-of-band reconcile |
| Scope breadth | 3/3 | editor module + controller + render wiring + CSS + deps + tests |
| Uncertainty | 2/3 | decisions locked & anchors verified, but CM6-under-jsdom testability is a genuine unknown |
| Risk/stakes | 3/3 | caret-destroying re-render regression + immovable XSS gate + anti-shallow mandate |

**In scope:** single full-pane CM6 editor; markdown syntax highlighting (hand-rolled `HighlightStyle`); Tab/Shift-Tab list indent; Enter list/quote/checkbox continuation+exit; smart pairs (`closeBrackets`); Mod+B/I/K, Mod+1..6; stable caret + native undo/redo; debounced caret-safe autosave with quiet status indicator; Reading-view toggle through the chokepoint; calm typography; empty placeholder; full-height pane sizing; dead-code/test removal.

**Out of scope (deliberate fast-follow — do NOT build now):** inline live-preview decorations (Obsidian-style hide-marks-on-blur); focus mode; typewriter scrolling; theme/font pickers; wikilink autocomplete; slash commands; image paste; task-list checkbox interactivity; full out-of-band re-render of links/backlinks on every autosave (see §9 S3 — deferred to note-switch refresh). **Design must let live-preview decorations layer on later via a CM6 compartment WITHOUT changing the on-disk format or the save flow (§7 D-MODULE).**

**Deferred (not this wave):** any Rust/Tauri/schema work (none needed).

**Stakeholders / approval chain:** Owner (approved the locked decisions) → Vivi (implements, diff-not-apply) → human applies diff.

---

## 3. MEMORY / RECALL FOLDED IN

`crystalium_recall(jin)` surfaced two episodic crystals (scout `26b57489` did NOT surface — consistent with the recurring Jin recall gap; all anchors re-verified firsthand):
- **`9a893cc6`** — prior Wave-2 Track B (per-block live editor) spec. **This is the anti-pattern being replaced.** Reused facts: backend save DONE (`editNote(id,{body})` → `edit_note_fn` → `api::refresh`, body-only = in-place overwrite, title+folder preserved); chokepoint contract; **Node ≥20 via nvm v24.18.0** (system v16.20.2 crashes vitest) — confirmed both present firsthand; ATLAS/scout anchors are often stale → verify firsthand (done).
- **`5216e65c`** — title-only bug RCA (historical; not in scope).

**Anti-pattern catalogued (from prior + owner directive):** green-but-shallow tests. This repo has repeatedly shipped tests that assert "a div exists." Every gate in §10 is written to **bite a mutation** (assert observable doc text / call args / node identity / caret position), never structure-only.

---

## 4. PATTERN

| Source | Match | Strategy |
|---|---|---|
| Prior Track-B spec (`9a893cc6`) — chokepoint + save backbone | 70% | **ADAPT** the save/sanitize scaffolding; **REPLACE** the editor + block model |
| Existing `render.ts` thin-adapter + controller-drives-render pattern | 85% | **USE_TEMPLATE** — keep the controller framework-light, CM6 behind a module |
| CM6 standard editor composition (state/view/commands/lang-markdown) | n/a (new dep) | **GENERATE** the module; CM6 patterns as reference |

Verified-firsthand anchors (the spec is built on these, not on memory):

**REUSE verbatim**
- Sanitize chokepoint `jin-gui/src/lib/notes/markdown.ts:60` → `renderMarkdownFragment(src): DocumentFragment` (markdown-it `html:false` + DOMPurify allow-list, `RETURN_DOM_FRAGMENT`). The ONLY HTML path. Reading view MUST go through this. markdown-it@14.2.0 + dompurify@3.4.11 already in deps.
- Save flow: `editNote` `invoke.ts:68-78` (returns updated `NoteDto`); state `currentNoteId` `notes_controller.ts:97`, `lastSavedBody` `notes_controller.ts:100`; dirty-check + error→`app:error` dispatch pattern `notes_controller.ts:322-358`.
- `renderNoteDetail` `render.ts` builds the detail; body host is created at `render.ts:202-208` (`<div class="note-detail__body">`).

**REPLACE**
- `renderNoteEditor` `editor.ts:44-211` (per-block live preview) — only call site `render.ts:207`. Replace with CM6 mount.
- Body-commit trigger: today = per-block blur → `onCommit`. New = debounced CM6 doc-change autosave + flush on blur/destroy/note-switch/reading-toggle.

**REMOVE (dead after replace)**
- `jin-gui/src/lib/notes/blocks.ts` — imported ONLY by `editor.ts:18` (prod) and `src/__tests__/blocks.test.ts` (test). `substituteBlock` is already dead prod code (test-only). Once the editor stops importing it → fully dead → delete file + test.
- `src/__tests__/editor.test.ts` — tests the old `renderNoteEditor` API; replaced by the new editor tests in S1.

**KEEP green (immovable):**
- G-XSS `notes_controller.test.ts:497-514` (semantic: no script node, literal text, canary undefined).
- G-CHOKEPOINT `markdown.test.ts:366,390` (no module besides `markdown.ts` imports markdown-it/dompurify). The new editor imports `renderMarkdownFragment` only — **never** markdown-it/dompurify directly. CM6 packages do not import them.

---

## 5. CRITICAL RISK (designed-around)

`commitBody` at `notes_controller.ts:339-347` calls a **full `renderNoteDetail`** after every save. For a single CM6 surface that **destroys the editor and the caret mid-typing**. This is the #1 risk. The design eliminates it:

> **Reconcile out-of-band, never re-mount on autosave.** On a successful debounced save: (1) update `lastSavedBody` to the **text that was sent** (NOT a re-fetch — a re-fetch + `setDoc` would clobber in-flight typing and move the caret), (2) update the quiet status indicator to "Saved", (3) update the "updated" timestamp via **targeted DOM** using the `NoteDto` returned by `editNote`. **Do NOT call `renderNoteDetail`. Do NOT call `setDoc` on the focused editor.** The editor is mounted/destroyed **only on note SWITCH** (`loadDetail`), never on autosave. This eliminates the prior `getNoteById` re-fetch on the autosave path entirely (simpler + caret-safe). Links/backlinks refresh is deferred to the next note-switch (scope OUT this wave).

---

## 6. EXPLORE — hypotheses, scoring, selection

Three genuinely distinct architectures *within* the locked envelope (CM6 + single surface + module API). Scored on the 7-dim rubric (Alignment .25 / Correctness .20 / Maintainability .15 / Performance .15 / Simplicity .10 / Risk .10 / Innovation .05).

- **H1 — Conservative: controller owns the debounce.** Module is a dumb CM6 wrapper exposing `onChange`; the *controller* runs the debounce timer + autosave + reconcile. Reading view rendered by the controller into the host. *Score 0.78.* Strong correctness/low-risk, but leaks editor-lifecycle concerns into the controller (it must manage timers, indicator DOM, toggle) → contradicts "controller stays framework-light."
- **H2 — Pattern-leveraging (SELECTED): module owns debounce + UI chrome; controller owns persistence + reconcile.** Module wraps CM6, runs its own `updateListener`-driven debounce, renders its own toolbar (Reading toggle + status indicator) + placeholder, and exposes `mountEditor(parent,{doc,onSave})→{getDoc,setDoc,focus,destroy,flush,getView}`. Controller provides `onSave` = the caret-safe persistence (`editNote` + out-of-band metadata, **no re-mount**) and destroys/re-mounts only on note switch. *Score 0.90.* Best alignment (controller thin, CM6 fully isolated, save flow reused) and lowest caret-safety risk (only the controller's `onSave` touches persistence; nothing on that path re-mounts).
- **H3 — Innovative: compartment-first, reading-view-as-CM6-readonly.** Same as H2 but the reading view is a *second CM6 `EditorState`* (read-only, decoration-rendered) and all extensions pre-wrapped in `Compartment`s. *Score 0.82.* Compartment-readiness is valuable (adopted into H2 for the fast-follow), but rendering reading view via a second CM6 state **bypasses the sanitize chokepoint** → violates the LOCKED "Reading view renders through `renderMarkdownFragment`." Rejected on that ground; its compartment idea is merged in.

**SELECTED: H2**, merging H3's **compartment-readiness** (extensions composed so live-preview decorations slot in later via `Compartment.reconfigure` with zero change to doc format or save flow).

**Rejected alternatives (recorded to prevent re-exploration):** H1 (controller-owns-debounce: violates framework-light); H3's CM6-rendered reading view (bypasses chokepoint — security-load-bearing); a `contenteditable`/markdown-WYSIWYG approach (off the table — owner locked CM6 + raw-markdown-on-disk); a heavy prebuilt theme dep (rejected for bundle + token-mismatch — hand-rolled `HighlightStyle`).

---

## 7. ARCHITECTURE DECISIONS (the four D-* resolved)

### D-DEPS — exact CM6 packages (latest stable, verified via `npm view` 2026-06-28)
Add as **runtime dependencies** (`jin-gui/package.json`):

| Package | Version | Purpose |
|---|---|---|
| `@codemirror/state` | `^6.7.0` | `EditorState`, transactions (pure; unit-test seam) |
| `@codemirror/view` | `^6.43.4` | `EditorView`, `keymap`, `placeholder`, `EditorView.theme` |
| `@codemirror/commands` | `^6.10.4` | `history`, `defaultKeymap`, `indentMore`/`indentLess`, `historyKeymap` |
| `@codemirror/language` | `^6.12.4` | `syntaxHighlighting`, `HighlightStyle`, `indentUnit` |
| `@codemirror/lang-markdown` | `^6.5.0` | `markdown()`, `markdownLanguage`, `insertNewlineContinueMarkup`, `deleteMarkupBackward` |
| `@codemirror/autocomplete` | `^6.20.3` | `closeBrackets`, `closeBracketsKeymap` (smart pairs) |
| `@lezer/highlight` | `^1.2.3` | `tags` for the hand-rolled `HighlightStyle` |

No new dev deps required (`@types` ship inline). **Bundle impact (advisory, G-BUNDLE):** estimate **~110–140 KB gzip** added (CM6 core ~50 KB gzip + `lang-markdown` which transitively pulls `@codemirror/lang-html`). Vivi MUST record the measured `vite build` delta. **Trim lever if over budget:** configure `markdown({ codeLanguages: [], ... })` / drop nested HTML sublanguage — do NOT add a heavy theme dep.

### D-MODULE — `jin-gui/src/lib/notes/editor.ts` (new body, imperative API)
```
mountEditor(parent: HTMLElement, opts: {
  doc: string;
  onSave: (doc: string) => Promise<void>;   // controller-provided; called debounced + on flush
  readOnly?: boolean;
}): EditorHandle

interface EditorHandle {
  getDoc(): string;
  setDoc(next: string): void;     // note-switch only; NEVER called on the autosave path
  focus(): void;
  flush(): Promise<void>;         // cancel debounce, save NOW if dirty (blur/switch/toggle)
  destroy(): void;
  getView(): EditorView;          // test seam for caret/identity assertions
}
```
- CM6 isolated entirely behind this module. Extensions composed in **`Compartment`s** (theme, language, highlight, keymaps) so live-preview decorations can be added later via `reconfigure` — **no on-disk-format or save-flow change** (fast-follow readiness, the H3 merge).
- Module renders inside `parent`: a slim **toolbar** (Reading-view toggle button + quiet status indicator span) above the CM6 surface, plus the empty-state via CM6 `placeholder("Start writing…")`.
- Extensions: `markdown({base: markdownLanguage})`, `syntaxHighlighting(jinHighlightStyle)`, `history()`, `closeBrackets()`, `EditorView.lineWrapping`, `placeholder(...)`, `EditorView.theme(jinTheme)`, and a single merged `keymap.of([...jinNoteKeys, ...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap])` (jin keys FIRST so they win).
- `updateListener` fires on `update.docChanged` → schedule debounce.

### D-SAVE-TRIGGER — debounce + flush + caret-safe `onSave`
- **Debounce = 600 ms** idle after the last doc change (module-internal timer).
- **Flush immediately** (cancel timer, save if dirty) on: editor **blur**, **note switch** (`loadDetail` before mounting the next note), **Reading-view toggle**, and **`destroy`**.
- Controller refactor of `commitBody` → caret-safe `onSave(doc)`:
  1. stale-closure guard (`id === currentNoteId`); dirty-check `doc !== lastSavedBody` (else no-op).
  2. `const updated = await editNote(id, { body: doc })`.
  3. on success: `lastSavedBody = doc` (the SENT text — **no re-fetch, no `setDoc`**); update the "updated" timestamp via targeted DOM from `updated.updated`; status indicator → "Saved". **No `renderNoteDetail`.**
  4. on error: dispatch `app:error` (existing `isJinErrorDto` path); status → "Save failed"; `lastSavedBody` unchanged so the next flush retries.
- Status indicator copy: idle blank → on change "Saving…" → resolve "Saved" → reject "Save failed".

### D-TEST-STRATEGY — realistic + rigorous (anti-shallow, jsdom reality)
Three test layers; **no test asserts merely that a div exists.**
- **(a) State-level (pure, node env — no layout needed):** build `EditorState` with the module's extension list; place selection; **run the command / dispatch the transaction**; assert resulting **doc text + selection**. Covers G-EDITOR-TAB (doc gains indent), G-EDITOR-ENTER (list continuation + empty-item exit), G-EDITOR-BOLD (selection → `**sel**`), Mod+I/K/headings, closeBrackets, undo/redo. These need only `@codemirror/state` + the command functions — fast, deterministic, mutation-biting.
- **(b) Controller-level (jsdom, real Stimulus + real CM6 mount):** mock `../invoke` (existing `vi.mock` pattern, `notes_controller.test.ts:57`); `vi.useFakeTimers()` to drive the 600 ms debounce. Covers G-AUTOSAVE (doc change → advance timers → `editNote` called with new text) and **G-SAVE-CARET-SAFE** (the regression gate — see §10). The caret-safe + XSS gates **MUST use a REAL `EditorView` mount** (a mock would defeat them). Module-boundary mocking is allowed ONLY for unrelated controller tests if `EditorView` proves flaky in jsdom.
- **(c) Reading-view + chokepoint (jsdom):** toggle → assert rendered DOM came through `renderMarkdownFragment` (spy on the chokepoint module / assert sanitized nodes + no script node) and that a dirty editor **flushes first** (`editNote` called before/at toggle).
- **(d) Immovable:** G-XSS `notes_controller.test.ts:497-514` + G-CHOKEPOINT stay green.
- **jsdom CM6 de-risk (S1, FIRST):** a smoke test mounts `EditorView` in jsdom and asserts `getDoc()` round-trips AND `.cm-content` `textContent` contains the doc text. If this passes, A2/A3 hold and the existing G-XSS test passes unchanged against the CM6 mount. If `.cm-content` is empty under jsdom, escalate the test-strategy variance (see §11 / §12 R2) before proceeding.
- **Runner:** Node ≥20 — use the **nvm v24.18.0** node path; system `node v16.20.2` crashes vitest. Per-file `// @vitest-environment jsdom` pragma for DOM tests (existing convention).

---

## 8. CHANGE MAP (anchored file:line)

| File | Action | Anchor |
|---|---|---|
| `jin-gui/package.json` | add 7 CM6 runtime deps | `dependencies` block |
| `jin-gui/src/lib/notes/editor.ts` | **replace body** — `mountEditor` + `EditorHandle` + keymaps + `HighlightStyle` + theme + reading-view + status indicator | old `renderNoteEditor` `:44-211` |
| `jin-gui/src/lib/notes/render.ts` | rewire body host to `mountEditor`; thread the handle/onSave | `:13` import, `:202-208` body host (`renderNoteEditor` call `:207`) |
| `jin-gui/src/controllers/notes_controller.ts` | `loadDetail` mounts/destroys editor on switch + flush; refactor `commitBody`→caret-safe `onSave` | `:265-310` loadDetail, `:322-358` commitBody (kill full re-render `:339-347`) |
| `jin-gui/src/styles/browse.css` | `.note-detail__body` `flex:1; min-height:0` + parent chain full-height; CM6 calm-typography theme; remove dead `.note-block*` rules | `:338-343` body, `:347-489` block rules, pane `:729-733`, grid `:658-669` |
| `jin-gui/src/lib/notes/blocks.ts` | **delete** (dead after editor replace) | whole file |
| `jin-gui/src/__tests__/blocks.test.ts` | **delete** (tests deleted module) | whole file |
| `jin-gui/src/__tests__/editor.test.ts` | **replace** with CM6 state-level + reading-view tests | whole file |
| `jin-gui/src/__tests__/notes_controller.test.ts` | rewrite G-SAVE block for CM6 (debounce, no textarea-click); add G-SAVE-CARET-SAFE; keep G-XSS `:497-514` green | `:1293-1470` G-SAVE/G-SAVE-ERROR |

---

## 9. CONSTRUCT — ordered stories (each with GIVEN/WHEN/THEN + gates + hints)

**Build order:** S0 → S1 → S2 → S3 → S4 → S5. Sequential (one consumer, coupled refactor). Each boundary keeps the build green via the **transitional-coexistence rule**: S1 ADDS `mountEditor` while leaving the old `renderNoteEditor` export in place; S3 switches `render.ts`/controller to `mountEditor` and removes `renderNoteEditor` + `editor.test.ts`'s old cases; S5 removes `blocks.ts`. Do NOT delete the old export before S3.

---

### S0 — Add CM6 dependencies (Kupo) · timebox 1d · P1
**As a** maintainer, **I want** the CM6 packages installed at latest stable **so that** the editor module can import them and the bundle delta is known.
- **Action:** Configure `package.json` (the 7 deps from §7 D-DEPS); install under Node 24; record `vite build` bundle delta.
- **GIVEN** `jin-gui/package.json` **WHEN** the 7 CM6 deps are added and installed under nvm v24.18.0 **THEN** `npm run build` (`tsc --noEmit && vite build`) passes and a baseline bundle size is recorded.
- **GIVEN** the install **WHEN** `markdown.test.ts` G-CHOKEPOINT runs **THEN** it stays green (CM6 packages do not import markdown-it/dompurify).
- **Gates:** G-BUILD (clean build), **G-CHOKEPOINT** (stays green), G-BUNDLE (advisory: record delta, flag if > ~150 KB gzip).
- **Hints:** Builder/speed class. Context: `package.json`, §7 D-DEPS. Risk: lockfile / `allowScripts` (esbuild already allow-listed).

### S1 — CM6 editor module + behavior gates · timebox ≤3d · P0
**As a** note-taker, **I want** one full-pane CM6 editor with markdown highlighting and real editor keybindings **so that** writing feels continuous and Tab/Enter/shortcuts behave correctly.
- **Action:** Create the new `editor.ts` body (`mountEditor`/`EditorHandle`, §7 D-MODULE): markdown lang + hand-rolled `HighlightStyle` + `history` + `closeBrackets` + `lineWrapping` + `placeholder("Start writing…")` + merged keymap. ADD alongside old `renderNoteEditor` (transitional). Write state-level + smoke tests. Replace `editor.test.ts`.
- **AC — jsdom smoke (de-risk A2/A3, FIRST):** GIVEN a doc string WHEN `mountEditor` runs in jsdom THEN `getDoc()` equals the doc AND `.cm-content` `textContent` contains it.
- **AC — Tab indent (G-EDITOR-TAB):** GIVEN the caret on a list item line `"- item"` WHEN Tab runs THEN the line text gains a leading indent unit (e.g. `"  - item"`) and the command consumes the key (returns true); GIVEN the same in a jsdom mount WHEN a Tab keydown is dispatched THEN `document.activeElement` stays within `.cm-editor` (**does NOT blur**). Shift-Tab outdents.
- **AC — Enter continuation (G-EDITOR-ENTER):** GIVEN caret at end of `"- item"` WHEN `insertNewlineContinueMarkup` runs THEN a new line starting `"- "` is inserted; GIVEN caret on an empty `"- "` item WHEN it runs THEN the marker is removed (list exits). Same for `"> "` blockquote and `"- [ ] "` checkbox.
- **AC — Bold wrap (G-EDITOR-BOLD):** GIVEN selection over `"word"` WHEN Mod+B runs THEN doc becomes `"**word**"` with selection preserved over `word`; running again unwraps (toggle).
- **AC — Italic/Link/Headings:** Mod+I → `*word*`; Mod+K → `[word](url)` with caret in `url`; Mod+1..6 → set ATX heading level on the line (replace existing level, not stack).
- **AC — Smart pairs:** typing `(` with a selection wraps it; typing the close char over an auto-close skips; backspace between an empty pair deletes both.
- **AC — Undo/redo:** an edit then Mod+Z restores prior doc; Mod+Shift+Z redoes.
- **AC — Placeholder:** empty doc shows "Start writing…" (CM6 placeholder), not a literal block.
- **AC — Highlight present:** GIVEN `"# H\n**b** \`c\`"` THEN the highlight layer produces distinct styling for heading / strong / inline-code (assert via highlight tags resolved by the `HighlightStyle`, not pixel color).
- **Gates:** **G-EDITOR-TAB**, **G-EDITOR-ENTER**, **G-EDITOR-BOLD**, G-EDITOR-PAIRS, G-EDITOR-HISTORY, G-EDITOR-PLACEHOLDER, G-CHOKEPOINT (editor imports only `renderMarkdownFragment`).
- **Hints:** Reasoner class (CM6 command authoring). Context: §7 D-MODULE/D-TEST-STRATEGY, `markdown.ts`, CM6 docs. Risk: keymap ordering (jin keys must precede `defaultKeymap`); list-aware Tab — prefer `indentMore`/`indentLess` keyed on list context, assert the observable doc change.

### S2 — Reading-view toggle through the chokepoint · timebox ≤2d · P0
**As a** reader, **I want** a button to switch the pane to a rendered, read-only view **so that** I can read the note cleanly without losing edits.
- **Action:** Add the toolbar toggle to the module; on toggle-to-reading, `flush()` then render `renderMarkdownFragment(getDoc())` into the host (read-only); on toggle-to-edit, restore the CM6 surface (caret restored to prior position where feasible).
- **AC (G-READING-VIEW):** GIVEN the editor with doc `"# H"` WHEN the toggle switches to reading view THEN the host shows sanitized rendered HTML produced via `renderMarkdownFragment` (an `<h1>` node, NOT raw text, NOT `innerHTML` of raw markdown).
- **AC — flush before toggle:** GIVEN unsaved edits WHEN the user toggles to reading view THEN `flush()` runs (dirty → `editNote` called) BEFORE rendering, so no edit is lost.
- **AC — XSS in reading view:** GIVEN doc `"<script>window.__x=1</script>"` WHEN toggled to reading view THEN no `<script>` node exists in the host and the canary is undefined (chokepoint).
- **AC — round-trip:** toggling reading→edit→reading does not mutate `getDoc()`.
- **Gates:** **G-READING-VIEW**, G-READING-FLUSH, G-XSS-READING.
- **Hints:** Builder class. Context: `markdown.ts:60`, S1 handle. Risk: toggling must `replaceChildren` (never `innerHTML`); the chokepoint returns a `DocumentFragment` — append, don't stringify.

### S3 — Controller rewire + caret-safe autosave · timebox ≤3d · P0
**As a** note-taker, **I want** my typing autosaved quietly without the editor or caret ever being destroyed **so that** writing is uninterrupted.
- **Action:** Switch `render.ts:202-208` body host to `mountEditor`; thread `onSave`. In `loadDetail`: destroy any prior handle, `flush()` the outgoing note, mount the new note's doc. Refactor `commitBody`→`onSave` per §7 D-SAVE-TRIGGER (NO `renderNoteDetail`, NO re-fetch/`setDoc`; update timestamp via targeted DOM from `editNote`'s returned DTO). Remove old `renderNoteEditor` + old `editor.test.ts` cases. Rewrite the G-SAVE block.
- **AC (G-AUTOSAVE):** GIVEN a mounted note WHEN the doc changes and 600 ms elapse (fake timers) THEN `editNote(id,{body})` is called once with the new doc text.
- **AC (G-SAVE-CARET-SAFE — THE regression gate):** GIVEN a focused editor at caret offset N WHEN an autosave completes THEN (1) the SAME `.cm-editor`/`EditorView` node instance is still mounted (node identity unchanged — `view before === view after`), (2) `renderNoteDetail` is NOT called by the save path (spy: called once on load, zero on save), (3) `view.state.selection.main.head === N`.
- **AC — dirty-check:** GIVEN no change since last save WHEN debounce/flush fires THEN `editNote` is NOT called.
- **AC — flush on switch/blur:** GIVEN dirty note A WHEN the user opens note B THEN A is flushed (`editNote` for A) BEFORE B mounts, and B's doc is the new note's body.
- **AC (G-SAVE-ERROR, retained):** GIVEN `editNote` rejects with a `JinErrorDto` WHEN autosave fires THEN `app:error` is dispatched, the edited text is retained in the editor, and the next flush retries (`lastSavedBody` unchanged).
- **AC (G-XSS immovable):** `notes_controller.test.ts:497-514` stays green against the CM6 mount (literal `<script>` text reachable via the editor's text nodes / or reading-view; no script node; canary undefined). If jsdom renders no `.cm-content` text (A2 fails), preserve all three security assertions' intent while adapting the read surface — security semantics NEVER weaken.
- **Gates:** **G-AUTOSAVE**, **G-SAVE-CARET-SAFE**, G-SAVE-DIRTY, G-SAVE-FLUSH-SWITCH, G-SAVE-ERROR, **G-XSS (immovable)**.
- **Hints:** Reasoner class. Context: `notes_controller.ts:265-358`, `render.ts:199-208`, `invoke.ts:68-78`, §5, §7 D-SAVE-TRIGGER. Risk (P0): any reintroduction of `renderNoteDetail` on the save path = caret loss; the gate must assert node identity to bite it.

### S4 — Full-height sizing + calm typography (Kupo) · timebox ≤2d · P1
**As a** note-taker, **I want** a cozy centered writing column that fills the pane and respects light/dark **so that** it feels like a real note app.
- **Action:** `.note-detail__body` → `flex:1; min-height:0` and ensure the parent chain (`detailContent` host → `.notes-detail-pane` `:729-733` → `.notes-paned` grid `:658-669`) propagates full height (the detail pane uses `overflow-y:auto`; the body host must be a flex child that fills). Add the CM6 `EditorView.theme` + `HighlightStyle` mapping (centered `max-width: 66ch; margin: 0 auto`; `.cm-content` `font-size: 1.125rem` (18px), `line-height: 1.6`, `font-family: var(--font-text)`, padding ~`3rem` top/sides; caret `var(--accent)`; selection `var(--fill-secondary)`; heading scale ~1.2 ratio h1≈1.9em…h6≈1em; strong 700; em italic; inline/fenced code `var(--font-mono)` tinted `var(--label-secondary)` bg `var(--bg-secondary)`; list/quote/heading marks `var(--label-tertiary)`; links `var(--accent)`). Remove dead `.note-block*` CSS (`:347-489`). Theme MUST reference token vars so light/dark `@media`/`[data-theme]` blocks in `tokens.css` flow through.
- **AC — fill:** GIVEN the detail pane WHEN a note opens THEN the editor surface fills the available height (the `.note-detail__body` rule carries `flex:1; min-height:0`).
- **AC — measure:** the content column is centered at ~66ch with 18px/1.6 body.
- **AC — theming:** the theme uses only token custom properties (no hard-coded hex); switching `[data-theme]` flips colors (assert the theme CSS references `var(--label)` / `var(--bg-*)` / `var(--accent)`, not literals).
- **AC — `lint:css`:** `npm run lint:css` passes; no orphaned `.note-block*` selectors remain.
- **Gates:** G-SIZING (`.note-detail__body` flex:1/min-height:0 + chain), G-THEME-TOKENS (token vars only), G-CSS-LINT, G-CSS-DEADCODE (no `.note-block*`).
- **Hints:** Builder class. Context: `browse.css:338-489,658-733`, `tokens.css`. Risk: the deviation to 18px/1.6 (vs token body 17px/1.29) is owner-specified — set locally in the editor theme; do not alter global tokens.

### S5 — Dead-code & dead-test removal (Kupo) · timebox 1d · P2
**As a** maintainer, **I want** the obsolete block model gone **so that** the module stays lean and no dead path can rot.
- **Action:** Delete `blocks.ts` + `blocks.test.ts`; confirm no remaining import of `blocks`/`renderNoteEditor`/`substituteBlock`/`parseBlocks`/`serializeBlocks` anywhere in `src/`.
- **AC:** GIVEN a repo-wide grep WHEN searching `notes/blocks` and `renderNoteEditor` THEN zero non-historical hits remain; `npm run build` + full `vitest run` pass; G-CHOKEPOINT + G-XSS still green.
- **Gates:** G-NO-DANGLING-IMPORTS, G-BUILD, G-CHOKEPOINT, G-XSS.
- **Hints:** Builder/speed class. Context: §4 REMOVE, §8. Risk: ensure `editableBlocks`/`Segment` type imports are gone from `editor.ts` first (done in S1/S3).

---

## 10. VALIDATION GATES CATALOG (these MUST bite)

| Gate | Story | What it asserts (mutation-biting) |
|---|---|---|
| **G-EDITOR-TAB** | S1 | Tab on a list line inserts a leading indent unit into the doc; in jsdom, focus stays in `.cm-editor` (NOT a blur). Shift-Tab outdents. |
| **G-EDITOR-ENTER** | S1 | Enter on `"- x"` inserts `"- "`; on empty `"- "` removes the marker (exit). Same for `> ` and `- [ ] `. |
| **G-EDITOR-BOLD** | S1 | Mod+B over a selection yields `**sel**`; toggles off on re-run. |
| G-EDITOR-PAIRS / -HISTORY / -PLACEHOLDER | S1 | closeBrackets wrap/skip/delete; undo restores; empty doc shows placeholder. |
| **G-AUTOSAVE** | S3 | doc change + 600 ms (fake timers) → `editNote(id,{body:newDoc})` called once. |
| **G-SAVE-CARET-SAFE** | S3 | After autosave: same `EditorView` node identity, `renderNoteDetail` NOT called, caret offset preserved. **(top regression gate)** |
| G-SAVE-DIRTY / -FLUSH-SWITCH / -ERROR | S3 | no-change → no save; switch flushes outgoing note before mount; reject → `app:error` + retained edit + retry. |
| **G-READING-VIEW** | S2 | toggle renders via `renderMarkdownFragment` (sanitized `<h1>` node, never `innerHTML` of raw md). |
| G-READING-FLUSH / G-XSS-READING | S2 | dirty edits flush before toggle; `<script>` → no script node + canary undefined. |
| **G-XSS (immovable)** | S3 | `notes_controller.test.ts:497-514` green; no script node, literal text, canary undefined. |
| **G-CHOKEPOINT (immovable)** | S0/S1/S5 | `markdown.test.ts:366,390` green; only `markdown.ts` imports markdown-it/dompurify. |
| G-SIZING / G-THEME-TOKENS / G-CSS-LINT / G-CSS-DEADCODE | S4 | `.note-detail__body` flex:1/min-height:0 + chain; theme uses token vars only; `lint:css` clean; no `.note-block*` left. |
| G-BUILD / G-BUNDLE / G-NO-DANGLING-IMPORTS | S0/S5 | clean `tsc`+`vite build`; recorded bundle delta; zero dead imports. |

**Runner contract:** all frontend gates run under **Node ≥20 (nvm v24.18.0)**; system `node v16.20.2` crashes vitest. DOM tests carry `// @vitest-environment jsdom`.

---

## 11. TEST (6-layer verification)

- **Structural:** hierarchy Project→Stories→Tasks intact; S0–S5 each atomic & independently valuable; no orphan tasks. ✔
- **Self-consistency:** three decompositions (by-layer / by-risk / by-file) converge on the same 6 units (>70% overlap). ✔
- **Dependency:** all impacted files anchored (§8) and re-verified firsthand; only call site of `renderNoteEditor` is `render.ts:207`; `blocks.ts` consumers enumerated (editor.ts + blocks.test.ts only). ✔
- **Constraint:** frontend-only (no Rust); reuse chokepoint + `editNote`; caret-safety designed in (§5); anti-shallow gates defined to bite (§10); Node ≥20. ✔
- **Process reward:** ordering reduces risk monotonically — deps → isolated module (testable pure) → reading view → the risky controller rewire (with its caret gate) → cosmetics → cleanup. ✔
- **Adversarial:** *Under-spec?* keymap exact bindings left to Vivi but every behavior has a doc-text gate. *Dependency blindness?* CM6 jsdom rendering (A2) — de-risked by the S1 smoke test FIRST. *Assumption drift?* re-fetch removed from save path (was in prior spec) — intentional, documented (§5). *Scope creep?* live-preview / focus-mode / typewriter explicitly OUT (§2). *Stale context?* all anchors re-read this session, not from memory.

**Open verification item (flagged, not blocking):** A2 (CM6 text in jsdom) — the S1 smoke test resolves it before S3 depends on it; fallback path specified (§7 D-TEST-STRATEGY).

---

## 12. RISK REGISTER

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| **R1** | Caret-destroying re-render (the `renderNoteDetail`-on-save at `notes_controller.ts:339-347`) reintroduced | **P0** | §5 out-of-band reconcile; **G-SAVE-CARET-SAFE** asserts node identity + caret + `renderNoteDetail` not called |
| **R2** | CM6 not testable under jsdom (no layout) | P1 | S1 jsdom smoke test FIRST; state-level tests need no view; module-boundary mock fallback for unrelated controller tests (caret/XSS gates keep a real mount) |
| R3 | Bundle bloat from `lang-markdown`→`lang-html` | P1 | G-BUNDLE measures delta; trim lever (`codeLanguages:[]`/drop nested HTML); hand-rolled HighlightStyle (no theme dep) |
| R4 | Theme/token mismatch (18px/1.6 vs 17px tokens; light/dark) | P2 | editor theme references token vars only (G-THEME-TOKENS); local size deviation owner-specified, scoped to editor |
| R5 | G-XSS regression when surface changes to CM6 | **P0** | CM6 renders text-only (A3, structural); reading view via chokepoint; immovable test kept green, security assertions never weakened |
| R6 | Lost edits on note switch / toggle | P1 | `flush()` on blur/switch/toggle/destroy (G-SAVE-FLUSH-SWITCH, G-READING-FLUSH) |
| R7 | Vivi refuses (greenfield guard) | P2 | framed brownfield: REPLACE an existing file + REUSE anchored chokepoint/save; CREATE-within-spec, not novel architecture |

---

## 13. CONFIDENCE REPORT

**0.88 → AUTO_PROCEED.**
| Factor (25% each) | Score | Note |
|---|---|---|
| Pattern match | 0.85 | thin-adapter + chokepoint reuse strong; CM6 itself new |
| Requirement clarity | 0.97 | every plan-shaping decision owner-LOCKED; D-* resolved |
| Decomposition stability | 0.85 | 3 decompositions converge >70% |
| Constraint compliance | 0.85 | frontend-only, chokepoint, caret-safety, anti-shallow all addressed; A2 is the one residual unknown (de-risked S1) |

---

## 14. OUT OF SCOPE / FAST-FOLLOW (explicit)

**Do NOT build now:** inline live-preview decorations (Obsidian hide-marks); focus mode; typewriter scrolling; theme/font pickers; wikilink autocomplete; slash commands; image paste; task-list checkbox interactivity; full out-of-band links/backlinks re-render per autosave (deferred to note-switch). The module's compartment-composed extensions (§7 D-MODULE) make live-preview decorations a later `reconfigure` with **zero on-disk-format / save-flow change**.

---

## 15. EXECUTION SEQUENCE

`S0 (deps) → S1 (module + behavior gates, smoke FIRST) → S2 (reading view) → S3 (controller rewire + caret-safe autosave) → S4 (sizing + typography) → S5 (cleanup)`. Sequential; transitional-coexistence keeps each boundary green (old `renderNoteEditor` survives until S3; `blocks.ts` until S5). Top watch: **S3 / G-SAVE-CARET-SAFE**.

*Handoff: `spectra → apivr` (Vivi). ECL v2.0 envelope sidecar emitted. Frontend gates require Node ≥20 (nvm v24.18.0).*
