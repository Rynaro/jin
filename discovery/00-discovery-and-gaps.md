# Jin — Discovery & Gap Analysis

> **Codename:** Jin · **Mode:** SPECTRA / DISCOVER (open-ended elicitation + gap analysis) · **Date:** 2026-06-26
> **Status:** Discovery artifact. This is **not** a spec and **not** an implementation plan. Its job is to frame the problem, surface every decision that must be resolved before build, and recommend the immediate next step.
> **Audience:** the owner (a senior engineer) + the Eidolons pipeline (FORGE / SPECTRA / Vivi / IDG).

---

## DISCOVER — Elicitation Summary

- **Stakeholders:** the **owner** (single power user, senior engineer) is requester, sole affected party, and sole approver. Open-sourcing is explicitly *"a bonus, not a goal"* → no external approval chain. `[GAP]` future OSS community is a *potential* later stakeholder, not a current one.
- **Latent goal:** not "build a notes app." The real outcome is **eliminate the cognitive tax of context-switching across siloed personal tools AND regain sovereignty over personal knowledge** — make notes, tasks, and calendar one connected, owner-owned memory so *nothing falls through the cracks* and *"my notes are mine."*
- **Success metrics:** `[GAP]` — no measurable baseline was stated. Provisional success signals proposed in §1.
- **Hard constraints:** local-first / sovereign canonical store; **Google Calendar bidirectional integration first** (company calendar); **CLI-first headless core**, GUI later; integration-first (one connected model, not three silos); eventual GUI targets Apple HIG / Liquid Glass; run the project with **defined procedures**, gaps resolved before full implementation.
- **Non-goals (current):** team/multi-user collaboration; OSS as a *driver*; Logseq/Obsidian-class PKM depth on day one; real-time multi-device CRDT collaboration; building a from-scratch calendar UI when Google is the priority; AI features; reminders/notifications polish.
- **Coverage:** **4/5 axes resolved** (success metrics is the lone `[GAP]`). → Proceeding to synthesis; no escalation required.

---

## 1. Problem Framing

### Problem statement

A senior engineer lives a dual life — a **personal** sphere and a **company** sphere (Google Workspace) — and the artifacts of that life (notes, todos, calendar events) are scattered across three-or-more disconnected apps. This imposes two distinct costs:

1. **Cognitive tax / fragmentation.** Constant app-dancing and manual reconciliation, most acutely between a **personal calendar** and a **company Google calendar**. Todos that deserve real time aren't on the calendar; notes that should prep an event are stranded elsewhere; quick captures rot because nothing resurfaces them.
2. **Loss of sovereignty.** The notes that matter most live in someone else's cloud, so *"my notes aren't mine."* Portability and ownership are not optional.

**Jin's job:** make **notes ↔ tasks ↔ calendar a single, owner-controlled, bidirectionally-linked model** — surfaced first through a **scriptable CLI/headless core**, and later through an **Apple-HIG visual layer** that consumes that same core.

This is precisely the white space product.md identifies: *"native, bidirectional, first-class integration of personal notes + task management + calendar events in one data model with self-host support — remains unsolved in 2026"* (Gap Analysis: The Unsolved Triangle).

### Non-negotiable principles

| # | Principle | What it means concretely |
|---|---|---|
| **P1** | **Sovereignty / local-first** | The canonical store for owner-authored data is on storage the owner controls, in an open/portable format, rebuildable and exportable, with **no mandatory cloud**. |
| **P2** | **Integration-first** | Notes, tasks, and events are **one linked model** with bidirectional references and "promote/attach" operations — not three silos bridged by import/export. This is *the* headline value. |
| **P3** | **CLI-first / headless core** | The engine is a library + CLI with a complete, stable interface. Any GUI is a **pure consumer** of that core — no logic forks into the GUI. |
| **P4** | **Google Calendar priority** | External-calendar integration **starts** with *bidirectional* Google Calendar sync (the company calendar). Local calendar is good; Google is first. |

### Provisional success signals (closes the `[GAP]`, owner to confirm)

- The owner runs `jin` daily as the **single capture + plan surface** and **retires at least one incumbent app**.
- **Personal calendar + company Google calendar appear in one pane** (`jin today`) with no double-booking.
- The three hero flows work end-to-end: **promote a todo to a calendar event**, **attach prep notes to an appointment**, **link reference notes to a task**.
- Every byte of owner-authored data is **exportable and human-readable** at any time (sovereignty acceptance test).

### Key tension to make explicit `[DISPUTED]`

**P1 (sovereignty) and P4 (Google first) pull in opposite directions** — Google Calendar is the antithesis of a sovereign store; its data lives on Google's servers, and bidirectional sync means owner data *leaves* the machine while company data *enters* it. product.md flags exactly this for Huly: *"Google sync still routes through [the tool's] integration infrastructure rather than purely through your own server — a data residency concern for privacy-maximal users."* The framing that resolves the tension (to be confirmed by FORGE + owner): **Jin holds the canonical copy of owner-authored data; Google is a sync *peer* for the company calendar — which the owner does not fully own anyway.** Per-object source-of-truth is itself an open decision (see DEC-09).

---

## 2. Personas & Jobs-to-be-Done

### Primary (and effectively only) persona — "The Sovereign Operator"

A senior engineer; Linux as the daily dev driver; strong Apple taste for the *eventual* GUI; juggles a **personal** life and a **company** role on **Google Workspace**. Lives in the terminal, automates by reflex, has low tolerance for lock-in, and treats their notes as a long-lived personal asset. Wants a serious, durable tool — built like corporate software, not a weekend hack.

### Jobs-to-be-done (the cited scenarios, as JTBD)

| ID | Job (When… I want… so that…) | Triangle edge exercised |
|---|---|---|
| **JTBD-1** *(promote-to-calendar)* | When a todo becomes important/time-bound, I want it to **also surface on my calendar** (without retyping) so it competes for real time. | task ↔ event |
| **JTBD-2** *(context-for-event)* | When I have an appointment (e.g., a doctor's visit), I want my **prep notes attached to that event** so I walk in prepared and capture outcomes in the same place. | note ↔ event |
| **JTBD-3** *(reference-for-task)* | When a task needs reference material, I want the relevant **notes linked** so I don't hunt across apps. | note ↔ task |
| **JTBD-4** *(dual-calendar, one pane)* | When planning my day, I want my **personal calendar and company Google calendar in one view** so I stop app-dancing and double-booking. | local + Google |
| **JTBD-5** *(sovereign capture)* | When I write a note, I want it stored in a **format I own** (greppable, portable, backup-able) so it's mine forever. | sovereignty (P1) |
| **JTBD-6** *(nothing-forgotten)* | When I capture quickly, I want it to **resurface at the right time/place** so notes and todos don't rot. | linking + temporal surfacing |
| **JTBD-7** *(scriptable)* | As an engineer, I want to **drive everything from the CLI/scripts** so the tool bends to my workflow and automation. | CLI-first (P3) |

JTBD-1 and JTBD-2 are the **hero flows** — they are the differentiator made tangible. The "note-as-event" half of JTBD-2 is the pattern product.md praises in NotePlan/AFFiNE but notes *"neither supports writing events back"* (Strategic Observation #3) — Jin's bidirectionality is the wedge.

---

## 3. The Core Differentiator as a Design Problem *(framed, not solved)*

product.md states the architectural reason the triangle is unsolved: *"notes need a rich content model (blocks, links, hierarchies); tasks need a structured workflow model (statuses, priorities, recurring rules, assignees); calendar needs temporal precision (VEVENT, VTODO, VFREEBUSY, recurrence rules, timezone handling). Merging all three without one domain dominating and degrading the others requires purpose-built data modeling that no current tool has fully executed."*

Below is **what makes this hard** — the problem surface FORGE must deliberate on. (Recommendations are deferred to §5; this section only frames.)

**A. Three incompatible "shapes," one model.** Notes are free-form, hierarchical, linkable rich content. Tasks are a state machine + scheduling + priority + recurrence. Events are precise temporal objects (start/end/timezone/recurrence). A naïve "one super-entity" collapses the distinctions (one domain dominates — the documented failure mode); three foreign-keyed tables risk **rebuilding the silos** the product exists to abolish. The design problem: a substrate where each primitive keeps its native depth **and** they share first-class links.

**B. The dual-nature / "promote" problem.** *"A todo important enough that it must also appear on the calendar."* Is that **one object viewed two ways**, or **two linked objects**? Likewise a note that spawns a task, or an event that needs a note. The model must represent an object's participation in multiple temporal/work contexts **without duplication or drift** — this is the literal mechanism of integration-first (P2).

**C. Calendar correctness is unforgiving.** Recurrence (RFC 5545 `RRULE`), exceptions (`EXDATE` / `RECURRENCE-ID`), all-day vs. timed, IANA timezones + DST, and floating times are a notorious correctness minefield. product.md's survey shows nearly every competitor *punts* here — read-only iCal feeds (AFFiNE), `VTODO`-only "early alpha" CalDAV (Vikunja), or system-calendar pass-through (NotePlan/EventKit). Doing real, writable `VEVENT`/`RRULE` is exactly where the field stops — and exactly the white space (Strategic Observations #1, #3, #5). Google's API forces RFC-5545 fidelity regardless, so this cannot be hand-waved.

**D. Bidirectional Google sync.** OAuth for a *local-first / would-be-OSS* app (you cannot ship a client secret); token storage on the owner's machine; the Google Calendar incremental-sync model (sync tokens, optional push channels); mapping Google's event resource to Jin's model both ways; **conflict resolution** when Jin and Google both edit the same event; offline behavior; and the **dual-calendar reality** (one or more Google accounts/calendars + local). Underneath all of it: **which side is canonical per object?**

**E. Sovereignty vs. power (the storage tension).** Plain-text/Markdown maximizes ownership (greppable, portable, diff-able) but is weak at relational queries, recurrence expansion, and indexing. A database (e.g., SQLite) is powerful but is a binary blob that *feels* less "yours." Logseq lived this exact arc — product.md documents its two-year **markdown-graph ↔ DB-graph unification** (7,322 commits) and its self-host sync pain (Syncthing/Nextcloud, *"edge cases on Android"*). Jin must get **both**: an owner-readable canonical store **and** fast queryability.

**F. The CLI-core ↔ future-GUI contract.** The core must expose a **complete, stable, headless interface** so an Apple-HIG GUI is a pure consumer (P3) — never a logic fork. The shape of that interface (embeddable library vs. local daemon + IPC vs. shared DB) and the runtime that hosts it constrain *everything* downstream, including whether the GUI can share the core's language. design.md's Apple ethos — *"design leads engineering"* (ANPP) and *content-leads-chrome* (Clarity/Deference/Depth/Harmony, Liquid Glass as a real-time material) — is the **forward constraint** the headless API must not foreclose, even though the GUI is out of MVP scope.

---

## 4. Candidate MVP Boundary

**Design rule:** the MVP must demonstrate the **triangle**, not one corner — a *thin but genuinely-integrated vertical slice*. A notes-only or calendar-only MVP would validate nothing about the actual differentiator.

### Recommended MVP — "The Integrated Thin Slice"

A CLI core over a unified local store that delivers **one end-to-end hero demonstration**:

> Create a **note** → create a **task**, link the note (JTBD-3) → **promote** the task to a calendar **event** (JTBD-1) → that event **syncs bidirectionally** to Google Calendar (P4) → `jin today` shows a **merged agenda** (personal-local + company-Google) with the linked note reachable (JTBD-2, JTBD-4) — all data **exportable/human-readable** (P1).

**In scope:**
- **Unified model + link substrate** — the spine (Note / Task / Event primitives + first-class bidirectional links).
- **Notes** — plain-text/Markdown CRUD in an owner-controlled store. *(Not a block editor / knowledge graph.)*
- **Tasks** — CRUD with status, due date, list membership.
- **Events** — local CRUD with a *correct single-event temporal model* (timezone-aware start/end, all-day).
- **Links** — bidirectional references across all three; **promote** (task→event) and **attach** (note→{task,event}).
- **Google Calendar** — OAuth + **bidirectional** sync for **one** account/calendar; **single (non-recurring) events first**; incremental sync token; a **basic, audited conflict policy**.
- **CLI** — capture, query/list, `today` (merged agenda), link, promote, sync; **`--json` output parity** from day one (keeps the future GUI unblocked).

**Explicitly deferred (with rationale):**
- **Recurrence beyond a trivial case** — high complexity; but see DEC-11 — *some* basic recurrence may be needed for daily usefulness, so the **model** must support RFC-5545 even if the **implementation** is a subset. `[GAP]` owner to set the line (DEC-B).
- **Rich notes** (block editor, backlink graph, embeds, attachments) — MVP = Markdown + simple links; ambition set by DEC-E.
- **Multiple Google accounts / CalDAV server / other providers** — one account first; design for more.
- **The GUI entirely** (Apple HIG/Liquid Glass) — core first (P3).
- **Multi-device sync / CRDT** for the local store — single machine first (DEC-G).
- **Reminders/notifications, time-blocking, NLP quick-add, AI, collaboration.**

### Alternatives considered

- **Alt-A — Notes-first MVP** (sovereign notes + links only; defer calendar/Google). *Rejected:* proves nothing about the differentiator (integration + bidirectional Google), which is the entire point.
- **Alt-B — Calendar-sync-first MVP** (Google bidirectional + local events; notes/tasks later). *Strong fallback.* It de-risks the **hardest technical surface** (bidirectional Google sync) earliest. *Not recommended as the primary* because it doesn't demonstrate the triangle and risks degenerating into "another calendar client." **Recommend if** the owner wants to retire integration risk before investing in the model.
- **Alt-C — Full triangle with recurrence + rich notes.** *Rejected:* violates thin-slice; maximal rework risk; this is precisely the "boil the ocean" trap that leaves the triangle unsolved.

---

## 5. OPEN DECISIONS LEDGER

The heart of this document. Each entry is tagged **exactly one** of `[USER-DECISION]` (owner-only), `[FORGE]` (hard architectural trade-off → structured deliberation), or `[SPEC]` (normal spec work once the above are fixed). Provisional recommendations are offered where warranted; they are **inputs to FORGE/owner, not verdicts.**

### `[FORGE]` — architectural trade-offs needing deliberation

| ID | Title | Why it matters | Realistic options | Provisional recommendation |
|---|---|---|---|---|
| **DEC-01** | **Unified data-model shape** | The central decision; determines whether one domain dominates (the documented failure mode) or the silos quietly re-form. | (a) single polymorphic super-entity; (b) **three typed primitives + first-class typed link/edge table**; (c) general graph model. | **(b)** — typed primitives retain native depth; links are the explicit product feature. Confirm vs. (c). |
| **DEC-02** | **Canonical storage format (sovereignty vs. queryability)** | P1 vs. power; the exact tension Logseq spent 2 years resolving (product.md). | (a) plain Markdown+frontmatter files; (b) SQLite only; (c) **hybrid: human-owned files canonical + SQLite as a rebuildable derived index**; (d) append-only event log. | **(c)** — files = sovereignty (greppable, portable, exportable); SQLite = fast queries/link resolution, fully rebuildable from files. |
| **DEC-03** | **Language / runtime for the core** | Must serve the CLI *now* and a future Apple-HIG GUI *later* (P3); tightly coupled to DEC-D (target OS). | (a) **Swift** (share core with an Apple GUI, native Liquid Glass; weaker Linux story today); (b) **Rust** (perf, single binary, portable, FFI to Swift); (c) Go (simple, weaker Swift interop); (d) TS/Node (fast iteration, weak as a sovereign local daemon). | **Defer to FORGE, gated on DEC-D.** Lean **Swift** if GUI is Apple-only; **Rust** if cross-platform/portability dominates. |
| **DEC-04** | **CLI-core ↔ future-GUI interface contract** | Decides the process model and whether the GUI can be a pure consumer (P3). | (a) **embeddable library + thin CLI** (+ local daemon/JSON-RPC if GUI language differs); (b) GUI reads the SQLite directly; (c) HTTP/gRPC local service. | **(a)** — stable, fully-capable headless API; avoid (b) (couples GUI to storage internals, breaks the sovereignty/projection boundary). |
| **DEC-05** | **Google Calendar sync architecture** | The hardest surface (§3-D); OAuth-secret problem for a local/OSS app. | (a) **direct Google Calendar API** (REST + sync tokens; optional push); (b) via a CalDAV bridge; OAuth client: **owner-provisioned client ID/secret** (not shipped) vs. a hosted broker. | **(a) + owner-provisioned OAuth client**, tokens in the OS secret store. Solves the OSS-secret problem and keeps it sovereign-ish. |
| **DEC-06** | **Local-first sync / conflict strategy** | Whether/how the owner's *own* machines share the store; gated on DEC-G. | (a) **single-machine for MVP**; (b) file-sync the canonical layer (Syncthing/iCloud/git) + deterministic SQLite rebuild; (c) build a CRDT engine; (d) last-write-wins + audit log. | **(a) now**, design toward **(b)**. Mirrors product.md's Logseq+Syncthing pattern; avoid building a CRDT engine prematurely. |
| **DEC-07** | **Recurrence & timezone model** | The correctness minefield where every competitor stops; Google forces RFC-5545 fidelity. | (a) **adopt RFC 5545 semantics internally** (`RRULE`/`EXDATE`/`RECURRENCE-ID`, IANA tz, all-day vs timed) from day one, implement a subset; (b) simplified internal model + lossy iCal mapping. | **(a)** — model full RFC-5545 even if MVP implements only single + simplest recurrence; retrofitting recurrence later is brutal. |
| **DEC-08** | **Linking semantics & dual-nature ("promote")** | The literal mechanism of P2; how JTBD-1 is represented. | (a) **typed bidirectional edges** (`prep-for`, `derived-from`, `references`); promote = new Event + `derived-from` link to the Task; (b) shared-identity dual-typed object; (c) duplication + soft-sync. | **(a)** — keep objects distinct so each keeps native fields/lifecycle; auto-maintain backlinks. Confirm vs. (b). |
| **DEC-09** | **Per-object source-of-truth & residency architecture** | Resolves the §1 P1↔P4 tension at the data layer (the *architecture* half; the *policy* half is DEC-C). | (a) **mirror** Google data into the local store; (b) **live read-through** (à la NotePlan/EventKit — not stored); (c) hybrid per calendar. | **Hybrid, gated on DEC-C:** Google authoritative for company events, Jin authoritative for local/owner events; mirror only if policy permits. |

### `[USER-DECISION]` — owner-only (scope, priorities, taste, privacy posture)

| ID | Title | Why it matters | Provisional lean |
|---|---|---|---|
| **DEC-A** | **MVP scope confirmation** | Integrated thin slice (recommended) vs. Google-sync-first (Alt-B). | Integrated thin slice — unless de-risking Google sync first is preferred. |
| **DEC-B** | **Recurrence in MVP** | Daily usefulness vs. timeline; recurring meetings are common on a company calendar. | Model full RFC-5545; implement single + daily/weekly only in MVP. |
| **DEC-C** | **Company (Google) calendar privacy posture** | May Jin store a *local copy* of company-calendar events, or live read-through only? Owner knows the employer's policy/residency rules. (Gates DEC-09.) | `[GAP]` — owner-only knowledge. |
| **DEC-D** | **Target OS for the eventual GUI** | Apple HIG implies Apple; but the daily driver is Linux. Drives DEC-03/DEC-04. | `[GAP]` — likely macOS/iOS given the HIG love; confirm. |
| **DEC-E** | **Notes power ceiling** | Plain Markdown forever vs. eventual Logseq/Obsidian-class graph. Sets long-term ambition + informs the model. | Plain Markdown + links for MVP; design model to not foreclose richer notes. |
| **DEC-F** | **Open-source posture** | Public from day one vs. private-first. Affects OAuth-secret handling, license, repo hygiene. | Private-first (OSS is "a bonus, not a goal"); design as if it *could* go public. |
| **DEC-G** | **Single-machine vs. multi-device** | Does Jin need to run on multiple of the owner's machines/phone with sync? Gates DEC-06. | `[GAP]` — single-machine for MVP unless stated otherwise. |
| **DEC-H** | **Tolerance for running infra (daemon/server)** | Strictly local single-process vs. willingness to run a small daemon/sync service (affects Google push + DEC-04/06). | Single-process CLI for MVP; daemon only if justified. |
| **DEC-I** | **Time/effort posture** | Long-burn personal project vs. time-boxed. Calibrates MVP ambition. | `[GAP]`. |
| **DEC-J** | **Mobile capture priority** | JTBD-6 capture-anywhere often implies mobile; may pull the GUI/runtime decision (DEC-D). | Out of MVP; flag as a force on DEC-D if mobile is wanted later. |

### `[SPEC]` — normal spec work once the above are fixed

- **DEC-S1** CLI verb grammar & UX (`capture`, `note`, `task`, `event`, `link`, `promote`, `today`, `sync`, `export`); human vs. `--json` output contract.
- **DEC-S2** Note file layout & frontmatter schema (naming, directory structure, metadata fields).
- **DEC-S3** Task schema & state-transition rules (status enum, priority, due, list membership).
- **DEC-S4** Event ↔ Google event-resource field mapping (both directions).
- **DEC-S5** Config location/format; OAuth credential & token storage mechanism (keychain / OS secret store / encrypted file).
- **DEC-S6** Object identity scheme (UUID/ULID), timestamps, soft-delete, store schema versioning/migration.
- **DEC-S7** Error handling, exit codes, sync-status reporting.
- **DEC-S8** Test strategy & fixtures; how Google sync is tested (mock vs. sandbox account / recorded cassettes).
- **DEC-S9** Backup/export commands (the sovereignty hygiene surface — directly serves the P1 acceptance test).

---

## 6. Proposed "Defined Procedures" (lightweight SDLC for Jin)

The owner asked to *"treat this like a serious corporate software project: defined procedures, gaps resolved before all hands."* This repo already runs the **Eidolons** pipeline (EIDOLONS.md). Proportional procedure for a one-person-but-serious project:

### Per-feature flow

```
DISCOVER (this doc, once per major theme)
  → DECIDE     FORGE deliberates each [FORGE] gap → ADR;  owner resolves each [USER-DECISION]
  → SPEC       SPECTRA produces one plan per feature/slice  → .spectra/plans/
  → BUILD      Vivi implements against the plan (Kupo for ≤2-file micro-tasks)
  → VERIFY     tests/verifier gate;  VIGIL on regressions  (maker ≠ checker)
  → DOCUMENT   IDG chronicles + updates ADR/changelog
```

This maps cleanly onto the Eidolons **`decide-then-implement`** chain (FORGE → SPECTRA → Vivi) and the optional **ESL** lifecycle (`propose → [deliberate] → implement → verify → drift → archive`) the cortex already references — run **lite** mode for most features, **full** only for the architectural gates below.

### Where artifacts live

| Artifact | Location | Owner |
|---|---|---|
| Discovery & gap docs | `discovery/` | SPECTRA/DISCOVER |
| **ADRs** (one per resolved `[FORGE]` decision, MADR-style) | `docs/adr/NNNN-title.md` *(proposed)* | FORGE → IDG |
| Feature specs / plans | `.spectra/plans/` | SPECTRA |
| Code | repo per DEC-03 outcome | Vivi |
| Chronicle / runbook | `docs/` *(proposed)* | IDG |

### Definition of Done (proportional)

1. Acceptance criteria met (GIVEN/WHEN/THEN).
2. Verifier/tests green.
3. Any architectural choice it made is recorded as an **ADR**.
4. **Sovereignty invariant holds** — data remains owner-readable, portable, and exportable (P1 regression check; ties to DEC-S9).
5. **CLI `--json` parity preserved** — the future GUI stays unblocked (P3 guardrail).
6. Docs/changelog updated.

### Gate before "all hands" (full implementation)

Per the owner's mandate, resolve the **high-leverage `[FORGE]` decisions** (DEC-01, DEC-02, DEC-03+DEC-04, DEC-05) **and** the **gating `[USER-DECISION]`s** (DEC-A, DEC-C, DEC-D, DEC-G) **before** broad build. Recurrence/timezone (DEC-07) and dual-nature (DEC-08) should be decided before the model is frozen. This is the discovery-gate that keeps the project from re-forming the silos it exists to abolish.

---

## 7. Recommended Next Step

**Run a FORGE deliberation on the 2–4 highest-leverage architecture decisions, with the gating owner decisions resolved in parallel — then a SPECTRA spec for the recommended MVP slice.**

1. **FORGE session** on, in priority order: **DEC-01** (data-model shape) + **DEC-08** (linking/dual-nature) as a pair → **DEC-02** (sovereign storage) → **DEC-03 + DEC-04** (runtime + GUI contract, *after* DEC-D) → **DEC-05** (Google bidirectional sync) with **DEC-07** (recurrence/timezone) and **DEC-09** (source-of-truth) as constraints. Each emits an ADR.
2. **Owner resolves in parallel:** DEC-A (MVP scope), DEC-C (company-calendar privacy posture), DEC-D (target OS), DEC-G (multi-device) — these unblock the FORGE work.
3. **Then SPECTRA** writes the spec for "The Integrated Thin Slice" (§4), and **Vivi** builds.

> `[GAP]` markers above (success metrics, DEC-C/D/G/I) require owner input before or during step 2 — they are owner-only knowledge and must not be assumed.
