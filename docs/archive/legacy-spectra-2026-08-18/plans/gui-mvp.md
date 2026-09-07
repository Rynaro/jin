---
eidolon: spectra
version: 4.10.0
kind: spec
status: ready-for-build
created_at: 2026-06-27T00:00:00Z
decisions_source: [ADR-0001, ADR-0002, ADR-0003, ADR-0004, mvp-integrated-thin-slice]
target_repos:
  - jin
thread_id: 6a9a8db3-2548-4f5b-b922-01856fdb9e90
evidence_anchors_count: 6
stories_count: 9
validation_gates_count: 8
complexity: 10            # /12
confidence: 0.87
decision: AUTO_PROCEED
---

# Jin GUI MVP — "Apple-Aesthetic Tauri Consumer" Build Specification

> **Codename:** Jin · **Mode:** SPECTRA / standard-tier planning cycle · **Date:** 2026-06-27
> **Type:** REQUEST (architecture fixed by ADR-0003; full GUI build spec) · **Complexity:** 10/12 (extended reasoning)
> **Status:** Decision-ready, pending the `[USER-DECISION]` ledger (§9). The runtime/contract is settled by ADR-0003; this spec decomposes the *presentation layer* and the *command bridge* — it does not re-open the runtime decision.
> **Audience:** the owner (sole approver, Linux daily-driver + macOS) + the Eidolons pipeline (Vivi to build, Kupo for micro-tasks, VIGIL on regression gates, IDG to chronicle).

This spec produces the GUI MVP for Jin: a **Tauri 2.11.x** desktop app that is a **pure consumer** of the already-built, verified `jin-core` crate (P3 — never a logic fork). It mirrors the CLI hero flow visually with Apple HIG / Liquid Glass rigor approximated on web tech, and it preserves VG4 (consumers never touch SQLite). **No code is produced here — this is a specification.**

---

## 0. Pre-flight & inputs

- **CLARIFY:** ran, no blocking questions. Intent unambiguous (build the GUI MVP), constraints explicit (Tauri + DTO consumer + headless build + Node-16 flag + hero-flow-visual), context sufficient (all four ADRs + the thin-slice plan read). All genuinely-open choices are *taste/preference* items routed to the `[USER-DECISION]` ledger (§9) with provisional recommendations rather than synchronous questions — per the mandate ("Give provisional recommendations").
- **Conventions:** no `.spectra/setup/spectra-conventions.md` present → generic SPECTRA vocabulary; project nouns (`jin-core`, DTO envelope, the `note/task/event` triangle) taken from the thin-slice plan and ADRs.
- **Memory:** CRYSTALIUM `mcp__crystalium__*` tools unavailable in this environment → recall/ingest/session_end gracefully skipped (EIIS-standalone-conformant).
- **Pattern strategy:** **ADAPT**. The thin-slice plan + ADR-0003 are ≥85% templates for the *DTO contract, exit-code taxonomy, and hero flow* (reused verbatim). The *view structure + design-system token mapping* is **GENERATE** (new territory), with `design.md` as the aesthetic north star.
- **Evidence anchors:** `design.md` (HIG/Liquid Glass north star); `docs/adr/0003-runtime-and-gui-contract.md` (Tauri + in-process crate + VG4 + WebKitGTK-vs-WKWebView risk); `.spectra/plans/mvp-integrated-thin-slice.md` (DTOs, verbs, exit codes, hero flow); ADR-0001/0002/0004 (model + storage + sync invariants the DTOs project).

---

## 1. Scope

### 1.1 The hero flow, made visual (the one end-to-end demonstration)

> Open Jin to the **Today/Agenda home** → see today's events (personal-local + company-Google merged) → for a **promoted** event, see its **originating task** inline and reach its **prep notes** → **capture** a note/task/event → **promote** a task to an event → **attach** a note to that event → trigger a **sync** (with auth status visible) → all surfaced through the same `jin-core` DTOs the CLI uses.

This is the CLI hero flow (thin-slice §1.1) rendered as a UI. Every triangle edge (note↔task, task↔event, note↔event reachability, local+Google) and the sovereignty principle are visible in one screen plus its reachable details.

### 1.2 Complexity — 10/12 (extended reasoning)

| Dimension | Score | Rationale |
|---|---|---|
| **Scope** | 3 | The whole presentation layer + the Rust command bridge: 6 views, a design-system token system, the `#[tauri::command]` surface, a frontend-stack decision, and a headless-aware verification approach. |
| **Ambiguity** | 2 | Runtime/contract fixed by ADR-0003. Residual ambiguity is *design taste* (nav, font, framework, Node) — routed to the `[USER-DECISION]` ledger, not architectural unknowns. |
| **Dependencies** | 3 | `jin-core` DTOs + Tauri 2.11 IPC + cross-platform CSS glass (WebKitGTK vs WKWebView) + Node-version/toolchain + (for Settings) the OAuth loopback flow. |
| **Risk** | 2 | Mostly **P1** (degrades experience), not data-integrity P0 — the core is verified and the GUI is a pure consumer. The two live risks are *visual fidelity is unverifiable in a headless build* and *cross-platform glass rendering divergence* (ADR-0003 RISK). |

**Total 10/12** → extended reasoning engaged; the `[USER-DECISION]` items in §9 are the human-in-the-loop hooks.

### 1.3 In scope (the recommended MVP scope — ONE opinionated set)

Six views + three cross-cutting actions, plus the bridge and the verification harness:

1. **Today / Agenda home** — the hero view. Launch destination.
2. **Notes** browse + detail.
3. **Tasks** browse + detail.
4. **Events** browse + detail.
5. **Capture / Create** — a global quick-capture affordance + full create forms for note/task/event.
6. **Sync & Settings** — Google auth status + login/logout, run sync (progress + last-synced + conflict count → audit), export, and appearance/accessibility controls.

Cross-cutting actions surfaced where contextually appropriate: **promote** (task→event), **attach** (note→target), **link** (typed edge).

### 1.4 Out of scope (GUI MVP)

A from-scratch calendar grid/month view, drag-to-reschedule, time-blocking, NLP quick-add parsing, notifications/reminders UI, AI features, collaboration/presence, free/busy, attendee/organizer editing, theming beyond light/dark + accessibility modes, in-app GCP-project provisioning automation (the wizard *instructs*, it does not automate Google Cloud setup).

### 1.5 Explicitly deferred — NOT built now, NOT foreclosed

| Deferred item | Why deferred | What keeps it open |
|---|---|---|
| **Recurrence editing/creation** | Core mirrors recurring events read-only (`recurrence_unexpanded`); write is deferred core-side. GUI must **display** them labelled, never offer an edit affordance. | `EventDto` carries `recurrence_unexpanded`; the agenda labels them. A future editor is additive. |
| **Rich / block notes editor** | MVP renders Markdown and edits raw text (or a simple textarea). | `NoteDto.body_markdown` is the contract; a block editor is a later view swap, no DTO change. |
| **Multi-device / mobile** | Single machine for MVP; Tauri 2 mobile target deferred (ADR-0003 `[ASSUMPTION]`). | Pure-consumer architecture + responsive layout primitives (8pt grid, reflow) keep a mobile target reachable. |
| **Multi-account / multi-calendar UI** | Core MVP is single configured `calendar_id`. | `EventDto.calendar_id`/`source`/`authority` are surfaced so a future picker is additive. |
| **Offline conflict-resolution UI** | Core resolves conflicts deterministically + audits; MVP GUI only **surfaces** counts + links to the audit log. | `SyncResultDto.conflicts` + `audit_path` are the contract. |

**Builder guardrail:** if a story tempts you to implement any deferred item (a calendar grid, a recurring-event editor, a block editor), stop — it is out of scope **by decision**, not by omission.

---

## 2. Fixed architectural invariants (guardrails, not decisions)

Restated so the builder can self-check; each traces to ADR-0003 or the thin-slice plan. **Do not re-litigate.**

1. **The GUI is a pure consumer of `jin-core`.** The Tauri backend links the *same compiled crate* in-process and invokes its public ops. There is **zero business logic** in the command layer — it only (de)serializes and forwards. *(ADR-0003 DEC-04, P3.)*
2. **No GUI-reads-SQLite — VG4 holds.** Only `jin-core` opens `index.sqlite`; the schema is private. The frontend obtains data **exclusively** through `#[tauri::command]` wrappers returning DTOs. Any direct SQLite/file access from the frontend or the command layer is a VG4 violation. *(ADR-0003 D6.)*
3. **DTOs are the only boundary.** Commands return the **existing serde DTOs** in the existing envelope `{ "jin_dto_version": "1", "kind": <...>, "data": {...}, "warnings": [] }` — model projections, never raw rows. The frontend never sees storage internals. *(thin-slice S3, ADR-0003.)*
4. **The CLI verb grammar is the canonical surface to mirror.** GUI commands map 1:1 onto the CLI verbs (`today`, `note/task/event {list,show,add,edit,rm}`, `promote`, `attach`, `link`, `capture`, `sync`, `export`, plus auth). No new logical capability is invented in the GUI. *(thin-slice S3.)*
5. **Exit-code semantics map to error states, not to logic.** The core's exit-code taxonomy (`0/2/3/4/5/6/7/1`) becomes the frontend's typed error states. The GUI never *decides* policy; it *renders* what the core returns. *(thin-slice S3.)*
6. **Apple aesthetic is approximated, not native.** Web tech (CSS `backdrop-filter`/vibrancy) approximates Liquid Glass; this is explicitly NOT SwiftUI. Cross-platform divergence (WebKitGTK on Linux vs WKWebView on macOS) is an accepted, flagged risk with mandated fallbacks. *(ADR-0003 D7 + RISK.)*
7. **Accessibility fallbacks are mandatory, not optional.** Reduced-transparency, increased-contrast, and reduced-motion paths are first-class (HIG mandate) — and because WebKitGTK media-query support is inconsistent, each also has a **manual in-app toggle**. *(design.md Part I/II accessibility.)*

**Settled inputs:** Tauri `2.11.x`; `jin-core` consumed in-process; DTO envelope + exit codes from the thin-slice plan; the DTO field shapes (NoteDto/TaskDto/EventDto/AgendaDto/AgendaEventDto with `originating_task` + `prep_notes`) per §4.2.

---

## 3. Information architecture & navigation (per HIG)

### 3.1 The shell — a NavigationSplitView analog

Desktop-first, content-leads-chrome **deference**:

```
┌──────────────┬───────────────────────────────┬────────────────────┐
│  SIDEBAR     │  CONTENT (primary column)     │  DETAIL (optional) │
│  (glass,     │                               │                    │
│   inset)     │  list / browse / Today        │  selected item     │
│              │                               │                    │
│  ● Today     │  ◀ scrolls beneath floating   │  pushes/replaces   │
│  ○ Notes     │     toolbar (soft scroll-edge)│  on selection      │
│  ○ Tasks     │                               │                    │
│  ○ Events    │                               │                    │
│  ──────────  │                               │                    │
│  ⚙ Settings  │                               │                    │
│  [+ Capture] │  (toolbar: title + actions)   │                    │
└──────────────┴───────────────────────────────┴────────────────────┘
```

- **Three-column on wide windows; collapses to two then one on narrow** (responsive, driven by container width breakpoints — no separate mobile layout in MVP).
- **Sidebar = HIG desktop pattern** (iPad/macOS, unlimited items, hierarchical). It uses a **glass material**, is **inset**, and content scrolls to the window edge *beneath* it (Liquid Glass sidebar behavior, design.md Part II). `[USER-DECISION UD1]` covers sidebar-vs-tab-bar taste; sidebar is the recommendation for a desktop daily-driver.
- **Today is pinned at the top and is the launch destination** (today-as-home). Selecting it never pushes a stack — it *is* home.
- **Global Capture affordance** lives at the sidebar foot (a prominent capsule "+ Capture" button) **and** is bound to a global shortcut (Cmd/Ctrl-N). It is reachable from every view (HIG: actions are not nav; capture is an action, so it is a floating control, never a sidebar nav item semantically).
- **Settings** sits at the sidebar foot, visually separated by a section break.

### 3.2 Chrome behavior (deference + depth)

- **Floating, glass chrome above content.** Toolbar and sidebar float on a Liquid-Glass layer; content has spatial separation beneath them (design.md Part II "controls as a functional layer").
- **Soft scroll-edge effect** where the floating toolbar overlaps scrolling content (iOS-style soft, not macOS-hard — we are a web surface). Implemented as a gradient/blur mask, reduced-motion-aware.
- **Optional condensing toolbar** (large title → inline title on scroll). Nice-to-have; gate behind reduced-motion. `[SPEC]`.
- **Navigation stack within the content column** for browse→detail (push/pop with a directional transition that communicates hierarchy — design.md "motion is informational"). Reduced-motion → crossfade/instant.

### 3.3 Per-view IA summary

| View | Primary column | Detail | Key DTO |
|---|---|---|---|
| **Today** | Date-scoped agenda list (sorted by start; all-day grouped) | Event detail (with originating task + prep notes) | `AgendaDto` → `AgendaEventDto` |
| **Notes** | List (title, snippet, tags, updated) | Rendered Markdown + frontmatter + links/backlinks | `NoteDto` |
| **Tasks** | List (filter: status/list/priority) | State controls + due/priority + links; **Promote** action | `TaskDto` |
| **Events** | List (range) | Temporal display (tz-aware) + source/authority badge + originating task + prep notes; **Attach** target | `EventDto` |
| **Capture/Create** | Quick-capture sheet (text → note default; `--task` toggle; list) + full forms | n/a (sheet/modal) | `CaptureResultDto`, create DTOs |
| **Sync & Settings** | Auth status, Run Sync, Export, Appearance/A11y | n/a | `AuthStatusDto`, `SyncResultDto`, `ExportResultDto` |

---

## 4. Tauri command surface (the bridge)

### 4.1 Bridge architecture — typed command-per-verb (recommended; `[FORGE F1]`)

Each CLI verb gets **one typed `#[tauri::command]` wrapper** that calls the corresponding `jin-core` op and returns the existing DTO inside the existing envelope. This preserves discoverability and type-safety and keeps the bridge a pure marshalling layer (invariant §2.1).

**Error model.** `jin-core` ops return `Result<Dto, JinError>`. Each command maps that to Tauri's `Result<EnvelopeDto, JinErrorDto>`, where `JinErrorDto` carries the **exit-code-equivalent** so the frontend renders the correct error state:

```
JinErrorDto {
  code: 3|4|5|6|7|1,        // mirrors the CLI exit-code taxonomy (0=ok is the Ok arm)
  kind: "not_found" | "sync_conflict" | "auth" | "offline" | "integrity" | "other",
  message: string,          // human-readable, already localized by core if applicable
  retriable: boolean,       // true for offline(6); false for not_found(3)
  detail?: object           // optional structured payload (e.g. conflict count, audit_path)
}
```

| Core code | `kind` | Frontend error state |
|---|---|---|
| `3` | not_found | Empty / "not found" state in the affected column |
| `4` | sync_conflict | Conflict banner + "View audit log" link (no destructive prompt) |
| `5` | auth | Re-auth prompt → deep-link to Settings → Google |
| `6` | offline | Persistent offline indicator; **local writes still succeed** (core enqueues outbox); sync shows "queued" |
| `7` | integrity | Diagnostic state: "Index needs repair — run `jin doctor`" |
| `1` / `2` | other / usage | Generic non-blocking toast (usage(2) should not occur via typed commands) |

**VG4 preservation.** The command layer imports *only* `jin-core`'s public ops + DTO types. It never imports `rusqlite`, never opens a file or DB, never constructs SQL. A bridge test asserts the command crate's dependency graph excludes any direct SQLite/filesystem-store access (VG4 regression).

### 4.2 The command list (returns existing DTOs in the existing envelope)

All return `Envelope<T> = { jin_dto_version: "1", kind, data: T, warnings: string[] }` on success, `JinErrorDto` on failure. All commands are **`async`** (`[GAP G2]` — confirm core op sync/async at build; async commands avoid blocking the webview regardless).

**Read / agenda**
- `today_agenda(date: Option<String /*ISO date*/>) -> AgendaDto` — the hero. `date` defaults to today in `config.display_tz`.
- `list_notes(filter: NoteFilter) -> Vec<NoteDto>` · `get_note(id) -> NoteDto`
- `list_tasks(filter: TaskFilter) -> Vec<TaskDto>` · `get_task(id) -> TaskDto`
- `list_events(range: DateRange) -> Vec<EventDto>` · `get_event(id) -> EventDto`

**Create / edit / soft-delete** (file-truth ordering enforced by core)
- `create_note(input: NoteInput) -> NoteDto` · `edit_note(id, patch) -> NoteDto` · `delete_note(id) -> NoteDto /*tombstone*/`
- `create_task(input: TaskInput) -> TaskDto` · `edit_task(id, patch) -> TaskDto` · `set_task_status(id, status) -> TaskDto /*state machine: todo/doing/done/cancelled/reopen*/` · `delete_task(id) -> TaskDto`
- `create_event(input: EventInput) -> EventDto` · `edit_event(id, patch) -> EventDto` · `delete_event(id) -> EventDto`

**Linking / promotion**
- `promote_task(task_id, when: TemporalSlot) -> EventDto` — new event with `derived_from` edge; task file byte-unchanged (VG6 lives in core).
- `attach_note(note_id, target_id, kind: Option<EdgeKind>) -> LinkResultDto` — default `prep-for` for Event, `references` for Task/Note.
- `link(source_id, target_id, edge_type: EdgeKind) -> LinkResultDto` — vocabulary-validated; rejects edges outside the three allowed signatures (core enforces; GUI surfaces the rejection).
- `capture(text, as_task: bool, list: Option<String>) -> CaptureResultDto { kind: "note"|"task", id }`

**Sync / auth / export**
- `run_sync() -> SyncResultDto` — drives the core sync state machine; returns counts + cursor.
- `auth_status() -> AuthStatusDto` · `auth_login() -> AuthStatusDto` (PKCE + loopback; opens system browser) · `auth_logout() -> AuthStatusDto`
- `export(dest: String) -> ExportResultDto` — canonical files + `audit.jsonl`; excludes index/sync-state/tokens.
- `app_config() -> AppConfigDto { root_path, display_tz, calendar_id, schema_version }` — read-only surface for Settings.

### 4.3 DTO shapes the GUI consumes (`[ASSUMPTION A1]` — these mirror `jin-core`'s existing serde DTOs; confirm exact field names at build)

```
NoteDto      { id, type:"note", title, body_markdown, tags[], created, updated,
               status, links[]: Edge, backlinks[]: Edge }
TaskDto      { id, type:"task", title, status, priority, due?, list, completed_at?,
               created, updated, links[], backlinks[], derived_event?: id }
EventDto     { id, type:"event", title, description?, location?,
               start, end, start_value_type, end_value_type, is_all_day,
               start_tzid?, end_tzid?, floating, recurrence_unexpanded,
               ical_uid, status, source:"jin"|"google", authority:"jin"|"google",
               calendar_id, derived_from?: task_id,
               prep_notes[]: NoteRef, backlinks[] }
AgendaEventDto { event: EventDto /*projection subset ok*/,
                 originating_task?: TaskRef { id, title, status },
                 prep_notes[]: NoteRef { id, title } }
AgendaDto    { date, display_tz, items[]: AgendaEventDto, warnings[] }
SyncResultDto{ pushed, pulled, conflicts, last_synced_at?, audit_path }
AuthStatusDto{ state:"connected"|"disconnected"|"needs_reauth", account?, scopes[], expires_at? }
LinkResultDto{ edge_type, source_id, target_id }
ExportResultDto { dest, file_count, included_audit: bool }
Edge         { type: EdgeKind, target: id, direction:"out"|"in" }
EdgeKind     = "derived-from" | "prep-for" | "references"
```

`originating_task` and `prep_notes` on `AgendaEventDto` are the **load-bearing fields for the hero flow** — they are how the Today view surfaces the promoted task and reachable prep notes without the frontend ever traversing edges itself (the core resolves backlinks in-index). Confirm these exact projections exist in `jin-core/src/dto/agenda.rs` (per thin-slice S7) at GUI-S0.

---

## 5. Design-system token spec (concrete web mapping of `design.md`)

All tokens are CSS custom properties on `:root`, switched by `prefers-color-scheme` **and** a manual `[data-appearance="light|dark|auto"]` attribute. Components reference **role tokens only** — never raw hex (design.md "semantic, not hex"; hardcoding is the anti-pattern).

### 5.1 Type scale — the 11 text styles → CSS

`pt` mapped 1:1 to `px` at the base, expressed in **`rem`** so Dynamic-Type-equivalent scaling works by changing the root size (§5.7). Values per design.md's documented defaults (Body = 17/22).

| Style | size | line-height | weight | `--type-*` token (size / line) |
|---|---|---|---|---|
| Large Title | 34 | 41 | 400 | `2.125rem / 2.5625rem` |
| Title 1 | 28 | 34 | 400 | `1.75rem / 2.125rem` |
| Title 2 | 22 | 28 | 400 | `1.375rem / 1.75rem` |
| Title 3 | 20 | 25 | 400 | `1.25rem / 1.5625rem` |
| Headline | 17 | 22 | 600 | `1.0625rem / 1.375rem` |
| Body | 17 | 22 | 400 | `1.0625rem / 1.375rem` |
| Callout | 16 | 21 | 400 | `1rem / 1.3125rem` |
| Subheadline | 15 | 20 | 400 | `0.9375rem / 1.25rem` |
| Footnote | 13 | 18 | 400 | `0.8125rem / 1.125rem` |
| Caption 1 | 12 | 16 | 400 | `0.75rem / 1rem` |
| Caption 2 | 11 | 13 | 400 | `0.6875rem / 0.8125rem` |

Rules from design.md: **no full justification**, **avoid Ultralight/Thin/Light for UI legibility**, **hierarchy must survive text-size changes** (use the named styles, not ad-hoc sizes).

**Font stack** (`[USER-DECISION UD3]`):
```css
--font-text: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             "Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", monospace;
```
- On **macOS WKWebView**, `-apple-system` resolves to the **real San Francisco** — free, correct, native.
- On **Linux WebKitGTK**, it falls through to a bundled **Inter** (SIL OFL 1.1 — *free to embed and redistribute*), the closest open near-SF face, then `system-ui`.
- **Font-licensing note:** **Do NOT bundle SF Pro / SF Mono / New York** — they are licensed for Apple-platform UI only; shipping them on Linux violates the license. Inter is the legal cross-platform fallback. New York (serif) is **skipped** for MVP.

### 5.2 Semantic color roles — light / dark adaptive

Role tokens (Apple's published system values; dark is **not** a naive inversion — two background tiers for depth):

| Role token | Light | Dark (base / elevated) |
|---|---|---|
| `--label` | `rgba(0,0,0,1)` | `rgba(255,255,255,1)` |
| `--label-secondary` | `rgba(60,60,67,0.6)` | `rgba(235,235,245,0.6)` |
| `--label-tertiary` | `rgba(60,60,67,0.3)` | `rgba(235,235,245,0.3)` |
| `--label-quaternary` | `rgba(60,60,67,0.18)` | `rgba(235,235,245,0.16)` |
| `--bg-base` | `#FFFFFF` | `#000000` |
| `--bg-secondary` | `#F2F2F7` | `#1C1C1E` |
| `--bg-tertiary` | `#FFFFFF` | `#2C2C2E` |
| `--bg-elevated` (sheets/sidebar) | `#FFFFFF` | `#1C1C1E` → `#2C2C2E` → `#3A3A3C` (tiers) |
| `--separator` | `rgba(60,60,67,0.29)` | `rgba(84,84,88,0.6)` |
| `--separator-opaque` | `#C6C6C8` | `#38383A` |
| `--fill-primary` | `rgba(120,120,128,0.2)` | `rgba(120,120,128,0.36)` |
| `--accent` (`systemBlue`) | `#007AFF` | `#0A84FF` |
| `--system-red` | `#FF3B30` | `#FF453A` |
| `--system-green` | `#34C759` | `#30D158` |
| `--system-orange` | `#FF9500` | `#FF9F0A` |
| `--system-yellow` | `#FFCC00` | `#FFD60A` |
| `--system-indigo` | `#5856D6` | `#5E5CE6` |

Dark Mode uses **base** (`#000000`) for the root window and **elevated** tiers for layered surfaces (sheets, the floating sidebar) — this is how depth is conveyed without shadows-only (design.md Part I "Dark Mode"). Contrast targets: **4.5:1** standard, **7:1** small text.

### 5.3 Liquid Glass approximation — the real-time-material analog

Three material layers approximating Apple's material set, each = translucent tint + blur + saturation boost + specular edge + elevation shadow:

```css
/* shared */
--specular-highlight: rgba(255,255,255,0.5);          /* light */
--glass-saturate: 180%;

.material-thin    { --_blur: 20px; }
.material-regular { --_blur: 30px; }
.material-thick   { --_blur: 50px; }

.material-thin, .material-regular, .material-thick {
  background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
  -webkit-backdrop-filter: blur(var(--_blur)) saturate(var(--glass-saturate));
          backdrop-filter: blur(var(--_blur)) saturate(var(--glass-saturate));
  border: 0.5px solid var(--separator);                /* hairline edge */
  box-shadow: inset 0 1px 0 0 var(--specular-highlight),   /* specular top edge */
              0 8px 24px rgba(0,0,0,0.18);              /* elevation depth */
}
```
- Dark mode lowers `--specular-highlight` to `rgba(255,255,255,0.12)` and the tint mix accordingly.
- **Vibrancy** for text/icons on glass: tier labels by opacity (`--label` / `--label-secondary`) rather than `mix-blend-mode` (unreliable on WebKitGTK).
- **Both `-webkit-` and unprefixed `backdrop-filter`** are required (WebKitGTK still wants the prefix).
- **Cross-platform caveat (`[FORGE F2]`, ADR-0003 RISK):** blur quality and GPU cost differ between WKWebView (macOS) and WebKitGTK (Linux). The **reduced-transparency fallback (§5.4) is also the safety net** if Linux blur is poor or slow — the owner verifies on their Linux desktop and may choose to default glass→solid on Linux.

### 5.4 The three HIG-mandated accessibility fallbacks

Each is a **media query AND a manual `[data-*]` toggle** (because WebKitGTK media-query support is inconsistent — `[GAP G1]`):

```css
/* Reduced transparency → opaque, drop the blur */
@media (prefers-reduced-transparency: reduce) { :root { --reduce-transparency: 1; } }
[data-reduce-transparency="1"] .material-thin,
[data-reduce-transparency="1"] .material-regular,
[data-reduce-transparency="1"] .material-thick {
  background: var(--bg-secondary);
  -webkit-backdrop-filter: none; backdrop-filter: none;
}

/* Increased contrast → stark separators, drop subtle fills */
@media (prefers-contrast: more) { :root { --increase-contrast: 1; } }
[data-increase-contrast="1"] { --separator: var(--separator-opaque);
                               --label-secondary: var(--label); }

/* Reduced motion → instant / crossfade only */
@media (prefers-reduced-motion: reduce) { :root { --reduce-motion: 1; } }
[data-reduce-motion="1"] * { animation: none !important;
                             transition-duration: 0ms !important; }
```
Settings (§GUI-S7) exposes all three as explicit switches, mirroring iOS 26.1's tinted-glass control philosophy.

### 5.5 8pt spacing grid (4pt subdivision)

```css
--space-0: 0;     --space-half: 4px;  --space-1: 8px;   --space-2: 16px;
--space-3: 24px;  --space-4: 32px;    --space-5: 40px;  --space-6: 48px;  --space-8: 64px;
```
The single ironclad rule (design.md): all spacing is a multiple of 8 with 4 as the only subdivision.

### 5.6 Concentric corner radii + capsules + 44pt targets

```css
--radius-xs: 6px;  --radius-sm: 8px;   --radius-md: 12px;
--radius-lg: 16px; --radius-xl: 20px;  --radius-capsule: 9999px;
--hit-target: 44px;     /* HIG 44×44 minimum */

/* concentric formula: outer = inner + padding  →  nested radius derives DOWN */
.nested { border-radius: max(0px, calc(var(--radius-container) - var(--inset-padding))); }
```
- **Buttons/switches/segmented controls → capsule** (`--radius-capsule`, radius = half height).
- **Cards/sheets → fixed** (`--radius-md`/`--radius-lg`).
- **Nested elements → concentric** via the formula (anti-pattern: a nested radius that doesn't follow it — "pinched/flared" corners).
- Every interactive element has `min-block-size: var(--hit-target); min-inline-size: var(--hit-target);` (or padding to reach it). 44px is kept even for pointer (desktop) for harmony and future touch.

### 5.7 Dynamic-Type-equivalent scaling

Browsers don't expose Apple Dynamic Type, so Settings provides a text-size control that sets a root multiplier; because all type tokens are `rem`, everything scales together and layout must **reflow, not clip** (HIG mandate):
```css
:root { font-size: calc(16px * var(--dynamic-type-scale, 1)); }
/* scale steps mirror the 7 standard + 5 AX sizes */
/* xSmall .82 · Small .88 · Medium .94 · Large 1.0(default) · xLarge 1.12 · xxLarge 1.24 ·
   xxxLarge 1.35 · AX1 1.6 · AX2 1.9 · AX3 2.35 · AX4 2.75 · AX5 3.1 */
```
Layouts use flex/grid with wrapping; no fixed-height text containers; truncation only with explicit tooltips. The owner verifies reflow at AX sizes visually.

### 5.8 Motion as information

```css
--duration-fast: 150ms; --duration-base: 250ms; --duration-slow: 350ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* spring-out */
--ease-emphasized: cubic-bezier(0.3, 0, 0, 1);
```
Transitions communicate hierarchy: detail push = directional slide (from the originating side); sheets spring from their triggering control's anchor (design.md "action sheets spring from their action"); the agenda's date change = horizontal slide matching direction. **All gated by `--reduce-motion`** → crossfade or instant.

### 5.9 Iconography (`[USER-DECISION UD6]`)

**SF Symbols cannot be used** (Apple-platform-licensed). Recommend **Lucide** (ISC license, tree-shakeable SVG, clean SF-adjacent stroke weights) as the cross-platform set. Match icon weight to adjacent text weight manually (set SVG `stroke-width` relative to font weight) since the automatic SF-Symbols weight-matching is unavailable. Maintain a single style (outline) within a context (HIG guideline). Alternatives: Phosphor, Tabler — owner's call.

### 5.10 Accessibility baseline (non-negotiable)

- **ARIA labels** on every interactive element, every meaningful icon, every custom control (screen-reader parity: Orca on Linux, VoiceOver on macOS).
- **Keyboard navigation** end-to-end; visible `:focus-visible` ring (not color-only).
- **Color independence** — every state also carries an icon/shape/text (e.g. task status = color **and** glyph **and** label; source = badge text "Google"/"Local", not color alone).
- **Contrast** 4.5:1 / 7:1 enforced; verified against both appearances.
- **Dynamic-Type-equivalent** reflow at all 12 steps (§5.7).

---

## 6. Frontend stack recommendation (pragmatic, given Node 16 + cross-platform + Apple aesthetic)

### 6.1 Framework — **Svelte 5 + Vite + TypeScript** (recommended; `[USER-DECISION UD4]`)

| Option | Bundle / runtime | Aesthetic fit | Verdict |
|---|---|---|---|
| **Vanilla TS + Vite** (framework-light) | Smallest; zero runtime | Best deference, but you hand-roll reactivity/routing → slower to build 6 views | Strong fallback; more boilerplate |
| **Svelte 5 + Vite** (recommended) | Tiny compiled output, no virtual DOM | Excellent for motion-as-information + small bundle; scoped CSS suits the token system; reactivity for free | **Recommended** |
| **Solid + Vite** | Tiny, fine-grained reactive | Great perf; smaller ecosystem; JSX | Viable alternative |
| **React + Vite** | Heaviest runtime + largest bundle | Overkill for a desktop MVP; weakest deference/bundle fit | Not recommended for MVP |

**Why Svelte:** smallest runtime of the framework options (best honors "deference" and Tauri's lean ethos), compile-time reactivity, first-class scoped CSS (clean home for the §5 token system), and excellent transition primitives (motion-as-information) that respect `prefers-reduced-motion`. This is a *taste* call → `[USER-DECISION UD4]`; the architecture (DTO consumer over `invoke`) is framework-agnostic, so a later swap is contained.

### 6.2 Build tooling — **Vite**

Vite is the de-facto Tauri 2 frontend bundler with first-class HMR for the `cargo tauri dev` loop. Version is coupled to the Node decision (§6.3).

### 6.3 Node decision — **upgrade Node 16 → 20 LTS** (recommended; `[USER-DECISION UD5]`)

- **Node 16 is EOL (since Sept 2023)** and below Tauri-2-frontend / modern-Vite expectations (Vite 5/6 want Node 18+).
- **Recommended:** upgrade to **Node 20 LTS** (via `nvm`/`fnm`/`volta`) — unblocks current Vite + Svelte 5 tooling and removes a security/maintenance liability. Pin via `.nvmrc` + `engines` in `package.json`.
- **If the owner declines the upgrade:** pin **Vite 4** (supports Node 14/16) and **Svelte 4** (Svelte 5 tooling assumes newer Node) — a workable but aging path. Document the pin and the EOL risk.
- **Note:** the **Tauri CLI itself is a Rust binary** (`cargo tauri` / `tauri-cli`), so the *backend* build and `cargo tauri dev` do not depend on Node — only the **frontend dev server (Vite) + npm deps** care about the Node version. This narrows the blast radius of the Node choice to the frontend toolchain only.

### 6.4 DTO type sharing (`[SPEC SP1]`)

To keep the TS DTO types in lockstep with the Rust DTOs, recommend **codegen from Rust** (`ts-rs` or `specta`/`tauri-specta`) emitting `.ts` types from the `jin-core` serde structs. If codegen friction is high, hand-author TS mirrors **gated by a shape test** (GUI-S8) that round-trips a sample DTO from each command against the TS type. Never let the two drift silently.

---

## 7. Build & verification approach (headless-aware)

The build environment is **headless (no display)**. The team can compile and unit/integration-test the command bridge and the frontend *logic*, but **cannot render or visually verify the UI**. The owner verifies visuals on their Linux desktop via `cargo tauri dev`. This gates the whole spec:

### 7.1 What compiles + tests headless (CI-green = correct *logic*, NOT correct *visuals*)

- **The command bridge (Rust).** Each `#[tauri::command]` is exercised by Rust integration tests calling `jin-core` against a **temp root** (init → create → promote → attach → today → sync-with-cassette → export), asserting: DTO envelope shape, `originating_task`/`prep_notes` presence on the agenda, error→`JinErrorDto` mapping for codes 3/4/5/6/7, and the **VG4 dependency-graph check** (bridge crate links no SQLite/store internals).
- **Frontend logic units** (vitest/node, headless): DTO TS types, agenda transformation (sort-by-start, all-day grouping, recurring-unexpanded labelling), error-state mapping, date/tz formatting, capture/promote/attach payload construction, store/state reducers.
- **Token static checks:** CSS lint + a snapshot/assert that role tokens are defined for both appearances and that components reference role tokens only (no raw hex) — a stylelint rule, runnable headless.
- **Accessibility static checks:** ARIA-label presence and color-independence lint on component templates (e.g. axe-core in jsdom for static structure) — partial, headless.

### 7.2 What is **visual-only** (owner verifies via `cargo tauri dev` on Linux; never claimed by CI)

- Liquid-Glass rendering (blur quality, specular edge, vibrancy) and the **WebKitGTK-vs-WKWebView divergence**.
- Light/dark adaptive appearance + the two dark tiers; desktop-tint harmony.
- Motion/transitions and their `prefers-reduced-motion` behavior.
- **Dynamic-Type reflow** at the AX sizes (no clipping).
- Tap-target ergonomics; sidebar inset + soft scroll-edge effect; condensing toolbar.
- The OAuth loopback browser hand-off (system browser + 127.0.0.1 redirect) on the owner's machine.

### 7.3 The `cargo tauri dev` loop + the gate

- Owner runs `cargo tauri dev` on the Linux desktop: Rust changes recompile; the Vite dev server hot-reloads the frontend (Node-version-dependent, §6.3).
- **Gate (VG-GUI-8):** CI green proves the bridge + frontend logic are correct. A **separate owner sign-off** against the **Visual Verification Checklist (§7.4)** proves visual/aesthetic correctness. **No story may be marked "visually done" from a headless build** — the checklist is the only path to that claim.

### 7.4 Visual Verification Checklist (owner-run, per build)

Glass renders with legible vibrancy on Linux ☐ · light↔dark switch is correct (two dark tiers) ☐ · reduced-transparency toggle yields opaque legible surfaces ☐ · increased-contrast toggle yields stark separators ☐ · reduced-motion toggle stops all animation ☐ · Dynamic-Type at AX3 reflows without clipping ☐ · 44pt targets feel right ☐ · Today shows a promoted event's originating task + reachable prep notes ☐ · capture→promote→attach→sync round-trips visibly ☐ · OAuth loopback completes ☐.

---

## 8. Story decomposition

Hierarchy: **THEME** Jin (sovereign integrated notes+tasks+calendar) → **PROJECT** GUI MVP (Apple-aesthetic Tauri consumer) → **FEATURES** → **STORIES** (GUI-S0…S8). Each story: user story · timebox · risk tag · deps · GWT acceptance · technical context · agent hint · **headless-verifiable vs visual-only** flag.

```
FEATURE G-A  Bridge & scaffold        → GUI-S0
FEATURE G-B  Design system            → GUI-S1
FEATURE G-C  Shell & navigation       → GUI-S2
FEATURE G-D  Hero & browse            → GUI-S3, GUI-S4
FEATURE G-E  Create & actions         → GUI-S5, GUI-S6
FEATURE G-F  Sync & settings          → GUI-S7
FEATURE G-G  Verification (x-cutting) → GUI-S8
```

---

### GUI-S0 — Tauri scaffold + command bridge *(G-A · ≤5d · P0 · depends: jin-core built · **headless-buildable+testable**)*

**As** the owner, **I want** a Tauri 2.11 app that links `jin-core` in-process and exposes typed `#[tauri::command]` wrappers returning the existing DTOs **so that** the GUI has a verified, VG4-safe data spine before any pixel is drawn.

**Action plan:** scaffold the Tauri 2.11 workspace (Rust backend + chosen frontend, §6); add `jin-core` as an in-process dependency; implement the §4.2 command list as **pure marshalling** wrappers; define `JinErrorDto` + the exit-code→error-state mapping (§4.1); wire the DTO type-sharing path (§6.4); write Rust integration tests over a temp root + the VG4 dependency-graph check.

**Acceptance criteria**
- **GIVEN** the app starts, **WHEN** the frontend `invoke("today_agenda", {date})`, **THEN** it receives a valid `{ jin_dto_version:"1", kind:"agenda", data: AgendaDto, warnings:[] }` envelope sourced from `jin-core` (not from any direct DB/file read).
- **GIVEN** a `jin-core` op returns `Err`, **WHEN** the command returns, **THEN** the frontend receives a `JinErrorDto` carrying the correct `code`/`kind` (3/4/5/6/7) per §4.1.
- **GIVEN** the bridge crate, **WHEN** its dependency graph is inspected, **THEN** it links **only** `jin-core`'s public API — no `rusqlite`, no direct store/file access (VG4 regression test).
- **GIVEN** every §4.2 command, **THEN** each has a Rust integration test asserting envelope shape against a temp-root `jin-core`.
- **GIVEN** `today_agenda` for a day with a promoted event, **THEN** the returned `AgendaEventDto` includes `originating_task` and `prep_notes` (the hero-flow fields exist end-to-end).

**Technical context:** `src-tauri/src/commands/*.rs`, `src-tauri/src/error.rs`, `src-tauri/tests/bridge.rs`; `jin-core` in-process dep; DTO codegen (`ts-rs`/`specta`) or hand-mirrored TS + shape test.
**Agent hint:** Vivi (builder; reasoning-leaning for the error mapping). Kupo viable for the `JinErrorDto` enum + envelope struct.
**Verifiability:** **HEADLESS** (compiles + full bridge tests in CI).

---

### GUI-S1 — Design-system tokens + Liquid Glass + a11y fallbacks *(G-B · ≤3d · P1 · depends: GUI-S0 · mixed)*

**As** the owner, **I want** the §5 token system implemented as CSS variables with the glass materials and the three mandated accessibility fallbacks **so that** every view inherits Apple-grade clarity/deference/depth and stays accessible.

**Action plan:** implement the type scale (§5.1), semantic color roles light/dark (§5.2), glass materials (§5.3), the reduced-transparency/increased-contrast/reduced-motion fallbacks as media-query **and** `[data-*]` toggles (§5.4), the 8pt grid (§5.5), concentric radii + capsules + 44pt targets (§5.6), Dynamic-Type root multiplier (§5.7), motion tokens (§5.8); bundle **Inter** (OFL) as the Linux near-SF fallback; integrate the Lucide icon set; write stylelint rules + token snapshot tests.

**Acceptance criteria**
- **GIVEN** the token sheet, **WHEN** appearance switches (system / manual light / manual dark), **THEN** all role tokens resolve to the §5.2 values, with the two dark background tiers distinct.
- **GIVEN** `[data-reduce-transparency="1"]`, **THEN** glass materials become opaque (`backdrop-filter:none`, solid `--bg-secondary`) and remain legible (≥4.5:1).
- **GIVEN** `[data-increase-contrast="1"]`, **THEN** separators become opaque and secondary labels gain contrast.
- **GIVEN** `[data-reduce-motion="1"]` (or `prefers-reduced-motion`), **THEN** all transitions/animations are disabled.
- **GIVEN** any component stylesheet, **WHEN** linted, **THEN** it references role tokens only — **no raw hex** (stylelint gate); and SF font files are **not** bundled (license check), Inter is.
- **GIVEN** the root multiplier set to an AX step, **THEN** all type sizes scale together (rem-based).

**Technical context:** `src/styles/{tokens,materials,typography,a11y}.css`, `src/lib/icons` (Lucide), bundled Inter (OFL); stylelint config + token snapshot test.
**Agent hint:** Vivi (builder). Kupo viable for the static token sheet.
**Verifiability:** **HEADLESS** for lint/snapshot/license/contrast-ratio checks; **VISUAL-ONLY** for the actual glass/blur/vibrancy/appearance rendering (owner).

---

### GUI-S2 — App shell + IA + navigation *(G-C · ≤3d · P1 · depends: GUI-S0, GUI-S1 · mixed)*

**As** the owner, **I want** the sidebar + content (+ detail) shell with Today as home and a global capture affordance **so that** navigation follows HIG deference and the daily entry point is the agenda.

**Action plan:** build the NavigationSplitView-analog shell (§3.1) — glass inset sidebar, content column with floating glass toolbar + soft scroll-edge, optional detail column; responsive 3→2→1 column collapse; routing with browse→detail push (directional transition, reduced-motion aware); the foot-anchored "+ Capture" capsule + Cmd/Ctrl-N; the global error-state surfaces (offline indicator, re-auth banner, integrity/diagnostic state) wired to `JinErrorDto`.

**Acceptance criteria**
- **GIVEN** app launch, **THEN** the Today view is the active destination (today-as-home).
- **GIVEN** the sidebar, **THEN** items are Today / Notes / Tasks / Events / (break) / Settings, with "+ Capture" at the foot, all ≥44px targets and ARIA-labelled.
- **GIVEN** a narrow window, **THEN** the layout collapses 3→2→1 columns without clipping (reflow).
- **GIVEN** a command returns `JinErrorDto{code:6}` (offline), **THEN** the persistent offline indicator shows and navigation is not blocked; `code:5` shows the re-auth banner deep-linking to Settings.
- **GIVEN** keyboard-only navigation, **THEN** every nav target and the capture affordance are reachable with a visible focus ring.

**Technical context:** `src/App.svelte`, `src/lib/shell/{Sidebar,Toolbar,SplitView}.svelte`, `src/lib/router.ts`, `src/lib/stores/error.ts`.
**Agent hint:** Vivi (builder).
**Verifiability:** **HEADLESS** for routing/error-store/collapse-logic units; **VISUAL-ONLY** for glass chrome, scroll-edge, transitions (owner).

---

### GUI-S3 — Today / Agenda hero view *(G-D · ≤3d · P0 · depends: GUI-S2 · mixed)*

**As** the owner, **I want** a merged day agenda where each promoted event shows its originating task and reachable prep notes **so that** I see my whole day and the context behind it in one place (the hero).

**Action plan:** consume `today_agenda(date)`; render `AgendaEventDto`s sorted by start with all-day grouped, in `display_tz`; each event card shows time, title, source/authority badge (text, not color-only), `originating_task` (tappable → Task detail), and `prep_notes` (tappable → Note detail); label `recurrence_unexpanded` events "recurring (not expanded)"; date prev/next/today nav; empty state.

**Acceptance criteria**
- **GIVEN** local + mirrored Google events for a day, **WHEN** Today renders, **THEN** a single agenda appears in `display_tz`, sorted by start, all-day grouped, with no source-based fragmentation.
- **GIVEN** a promoted event, **THEN** its `originating_task` is shown inline and navigates to the Task detail.
- **GIVEN** an event with `prep_notes`, **THEN** the notes are listed and each navigates to its Note detail (JTBD-2 reachability).
- **GIVEN** a `recurrence_unexpanded` event, **THEN** it is shown labelled "recurring (not expanded)", never omitted or expanded.
- **GIVEN** the agenda data, **THEN** the transformation (sort/group/label) has headless unit tests; the visual layout is owner-verified.

**Technical context:** `src/routes/Today.svelte`, `src/lib/agenda/{transform,EventCard}.*`; consumes `today_agenda`.
**Agent hint:** Vivi (builder).
**Verifiability:** **HEADLESS** for the agenda transform + navigation wiring; **VISUAL-ONLY** for card layout/glass (owner).

---

### GUI-S4 — Notes / Tasks / Events browse + detail *(G-D · ≤5d · P1 · depends: GUI-S2 · mixed · ∥ GUI-S5)*

**As** the owner, **I want** to browse and inspect notes, tasks, and events **so that** the daily surface is navigable beyond the agenda.

**Action plan:** three list views (`list_notes/list_tasks/list_events` with filters: tags/status·list·priority/range) + detail views (`get_*`); Notes detail renders sanitized Markdown (`[FORGE F3]`) + frontmatter + links/backlinks; Tasks detail shows state-machine controls + due/priority + links; Events detail shows tz-aware temporal display + source/authority badge + `derived_from` originating task + `prep_notes`; deterministic sort; empty/not-found states from `JinErrorDto{code:3}`.

**Acceptance criteria**
- **GIVEN** `list_tasks({status:"todo", list:"inbox"})`, **THEN** only matching non-tombstoned tasks render, deterministically sorted, each status shown by color **and** glyph **and** label (color-independence).
- **GIVEN** a note detail, **THEN** Markdown renders **sanitized** (no script execution), with links/backlinks shown and navigable.
- **GIVEN** an event detail, **THEN** start/end render in the correct tz with all-day/floating handled, the source/authority badge is text-labelled, and `derived_from`/`prep_notes` are reachable.
- **GIVEN** a missing id, **THEN** the detail shows a "not found" state (no crash).

**Technical context:** `src/routes/{Notes,Tasks,Events}.svelte` + detail components; a sanitized Markdown renderer.
**Agent hint:** Vivi (builder).
**Verifiability:** **HEADLESS** for list filters/sort/markdown-sanitization/tz-format units; **VISUAL-ONLY** for layout (owner).

---

### GUI-S5 — Capture + create note/task/event *(G-E · ≤3d · P1 · depends: GUI-S2 · mixed · ∥ GUI-S4)*

**As** the owner, **I want** a low-friction capture affordance and full create forms **so that** I can get thoughts and commitments into Jin instantly.

**Action plan:** a global capture sheet (springs from its trigger; §5.8) — text → Note by default, `--task` toggle, optional list → `capture(text, as_task, list)`; full create forms for Note (title + Markdown body + tags), Task (title, status, priority, due, list), Event (title, start/end, all-day toggle, tz, location) → `create_note/create_task/create_event`; validation states; success returns id + navigates to the new item.

**Acceptance criteria**
- **GIVEN** the capture sheet with text and no toggle, **WHEN** submitted, **THEN** `capture` creates a Note and the new id is returned/surfaced.
- **GIVEN** the `--task` toggle, **THEN** `capture` creates a Task in the chosen list.
- **GIVEN** the Event create form with an all-day toggle, **THEN** the payload sets `is_all_day` correctly (no time/tz) vs a timed event with tz.
- **GIVEN** an invalid form (e.g. end before start), **THEN** the GUI surfaces the core's validation rejection without inventing its own logic.
- **GIVEN** any successful create, **THEN** the item is immediately listable/showable (round-trips through `jin-core`).

**Technical context:** `src/lib/capture/CaptureSheet.svelte`, `src/routes/create/*`; consumes `capture` + `create_*`.
**Agent hint:** Vivi (builder).
**Verifiability:** **HEADLESS** for payload construction/validation-mapping units; **VISUAL-ONLY** for sheet/form layout + spring anchor (owner).

---

### GUI-S6 — Promote / attach / link actions *(G-E · ≤2d · P1 · depends: GUI-S4, GUI-S5 · mixed)*

**As** the owner, **I want** to promote a task to an event, attach a note to a target, and create typed links from the UI **so that** the integration triangle is operable visually.

**Action plan:** a Promote affordance on Task detail → `promote_task(task_id, when)` with a temporal-slot picker; an Attach affordance on Note detail / Event detail → `attach_note(note_id, target_id, kind?)` with the default-kind behavior; a general typed Link action → `link(source, target, edge_type)` validated against the three-edge vocabulary (surface core rejection of anything else); after each action, refresh the affected views so backlinks appear.

**Acceptance criteria**
- **GIVEN** a Task, **WHEN** Promote with a slot, **THEN** a new Event is created (own id, `derived_from`), the task is unchanged, and Today/Events show the new event with the originating task (VG6 enforced by core; GUI verifies the surfaced result).
- **GIVEN** a Note and an Event, **WHEN** Attach with no kind, **THEN** a `prep-for` edge is created and the event's prep-notes backlink appears on refresh.
- **GIVEN** a Link request with an edge outside the vocabulary, **THEN** the core rejection is surfaced as a clear error (the GUI does not invent or bypass validation).
- **GIVEN** any action, **THEN** the GUI re-fetches via `jin-core` rather than mutating local state independently (single source of truth).

**Technical context:** `src/lib/actions/{Promote,Attach,Link}.svelte`; consumes `promote_task/attach_note/link`.
**Agent hint:** Vivi (builder).
**Verifiability:** **HEADLESS** for payload/validation-surface units; **VISUAL-ONLY** for the action sheets + refresh (owner).

---

### GUI-S7 — Sync & Settings (Google auth, run sync, export, appearance) *(G-F · ≤5d · P1 · depends: GUI-S2 · mixed)*

**As** the owner, **I want** a Settings area showing Google auth status with login/logout, a Run-Sync control, export, and appearance/accessibility toggles **so that** I control connectivity, backups, and the look without leaving the GUI.

**Action plan:** Settings sections — **Google:** `auth_status()` shows connected/disconnected/needs-reauth + account + expiry; `auth_login()` runs PKCE + loopback (opens system browser) with a guided panel that **mirrors the CLI wizard's GCP-provisioning instructions** (it instructs, does not automate — `[SPEC SP4]`); `auth_logout()`. **Sync:** Run Sync → `run_sync()` with progress, last-synced, pushed/pulled/conflict counts, and a "View audit log" link to `audit_path` (no destructive conflict prompt). **Export:** dest picker → `export(dest)` showing file count + audit inclusion. **Appearance/A11y:** light/dark/auto, the text-size (Dynamic-Type) slider, and the three §5.4 toggles (reduced-transparency, increased-contrast, reduced-motion) persisted to app prefs. **Info:** read-only `app_config()` (root path, display_tz, calendar_id, schema_version).

**Acceptance criteria**
- **GIVEN** no valid token, **THEN** auth status shows "disconnected"/"needs reauth" and Run Sync is gated with a re-auth prompt (`JinErrorDto{code:5}`).
- **GIVEN** `auth_login()`, **THEN** the system browser opens for the PKCE+loopback flow and, on success, status flips to "connected" with account + expiry (owner-machine verification).
- **GIVEN** Run Sync with no network, **THEN** the GUI shows `code:6` offline, local writes remain unaffected, and sync state shows "queued" — nothing blocks.
- **GIVEN** a completed sync, **THEN** pushed/pulled/conflict counts render and "View audit log" links to the export-included `audit.jsonl`.
- **GIVEN** the appearance/a11y toggles, **THEN** they set the corresponding `[data-*]` attributes (§5.4) + Dynamic-Type multiplier and persist across launches.
- **GIVEN** Export to a dest, **THEN** `ExportResultDto` reports file count + audit inclusion; index/sync-state/tokens are excluded (core enforces).

**Technical context:** `src/routes/Settings.svelte` + sections; consumes `auth_status/auth_login/auth_logout/run_sync/export/app_config`; prefs persistence.
**Agent hint:** Vivi (builder; reasoning-leaning for the auth/error flows).
**Verifiability:** **HEADLESS** for status/sync-result/prefs-toggle units + the bridge auth/sync command tests (cassettes); **VISUAL-ONLY** for the OAuth browser hand-off + the appearance/a11y rendering (owner).

---

### GUI-S8 — Verification harness + visual sign-off gate *(G-G · ≤3d · P0 · cross-cutting · scaffold after GUI-S0)*

**As** the maintainer, **I want** a layered headless test harness plus an explicit owner visual sign-off gate **so that** CI proves logic correctness without ever falsely claiming visual correctness.

**Action plan:** stand up vitest (frontend logic), the Rust bridge integration suite (over a temp root + Google cassettes reused from the core test fixtures), stylelint token/license gates, static a11y (ARIA/color-independence) checks, and the DTO shape-sync test (§6.4); codify the **Visual Verification Checklist (§7.4)** as the owner sign-off gate; document the `cargo tauri dev` loop + the Node-version note (§6.3).

**Acceptance criteria**
- **GIVEN** CI, **THEN** the bridge suite, frontend logic units, stylelint token/no-raw-hex/font-license gates, static a11y checks, and the DTO shape-sync test all run **headless** and gate merges.
- **GIVEN** the bridge suite, **THEN** it covers every §4.2 command incl. the error→`JinErrorDto` mapping and the VG4 dependency-graph check, using Google cassettes (no live network).
- **GIVEN** a build, **THEN** CI status is explicitly labelled "logic verified — visuals NOT verified"; visual correctness requires the owner's §7.4 checklist sign-off.
- **GIVEN** the DTO shape-sync test, **THEN** a sample of each command's DTO round-trips against the TS types (no silent drift).

**Technical context:** `src-tauri/tests/*`, `src/**/*.test.ts`, `stylelint.config`, CI workflow; reuses core's Google cassettes.
**Agent hint:** Vivi (builder) for the harness; **VIGIL owns the standing gates** (maker ≠ checker) and the visual sign-off ritual.
**Verifiability:** **HEADLESS** (the harness itself); it *defines* the visual gate it cannot run.

---

## 8.5 Build sequence, milestones, parallelization

```
GUI-S0 ──► GUI-S1 ──► GUI-S2 ──► GUI-S3 ─┬─► GUI-S4 ─┐
                                          ├─► GUI-S5 ─┤──► GUI-S6 ──► (hero complete)
                                          └─► GUI-S7 (parallel side-track)
GUI-S8 scaffold starts right after GUI-S0; standing gates land per story.
```

- **Critical path to the hero:** GUI-S0 → GUI-S1 → GUI-S2 → GUI-S3.
- **After GUI-S2:** GUI-S4 ∥ GUI-S5 (both depend on the shell, independent of each other); GUI-S7 is an independent side-track (Settings/sync don't block the hero). GUI-S6 needs S4+S5.
- **If no fan-out:** S0→S1→S2→S3→S4→S5→S6→S7→S8 sequential.

| Milestone | Stories | Exit gate |
|---|---|---|
| **GM1 — Spine** *(sequential, headless)* | GUI-S0 (+ GUI-S8 scaffold) | Bridge tests green; VG4 dependency-graph check; `today_agenda` returns `originating_task`+`prep_notes`. |
| **GM2 — Look & shell** | GUI-S1 → GUI-S2 | Token gates (no-raw-hex, font-license, contrast); a11y fallbacks toggle; **owner visual sign-off #1** (glass/appearance/reflow). |
| **GM3 — Hero & content** | GUI-S3 → (GUI-S4 ∥ GUI-S5) → GUI-S6 | Agenda transform tests; create/promote/attach round-trip through core; **owner visual sign-off #2** (hero flow visible). |
| **GM4 — Sync & ship** | GUI-S7 + GUI-S8 standing gates | Auth/sync bridge tests (cassettes); export; appearance/a11y persistence; **owner visual sign-off #3** (full §7.4 checklist + OAuth). |

---

## 8.6 GUI validation gates

| Gate | Assertion | Owning story |
|---|---|---|
| **VG-GUI-1 No-direct-SQLite (=VG4)** | bridge links only `jin-core` public API; no SQLite/store/file access from bridge or frontend | GUI-S0 |
| **VG-GUI-2 DTO-envelope parity** | every command returns `{jin_dto_version,kind,data,warnings}`; no raw rows cross the boundary | GUI-S0 |
| **VG-GUI-3 Error-state mapping** | exit-code-equivalents 3/4/5/6/7 map to the correct frontend states; offline never blocks local writes | GUI-S0/S2 |
| **VG-GUI-4 Hero-field presence** | `AgendaEventDto.originating_task` + `prep_notes` present and reachable in Today | GUI-S0/S3 |
| **VG-GUI-5 Token discipline** | components reference role tokens only (no raw hex); SF not bundled, Inter (OFL) is; contrast 4.5:1/7:1 | GUI-S1 |
| **VG-GUI-6 A11y fallbacks** | reduced-transparency/increased-contrast/reduced-motion each work via media query AND manual toggle; color-independence; ARIA labels; Dynamic-Type reflow | GUI-S1/S2 |
| **VG-GUI-7 Pure-consumer** | no business logic in the GUI; all actions re-fetch via `jin-core`; deferred items have no edit affordances | all |
| **VG-GUI-8 Headless honesty** | CI proves logic only; visual correctness requires the §7.4 owner sign-off; no story claims visuals from a headless build | GUI-S8 |

---

## 8.7 Verification (6-layer) & confidence

| Layer | Result |
|---|---|
| **Structural** | Theme→Project→7 Features→9 Stories; the 6 views + 3 actions + bridge + harness all mapped; no orphans. **PASS** |
| **Self-consistency** | 3 decompositions (by-view / by-dependency-layer / by-milestone) converge on the same 9 atomic units (≥70% overlap). **PASS** |
| **Dependency** | Frontend module paths + the `#[tauri::command]` surface named per story; hero depends on the bridge first; Settings is an independent side-track. **PASS** |
| **Constraint** | All §2 invariants honored (Tauri 2.11, in-process crate, VG4, DTO envelope, exit-code mapping, approximated-not-native, mandated a11y fallbacks); timeboxes ≤5d; Node-16 flagged with a recommended upgrade. **PASS** |
| **Process reward** | Bridge-first proves the VG4-safe data spine before any pixel; design-system before views avoids token churn; hero on the critical path. **PASS** |
| **Adversarial** | Checked: under-spec (every story has GWT); the **headless-can't-verify-visuals** trap (explicit VG-GUI-8 + visual checklist + sign-off milestones); cross-platform glass divergence (reduced-transparency safety net, `[FORGE F2]`); font-licensing (no SF bundling, Inter OFL); Node-16/Vite mismatch (recommended upgrade + fallback pin); scope creep into deferred items (explicit guardrail §1.5 + VG-GUI-7); Markdown XSS (sanitization `[FORGE F3]`); WebKitGTK media-query gaps (manual toggles, `[GAP G1]`). **PASS** |

**Confidence: 87% → AUTO_PROCEED.** Factors (each /3): Pattern match 2.5 (DTO/bridge reused verbatim; view shape is new) · Requirement clarity 2.5 (taste items deferred to the ledger) · Decomposition stability 3 (self-consistent) · Constraint compliance 3 → (11/12) discounted to **0.87** for the unavoidable headless-visual gap + the cross-platform-glass risk + the `[USER-DECISION]` taste items still open.

---

## 9. OPEN DECISIONS ledger

Each tagged `[USER-DECISION]` (taste/preference — bring to the owner before building), `[FORGE]` (genuine architecture trade-off — few, since ADR-0003 fixed the big ones), `[SPEC]` (in-spec latitude already decided), with provisional recommendations.

### `[USER-DECISION]` — bring to the owner first

- **UD1 — Navigation taste.** Sidebar (HIG desktop) vs top tab-bar vs hybrid. **Recommend: sidebar** with Today pinned at top (best for a desktop daily-driver; unlimited items).
- **UD2 — Scope priority / ordering.** **Recommend** the build order Today → (Notes/Tasks/Events) → create → promote/attach → Sync/Settings, with the hero (Today) first.
- **UD3 — Font choice.** **Recommend** the system stack (real SF on macOS) + **bundle Inter (OFL)** as the Linux near-SF fallback. **Do NOT bundle SF** (license). New York serif skipped for MVP.
- **UD4 — Frontend framework.** Svelte / Solid / vanilla+Vite / React. **Recommend: Svelte 5 + Vite + TS** (smallest runtime, motion + scoped-CSS fit). Architecture is framework-agnostic, so a swap is contained.
- **UD5 — Node upgrade.** **Recommend: upgrade Node 16 → 20 LTS** (16 is EOL; Vite 5/6 + Svelte 5 want 18+). Fallback if declined: pin Vite 4 + Svelte 4 on Node 16. Note: only the frontend toolchain cares — the Tauri CLI is a Rust binary.
- **UD6 — Icon set.** **Recommend: Lucide** (ISC, SF-adjacent). Alternatives: Phosphor / Tabler. **SF Symbols cannot be used** (license).
- **UD7 — Appearance default + controls.** **Recommend** follow-system by default, and expose in-app light/dark/auto + a Dynamic-Type text-size slider + the three a11y toggles in the MVP (mirrors iOS 26.1 tinted-glass philosophy).

### `[FORGE]` — genuine trade-offs (few, ADR-0003 fixed the big ones)

- **F1 — Command-bridge granularity.** Typed command-per-verb vs a single generic `jin_invoke(verb,args)`. **Recommend: typed command-per-verb** (discoverability + type-safety; keeps the bridge pure marshalling).
- **F2 — Liquid Glass on WebKitGTK.** Accept the `backdrop-filter` approximation with reduced-transparency as the safety net (ADR-0003 RISK). **Recommend: ship glass with the reduced-transparency fallback**; the owner verifies Linux blur quality/perf and may default glass→solid on Linux if poor.
- **F3 — Markdown rendering/sanitization.** Which renderer + sanitizer for note bodies. **Recommend: a small renderer with strict sanitization** (defense-in-depth even though data is local — the webview is a JS context).

### `[SPEC]` — in-spec latitude (decided here, non-foreclosing)

- **SP1 — DTO type sharing.** **Decided: prefer codegen** (`ts-rs`/`specta`) from the Rust DTOs; else hand-mirrored TS gated by a shape test (GUI-S8). Never drift silently.
- **SP2 — Cross-boundary error schema.** **Decided: `JinErrorDto{code,kind,message,retriable,detail?}`** carrying the exit-code-equivalent (§4.1).
- **SP3 — Frontend state management.** **Decided: framework-native stores, minimal**; single-source-of-truth is `jin-core` (re-fetch after mutations, no parallel client logic).
- **SP4 — OAuth provisioning in Settings.** **Decided:** Settings *triggers* `auth_login` (same core flow) and *shows a guided GCP-provisioning panel mirroring the CLI wizard* — it instructs, it does not automate Google Cloud setup.

### `[GAP]` — verify at build

- **G1 — WebKitGTK media-query support** for `prefers-reduced-transparency`/`prefers-contrast` is inconsistent → manual in-app toggles are **mandatory**, not a nicety.
- **G2 — `jin-core` op sync/async shape** affects whether commands must be `async` (recommend async regardless to avoid webview blocking) — confirm at GUI-S0.
- **G3 — OAuth loopback under Tauri** (system-browser + 127.0.0.1 redirect) — owner-machine-only; not exercisable headless.

### `[ASSUMPTION]` — asserted, confirm at build

- **A1 — `jin-core` DTO field names** (NoteDto/TaskDto/EventDto/AgendaDto/AgendaEventDto with `originating_task`+`prep_notes`) match §4.3 — confirm against `jin-core/src/dto/*` at GUI-S0.
- **A2 — Tauri 2.11 command/serde interop** returns the DTO envelope cleanly across the IPC boundary.
- **A3 — The CLI verb grammar + exit-code taxonomy** (thin-slice S3) is the canonical surface the GUI mirrors.

---

## 10. Recommended next handoff

- **Resolve the `[USER-DECISION]` ledger (§9) with the owner first** — especially UD4 (framework) + UD5 (Node), since they set the frontend toolchain before scaffolding.
- **Vivi → build GUI-S0 (scaffold + command bridge)** as the first track; exit gate = bridge tests green + VG-GUI-1/2/4. This is the load-bearing, fully-headless-verifiable spine; nothing parallelizes before it.
- **After GUI-S2:** fan out **GUI-S4 ∥ GUI-S5** and the **GUI-S7** side-track; keep GUI-S0→S1→S2→S3 single-track (the hero critical path).
- **Kupo** for ≤2-file micro-tasks: `JinErrorDto` enum, the envelope struct, the static token sheet, the Lucide icon-wrapper.
- **VIGIL** owns the standing gates (VG-GUI-1/5/6/8) and the **visual sign-off ritual** (maker ≠ checker).
- **IDG** chronicles per milestone; record any new architectural choice (e.g. the resolved UD4/UD5) as an ADR.

---

## 11. Machine-readable handoff (embedded)

```yaml
spec:
  id: gui-mvp
  project: jin
  type: REQUEST
  tier: standard
  complexity: 10            # /12
  confidence: 0.87
  decision: AUTO_PROCEED
  architecture_source: [ADR-0003, mvp-integrated-thin-slice]
  stack:
    runtime: "Tauri 2.11.x (Rust backend, in-process jin-core)"
    frontend_recommended: "Svelte 5 + Vite + TypeScript"   # [USER-DECISION UD4]
    node_recommended: "20 LTS (upgrade from 16; fallback pin Vite4+Svelte4 on 16)"  # [USER-DECISION UD5]
    fonts: "system stack (real SF on macOS) + bundled Inter (OFL) on Linux; DO NOT bundle SF"  # [USER-DECISION UD3]
    icons: "Lucide (ISC); SF Symbols cannot be used"        # [USER-DECISION UD6]
  invariants:
    - "GUI is a pure consumer of jin-core (P3); zero logic in the command layer"
    - "No GUI-reads-SQLite (VG4); DTOs are the only boundary"
    - "DTO envelope {jin_dto_version,kind,data,warnings}; exit-code-equivalents map to error states"
    - "Apple aesthetic approximated via CSS backdrop-filter/vibrancy, NOT native SwiftUI"
    - "reduced-transparency / increased-contrast / reduced-motion fallbacks mandatory (media query + manual toggle)"

hero_flow: "Today/agenda home -> promoted event shows originating_task + reachable prep_notes -> capture -> promote(task)->event -> attach(note) -> run_sync (auth status visible) -> all via jin-core DTOs"

views: [today_agenda_home, notes_browse_detail, tasks_browse_detail, events_browse_detail, capture_create, sync_settings]

command_surface:   # #[tauri::command] wrappers; all async; return Envelope<T> or JinErrorDto
  read: [today_agenda, list_notes, get_note, list_tasks, get_task, list_events, get_event, app_config]
  write: [create_note, edit_note, delete_note, create_task, edit_task, set_task_status, delete_task, create_event, edit_event, delete_event]
  linking: [promote_task, attach_note, link, capture]
  sync_auth: [run_sync, auth_status, auth_login, auth_logout, export]
  envelope: '{ jin_dto_version:"1", kind, data, warnings[] }'
  error_dto: '{ code:3|4|5|6|7|1, kind, message, retriable, detail? }'
  error_map: { not_found: 3, sync_conflict: 4, auth: 5, offline: 6, integrity: 7, other: 1 }

dtos_consumed:     # [ASSUMPTION A1] mirror jin-core serde DTOs; confirm field names at GUI-S0
  AgendaDto: { date, display_tz, items: "AgendaEventDto[]", warnings }
  AgendaEventDto: { event: EventDto, originating_task: "TaskRef?", prep_notes: "NoteRef[]" }
  NoteDto: { id, type, title, body_markdown, tags, created, updated, status, links, backlinks }
  TaskDto: { id, type, title, status, priority, due, list, completed_at, links, backlinks, derived_event }
  EventDto: { id, type, title, start, end, is_all_day, start_tzid, end_tzid, floating, recurrence_unexpanded, status, source, authority, calendar_id, derived_from, prep_notes, backlinks }
  SyncResultDto: { pushed, pulled, conflicts, last_synced_at, audit_path }
  AuthStatusDto: { state, account, scopes, expires_at }

design_tokens:
  type_scale_styles: 11   # LargeTitle..Caption2, body=17/22, rem-based for Dynamic Type
  color_roles: "semantic light/dark adaptive (two dark tiers); no raw hex in components"
  glass: "backdrop-filter blur(20/30/50)+saturate(180%) + 0.5px hairline + inset specular + elevation shadow; -webkit- prefixed"
  a11y_fallbacks: [reduced-transparency, increased-contrast, reduced-motion]  # media-query AND manual toggle
  spacing: "8pt grid, 4pt subdivision"
  radii: "concentric: outer=inner+padding; capsules for buttons; 44pt min targets"
  dynamic_type: "root rem multiplier; 7 standard + 5 AX steps; reflow not clip"

stories:
  - id: GUI-S0
    title: Tauri scaffold + command bridge
    feature: G-A-bridge-scaffold
    timebox: "<=5d"
    risk: P0
    depends_on: [jin-core]
    verifiability: headless
    agent_hint: vivi-builder
    context_files: ["src-tauri/src/commands/*.rs", "src-tauri/src/error.rs", "src-tauri/tests/bridge.rs"]
    acceptance:
      - given: "frontend invoke today_agenda"
        then: "valid envelope sourced from jin-core (not direct DB/file)"
      - given: "core op returns Err"
        then: "JinErrorDto with correct code/kind 3/4/5/6/7"
      - given: "bridge crate dependency graph"
        then: "links only jin-core public API; no rusqlite/store access (VG4)"
      - given: "today_agenda for a promoted event"
        then: "AgendaEventDto includes originating_task + prep_notes"
  - id: GUI-S1
    title: Design-system tokens + Liquid Glass + a11y fallbacks
    feature: G-B-design-system
    timebox: "<=3d"
    risk: P1
    depends_on: [GUI-S0]
    verifiability: mixed   # lint/license/contrast headless; glass rendering visual-only
    agent_hint: vivi-builder
    context_files: ["src/styles/{tokens,materials,typography,a11y}.css", "src/lib/icons"]
    acceptance:
      - given: "appearance switch system/light/dark"
        then: "role tokens resolve to spec values; two dark tiers distinct"
      - given: "[data-reduce-transparency]"
        then: "glass opaque, backdrop-filter none, legible >=4.5:1"
      - given: "[data-increase-contrast] / [data-reduce-motion]"
        then: "opaque separators / animations disabled"
      - given: "component stylesheet linted"
        then: "role tokens only, no raw hex; SF not bundled, Inter is"
  - id: GUI-S2
    title: App shell + IA + navigation
    feature: G-C-shell-navigation
    timebox: "<=3d"
    risk: P1
    depends_on: [GUI-S0, GUI-S1]
    verifiability: mixed
    agent_hint: vivi-builder
    context_files: ["src/App.svelte", "src/lib/shell/*", "src/lib/router.ts", "src/lib/stores/error.ts"]
    acceptance:
      - given: "app launch"
        then: "Today is active (today-as-home)"
      - given: "sidebar"
        then: "Today/Notes/Tasks/Events/(break)/Settings + foot Capture; >=44px; ARIA-labelled"
      - given: "narrow window"
        then: "3->2->1 column collapse without clipping"
      - given: "JinErrorDto code 6 / code 5"
        then: "offline indicator non-blocking / re-auth banner deep-links Settings"
  - id: GUI-S3
    title: Today / Agenda hero view
    feature: G-D-hero-browse
    timebox: "<=3d"
    risk: P0
    depends_on: [GUI-S2]
    verifiability: mixed
    agent_hint: vivi-builder
    context_files: ["src/routes/Today.svelte", "src/lib/agenda/*"]
    acceptance:
      - given: "local + mirrored events for a day"
        then: "single agenda in display_tz, sorted by start, all-day grouped, no fragmentation"
      - given: "promoted event"
        then: "originating_task shown inline, navigates to Task detail"
      - given: "event with prep_notes"
        then: "notes listed and each navigates to Note detail"
      - given: "recurrence_unexpanded event"
        then: "labelled 'recurring (not expanded)', not omitted/expanded"
  - id: GUI-S4
    title: Notes/Tasks/Events browse + detail
    feature: G-D-hero-browse
    timebox: "<=5d"
    risk: P1
    depends_on: [GUI-S2]
    parallelizable: true
    verifiability: mixed
    agent_hint: vivi-builder
    context_files: ["src/routes/{Notes,Tasks,Events}.svelte"]
    acceptance:
      - given: "list_tasks status/list filter"
        then: "matching non-tombstoned tasks, deterministic sort, status by color+glyph+label"
      - given: "note detail"
        then: "sanitized Markdown render; links/backlinks navigable"
      - given: "event detail"
        then: "tz-aware temporal display; source/authority text badge; derived_from + prep_notes reachable"
      - given: "missing id"
        then: "not-found state, no crash"
  - id: GUI-S5
    title: Capture + create note/task/event
    feature: G-E-create-actions
    timebox: "<=3d"
    risk: P1
    depends_on: [GUI-S2]
    parallelizable: true
    verifiability: mixed
    agent_hint: vivi-builder
    context_files: ["src/lib/capture/CaptureSheet.svelte", "src/routes/create/*"]
    acceptance:
      - given: "capture text no toggle"
        then: "creates Note, returns id"
      - given: "--task toggle"
        then: "creates Task in chosen list"
      - given: "event create all-day toggle"
        then: "is_all_day correct (no time/tz) vs timed+tz"
      - given: "invalid form (end<start)"
        then: "surfaces core validation rejection, no invented logic"
  - id: GUI-S6
    title: Promote / attach / link actions
    feature: G-E-create-actions
    timebox: "<=2d"
    risk: P1
    depends_on: [GUI-S4, GUI-S5]
    verifiability: mixed
    agent_hint: vivi-builder
    context_files: ["src/lib/actions/{Promote,Attach,Link}.svelte"]
    acceptance:
      - given: "Promote task with slot"
        then: "new event (derived_from), task unchanged, Today/Events show it with originating task"
      - given: "Attach note->event no kind"
        then: "prep-for edge; event prep-notes backlink appears on refresh"
      - given: "Link edge outside vocabulary"
        then: "core rejection surfaced clearly; GUI does not bypass validation"
      - given: "any action"
        then: "GUI re-fetches via jin-core (single source of truth)"
  - id: GUI-S7
    title: Sync & Settings (auth, run sync, export, appearance)
    feature: G-F-sync-settings
    timebox: "<=5d"
    risk: P1
    depends_on: [GUI-S2]
    parallelizable: true
    verifiability: mixed   # bridge auth/sync headless via cassettes; OAuth + appearance visual-only
    agent_hint: vivi-builder
    context_files: ["src/routes/Settings.svelte"]
    acceptance:
      - given: "no valid token"
        then: "status disconnected/needs-reauth; Run Sync gated with re-auth prompt (code 5)"
      - given: "auth_login"
        then: "system browser PKCE+loopback; on success status->connected + account/expiry"
      - given: "Run Sync no network"
        then: "code 6 offline; local writes unaffected; sync 'queued'; nothing blocks"
      - given: "completed sync"
        then: "pushed/pulled/conflict counts; 'View audit log' -> audit_path"
      - given: "appearance/a11y toggles"
        then: "set [data-*] attrs + Dynamic-Type multiplier; persist across launches"
      - given: "export to dest"
        then: "ExportResultDto file_count + audit included; index/sync-state/tokens excluded"
  - id: GUI-S8
    title: Verification harness + visual sign-off gate
    feature: G-G-verification
    timebox: "<=3d"
    risk: P0
    depends_on: [GUI-S0]
    verifiability: headless   # defines the visual gate it cannot run
    agent_hint: vivi-builder + vigil-gates
    context_files: ["src-tauri/tests/*", "src/**/*.test.ts", "stylelint.config", "ci-workflow"]
    acceptance:
      - given: "CI"
        then: "bridge suite + frontend logic units + stylelint token/license + static a11y + DTO shape-sync all run headless and gate merges"
      - given: "bridge suite"
        then: "covers every command incl error mapping + VG4 graph check, using Google cassettes (no live net)"
      - given: "a build"
        then: "CI labelled 'logic verified - visuals NOT verified'; visual correctness requires owner Sec 7.4 sign-off"
      - given: "DTO shape-sync test"
        then: "each command DTO round-trips against TS types (no silent drift)"

milestones:
  - id: GM1
    name: Spine
    stories: [GUI-S0]
    parallel_with: [GUI-S8-scaffold]
    exit_gate: [VG-GUI-1, VG-GUI-2, VG-GUI-4]
  - id: GM2
    name: Look & shell
    stories: [GUI-S1, GUI-S2]
    exit_gate: [VG-GUI-5, VG-GUI-6, "owner-visual-signoff-1"]
  - id: GM3
    name: Hero & content
    stories: [GUI-S3, GUI-S4, GUI-S5, GUI-S6]
    exit_gate: ["agenda-transform-tests", "create/promote/attach round-trip", "owner-visual-signoff-2"]
  - id: GM4
    name: Sync & ship
    stories: [GUI-S7, GUI-S8]
    exit_gate: [VG-GUI-3, VG-GUI-8, "owner-visual-signoff-3-full-checklist"]

critical_path: [GUI-S0, GUI-S1, GUI-S2, GUI-S3]
parallel_after_S2: { content: [GUI-S4, GUI-S5], side_track: [GUI-S7] }

validation_gates:
  VG-GUI-1: "no-direct-SQLite (=VG4): bridge links only jin-core public API"
  VG-GUI-2: "DTO-envelope parity; no raw rows cross boundary"
  VG-GUI-3: "error-state mapping 3/4/5/6/7; offline never blocks local writes"
  VG-GUI-4: "hero fields: AgendaEventDto.originating_task + prep_notes reachable"
  VG-GUI-5: "token discipline: role tokens only, no raw hex; SF not bundled, Inter(OFL) is; contrast 4.5/7"
  VG-GUI-6: "a11y fallbacks (reduced-transparency/increased-contrast/reduced-motion) via media-query AND manual toggle; color-independence; ARIA; Dynamic-Type reflow"
  VG-GUI-7: "pure-consumer: no GUI logic; re-fetch via core; deferred items have no affordances"
  VG-GUI-8: "headless honesty: CI proves logic only; visuals require owner Sec 7.4 sign-off"

open_decisions:
  user_decision:
    - "UD1 navigation taste -> sidebar (recommended) vs tab-bar vs hybrid"
    - "UD2 scope priority -> Today first, then browse, create, actions, sync/settings"
    - "UD3 font -> system stack + bundled Inter(OFL); DO NOT bundle SF; NY serif skipped"
    - "UD4 framework -> Svelte 5 (recommended) vs Solid vs vanilla vs React"
    - "UD5 Node -> upgrade 16->20 LTS (recommended); fallback pin Vite4+Svelte4 on 16"
    - "UD6 icons -> Lucide (recommended); SF Symbols cannot be used"
    - "UD7 appearance -> follow-system default + in-app light/dark/auto + text-size + 3 a11y toggles"
  forge:
    - "F1 command granularity -> typed command-per-verb (recommended) vs generic invoke"
    - "F2 glass on WebKitGTK -> ship glass + reduced-transparency safety net; owner may default solid on Linux"
    - "F3 markdown -> small renderer + strict sanitization (defense-in-depth)"
  spec:
    - "SP1 DTO types -> codegen (ts-rs/specta) preferred, else hand-mirror + shape test"
    - "SP2 error schema -> JinErrorDto{code,kind,message,retriable,detail?}"
    - "SP3 state mgmt -> framework-native minimal stores; jin-core is single source of truth"
    - "SP4 OAuth -> Settings triggers auth_login + guided GCP panel mirroring CLI wizard (instructs, not automates)"
  gap:
    - "G1 WebKitGTK media-query support inconsistent -> manual a11y toggles mandatory"
    - "G2 jin-core op sync/async -> commands async regardless (avoid webview block); confirm at S0"
    - "G3 OAuth loopback under Tauri -> owner-machine only, not headless-exercisable"
  assumption:
    - "A1 jin-core DTO field names match Sec 4.3 (incl originating_task + prep_notes); confirm at S0"
    - "A2 Tauri 2.11 command/serde returns DTO envelope cleanly across IPC"
    - "A3 CLI verb grammar + exit-code taxonomy is the canonical surface to mirror"

deferred_not_foreclosed:
  - recurrence-editing-creation
  - rich-block-notes-editor
  - multi-device-mobile
  - multi-account-multi-calendar-ui
  - calendar-grid-month-view
  - offline-conflict-resolution-ui

next_handoff:
  - "resolve USER-DECISION ledger with owner first (esp UD4 framework + UD5 Node)"
  - "vivi: build GUI-S0 (scaffold + bridge); exit gate VG-GUI-1/2/4 (fully headless)"
  - "after GUI-S2: fan out GUI-S4 || GUI-S5 + GUI-S7 side-track; keep S0->S1->S2->S3 single-track"
  - "kupo: micro-tasks (JinErrorDto enum, envelope struct, token sheet, icon wrapper)"
  - "vigil: standing gates VG-GUI-1/5/6/8 + visual sign-off ritual (maker != checker)"
  - "idg: chronicle per milestone; record resolved UD4/UD5 as an ADR"
```

---

*SPECTRA — standard-tier planning cycle. READ-ONLY throughout; no code produced. CRYSTALIUM memory hooks gracefully skipped (tools unavailable; EIIS-standalone-conformant). ECL envelope sidecar emitted (ECL_VERSION 2.0 present).*
