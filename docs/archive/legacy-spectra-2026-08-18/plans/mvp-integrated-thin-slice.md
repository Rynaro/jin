---
eidolon: spectra
version: 4.10.0
kind: spec
status: ready-for-build
created_at: 2026-06-26T12:00:00Z
decisions_resolved_at: 2026-06-26T00:00:00Z
target_repos:
  - jin
thread_id: 6a9a8db3-2548-4f5b-b922-01856fdb9e90
evidence_anchors_count: 9
stories_count: 11
validation_gates_count: 11
confidence: 0.90
---

# Jin MVP — "Integrated Thin Slice" Build Specification

> **Codename:** Jin · **Mode:** SPECTRA / standard-tier planning cycle · **Date:** 2026-06-26
> **Type:** REQUEST (architecture fixed; full build spec) · **Complexity:** 11/12 (extended reasoning)
> **Status:** Decision-ready. The architecture is settled across ADR-0001..0004; this spec decomposes the *build*, it does not re-open decisions.
> **Audience:** the owner (sole approver) + the Eidolons pipeline (Vivi to build, Kupo for micro-tasks, VIGIL on regressions, IDG to chronicle).

This spec satisfies the discovery §4 "Integrated Thin Slice" MVP and the §6 Definition of Done. Every fixed decision below traces to a `[FORGE]`-authored ADR and is treated as a settled input, never a hypothesis.

---

## 1. Scope

### 1.1 Hero flow (the one end-to-end demonstration the MVP must satisfy)

> Create a **note** → create a **task**, link the note (`references`) → **`promote`** the task to an **event** → that event **syncs bidirectionally** to one Google Calendar → **`jin today`** shows a **merged agenda** (personal-local + company-Google) with the linked note reachable → all data **exportable / human-readable** (sovereignty).

This single flow exercises every triangle edge (note↔task JTBD-3, task↔event JTBD-1, note↔event reachability JTBD-2, local+Google JTBD-4) and the sovereignty principle (P1, JTBD-5) at once.

### 1.2 Complexity score — 11/12

| Dimension | Score | Rationale |
|---|---|---|
| **Scope** | 3 | Spans the whole system spine: store, derived index, CLI/DTO boundary, two primitive types + edges, bidirectional Google sync, merged agenda, export, test harness (9 components). |
| **Ambiguity** | 2 | Architecture fully fixed by 4 ADRs; residual gaps are owner-confirm policy items (DEC-C posture confirmed permissive; remote-delete=unpublish; owner Rust fluency), not architectural unknowns. |
| **Dependencies** | 3 | Cross-domain: filesystem + SQLite + OAuth/PKCE + OS keychain + Google REST + RFC-5545/IANA-tz/DST. |
| **Risk** | 3 | Critical path: canonical-data integrity + bidirectional sync correctness; data-loss / drift potential if invariants slip. |

**Total 11/12** → extended reasoning engaged; the owner-confirm items in §10 are the human-in-the-loop hooks. The score reflects *inherent* build complexity; the ADRs have already retired the *architectural* ambiguity, which is why this can ship as a single planning cycle rather than re-deliberation.

### 1.3 In scope

The 9 components named in the mandate, decomposed into 11 stories (S6 splits into three to keep timeboxes ≤8d): store & schema · index & deterministic rebuild · CLI grammar & versioned DTO contract · Tasks & Notes CRUD · local Events + linking/promote · Google sync (OAuth, sync loop + field mapping, conflict + audit) · `today` merged agenda · export/backup · test strategy.

### 1.4 Out of scope (MVP)

Reminders/notifications, time-blocking, NLP quick-add parsing, AI features, collaboration/multi-user, free/busy, attendees/organizer/conferenceData modelling, a from-scratch calendar UI.

### 1.5 Deferred — NOT to be specced or built now, but explicitly **not foreclosed** (the schemas reserve room)

| Deferred item | Why deferred | What keeps it open |
|---|---|---|
| **Recurrence WRITE** (creating/editing recurring events bidirectionally) | High complexity; not needed for the hero flow. | `recurrence[]`/`recurring_event_id`/`original_start`/`master_id` stored **verbatim** day one; recurring Google events are **mirrored read-only**, flagged unexpanded. |
| **Rich notes** (block editor, backlink graph at block granularity, embeds, attachments) | MVP = Markdown + simple links. | Link targets are whole-note ULIDs now; a `#block-id` fragment can be added later (ADR-0001 GAP). |
| **Multi-device / CRDT sync** of the canonical store | Single machine for MVP (DEC-G). | Files are line-mergeable + index is deterministically rebuildable per machine — the file-sync path is a no-rewrite addition. |
| **The GUI** (Tauri 2.x, Liquid-Glass approximation) | Core first (P3). | `jin-core` is the single locus of logic; `--json` DTO parity from day one keeps the GUI a pure consumer. |
| **Push channels** (`events.watch`), **multi-account/multi-calendar**, CalDAV/other providers, two-stream `singleEvents=true` display | Need a public webhook / out of MVP by C2. | Polling now; `calendar_id` + per-object `authority` carried so multi-calendar isn't foreclosed. |
| **Task↔Event completion/field propagation** | Out of MVP (ADR-0001 GAP). | Objects stay distinct; the `derived-from` edge is the integration. Propagation is a future follow-up spec. |

**Builder guardrail:** if a story tempts you to implement any deferred item, stop — it is out of scope by decision, not by omission.

---

## 2. Fixed architectural invariants (guardrails, not decisions)

These are restated so the builder can self-check; each traces to an ADR. **Do not re-litigate.**

1. **One core, thin consumers.** All logic lives in the `jin-core` crate. The `jin` CLI (clap) is a thin wrapper; `--json` parity from day one emits **serde DTOs that are model projections, never raw SQLite rows**. The future Tauri GUI links the same crate in-process. *(ADR-0003 DEC-04.)*
2. **Consumers never touch SQLite.** Only `jin-core` opens `index.sqlite`. The schema is **private** to the crate. *(ADR-0003 D6.)*
3. **Files are canonical; SQLite is a disposable derived index.** Writes go to files first, then refresh/dirty the index. The index is a **pure deterministic function** of the canonical files (+ the operational sync-map for Google-source events). *(ADR-0002.)*
4. **Three-layer split.** Canonical (owner-readable files, synced) · Derived index (`.jin/index.sqlite`, rebuildable, not synced) · Operational (`.jin/sync/`, re-fetchable, **outside both** the canonical set and the index). *(ADR-0002 + mandate.)*
5. **Edges are first-class, stored source-side only.** An edge lives in the *source* object's frontmatter; **backlinks are derived in the index, never written to disk**. `promote`/`attach` are single-file additive writes that never mutate the target. *(ADR-0001.)*
6. **Full RFC-5545 on disk from day one**, even though the MVP writes only single events. Temporal values stored as **local wall-time + IANA tzid, un-normalized**; any UTC is a derived index column. *(ADR-0004 DEC-07.)*
7. **Authority by authorship.** Owner-authored objects are Jin-canonical (Google a downstream replica for promoted events); company/Google events are Google-canonical, held locally as a flagged non-sovereign **mirror**. *(ADR-0004 DEC-09.)*
8. **Soft-delete / tombstones**, never hard delete — "deleted" must be distinguishable from "never existed" for correct delete propagation. *(ADR-0004 dep #4.)*
9. **Secretless OAuth.** Owner-provisioned OAuth **Desktop** client, **PKCE + loopback(127.0.0.1)** redirect; tokens in the OS secret store (`keyring 3.6.x`) with a **mandatory** encrypted-file fallback. *(ADR-0004 DEC-05.)*

**Verified crate pins (settled inputs):** `rrule 0.14`, `icalendar 0.17.x`, `chrono-tz 0.10.x` (handle DST `Ambiguous`/`None` explicitly), `keyring 3.6.x` (enable per-OS backend features in `Cargo.toml`), `rusqlite 0.38` (`bundled` — needs a C compiler at build), Tauri `2.11.x` (deferred). Plus `clap`, `serde`/`serde_json`/`serde_yaml`, `ulid`, an HTTP client (`reqwest` or `ureq`) for Google.

---

## 3. Concrete reference layout & schemas (builder contract)

This is reference material the stories below assume. It is fixed by the ADRs + mandate; the only `[SPEC]` latitude is task-file granularity (chosen: one-file-per-task) and slug derivation.

### 3.1 On-disk layout

```
<root>/                         # sovereign canonical root (owner-chosen dir; recorded in config)
  notes/<ULID>--<slug>.md       # YAML frontmatter + Markdown body
  tasks/<ULID>.md               # frontmatter (+ optional body)
  events/<ULID>.md              # frontmatter (full RFC-5545 fields) + optional body
  .jin/
    config.toml                 # root path, display_tz, calendar_id, token_backend pref, schema_version
    index.sqlite                # DERIVED — rebuildable, gitignored / never synced, never read by consumers
    sync/                       # OPERATIONAL — outside canonical set AND index
      sync-state.sqlite         # per-calendar sync_token; per-event map: jin_id↔google_event_id↔ical_uid, etag, google_updated, dirty, last_synced_at
      outbox.jsonl              # queued unpushed local mutations (dirty set)
      audit.jsonl               # append-only conflict audit log — human-readable, EXPORT-INCLUDED
      tokens.enc                # AEAD-encrypted token fallback (only when no Secret Service)
```

**Export boundary:** `jin export` emits the canonical files (`notes/ tasks/ events/`) **plus `.jin/sync/audit.jsonl`** (sovereign-adjacent, human-readable). It **excludes** `index.sqlite`, `sync-state.sqlite`, `outbox.jsonl`, and `tokens.enc` (derived or volatile/secret).

### 3.2 Note frontmatter

```yaml
---
id: 01J...NOTE            # ULID, immutable
type: note
title: "Dentist prep"
created: 2026-06-26T09:00:00-03:00
updated: 2026-06-26T09:00:00-03:00
status: active            # active | deleted (tombstone)
deleted_at: null
tags: []
links:                    # source-side edges (this note is the source endpoint)
  - { type: prep-for,   target: 01J...EVENT }
  - { type: references, target: 01J...TASK  }
---
Markdown body...
```

### 3.3 Task frontmatter (DEC-S3 — one file per task)

```yaml
---
id: 01J...TASK
type: task
title: "Book dentist annual checkup"
created: 2026-06-26T09:00:00-03:00
updated: 2026-06-26T09:00:00-03:00
status: todo              # state machine: todo | doing | done | cancelled
priority: none           # none | low | medium | high
due: 2026-07-01           # optional; date OR date-time+offset
list: inbox               # list membership (default "inbox")
completed_at: null
deleted_at: null
links: []                 # tasks may also be a source endpoint of `references`
---
Optional notes body...
```

**Task state machine (S4):** `todo → doing → done`; `todo|doing → cancelled`; reopen `done|cancelled → todo`. `done` sets `completed_at`; reopen clears it. Completing a task does **NOT** touch a promoted Event (propagation deferred).

### 3.4 Event frontmatter (full RFC-5545; nullable for MVP single events)

```yaml
---
id: 01J...EVENT           # ULID, canonical identity
type: event
title: "Dentist — annual checkup"
description: null
location: null
# --- temporal core (un-normalized: local wall-time + tzid) ---
start:        2026-07-01T14:00:00     # value_type=date-time
end:          2026-07-01T14:30:00
start_value_type: date-time           # date-time | date
end_value_type:   date-time
is_all_day:   false                   # true ⇒ value_type=date, no time, no tz
start_tzid:   America/Sao_Paulo       # IANA; null when all-day or floating
end_tzid:     America/Sao_Paulo
floating:     false                   # datetime with no tzid, not all-day
# --- recurrence (verbatim; empty for MVP single events) ---
recurrence:           []              # ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "EXDATE:...", "RDATE:..."]
recurring_event_id:   null            # exception → series master (Google recurringEventId)
original_start:       null            # + its value_type/tzid (Google originalStartTime)
master_id:            null            # local FK exception → master
recurrence_unexpanded: false          # true ⇒ mirrored recurring event we do NOT expand
# --- identity / lifecycle ---
ical_uid:  "abc...@google.com"        # RFC-5545 UID; stable cross-calendar identity (in FILE)
sequence:  0
status:    confirmed                  # confirmed | tentative | cancelled (cancelled = tombstone)
created:   2026-06-26T09:00:00-03:00
updated:   2026-06-26T09:00:00-03:00
transparency: null                    # reserve
visibility:   null                    # reserve
# --- source / authority (DEC-09) ---
source:    jin                        # jin | google  (who authored it)
authority: jin                        # jin | google  (who is canonical on conflict)
calendar_id: "primary"                # configured, not discovered, in MVP
# --- links (source-side; set when promoted) ---
derived_from: 01J...TASK              # null unless promoted from a Task
---
Optional agenda/body...
```

**Volatile sync cursors are NOT in this file** — `google_event_id`, `etag`, `google_updated`, `dirty`, `last_synced_at`, per-calendar `sync_token` live only in `.jin/sync/sync-state.sqlite`. Durable identity (`ical_uid`, and the `google_event_id` mapping is rebuildable from it) survives index/sync-state loss because `ical_uid` is in the file.

### 3.5 Edge vocabulary (MVP — exactly three)

| Edge type | Signature (source → target) | Created by | Derived backlink on target |
|---|---|---|---|
| `derived-from` | Event → Task | `promote` | task: "scheduled-as / has-event" |
| `prep-for` | Note → Event | `attach` (default for Event target) | event: "prep-notes" |
| `references` | Note → {Task \| Event \| Note} | `attach` (default for Task/Note) | target: "referenced-by / notes" |

Generic `relates-to` is **deliberately excluded** (keeps the vocabulary small and typed). Dangling edges (target missing/tombstoned) are detected and **reported** at rebuild, never silently dropped.

---

## 4. Pattern & decomposition strategy

**Pattern phase:** CRYSTALIUM memory tools are unavailable in this environment → recall/ingest/session_end gracefully skipped (EIIS-standalone). No prior code exists (greenfield Rust). The four ADRs serve as ≥85% architectural templates → strategy is **ADAPT** (ADRs as fixed skeleton; this spec fills the build decomposition).

**Decomposition/sequencing — selected hypothesis (H2+H1 hybrid): foundation-first, then dependency-ordered thickening with parallel side-tracks.** Build the load-bearing spine (store → index+rebuild → CLI/DTO) first, prove the deterministic-rebuild invariant immediately, then thicken primitives, then layer the hardest surface (Google sync) on the *stable* event model, finishing with agenda + sovereignty export.

**Rejected alternatives (recorded to prevent re-exploration):**
- **H1 — strictly sequential single track (no parallelism).** Rejected as primary: safe but slowest; wastes the genuine parallelism the dependency graph permits (export and OAuth-wizard are independent of the core data flow). Retained as the fallback if no Vivi fan-out is authorized.
- **H3 — risk-first / Google-sync-first (Alt-B ethos).** Rejected: builds the hardest surface against an unstable event model, risking sync rework when the model settles. The ADRs already retired most sync architecture risk, so front-loading it buys less than it costs. (Its spirit is preserved: OAuth provisioning, S6.1, *is* pulled early as a parallel side-track.)

---

## 5. Story hierarchy

```
THEME    Jin — sovereign, integrated notes + tasks + calendar (one owner-controlled model)
PROJECT  MVP "Integrated Thin Slice"
  FEATURE A  Sovereign Store & Index Foundation     → S1, S2
  FEATURE B  CLI / DTO Interface Contract            → S3
  FEATURE C  Primitives, Linking & Promote           → S4, S5
  FEATURE D  Google Calendar Sync                     → S6.1, S6.2, S6.3
  FEATURE E  Merged Agenda & Sovereignty Export       → S7, S8
  FEATURE F  Test Strategy (cross-cutting)            → S9
```

Each story below carries: user story · timebox · risk tag (P0 blocks release / P1 degrades / P2 cosmetic) · dependencies · GIVEN/WHEN/THEN acceptance criteria · technical context · agent hint.

---

### S1 — Store & schema *(Feature A · ≤3d · P0 · depends: none)*

**As** the owner, **I want** a versioned, human-readable on-disk store with stable identity and tombstones **so that** my data is sovereign, greppable, and diff/merge-friendly from day one.

**Action plan:** Create `jin-core` crate skeleton + workspace; define Note/Task/Event frontmatter structs (serde) per §3; ULID identity; `jin init` to scaffold `<root>` + `.jin/` subtree + `config.toml` (with `schema_version`); soft-delete tombstone semantics; on-disk edge representation in source frontmatter.

**Acceptance criteria**
- **GIVEN** an empty target directory, **WHEN** `jin init --root <path>` runs, **THEN** it creates `notes/ tasks/ events/ .jin/{sync/}` and a `config.toml` stamped with `schema_version`, and is idempotent (re-running does not clobber existing data).
- **GIVEN** a new Note / Task / Event, **WHEN** it is written, **THEN** it is exactly one file with valid YAML frontmatter conforming to §3, a ULID `id`, a `type` discriminator, and `created`/`updated` timestamps.
- **GIVEN** an existing object, **WHEN** it is soft-deleted, **THEN** a tombstone is recorded (notes/tasks: `status: deleted` + `deleted_at`; events: `status: cancelled`), the file is retained, and the deletion is distinguishable from "never existed."
- **GIVEN** an Event written for a single (non-recurring) occurrence, **THEN** all RFC-5545 fields in §3.4 are present (recurrence fields empty/null), with temporal values stored as local wall-time + IANA tzid (un-normalized).
- **GIVEN** `promote`/`attach` will write edges, **THEN** the schema places edges **only** in the source object's `links[]` / `derived_from` (no backlink fields on disk).

**Technical context:** `jin-core/src/model/{note,task,event,edge}.rs`, `jin-core/src/store/fs.rs`, `config.rs`; crates `serde`, `serde_yaml`, `ulid`, `chrono`/`chrono-tz`.
**Agent hint:** Vivi (builder). Kupo viable for the `config.toml` schema + exit-code enum micro-tasks.

---

### S2 — Index & deterministic rebuild *(Feature A · ≤5d · P0 · depends: S1)*

**As** the owner, **I want** a private SQLite index that is a pure deterministic function of my files **so that** queries are fast and I can delete and rebuild it with zero information loss.

**Action plan:** Define the **private** SQLite schema (tables: `notes`, `tasks`, `events`, `edges`, derived `backlinks`, `recurrence_expansion` cache, optional FTS); implement a content-ordered (sort by `id`) scan→parse→populate rebuild; resolve edges and **materialise backlinks** in-index; detect+report dangling edges; mark/refresh dirty on writes. Implement the rebuild-equivalence test (VG1).

**Acceptance criteria**
- **GIVEN** a populated canonical store, **WHEN** `index.sqlite` is deleted and rebuilt, **THEN** every query (`today`, list, `show`, backlinks) returns **byte-identical** results to before deletion (VG1 — the rebuild-equivalence regression test).
- **GIVEN** edges stored source-side, **WHEN** the index rebuilds, **THEN** each target's backlinks are materialised in-index and queryable from either endpoint, while **no backlink is written to any file**.
- **GIVEN** an edge whose target is missing or tombstoned, **WHEN** the index rebuilds, **THEN** the dangling edge is recorded and surfaced by a `jin doctor`/diagnostic query — never silently dropped.
- **GIVEN** the rebuild runs twice on identical inputs, **THEN** it produces identical index query results (no wall-clock or nondeterministic ordering leaks into derived data).
- **GIVEN** a consumer (CLI `--json`, future GUI), **THEN** it obtains data only through `jin-core` DTOs and **never** opens `index.sqlite` directly (VG4).

**Technical context:** `jin-core/src/index/{schema.rs,rebuild.rs,query.rs}`; crate `rusqlite 0.38` (`bundled`). Rebuild must be insertion-order-independent (deterministic by `id`).
**Agent hint:** Vivi (reasoning-leaning — determinism is subtle).

---

### S3 — CLI grammar & versioned DTO contract *(Feature B · ≤3d · P0 · depends: S2)*

**As** an engineer, **I want** a complete CLI with `--json` parity and stable exit codes **so that** I can script everything and the future GUI consumes the same DTOs.

**Action plan:** Define the clap verb grammar; the versioned DTO envelope; human vs `--json` rendering for every command; exit-code taxonomy. Verbs: `init`, `note {add|edit|show|list|rm}`, `task {add|edit|show|list|rm|done}`, `event {add|edit|show|list|rm}`, `link`, `attach`, `promote`, `today`, `sync`, `export`, `capture`.

**Decisions fixed here:**
- **DTO envelope:** `{ "jin_dto_version": "1", "kind": "<note|task|event|list|agenda|result>", "data": {…}, "warnings": [] }` — projections only, never raw rows; version-tagged and decoupled from storage internals.
- **`link` vs `attach`:** `attach <note> <target> [--kind …]` is the note-centric sugar (ADR-0001: default `prep-for` for Event, `references` for Task/Note). `link <source> <target> --type <edge>` is the general typed-edge creator, **validated against the three allowed signatures** (rejects any edge outside the vocabulary). `[SPEC]`
- **`capture <text> [--task] [--list …]`:** minimal-friction quick add → a Note by default (or Task with `--task`); prints the new id (JTBD-6).
- **Exit codes:** `0` ok · `2` usage (clap) · `3` not-found · `4` sync-conflict surfaced · `5` auth/OAuth error (re-auth needed) · `6` offline/network · `7` integrity/index error · `1` other.

**Acceptance criteria**
- **GIVEN** any command, **WHEN** invoked with `--json`, **THEN** it emits a single valid DTO envelope with `jin_dto_version` and **no raw SQLite columns** leak across the boundary (VG3).
- **GIVEN** the same command without `--json`, **THEN** it renders a human-readable form carrying the same information (parity).
- **GIVEN** `link a b --type relates-to` (outside the vocabulary), **THEN** it fails with exit 2 and an explanatory message; **GIVEN** a valid signature, **THEN** the edge is created.
- **GIVEN** a not-found id / a sync conflict / an expired token / no network, **THEN** the documented exit code (3/4/5/6) is returned and reflected in the `--json` `result`.

**Technical context:** `jin/src/main.rs` (clap), `jin-core/src/dto/*.rs`; crates `clap`, `serde_json`.
**Agent hint:** Vivi. Kupo viable for the exit-code enum + DTO-envelope struct.

---

### S4 — Tasks & Notes CRUD *(Feature C · ≤3d · P0 · depends: S3 · parallelizable with S5)*

**As** the owner, **I want** full CRUD over Markdown notes and stateful tasks **so that** the capture/plan surface is usable daily.

**Action plan:** Implement note add/edit/show/list/rm (Markdown body + frontmatter); task add/edit/show/list/rm/done with the §3.3 state machine, priority, due, list membership; wire soft-delete; refresh index on each write.

**Acceptance criteria**
- **GIVEN** `note add --title T`, **THEN** a `notes/<ULID>--<slug>.md` file is created with valid frontmatter and is immediately listable/showable.
- **GIVEN** a task in `todo`, **WHEN** `task done <id>`, **THEN** `status=done` and `completed_at` is set; **WHEN** reopened, **THEN** `status=todo` and `completed_at` cleared.
- **GIVEN** an illegal transition (e.g. `done → doing` is allowed only via reopen), **THEN** the transition rules in §3.3 are enforced and violations are rejected with a clear error.
- **GIVEN** `task list --list inbox --status todo`, **THEN** only matching, non-tombstoned tasks are returned, sorted deterministically.
- **GIVEN** any create/edit/delete, **THEN** the canonical file is written **first**, then the index refreshed (file-truth ordering).

**Technical context:** `jin-core/src/ops/{notes,tasks}.rs`; reuses S1 model + S2 index.
**Agent hint:** Vivi (builder). **Parallel track A** after M1.

---

### S5 — Local Events + linking & promote *(Feature C · ≤5d · P0 · depends: S3; soft-needs S4 for cross-link test)*

**As** the owner, **I want** correct single-event temporal handling plus `promote` and `attach` **so that** a task can become a calendar event and notes can be attached without duplication or drift.

**Action plan:** Implement local event CRUD with timezone/all-day/floating correctness (explicit `chrono-tz` `Ambiguous`/`None` handling); `promote(task, when)`; `attach(note, target, kind?)`; edge integrity + derived backlinks via S2.

**Acceptance criteria**
- **GIVEN** a timed event in `America/Sao_Paulo`, **WHEN** stored, **THEN** `start`/`end` are local wall-time + `start_tzid`/`end_tzid` un-normalized; any `start_utc` is index-derived only.
- **GIVEN** a wall-time that is DST-ambiguous or nonexistent, **WHEN** resolving to an instant, **THEN** the `chrono-tz` `Ambiguous`/`None` case is handled explicitly (surfaced/flagged) and **never silently guessed** (VG9).
- **GIVEN** an all-day event, **THEN** `is_all_day=true`, `value_type=date`, no time, no tz.
- **GIVEN** a task with (or without) a due date, **WHEN** `promote <task> --when <slot>`, **THEN** a **new** Event is created with its own ULID, copied title, and the supplied/inferred temporal slot; a `derived-from` edge Event→Task is written into the **event** frontmatter; and the **task file is byte-unchanged** (VG6).
- **GIVEN** `attach <note> <event>` with no `--kind`, **THEN** a `prep-for` edge is written into the **note** frontmatter only; the event file is unchanged and its "prep-notes" backlink is derived at rebuild (VG6).
- **GIVEN** any promote/attach, **WHEN** the index rebuilds from scratch, **THEN** the backlinks reappear identically (ties into VG1).

**Technical context:** `jin-core/src/ops/{events,promote,attach}.rs`, `jin-core/src/time/tz.rs`; crates `chrono-tz 0.10.x`, `icalendar 0.17.x` (value formatting). Edges via S1 schema + S2 resolver.
**Agent hint:** Vivi (reasoning-leaning — tz/DST + edge-integrity correctness). **Parallel track B** after M1; the note→event cross-link integration test requires S4 merged.

---

### S6.1 — OAuth onboarding wizard & token storage *(Feature D · ≤3d · P0 · depends: S3; parallelizable with S4/S5)*

**As** the owner, **I want** a guided, secretless OAuth setup with resilient token storage **so that** Jin can reach my Google Calendar without a baked-in secret and without weekly re-auth.

**Action plan:** First-run wizard that instructs GCP project + Calendar API + consent-screen provisioning, **including publishing the consent screen to "In production"** (unverified is acceptable for personal use) to avoid the ~7-day refresh-token expiry that "Testing" status imposes on sensitive Calendar scopes; PKCE auth-code flow with loopback `127.0.0.1:<ephemeral-port>` redirect, `access_type=offline`, `prompt=consent`, scope `calendar.events`; token storage via `keyring 3.6.x` (per-OS backend features enabled in `Cargo.toml`) with a **mandatory** AEAD-encrypted-file fallback for headless Linux (no Secret Service); a token-refresh/re-auth error-recovery path.

**Acceptance criteria**
- **GIVEN** first-run, **WHEN** the wizard runs, **THEN** it walks the owner through GCP provisioning and **explicitly instructs publishing the consent screen to "In production"**, citing the 7-day Testing-status token expiry for sensitive scopes.
- **GIVEN** owner-provided client credentials, **WHEN** auth proceeds, **THEN** it uses PKCE + loopback redirect, requests `calendar.events` only (not broad `calendar`), and obtains a refresh token (`access_type=offline`).
- **GIVEN** a working Secret Service, **THEN** tokens are stored via `keyring`; **GIVEN** none (headless Linux), **THEN** they are stored in the AEAD-encrypted-file fallback — both paths exercised in tests (VG: token-storage dual-path).
- **GIVEN** an expired/`invalid_grant` refresh token, **WHEN** any sync runs, **THEN** Jin attempts refresh; on failure it returns exit `5` with actionable re-auth instructions (the recovery path), never a silent hang.
- **GIVEN** the repo were published, **THEN** **no** client secret is shipped (BYO-client; the installed-app secret is non-confidential and PKCE removes reliance on it).

**Technical context:** `jin-core/src/google/auth.rs`, `secrets.rs`; crates `keyring 3.6.x`, an OAuth/PKCE helper + HTTP client, an AEAD crate for the fallback.
**Agent hint:** Vivi (builder). **Parallel side-track** — independent of the data model; can start during M2.

---

### S6.2 — Sync loop & bidirectional field mapping *(Feature D · ≤5d · P0 · depends: S1, S5, S6.1)*

**As** the owner, **I want** an incremental, crash-safe sync loop that maps fields both directions **so that** promoted events publish to Google and company events mirror locally — single events bidirectional, recurring mirrored read-only.

**Action plan:** Implement the ADR-0004 state machine — BOOTSTRAP (`events.list` paginate `pageToken`→persist mirror→`nextSyncToken`), INCREMENTAL (`syncToken`; `410 fullSyncRequired` → wipe+full re-sync), PUSH (outbox drain: `insert` with client-specified base32hex(ULID) id / `patch`+`If-Match` / `delete`+`If-Match`); the DEC-S4 field mapping both directions; mirror Google-source events as flagged files (`source: google`, `authority: google`); store recurring masters/exceptions **verbatim** flagged `recurrence_unexpanded`; durable identity in file, volatile cursors in `.jin/sync/`; offline = always-succeed local writes + outbox enqueue.

**Acceptance criteria**
- **GIVEN** no `sync_token`, **WHEN** `jin sync`, **THEN** BOOTSTRAP pages with `pageToken`, persists each event to the mirror with its map+etag+`google_updated`, and stores the final `nextSyncToken`.
- **GIVEN** a stored `sync_token`, **WHEN** `jin sync`, **THEN** INCREMENTAL applies deltas (incl. `status=cancelled` deletes) and persists the new `nextSyncToken`; **GIVEN** HTTP `410`, **THEN** the token is discarded and a full re-sync runs (safe).
- **GIVEN** a promoted (Jin-origin) event in the outbox, **WHEN** pushed, **THEN** `events.insert` supplies `id = base32hex(ULID)` (charset `a-v0-9`, 5–1024 chars) making the insert idempotent/crash-safe; the returned `etag`/`updated` are stored and `dirty` cleared.
- **GIVEN** a Google-authored event arrives, **THEN** it is written as a human-readable mirror file flagged `source: google, authority: google`; its `ical_uid` is in the file (so the map is rebuildable) while `etag`/`sync_token` stay in `.jin/sync/`.
- **GIVEN** a recurring Google event, **THEN** master (`recurrence[]`) + exceptions (`recurring_event_id`+`original_start`) are stored **verbatim** and flagged `recurrence_unexpanded: true`; a recurring **write** is **not** attempted (deferred).
- **GIVEN** no network, **WHEN** any local mutation occurs, **THEN** the file write succeeds and an outbox entry is enqueued; `jin sync` with no network returns exit `6` and blocks nothing.
- **GIVEN** a Google `events` resource, **THEN** the DEC-S4 mapping (ADR-0004 table) holds both directions, round-tripping `start.dateTime+timeZone`/`start.date`, `recurrence[]`, `iCalUID`, `status`, etc., losslessly (VG5).

**Technical context:** `jin-core/src/google/{client.rs,sync.rs,mapping.rs}`, `jin-core/src/sync/{outbox.rs,state.rs}`; crates HTTP client, `icalendar`, `rrule`, `rusqlite` (sync-state db), `ulid`→base32hex transform.
**Agent hint:** Vivi (reasoning-class — the state machine + idempotency + lossless mapping are the highest-subtlety work). **Critical path.**

---

### S6.3 — Conflict resolution & audit log *(Feature D · ≤3d · P0 · depends: S6.2)*

**As** the owner, **I want** deterministic, auditable conflict handling **so that** the source-of-truth matrix holds in practice and no resolution is silent.

**Action plan:** Implement the per-class conflict policy + the append-only exportable audit log (`.jin/sync/audit.jsonl`); the "authority by authorship" matrix in practice.

**Acceptance criteria**
- **GIVEN** a promoted (Jin-canonical) event diverges (pull-diverged or push-`412`), **THEN** resolution is **etag-guarded LWW by `updated`** (compare `google_updated` vs `local_updated`, newer wins; **tie → Jin**), and every conflict + the losing snapshot is appended to the audit log.
- **GIVEN** a company (Google-canonical, `authority: google`) event with a conflicting local edit, **THEN** **Google wins (remote-wins)**, the overwritten local delta is captured to the audit log **before** being discarded, and editing such an object emits a warning.
- **GIVEN** the Google replica of a **promoted** event is deleted remotely, **THEN** Jin treats it as **unpublish** (sever the publish link, mark `unpublished`, audit) and **does NOT delete the Jin-canonical object** (owner-confirmed policy).
- **GIVEN** a Google-authored event is `status=cancelled` remotely, **THEN** the local mirror is removed (index tombstone); a local "delete" of a mirror stops mirroring only and never calls `events.delete`.
- **GIVEN** any conflict, **THEN** the audit entry records timestamp, `jin_id`, `google_event_id`/`ical_uid`, conflict type (`pull-diverged`/`push-412`/`remote-delete-of-promoted`), both versions' key fields (or a diff), policy applied, winner, and the loser snapshot — and the log is human-readable JSONL, append-only, and export-included (VG8).

**Technical context:** `jin-core/src/sync/conflict.rs`, `audit.rs`. Deterministic (no interactive prompt in MVP).
**Agent hint:** Vivi (reasoning-leaning). **Critical path.**

---

### S7 — `today` merged agenda *(Feature E · ≤2d · P0 · depends: S5; merged view needs S6.2)*

**As** the owner, **I want** one merged day view of personal-local + company-Google events with reachable linked notes **so that** I stop app-dancing and double-booking.

**Action plan:** Merge local + mirrored events for a date; render in the owner's display tz; surface linked notes (derived backlinks) and the originating task for promoted events; flag unexpanded recurring events.

**Acceptance criteria**
- **GIVEN** local events + mirrored Google events for a day, **WHEN** `jin today`, **THEN** a single agenda is rendered in `config.display_tz`, sorted by start, all-day events grouped, with no source-based fragmentation.
- **GIVEN** an event with `prep-for`/`references` backlinks, **THEN** the agenda shows the linked note(s) and they are reachable (id/title surfaced) (JTBD-2).
- **GIVEN** a promoted event, **THEN** the originating task is surfaced via the `derived-from` backlink (JTBD-1).
- **GIVEN** a mirrored recurring event flagged `recurrence_unexpanded`, **THEN** it is shown labelled "recurring (not expanded)" rather than silently omitted or mis-expanded.
- **GIVEN** `--json`, **THEN** the agenda is emitted as a DTO with the same content as the human view (parity).

**Technical context:** `jin-core/src/ops/agenda.rs`, `jin-core/src/dto/agenda.rs`; uses S2 queries + S5 tz rendering.
**Agent hint:** Vivi (builder).

---

### S8 — Export / backup (sovereignty acceptance) *(Feature E · ≤2d · P0 · depends: S1; parallelizable with Feature D)*

**As** the owner, **I want** every byte exportable and human-readable **so that** "my notes are mine" is literally true and verifiable.

**Action plan:** Implement `jin export <dest>` emitting the canonical files + `audit.jsonl` in human-readable form, excluding index/sync-state/tokens; implement the sovereignty round-trip regression test (VG2).

**Acceptance criteria**
- **GIVEN** a populated store, **WHEN** `jin export <dest>`, **THEN** all `notes/ tasks/ events/` files **plus `.jin/sync/audit.jsonl`** are emitted in their human-readable form, and `index.sqlite`, `sync-state.sqlite`, `outbox.jsonl`, `tokens.enc` are **excluded**.
- **GIVEN** an export, **WHEN** every exported file is opened in a plain text editor / `grep`, **THEN** it is fully human-readable (no binary blob is required to read owner data) — the sovereignty acceptance test.
- **GIVEN** an export, **WHEN** it is imported into a fresh `jin init`'d root and the index rebuilt, **THEN** all queries (`today`, list, backlinks) return identical results (round-trip equivalence, VG2).
- **GIVEN** a mirrored company event (`authority: google`), **THEN** it is included in the export as a readable file and clearly flagged non-sovereign cache.

**Technical context:** `jin-core/src/ops/export.rs`; pure filesystem copy + manifest, no DB dependency.
**Agent hint:** Vivi (builder). **Cleanest parallel track** — depends only on S1.

---

### S9 — Test strategy *(Feature F · ≤3d · P0 · cross-cutting · scaffold parallelizable after S3)*

**As** the maintainer, **I want** a layered test strategy with deterministic Google-sync tests **so that** the hard invariants are protected against regression and CI is hermetic.

**Action plan:** Establish unit + integration test harness; **recorded HTTP cassettes** (e.g. `wiremock`-style recorded fixtures) for Google sync in CI (hermetic, deterministic) + an **optional, gated, non-CI sandbox-account smoke test**; property tests for tz/DST (`chrono-tz` `Ambiguous`/`None`) and for base32hex(ULID) id charset/length; the rebuild-equivalence test (VG1, lands with S2) and sovereignty round-trip test (VG2, lands with S8) as standing regression gates.

**Acceptance criteria**
- **GIVEN** CI, **WHEN** Google-sync tests run, **THEN** they use **recorded cassettes** (no live network, no real account), covering BOOTSTRAP, INCREMENTAL, `410` re-sync, push `insert`/`patch`/`delete`, and the three conflict types.
- **GIVEN** a developer with a sandbox Google account, **WHEN** the gated smoke test is explicitly enabled, **THEN** a minimal live round-trip (create→push→pull→delete) is exercised — but this test is **never** required in CI.
- **GIVEN** the rebuild-equivalence test (VG1), **THEN** it deletes the index, rebuilds, and asserts byte-identical query results.
- **GIVEN** the sovereignty regression test (VG2), **THEN** it asserts export → fresh-init → rebuild yields identical results and every exported byte is human-readable.
- **GIVEN** tz/DST property tests, **THEN** ambiguous/nonexistent local times are asserted to surface explicitly (never silently coerced).

**Technical context:** `jin-core/tests/*`, `jin/tests/*`; recorded-cassette fixtures under `tests/fixtures/google/`; property-test crate (`proptest`). 
**Agent hint:** Vivi (builder) for harness; VIGIL owns the standing regression gates (maker ≠ checker).

---

## 6. Build sequence, milestones & parallelization

### 6.1 Dependency graph

```
S1 ──► S2 ──► S3 ─┬─────────────────────────────► S4  (track A)
                  ├─────────────────────────────► S5 ──► S6.2 ──► S6.3 ──► S7(merged)
                  ├─────────────────────────────► S6.1 (track, joins S6.2)
                  ├─────────────────────────────► S8  (track, independent of sync)
                  └─────────────────────────────► S9-scaffold (harness)
S7(local-only) can land after S5; the *merged* agenda needs S6.2.
```

**Critical path:** S1 → S2 → S3 → S5 → S6.2 → S6.3 → S7(merged).

### 6.2 Milestones

| Milestone | Stories | Gate to exit |
|---|---|---|
| **M1 — Foundation** *(sequential)* | S1 → S2 → S3 | VG1 (rebuild-equivalence) green; VG3/VG4 (`--json` parity, no direct SQLite); `jin init` + one primitive round-trips. |
| **M2 — Primitives & spine** *(parallel)* | S4 ∥ S5 (∥ S6.1 ∥ S8 ∥ S9-scaffold) | Tasks/notes CRUD + state machine; promote/attach with VG6 (additive-write) + VG9 (DST); local `today`. |
| **M3 — Google sync** *(mostly sequential, on the stable event model)* | S6.1 (if not done in M2) → S6.2 → S6.3 | VG5 (lossless round-trip), VG7 (idempotent/crash-safe push), VG8 (conflict audit), VG10 (soft-delete propagation). |
| **M4 — Agenda & sovereignty** | S7(merged) + S8 + S9 standing gates | Hero flow end-to-end; VG2 (sovereignty round-trip); full DoD (VG11). |

### 6.3 Parallelizable stories — for a potential Vivi fan-out

After **M1 completes (S3 done)**, these run as independent tracks with low merge risk:

- **Track A — S4 (Tasks & Notes):** independent of events; merges cleanly.
- **Track B — S5 (Events + linking/promote):** on the critical path; the note→event cross-link *integration test* needs S4 merged, but the code does not.
- **Track C — S6.1 (OAuth wizard + token storage):** fully independent of the data model — strongest parallel candidate.
- **Track D — S8 (export/backup):** depends only on S1's canonical layout; independent of all of Feature D — second strongest parallel candidate.
- **Track E — S9 scaffolding (test harness + cassettes):** can be stood up right after S3.

**Recommendation for the orchestrator:** fan out **A, C, D, E in parallel** alongside the critical-path **B (S5)** after M1. Keep **S6.2 → S6.3 → S7(merged)** single-track (tight sequential coupling + shared sync-state). If no fan-out is authorized, fall back to the H1 sequential order: S1→S2→S3→S4→S5→S6.1→S6.2→S6.3→S7→S8→S9.

---

## 7. Validation gates (build-wide) & Definition of Done

| Gate | Assertion | Owning story |
|---|---|---|
| **VG1 Rebuild-equivalence** | delete index → rebuild → byte-identical query results | S2 |
| **VG2 Sovereignty round-trip** | export → fresh init → rebuild → identical results; every exported byte human-readable | S8 |
| **VG3 `--json` parity** | every command has a versioned-DTO `--json` form; no raw rows cross the boundary | S3 |
| **VG4 No-direct-SQLite** | only `jin-core` opens `index.sqlite`; schema stays private | S2/S3 |
| **VG5 RFC-5545 fidelity** | recurring mirror stored verbatim; field mapping round-trips losslessly | S6.2 |
| **VG6 Additive-write linking** | `promote`/`attach` mutate only the source file; target byte-unchanged; backlink derived | S5 |
| **VG7 Sync idempotency/crash-safety** | client-specified base32hex(ULID) id; `If-Match` etag; outbox re-runnable, no dupes | S6.2 |
| **VG8 Conflict-audit completeness** | every conflict logged with both versions + policy + winner + loser snapshot | S6.3 |
| **VG9 DST correctness** | `chrono-tz` `Ambiguous`/`None` handled explicitly, never silently guessed | S5 |
| **VG10 Soft-delete distinguishability** | tombstones; "deleted" ≠ "never existed"; correct delete propagation | S1/S6.x |
| **VG11 DoD (discovery §6)** | AC met (GWT) · tests green · ADR recorded for any new architectural choice · sovereignty invariant holds · `--json` parity preserved · docs/changelog updated | all |

**Definition of Done (per discovery §6), applied to every story:** (1) GWT acceptance criteria met; (2) verifier/tests green; (3) any architectural choice recorded as an ADR; (4) sovereignty invariant holds (P1 regression check — VG2); (5) CLI `--json` parity preserved (P3 guardrail — VG3); (6) docs/changelog updated.

---

## 8. Test strategy summary (S9 detail)

- **Unit:** model serde round-trips; state-machine transitions; tz/DST resolution (property tests over `Ambiguous`/`None`); base32hex(ULID) charset/length property test; field-mapping pure functions.
- **Integration:** `jin init`→CRUD→promote→attach→`today` over a temp root; rebuild-equivalence (VG1); sovereignty round-trip (VG2).
- **Google sync:** **recorded HTTP cassettes** in CI (hermetic) covering BOOTSTRAP, INCREMENTAL, `410 fullSyncRequired` re-sync, push insert/patch/delete, and the three conflict types + audit assertions. An **optional gated sandbox-account smoke test** (env-flag, never in CI) for a real round-trip.
- **Token storage:** both `keyring` and the encrypted-file fallback paths exercised (simulate "no Secret Service").
- **Standing regression gates owned by VIGIL** (maker ≠ checker): VG1, VG2, VG5, VG7, VG8.

---

## 9. Verification (6-layer) & confidence

| Layer | Result |
|---|---|
| **Structural** | Theme→Project→6 Features→11 Stories→tasks; all 9 mandated components mapped; no orphans. **PASS** |
| **Self-consistency** | 3 decompositions (by-component / by-dependency-layer / by-milestone) converge on the same 11 atomic units (≥70% overlap). **PASS** |
| **Dependency** | Crate deps + `jin-core` module paths named per story; sync sequenced after the stable event model; `.jin/sync` vs index split resolved explicitly. **PASS** |
| **Constraint** | All §2 invariants + the verified crate pins honored; timeboxes ≤8d each (max ≤5d); NFRs (rebuild determinism, sovereignty, `--json`, no-direct-SQLite, soft-delete, encrypted-file fallback) each have a VG. **PASS** |
| **Process reward** | Foundation-first ordering proves the load-bearing invariant (VG1) before anything depends on it; sync on a stable model minimizes rework. **PASS** |
| **Adversarial** | Checked: under-spec (every story has GWT); dependency blindness (sync after S5); the ADR-0002↔0004 sync-state-location tension (resolved: operational state in `.jin/sync/`, outside the index, audit-log export-included); DST ambiguity (VG9); OAuth 7-day expiry (wizard + recovery path); base32hex id charset (VG7); tombstones vs hard delete (VG10); scope creep into deferred items (explicit guardrail §1.5). **PASS** |

**Confidence: 90% → AUTO_PROCEED.** Factors (each /3): Pattern match 3 (ADRs as ≥85% templates) · Requirement clarity 2.5 (residual owner-confirm gaps) · Decomposition stability 3 (self-consistent) · Constraint compliance 3 → (11.5/12) discounted to **0.90** to honour the inherited M-reliability Google-API/crate assumptions and the open owner-confirm items.

---

## 10. `[GAP]` / `[ASSUMPTION]` / owner-confirm ledger

- `[ASSUMPTION]` (inherited, ADR-0004) Google OAuth refresh-token **7-day expiry under "Testing"** status for sensitive Calendar scopes; "In production" (unverified) yields long-lived tokens. The wizard hard-codes the production-publishing instruction **and** a re-auth recovery path so the spec is safe either way. *Verify against current Google docs at build time.*
- `[ASSUMPTION]` (inherited) `syncToken`/`410 fullSyncRequired`, client-specified event-id charset (`a-v0-9`, 5–1024), `If-Match`/etag concurrency, PKCE+loopback for installed apps — per training knowledge; confirm against current docs during S6.2.
- `[OWNER-CONFIRM]` **Remote-delete-of-promoted-event = unpublish (keep the Jin object)**, not destroy. Specced as confirmed per the mandate; flagged here as the `[DISPUTED]` policy from ADR-0004 for final owner sign-off.
- `[OWNER-CONFIRM]` **DEC-C company-calendar privacy posture** — taken as *mirroring permitted* (mandate states company events are mirrored as flagged non-sovereign cache). If the employer's policy forbids local copies, S6.2's mirror strategy must shift to a no-store stance (would partially break offline `today`).
- `[GAP]` (inherited, ADR-0003) **Owner Rust fluency / DEC-I time posture** — the one DEC-03 sensitivity. The mandate treats Rust as committed; an optional ≤1-week Rust spike before M1 remains the cheapest de-risk if velocity is in doubt. Not a spec blocker.
- `[GAP]` Success metric baseline (discovery DISCOVER) is still unquantified; the hero-flow demonstration is the proxy acceptance for MVP.
- `[SPEC]` `link` (general typed-edge creator, vocabulary-validated) vs `attach` (note-centric sugar) split, and slug derivation for note filenames — minor, decided in S3/S1; non-foreclosing.

---

## 11. Recommended next handoff

- **Vivi → build Milestone 1 (S1 → S2 → S3)** as the first track; VG1/VG3/VG4 are the exit gate. This is the load-bearing spine; nothing parallelizes before it.
- **After M1, orchestrator decides a Vivi fan-out:** parallel tracks **A (S4)**, **C (S6.1)**, **D (S8)**, **E (S9-scaffold)** alongside critical-path **B (S5)**; keep **S6.2 → S6.3 → S7(merged)** single-track.
- **Kupo** for the ≤2-file micro-tasks: exit-code enum, DTO envelope struct, `config.toml` schema, base32hex(ULID) encoder helper.
- **VIGIL** owns the standing regression gates (VG1, VG2, VG5, VG7, VG8) — maker ≠ checker.
- **IDG** chronicles per-milestone and records any new architectural choice as an ADR (DoD item 3).

---

## 12. Machine-readable handoff (embedded)

```yaml
spec:
  id: mvp-integrated-thin-slice
  project: jin
  type: REQUEST
  tier: standard
  complexity: 11            # /12
  confidence: 0.90
  decision: AUTO_PROCEED
  architecture_source: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
  crate_pins:
    rrule: "0.14"
    icalendar: "0.17.x"
    chrono-tz: "0.10.x"
    keyring: "3.6.x"
    rusqlite: "0.38 (bundled)"
    tauri: "2.11.x (deferred)"
    other: [clap, serde, serde_json, serde_yaml, ulid, "http-client(reqwest|ureq)", proptest]

hero_flow: "note -> task (+references) -> promote(task)->event -> bidirectional Google sync -> jin today merged agenda with linked note reachable -> exportable/human-readable"

stories:
  - id: S1
    title: Store & schema
    feature: A-store-index-foundation
    user_story: "As the owner, I want a versioned human-readable store with stable identity and tombstones so my data is sovereign and merge-friendly."
    timebox: "<=3d"
    risk: P0
    depends_on: []
    parallelizable: false
    agent_hint: vivi-builder
    context_files: ["jin-core/src/model/*", "jin-core/src/store/fs.rs", "config.rs"]
    acceptance:
      - given: "empty target dir"
        when: "jin init --root <path>"
        then: "creates notes/ tasks/ events/ .jin/{sync/} + config.toml with schema_version; idempotent"
      - given: "new note/task/event"
        when: "written"
        then: "single file, valid YAML frontmatter per schema, ULID id, type discriminator, created/updated"
      - given: "existing object"
        when: "soft-deleted"
        then: "tombstone recorded (status deleted/cancelled + deleted_at), file retained, distinguishable from never-existed"
      - given: "single (non-recurring) event"
        then: "all RFC-5545 fields present (recurrence empty); local wall-time + IANA tzid un-normalized"
      - given: "edge schema"
        then: "edges only in source links[]/derived_from; no backlink fields on disk"

  - id: S2
    title: Index & deterministic rebuild
    feature: A-store-index-foundation
    user_story: "As the owner, I want a private SQLite index that is a pure deterministic function of my files so queries are fast and the index is disposable."
    timebox: "<=5d"
    risk: P0
    depends_on: [S1]
    parallelizable: false
    agent_hint: vivi-reasoner
    context_files: ["jin-core/src/index/{schema,rebuild,query}.rs"]
    acceptance:
      - given: "populated canonical store"
        when: "index.sqlite deleted and rebuilt"
        then: "every query returns byte-identical results (VG1)"
      - given: "source-side edges"
        when: "index rebuilds"
        then: "backlinks materialised in-index, queryable both ends, none written to disk"
      - given: "edge with missing/tombstoned target"
        when: "rebuild"
        then: "dangling edge reported via diagnostic, never silently dropped"
      - given: "rebuild run twice on identical inputs"
        then: "identical query results (no nondeterminism leaks)"
      - given: "any consumer"
        then: "obtains data only via jin-core DTOs; never opens index.sqlite (VG4)"

  - id: S3
    title: CLI grammar & versioned DTO contract
    feature: B-cli-dto-contract
    user_story: "As an engineer, I want a complete CLI with --json parity and stable exit codes so I can script everything and the GUI consumes the same DTOs."
    timebox: "<=3d"
    risk: P0
    depends_on: [S2]
    parallelizable: false
    agent_hint: vivi-builder
    context_files: ["jin/src/main.rs", "jin-core/src/dto/*"]
    verbs: [init, "note{add,edit,show,list,rm}", "task{add,edit,show,list,rm,done}", "event{add,edit,show,list,rm}", link, attach, promote, today, sync, export, capture]
    dto_envelope: '{ jin_dto_version:"1", kind, data, warnings[] }'
    exit_codes: { ok: 0, usage: 2, not_found: 3, sync_conflict: 4, auth: 5, offline: 6, integrity: 7, other: 1 }
    acceptance:
      - given: "any command with --json"
        then: "single valid DTO envelope with jin_dto_version; no raw SQLite columns leak (VG3)"
      - given: "same command without --json"
        then: "human-readable form with same information (parity)"
      - given: "link with edge type outside vocabulary"
        then: "fails exit 2; valid signature creates edge"
      - given: "not-found / conflict / expired token / no network"
        then: "documented exit code 3/4/5/6 returned and reflected in --json"

  - id: S4
    title: Tasks & Notes CRUD
    feature: C-primitives-linking
    user_story: "As the owner, I want full CRUD over Markdown notes and stateful tasks so the daily surface is usable."
    timebox: "<=3d"
    risk: P0
    depends_on: [S3]
    parallelizable: true
    parallel_track: A
    agent_hint: vivi-builder
    context_files: ["jin-core/src/ops/{notes,tasks}.rs"]
    acceptance:
      - given: "note add --title T"
        then: "notes/<ULID>--<slug>.md created, valid frontmatter, listable/showable"
      - given: "task in todo"
        when: "task done <id>"
        then: "status=done + completed_at; reopen clears it"
      - given: "illegal transition"
        then: "state-machine rules enforced; violation rejected clearly"
      - given: "task list filters"
        then: "only matching non-tombstoned tasks, deterministic sort"
      - given: "any create/edit/delete"
        then: "file written first, then index refreshed"

  - id: S5
    title: Local Events + linking & promote
    feature: C-primitives-linking
    user_story: "As the owner, I want correct single-event temporal handling plus promote/attach so a task can become an event and notes attach without drift."
    timebox: "<=5d"
    risk: P0
    depends_on: [S3]
    soft_depends_on: [S4]
    parallelizable: true
    parallel_track: B-critical-path
    agent_hint: vivi-reasoner
    context_files: ["jin-core/src/ops/{events,promote,attach}.rs", "jin-core/src/time/tz.rs"]
    acceptance:
      - given: "timed event in America/Sao_Paulo"
        then: "start/end local wall-time + tzid un-normalized; start_utc index-derived only"
      - given: "DST-ambiguous/nonexistent wall-time"
        then: "chrono-tz Ambiguous/None handled explicitly, never silently guessed (VG9)"
      - given: "all-day event"
        then: "is_all_day=true, value_type=date, no time, no tz"
      - given: "promote <task> --when <slot>"
        then: "new Event (own ULID, copied title, slot) + derived-from edge in EVENT frontmatter; task file byte-unchanged (VG6)"
      - given: "attach <note> <event> (no kind)"
        then: "prep-for edge in NOTE frontmatter only; event unchanged; backlink derived (VG6)"
      - given: "promote/attach then full rebuild"
        then: "backlinks reappear identically (VG1)"

  - id: S6.1
    title: OAuth onboarding wizard & token storage
    feature: D-google-sync
    user_story: "As the owner, I want guided secretless OAuth with resilient token storage so Jin reaches Google without a baked-in secret or weekly re-auth."
    timebox: "<=3d"
    risk: P0
    depends_on: [S3]
    parallelizable: true
    parallel_track: C
    agent_hint: vivi-builder
    context_files: ["jin-core/src/google/auth.rs", "jin-core/src/google/secrets.rs"]
    acceptance:
      - given: "first-run wizard"
        then: "walks GCP provisioning; explicitly instructs publishing consent screen to 'In production' citing 7-day Testing-status token expiry"
      - given: "owner client credentials"
        when: "auth proceeds"
        then: "PKCE + loopback 127.0.0.1 redirect, scope calendar.events only, access_type=offline -> refresh token"
      - given: "Secret Service present vs absent"
        then: "keyring path vs AEAD-encrypted-file fallback; both exercised in tests"
      - given: "expired/invalid_grant refresh token"
        when: "sync runs"
        then: "attempt refresh; on failure exit 5 with re-auth instructions (recovery path)"
      - given: "published repo"
        then: "no client secret shipped (BYO-client; PKCE)"

  - id: S6.2
    title: Sync loop & bidirectional field mapping
    feature: D-google-sync
    user_story: "As the owner, I want an incremental crash-safe sync loop mapping fields both directions so promoted events publish and company events mirror; recurring mirrored read-only."
    timebox: "<=5d"
    risk: P0
    depends_on: [S1, S5, S6.1]
    parallelizable: false
    parallel_track: critical-path
    agent_hint: vivi-reasoner
    context_files: ["jin-core/src/google/{client,sync,mapping}.rs", "jin-core/src/sync/{outbox,state}.rs"]
    acceptance:
      - given: "no sync_token"
        when: "jin sync"
        then: "BOOTSTRAP pages with pageToken, persists mirror + map+etag+google_updated, stores nextSyncToken"
      - given: "stored sync_token"
        when: "jin sync"
        then: "INCREMENTAL applies deltas incl status=cancelled deletes; 410 -> discard token + full re-sync"
      - given: "promoted event in outbox"
        when: "pushed"
        then: "events.insert id=base32hex(ULID) idempotent; store etag/updated, clear dirty"
      - given: "Google-authored event arrives"
        then: "written as readable mirror file flagged source/authority=google; ical_uid in file; etag/sync_token in .jin/sync"
      - given: "recurring Google event"
        then: "master+exceptions stored verbatim, recurrence_unexpanded=true; no recurring write attempted"
      - given: "no network local mutation"
        then: "file write succeeds + outbox enqueued; jin sync returns exit 6, blocks nothing"
      - given: "Google events resource"
        then: "DEC-S4 mapping round-trips both directions losslessly (VG5)"

  - id: S6.3
    title: Conflict resolution & audit log
    feature: D-google-sync
    user_story: "As the owner, I want deterministic auditable conflict handling so the source-of-truth matrix holds and no resolution is silent."
    timebox: "<=3d"
    risk: P0
    depends_on: [S6.2]
    parallelizable: false
    parallel_track: critical-path
    agent_hint: vivi-reasoner
    context_files: ["jin-core/src/sync/{conflict,audit}.rs"]
    acceptance:
      - given: "promoted event diverges (pull-diverged or push-412)"
        then: "etag-guarded LWW by updated, tie->Jin; conflict + loser snapshot audited"
      - given: "company event (authority=google) with conflicting local edit"
        then: "remote-wins; overwritten local delta audited before discard; edit warns"
      - given: "Google replica of promoted event deleted remotely"
        then: "unpublish (sever link, mark unpublished, audit); Jin object NOT deleted"
      - given: "Google-authored event status=cancelled remotely"
        then: "local mirror removed (index tombstone); local mirror delete never calls events.delete"
      - given: "any conflict"
        then: "audit entry: ts, jin_id, google_event_id/ical_uid, type, both versions/diff, policy, winner, loser snapshot; JSONL append-only export-included (VG8)"

  - id: S7
    title: today merged agenda
    feature: E-agenda-sovereignty
    user_story: "As the owner, I want one merged day view of local + Google events with reachable linked notes so I stop app-dancing and double-booking."
    timebox: "<=2d"
    risk: P0
    depends_on: [S5]
    soft_depends_on: [S6.2]
    parallelizable: false
    agent_hint: vivi-builder
    context_files: ["jin-core/src/ops/agenda.rs", "jin-core/src/dto/agenda.rs"]
    acceptance:
      - given: "local + mirrored events for a day"
        when: "jin today"
        then: "single agenda in config.display_tz, sorted by start, all-day grouped, no source fragmentation"
      - given: "event with prep-for/references backlinks"
        then: "linked notes shown and reachable (JTBD-2)"
      - given: "promoted event"
        then: "originating task surfaced via derived-from backlink (JTBD-1)"
      - given: "mirrored recurring event recurrence_unexpanded"
        then: "shown labelled 'recurring (not expanded)', not omitted/mis-expanded"
      - given: "--json"
        then: "agenda DTO with same content as human view (parity)"

  - id: S8
    title: Export / backup (sovereignty acceptance)
    feature: E-agenda-sovereignty
    user_story: "As the owner, I want every byte exportable and human-readable so 'my notes are mine' is literally true and verifiable."
    timebox: "<=2d"
    risk: P0
    depends_on: [S1]
    parallelizable: true
    parallel_track: D
    agent_hint: vivi-builder
    context_files: ["jin-core/src/ops/export.rs"]
    acceptance:
      - given: "populated store"
        when: "jin export <dest>"
        then: "emits notes/tasks/events + .jin/sync/audit.jsonl human-readable; excludes index.sqlite/sync-state.sqlite/outbox.jsonl/tokens.enc"
      - given: "exported files opened in text editor / grep"
        then: "fully human-readable; no binary blob required (sovereignty acceptance)"
      - given: "export imported into fresh init + rebuild"
        then: "all queries identical (round-trip equivalence, VG2)"
      - given: "mirrored company event (authority=google)"
        then: "included as readable file, flagged non-sovereign cache"

  - id: S9
    title: Test strategy
    feature: F-test-strategy
    user_story: "As the maintainer, I want a layered strategy with deterministic Google-sync tests so hard invariants are protected and CI is hermetic."
    timebox: "<=3d"
    risk: P0
    depends_on: [S3]
    parallelizable: true
    parallel_track: E
    agent_hint: vivi-builder + vigil-gates
    context_files: ["jin-core/tests/*", "jin/tests/*", "tests/fixtures/google/*"]
    acceptance:
      - given: "CI"
        when: "Google-sync tests run"
        then: "recorded cassettes (no live net): BOOTSTRAP, INCREMENTAL, 410 re-sync, push insert/patch/delete, 3 conflict types"
      - given: "developer with sandbox account + explicit flag"
        then: "gated live round-trip smoke test; never required in CI"
      - given: "rebuild-equivalence test"
        then: "delete index -> rebuild -> byte-identical results (VG1)"
      - given: "sovereignty regression test"
        then: "export -> fresh init -> rebuild identical + every byte human-readable (VG2)"
      - given: "tz/DST property tests"
        then: "ambiguous/nonexistent local times surface explicitly, never coerced (VG9)"

milestones:
  - id: M1
    name: Foundation
    stories: [S1, S2, S3]
    mode: sequential
    exit_gate: [VG1, VG3, VG4]
  - id: M2
    name: Primitives & spine
    stories: [S4, S5]
    parallel_with: [S6.1, S8, S9]
    exit_gate: [VG6, VG9]
  - id: M3
    name: Google sync
    stories: [S6.1, S6.2, S6.3]
    mode: mostly-sequential
    exit_gate: [VG5, VG7, VG8, VG10]
  - id: M4
    name: Agenda & sovereignty
    stories: [S7, S8, S9]
    exit_gate: [VG2, VG11]

critical_path: [S1, S2, S3, S5, S6.2, S6.3, S7]
parallel_tracks_after_M1:
  A: [S4]
  B_critical: [S5]
  C: [S6.1]
  D: [S8]
  E: [S9-scaffold]
fan_out_recommendation: "Run A, C, D, E in parallel alongside critical-path B; keep S6.2->S6.3->S7(merged) single-track."

validation_gates:
  VG1: "rebuild-equivalence: delete index -> rebuild -> byte-identical queries (owner S2)"
  VG2: "sovereignty round-trip: export -> fresh init -> rebuild identical; every byte human-readable (owner S8)"
  VG3: "--json parity: versioned DTO every command; no raw rows cross boundary (owner S3)"
  VG4: "no-direct-SQLite: only jin-core opens index.sqlite; schema private (owner S2/S3)"
  VG5: "RFC-5545 fidelity: recurring mirror verbatim; lossless field round-trip (owner S6.2)"
  VG6: "additive-write linking: promote/attach mutate only source; target unchanged; backlink derived (owner S5)"
  VG7: "sync idempotency/crash-safety: base32hex(ULID) id + If-Match etag + re-runnable outbox (owner S6.2)"
  VG8: "conflict-audit completeness: both versions + policy + winner + loser snapshot (owner S6.3)"
  VG9: "DST correctness: chrono-tz Ambiguous/None explicit, never guessed (owner S5)"
  VG10: "soft-delete distinguishability: tombstones; deleted != never-existed; correct propagation (owner S1/S6.x)"
  VG11: "DoD (discovery 6): AC met + tests green + ADR recorded + sovereignty holds + --json parity + docs updated (all)"

deferred_not_foreclosed:
  - recurrence-write
  - rich-notes-block-editor
  - multi-device-crdt-sync
  - gui-tauri
  - push-channels-events-watch
  - multi-account-multi-calendar
  - caldav-other-providers
  - two-stream-singleEvents-display
  - task-event-completion-propagation

gaps_and_owner_confirm:
  - "[ASSUMPTION] Google OAuth 7-day Testing-status token expiry; In-production yields long-lived (verify at build)."
  - "[ASSUMPTION] syncToken/410, client-event-id charset a-v0-9/5-1024, If-Match/etag, PKCE+loopback (verify at build)."
  - "[OWNER-CONFIRM] remote-delete-of-promoted = unpublish (keep), not destroy."
  - "[OWNER-CONFIRM] DEC-C: company-calendar mirroring permitted (assumed yes per mandate)."
  - "[GAP] owner Rust fluency / DEC-I time posture; optional <=1wk spike before M1 (not a blocker)."
  - "[GAP] success-metric baseline unquantified; hero-flow demo is the MVP proxy."
  - "[SPEC] link(general, vocabulary-validated) vs attach(note sugar); note slug derivation."

next_handoff:
  - "vivi: build M1 (S1->S2->S3); exit gate VG1/VG3/VG4."
  - "orchestrator: after M1, optional Vivi fan-out tracks A/C/D/E alongside critical-path B."
  - "kupo: micro-tasks (exit-code enum, DTO envelope struct, config.toml schema, base32hex(ULID) helper)."
  - "vigil: standing regression gates VG1/VG2/VG5/VG7/VG8 (maker != checker)."
  - "idg: chronicle per milestone; record new architectural choices as ADRs."
```

---

*SPECTRA — standard-tier planning cycle. READ-ONLY throughout; no code produced. CRYSTALIUM memory hooks gracefully skipped (tools unavailable; EIIS-standalone-conformant). ECL envelope sidecar emitted (ECL_VERSION 2.0 present).*
