# Jin Notes Rebuild — Wave 1 Spec (decision-ready)

- **Methodology:** SPECTRA 4.10.0 · standard tier · single-pass cycle
- **Date:** 2026-06-27
- **Intent type:** CHANGE (contains one BUG_SPEC sub-component)
- **Complexity:** 9/12 → extended thinking (2× depth)
- **Confidence:** 86% → AUTO_PROCEED
- **Hand-off:** spectra → apivr (Vivi, coder)
- **Conventions file:** none present (`.spectra/setup/spectra-conventions.md` absent) → generic defaults

> Scope is **Wave 1 only**. Folders (real on-disk subdirectories) and the Obsidian live editor are **Wave 2 — out of scope**. Wave 1 leaves seams, never paints folders into a corner.

---

## 1. CLARIFY (skip-justified)

Intent is unambiguous; constraints explicit; context gathered firsthand (every anchor re-read). No blocking questions. The one delegated decision — snippet source — is resolved in §3 with evidence. Two ambiguities resolved as decisions (not questions): date field to display (= `updated`, §3 D4) and excerpt shape (§3 D2).

| Axis | Value |
|---|---|
| WHO | Owner (product) → Vivi (executor). This spec is the handoff. |
| WHAT | (1) Fix "clicking a note shows only title, not body". (2) Apple-Notes-style list rows (title + snippet + date) replacing bubble cards. |
| WHY | Notes detail is broken; list looks like bubble cards; owner wants a clean Apple-Notes list. |
| CONSTRAINTS | Wave 1 only; snippets are REQUIRED (frontend-only date+title insufficient); keep list rendering cheap; XSS-safe body must remain; anti-shallow round-trip tests mandatory; anchor every change to file:line; don't block Wave 2 folders. |

---

## 2. SCOPE

**In scope**
- Rust: `NoteDto` gains `body_markdown` + `excerpt`; `get_note` loads body from disk; list path carries excerpt.
- Index: `excerpt` column on `notes` table (+ idempotent migration); populated at rebuild; selected in list/get queries; mapped through `NoteRow` → `NoteDto`.
- Frontend: TS `NoteDto` gains `excerpt`; list row redesigned to Apple-Notes layout (title + snippet + date); HTML template + CSS replaced; pure `formatNoteDate` helper.
- Tests: mandatory anti-shallow round-trips (Rust body, Rust excerpt, frontend list row) + migration safety + regression of existing status/tags/title/XSS tests.

**Out of scope (Wave 2)** — real folder subdirectories, recursive store, folder column/filter, folder grouping in list, Obsidian live editor, in-list editing.

**Deferred / seams (designed for, not built)** — §6.

**Assumptions (risk-if-wrong)**
- A1: The index is a fully derived, disposable artifact (canonical = markdown files). Confirmed: `rebuild` wipes+repopulates all tables (rebuild.rs:22-30). Risk-if-wrong: migration strategy invalid.
- A2: `NoteRow.file_path` (query.rs:18) is a readable path written by rebuild (rebuild.rs:50 via `path.to_string_lossy()`). Risk-if-wrong: get_note disk-read fails.
- A3: One `NoteDto` serves both list and detail (api.rs:13-33). Confirmed. Risk-if-wrong: would need a separate summary DTO.

---

## 3. DECISIONS

### D1 — Snippet source: index-side `excerpt` column (for the list) + disk-read body (for detail). [SELECTED]
The list snippet comes from a short **`excerpt` column on the `notes` index table**, populated **at rebuild time** from the note body. The detail body (`get_note`) is read **fresh from disk**, never indexed.

**Why:** `rebuild` already reads every note file (`fs::read_note`, rebuild.rs:35) — deriving the excerpt there is **zero extra IO**. List rendering stays a single cheap SQL query (no per-note disk reads at request time). The full body never enters the index (ATLAS constraint honored); only a short excerpt does. The detail body is always current from canonical disk, which is exactly what the Wave-2 Obsidian editor will need.

**Rejected alternatives**
- (H2) List-time per-note disk read in `list_notes`: O(N) file reads on every list load — the exact cost ATLAS flagged. Rejected (performance).
- (H3 / option c) Frontend date+title only, snippet later: violates the explicit "snippets required" constraint. Rejected.
- (H4) Store full body in the index, derive excerpt frontend-side: index bloat + duplicates canonical data; ATLAS explicitly forbids body in the index. Rejected.

### D2 — Excerpt derivation contract (pure, deterministic). [DECIDED]
`derive_excerpt(body: &str) -> String`: collapse every run of whitespace (incl. newlines) to a single space, trim, then take the first **200 chars** on a **UTF-8 char boundary** (use `char_indices`, never byte-slice). Empty/whitespace-only body → `""`. No trailing ellipsis stored (the frontend clamps visually). Markdown-syntax stripping (leading `#`/`>`/`-`) is a **Wave-2 polish seam**, not Wave 1 — the load-bearing contract is whitespace-collapse + char-safe truncate.

### D3 — `get_note` body source: read from `NoteRow.file_path`. [DECIDED]
In `api::get_note` (api.rs:25-33), after fetching the row, read the body from `row.file_path` via `crate::store::fs::read_note` and attach it; keep index-derived title/status/tags/backlinks from the row. **Do not** route through `notes::get_note` (it re-scans the dir via `find_note_path`); using the stored `file_path` is cheaper and is **folder-safe** (works regardless of subdirectory — a deliberate Wave-2 seam, §6).
**Behavior change (flagged):** if the row exists but the file is unreadable/missing, `get_note` now returns an error instead of silently succeeding from the index. This is more correct (surfaces real inconsistency) and avoids silently reintroducing the empty-body symptom. Document it.

### D4 — List date field: display `updated`. [DECIDED]
The list already sorts by `updated` desc (transform.ts:38). Display `updated` (Apple Notes shows the modified date). Format via pure `formatNoteDate(iso, now = Date.now())`: same day → `Today`; previous day → `Yesterday`; same year → `MMM D` (e.g. `Jun 12`); else `MMM D, YYYY` (e.g. `Dec 3, 2025`). Local timezone. `now` injectable for deterministic tests.

### D5 — Schema migration: dual-path (CREATE includes column + guarded ALTER) + version-gated one-time rebuild. [DECIDED — load-bearing]
`schema::apply` uses only `CREATE TABLE IF NOT EXISTS` (schema.rs:114-116), and `index::open` only applies the schema (index/mod.rs:15-18). Therefore adding `excerpt` to the `CREATE TABLE` alone will **NOT** alter a pre-existing `index.sqlite` → `SELECT ... excerpt` would crash existing users with *"no such column: excerpt"*. Required:
1. **(MANDATORY, correctness)** Add `excerpt TEXT NOT NULL DEFAULT ''` to the `notes` `CREATE TABLE` (schema.rs:15-24) AND add an **idempotent guarded** `ALTER TABLE notes ADD COLUMN excerpt TEXT NOT NULL DEFAULT ''` in `schema::apply` (gate on `PRAGMA table_info(notes)` showing no `excerpt`, or catch the duplicate-column error). Without this, the app crashes for current users.
2. **(STRONGLY RECOMMENDED, experience → Kupo K1)** Pre-existing notes have empty excerpt until a mutating op triggers `api::refresh`, and there is **no startup refresh** (lib.rs:21-66; `ops::init` early-returns, init.rs:10-12). Close the stale-empty window with a **version-gated one-time rebuild**: store an index-schema sentinel in `schema_meta` (the table already exists, schema.rs:10-13) and run `rebuild` once on version bump, at a place where `root` is available (recommended: extend `ops::init` to perform a version-gated `rebuild` — it already runs on every launch via main.rs:12 and is the canonical root-prep step). See K1.

---

## 4. STORIES (ordered, with dependencies)

```
S1 (bug fix) ──▶ [unblocks detail render path]
S2 (backend excerpt + migration) ──▶ S3 (Apple-Notes list redesign)
K1 (version-gated rebuild)  depends on S2
K2 (template/fixture parity test)  depends on S3
K3 (dto.ts comment + dto_shapes drift)  depends on S1+S2
```

Bug fix first (P0, smallest, independent). S3 depends on S2 (needs `excerpt` in the DTO). S1 and S2 are technically independent (different fields) but are sequenced bug-first per owner directive.

---

### STORY S1 — Fix the title-only note bug (detail body) · P0 · ≤1d

**As a** Jin user, **I want** clicking a note to show its full body, **so that** notes are actually usable.

**Root cause (confirmed):** `NoteDto` has no body field (note.rs:7-18); `api::get_note` projects only the index `NoteRow` (api.rs:25-33), which has no body; frontend renders `note.body_markdown ?? ''` (render.ts:160) → empty.

**Action plan**
1. **Extend** `NoteDto` (note.rs:7-18): add `pub body_markdown: Option<String>`.
2. **Modify** `from_model` (note.rs:36-58): `body_markdown: Some(note.body.clone())`.
3. **Modify** `from_row` (note.rs:61-74): `body_markdown: None` (full body never on the list path).
4. **Modify** `api::get_note` (api.rs:25-33): read body from `row.file_path` via `crate::store::fs::read_note`, attach to the DTO; keep row-derived fields + backlinks (per D3). Add a small builder (e.g. `with_body`) or set the field directly before `with_backlinks`.
5. **Update** TS `NoteDto` comment (dto.ts:39-44): the "get_note always returns it" claim becomes TRUE (no shape change — field already declared optional). [→ K3]

**Files/anchors:** `jin-core/src/dto/note.rs:7-18,36-58,61-74` · `jin-core/src/ops/api.rs:25-33` · `jin-core/src/store/fs.rs:72-80` (read_note, reused) · `jin-gui/src/types/dto.ts:39-44`

**Acceptance — GIVEN/WHEN/THEN**
- **AC1.1 GIVEN** a note created with body `"line1\nline2"` and the index refreshed, **WHEN** `get_note_fn(root, id)` is called, **THEN** the returned `NoteDto.body_markdown` is `Some` and equals the on-disk body (non-empty).
- **AC1.2 GIVEN** `from_model(note)`, **WHEN** projected, **THEN** `body_markdown == Some(note.body)`.
- **AC1.3 GIVEN** `from_row(row)` (list projection), **WHEN** projected, **THEN** `body_markdown == None`.
- **AC1.4 GIVEN** a note whose on-disk body is edited directly and the index is NOT rebuilt, **WHEN** `get_note` is called, **THEN** the returned body reflects the on-disk edit (proves disk-read, not index projection).
- **AC1.5 GIVEN** the frontend `getNoteById` resolves a DTO with `body_markdown` set, **WHEN** `NotesController.loadDetail` runs, **THEN** `.note-detail__body` textContent contains the body.
- **AC1.6 (regression)** XSS guard intact: a `<script>` body renders as literal text and does not execute.

**Validation gates** — VG1.1, VG1.2, VG1.3, VG1.4, VG1.5, VG1.6 (see §5).

**Risk tags:** P0 (blocks usable notes). Behavior change per D3 — document.

---

### STORY S2 — Backend `excerpt` for the list (schema + migration + projection) · P1 · ≤2d
**Depends on:** none (parallel to S1). **Blocks:** S3, K1.

**As a** Jin user, **I want** each note's list row to carry a content snippet, **so that** the list previews content like Apple Notes.

**Action plan**
1. **Migrate schema** (per D5): add `excerpt TEXT NOT NULL DEFAULT ''` to `CREATE TABLE notes` (schema.rs:15-24) AND a guarded idempotent `ALTER TABLE notes ADD COLUMN excerpt ...` in `schema::apply` (schema.rs:113-116).
2. **Create** pure `derive_excerpt(body: &str) -> String` (per D2) — recommend a small free fn in `index/rebuild.rs` or a `store` util; unit-test it.
3. **Modify** rebuild note-insert (rebuild.rs:38-53): compute `derive_excerpt(&note.body)` and write it into the new column (the body is already in scope at rebuild.rs:35).
4. **Extend** `NoteRow` (query.rs:10-19): add `pub(crate) excerpt: String`.
5. **Modify** every `notes` SELECT to include `excerpt`: `list_notes` (query.rs:78-100), `get_note` (query.rs:125-143) — add the column to both the SELECT list and the row mapper.
6. **Extend** `NoteDto` (note.rs:7-18): add `pub excerpt: Option<String>`.
7. **Modify** `from_row` (note.rs:61-74): `excerpt: Some(row.excerpt.clone())`. **Modify** `from_model` (note.rs:36-58): `excerpt: None`.
8. **Extend** TS `NoteDto` (dto.ts:29-45): add `excerpt?: string | null` with a doc note ("list projection; absent on create/detail"). [→ K3]

**Files/anchors:** `jin-core/src/index/schema.rs:15-24,113-116` · `jin-core/src/index/rebuild.rs:33-55` · `jin-core/src/index/query.rs:10-19,78-100,125-143` · `jin-core/src/dto/note.rs:7-18,36-58,61-74` · `jin-gui/src/types/dto.ts:29-45`

**Acceptance — GIVEN/WHEN/THEN**
- **AC2.1 GIVEN** body `"# Heading\n\nFirst paragraph with detail."`, **WHEN** `derive_excerpt` runs, **THEN** output collapses whitespace, is trimmed, ≤200 chars, on a char boundary, non-empty.
- **AC2.2 GIVEN** an empty/whitespace-only body, **WHEN** `derive_excerpt` runs, **THEN** output is `""`.
- **AC2.3 GIVEN** a multi-byte UTF-8 body longer than 200 chars, **WHEN** truncated, **THEN** it never splits a char (no panic, valid String).
- **AC2.4 GIVEN** a note with a multi-line body, refreshed, **WHEN** `list_notes_fn(root, false, None)` is called, **THEN** that note's `NoteDto.excerpt` is `Some` and equals `derive_excerpt(body)`.
- **AC2.5 GIVEN** a pre-existing `index.sqlite` created WITHOUT the `excerpt` column, **WHEN** `index::open` (→ `schema::apply`) runs, **THEN** no error and `PRAGMA table_info(notes)` shows `excerpt`; a subsequent `list_notes` succeeds.
- **AC2.6 GIVEN** `schema::apply` is applied twice to the same connection, **WHEN** re-applied, **THEN** it is idempotent (no duplicate-column error).

**Validation gates** — VG2.1, VG2.2, VG2.3 (see §5).

**Risk tags:** P0 if the guarded ALTER is omitted (crashes existing users — see D5/VG2.3). P1 otherwise.

---

### STORY S3 — Apple-Notes-style list row (title + snippet + date) · P1 · ≤2d
**Depends on:** S2 (needs `excerpt` in the DTO).

**As a** Jin user, **I want** the note list to show clean rows with title, snippet, and date, **so that** browsing feels like Apple Notes instead of bubble cards.

**Action plan**
1. **Create** pure `formatNoteDate(iso: string, now?: number): string` in `lib/notes/transform.ts` (per D4).
2. **Modify** the production template `#tmpl-note-row` (index.html:1268-1280): restructure to title line + 2-line snippet + date, **retaining** the class hooks the existing tests assert (`.browse-row__inner`, `.browse-row__title`, `.note-row__status`, `.note-row__status-icon`, `.note-row__status-label`, `.note-row__tags`) and **adding** `.note-row__snippet` and `.note-row__date`. Keep status accessible (aria + glyph) but visually de-emphasized.
3. **Modify** the TEST fixture template (notes_controller.test.ts:115-130) in lock-step — it is a SEPARATE template string and will silently diverge otherwise (see Risk R2 / K2). Add `.note-row__snippet` and `.note-row__date`.
4. **Modify** `buildNoteRow` (render.ts:226-262): populate `.note-row__snippet` via `textContent = note.excerpt ?? ''` (XSS-safe, same discipline as the body) and `.note-row__date` via `textContent = formatNoteDate(note.updated)`.
5. **Replace** the bubble CSS with flat Apple-Notes rows: `.browse-list` (browse.css:49-53), `.browse-row` (57-59), `.browse-row__inner` (61-80 — drop the elevated card: remove `bg-elevated` + radius + full border; use hairline `border-block-end: 0.5px solid var(--separator)`, vertical stack, hover highlight on the whole row), `.browse-row__title` (82-92), `.browse-row__meta` (94-99). **Add** `.note-row__snippet` (color `--label-secondary`, `-webkit-line-clamp: 2` / 2-line clamp, ellipsis) and `.note-row__date` (caption, `--label-tertiary`). Restyle/de-emphasize `.note-row__tags` (271-275). **NOTE:** the shared `.browse-row*` classes are also used by Tasks/Events row templates (index.html task-row ~1300, event-row) — scope the new flat look to notes via `.note-row` overrides OR confirm the flat look is intended for all three. **[DECISION for Vivi: keep Tasks/Events visually unchanged in Wave 1 → put the Apple-Notes flat styling under `.note-row`-scoped selectors, not on bare `.browse-row__inner`.]**

**Files/anchors:** `jin-gui/src/lib/notes/transform.ts` (new fn) · `jin-gui/index.html:1268-1280` · `jin-gui/src/__tests__/notes_controller.test.ts:115-130` · `jin-gui/src/lib/notes/render.ts:226-262` · `jin-gui/src/styles/browse.css:49-99,271-275`

**Acceptance — GIVEN/WHEN/THEN**
- **AC3.1 GIVEN** a note with `excerpt="quick brown fox"` and `updated`, **WHEN** `renderNotesList` runs, **THEN** `.note-row__snippet` textContent === `"quick brown fox"` and `.note-row__date` textContent is the formatted date (non-empty).
- **AC3.2 GIVEN** a note with `excerpt` containing `<script>`, **WHEN** the row renders, **THEN** the snippet is literal text (textContent), not executed.
- **AC3.3 GIVEN** `formatNoteDate(iso, now)` with iso = now's day / now-1day / same-year / prior-year, **WHEN** called, **THEN** returns `Today` / `Yesterday` / `MMM D` / `MMM D, YYYY` respectively.
- **AC3.4 (regression)** existing row tests stay green: title (`.browse-row__title`), status label/glyph/aria (`.note-row__status*`), tags (`.note-row__tags`), row count (`.note-row`), click→navigate (`.browse-row__inner`) — notes_controller.test.ts:306-374.
- **AC3.5 (visual, owner-verified)** the list shows flat Apple-Notes rows (title + snippet + date) with hairline separators, bubble cards gone; Tasks/Events rows unchanged.

**Validation gates** — VG2.4, VG2.5, VG2.7, VG2.8 (see §5).

**Risk tags:** P1. R2 (template divergence) and shared `.browse-row` blast radius (AC3.6/D in step 5) are the watch-items.

---

### Kupo micro-tasks (small, well-bounded)

- **K1 — Version-gated one-time rebuild** (≤0.5d, depends S2). Implement D5 step 2: index-schema sentinel in `schema_meta` + one-time `rebuild` on version bump where `root` is available (recommended: `ops::init`, init.rs:8-12 — handle the early-return path too). Gate: test that pre-existing notes get populated excerpts after one `init`/open cycle. **Closes the stale-empty-snippet window for existing users.**
- **K2 — Template/fixture parity guard** (≤0.5d, depends S3). Add a test that parses `jin-gui/index.html`'s `#tmpl-note-row` and asserts it contains `.note-row__snippet` + `.note-row__date` (and the retained hooks). Prevents the production template from silently diverging from the test fixture (R2).
- **K3 — DTO comment + drift test** (≤0.25d, depends S1+S2). Update the `dto.ts:39-44` body comment (now true) + add `excerpt` doc; extend `dto_shapes.test.ts:143-159` `NoteDto` shape to include `body_markdown` and `excerpt` so silent Rust↔TS drift is caught.

---

## 5. VALIDATION GATES

Anti-shallow mandate (owner): real round-trips, not DTO-fed-into-render-by-hand. VG1.1, VG2.2/VG2.4, VG2.4-frontend are the load-bearing anti-shallow gates.

| Gate | Story | Type | Assertion | Where |
|---|---|---|---|---|
| **VG1.1** | S1 | Rust integ (anti-shallow) | create_note(body) → `api::refresh` → `get_note_fn` ⇒ `body_markdown == Some(body)`, non-empty | extend `bridge.rs:233-255` (`bridge_create_note_round_trip`) |
| **VG1.2** | S1 | Rust unit | `from_model` ⇒ `body_markdown == Some(body)` | new test mod in `dto/note.rs` |
| **VG1.3** | S1 | Rust integ (strong) | edit on-disk body without rebuild → `get_note` returns the new body (disk-read proof) | `bridge.rs` (new) |
| **VG1.4** | S1 | Frontend (anti-shallow) | `vi.mock('../invoke')` so `getNoteById` returns a body → drive `loadDetail` → `.note-detail__body` shows it (NOT hand-fed to render) | `notes_controller.test.ts` (new describe) |
| **VG1.5** | S1 | Frontend regression | XSS guard intact | keep `notes_controller.test.ts:426-439` |
| **VG1.6** | S1/K3 | Frontend drift | `dto_shapes` asserts `body_markdown` typed | `dto_shapes.test.ts:143-159` |
| **VG2.1** | S2 | Rust unit | `derive_excerpt`: collapse/trim/≤200/char-safe/empty→"" | new test mod (rebuild.rs or util) |
| **VG2.2** | S2 | Rust integ (anti-shallow) | create note(multi-line) → refresh → `list_notes_fn` ⇒ that note's `excerpt == Some(derive_excerpt(body))` (schema→rebuild→query→DTO proven) | `bridge.rs` (new) |
| **VG2.3** | S2 | Rust integ (migration) | open old-schema index → `schema::apply` no-crash, `PRAGMA table_info` has `excerpt`, `list_notes` succeeds; apply twice = idempotent | `jin-core` index test |
| **VG2.4** | S3 | Frontend (anti-shallow) | `renderNotesList` ⇒ `.note-row__snippet`==excerpt AND `.note-row__date` formatted non-empty | `notes_controller.test.ts` (new) |
| **VG2.5** | S3 | Frontend unit | `formatNoteDate` Today/Yesterday/MMM D/MMM D, YYYY (injected `now`) | `notes_controller.test.ts` (new) |
| **VG2.7** | S3 | Frontend regression | existing title/status/tags/count/click tests green | `notes_controller.test.ts:306-374` |
| **VG2.8** | S3 | Manual (owner) | flat Apple-Notes rows; bubble gone; Tasks/Events unchanged | `cargo tauri dev` |
| **VG-K1** | K1 | Rust integ | pre-existing notes get excerpts after one init/open (version-gated rebuild) | `jin-core` test |
| **VG-K2** | K2 | Frontend | production `#tmpl-note-row` contains snippet/date hooks | new test parsing `index.html` |

**Project-level command gates (all must pass):** `cargo test -p jin-core` · `cargo test` (jin-gui bridge) · `cargo clippy --all-targets -- -D warnings` · `npm test` (vitest) · TS typecheck/build. No `#[ignore]`, no `it.skip` on the gates above.

---

## 6. SEAMS FOR WAVE 2 (folders + Obsidian editor)

| Seam | Wave-1 stance | Wave-2 plug-in point |
|---|---|---|
| **get_note body source** | Reads from stored `NoteRow.file_path` (D3), not by reconstructing a flat-dir path. | Folder-safe already: a note in a subdir has its `file_path` stored at rebuild; no rework. |
| **List DTO / row shape** | `NoteDto` already a superset (id/title/status/dates/tags/links/backlinks/body_markdown/excerpt). Row template has a meta line. | Add `folder_path`/`rel_path` to `NoteRow` + `notes` table + `NoteDto`; render a folder chip/breadcrumb on the existing meta line — additive. |
| **Query signature** | `api::list_notes(root, include_deleted, tag)` and `query::list_notes_by_tag(conn, include_deleted, tag)` are positional but additive-friendly. | Add an optional `folder_filter`/`recursive` param; no row-render assumptions about flatness baked in. |
| **Store recursion** | `fs::list_note_paths` non-recursive (fs.rs:83-97); `find_note_path` matches by stem prefix (fs.rs:100-109). The rebuild loop (rebuild.rs:33-55) iterates whatever paths it's given. | Make `list_note_paths` recursive (walk subdirs); excerpt/rebuild flow through unchanged because they operate per-path. |
| **excerpt column** | Folder-agnostic. | No rework when folders land. |
| **Obsidian live editor** | Detail body comes fresh from disk each `get_note`; K1 startup rebuild reflects external edits. | Editor uses existing `edit_note` (ops/notes.rs:74); detail already re-reads canonical disk. No Wave-1 blocker. |

**Anti-corner check:** nothing in Wave 1 assumes a flat namespace in a way that would force a rewrite. The only flat assumptions live in `fs.rs` (already isolated) and become recursive in Wave 2 without touching the excerpt/DTO/render layers.

---

## 7. RISK FLAGS

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | Schema migration on pre-existing `index.sqlite` — `CREATE TABLE IF NOT EXISTS` won't add the column → `no such column: excerpt` crash for current users. | P0 | D5 step 1 (guarded ALTER, MANDATORY) + VG2.3. |
| R2 | Test fixture template (notes_controller.test.ts:115-130) is a SEPARATE string from production `#tmpl-note-row` (index.html:1268-1280) — frontend tests can be green while production HTML diverges (a known green-but-shallow trap on this repo). | P1 | S3 step 3 (update both in lock-step) + K2 parity guard. |
| R3 | Stale-empty snippets for pre-existing notes (no startup refresh; index only rebuilt on mutations). | P1 | K1 version-gated one-time rebuild. |
| R4 | Shared `.browse-row*` CSS/template blast radius — restyling bare `.browse-row__inner` would also restyle Tasks/Events rows. | P1 | S3 step 5 decision: scope the Apple-Notes flat look under `.note-row` selectors; leave Tasks/Events unchanged in Wave 1. |
| R5 | `get_note` behavior change (D3): error instead of silent-success when the file is missing. | P2 | Documented; index row implies a file at last rebuild; surfaces real inconsistency. |
| R6 | Existing `dto_shapes`/`notes_controller` tests treat body as optional and feed it by hand — must not be the only body coverage. | P1 | VG1.1 + VG1.4 add real round-trips; K3 tightens the shape test. |

---

## 8. CONFIDENCE REPORT

| Factor (25%) | Score | Note |
|---|---|---|
| Pattern match | 0.85 | Adding a column + DTO field mirrors existing `due`/`list_name`; ADAPT. |
| Requirement clarity | 0.90 | Owner locked decisions; the one delegated decision (snippet source) resolved with evidence. |
| Decomposition stability | 0.85 | 3 decompositions (by concern / by layer / by feature) converge on the same files + two backend changes + one frontend change (≥70%). |
| Constraint compliance | 0.85 | Anti-shallow gates, XSS preserved, Wave-2 seams, migration risk surfaced. |
| **Overall** | **0.86** | **AUTO_PROCEED.** Residual risk = excerpt population for existing notes (K1, flagged with a concrete path). |

**Recommended build order:** S1 → S2 → (K1 ∥ S3) → K2 → K3. Start with S1 (P0, fully headless-verifiable via VG1.1).
