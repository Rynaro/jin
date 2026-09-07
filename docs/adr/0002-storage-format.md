# 0002 — Canonical Storage Format

- **Status:** Proposed
- **Date:** 2026-06-26
- **Deciders:** Owner (sole approver) · authored by FORGE
- **Covers:** DEC-02 (canonical storage format — sovereignty vs. queryability)
- **Decision type:** TRADE-OFF / CONSTRAINT-SATISFACTION
- **Depends on:** ADR-0001 (data model & link representation)

---

## Context

P1 (sovereignty) wants greppable, portable, diff-able, owner-readable files with
no mandatory cloud. Relational queries (`jin today` merged agenda, link/backlink
resolution, "tasks due this week"), future recurrence expansion (RFC-5545), and
Google sync-state want a database. `product.md` documents that Logseq spent two
years and 7,322 commits resolving exactly this **markdown-graph ↔ DB-graph**
tension — a direct, high-reliability precedent.

The store must satisfy the sovereignty acceptance test — *"every byte exportable
and human-readable at any time"* — **and** support the single-machine → file-sync
(Syncthing/git) + deterministic index-rebuild path **without a rewrite**. It must
also house Google-mirrored company events (mirroring is owner-permitted) and the
RFC-5545 fields ADR-0001 requires the Event primitive to carry.

## Decision Drivers

- **[CONSTRAINT] P1 acceptance test** — canonical bytes must be human-readable at
  any time. This is the decisive hard constraint.
- **[CONSTRAINT] Queryability** — fast merged-agenda, link/backlink traversal,
  recurrence expansion.
- **[CONSTRAINT] File-sync-later without rewrite (DEC-06/DEC-G)** — merge-friendly
  granularity + deterministic rebuild on each machine.
- **[CONSTRAINT] Language-agnostic / portable** (P3; owner: cross-platform, not
  Swift-bound) — open formats only.
- **RFC-5545 home (DEC-07)** — canonical events must hold full temporal fields;
  recurrence *expansion* must have a derivable home that is not canonical.
- **Crisp sovereignty boundary** — operational sync-state (Google tokens/etags)
  must not pollute the "owner-readable canonical" guarantee.

## Considered Options

- **(a) Plain Markdown + frontmatter files only** (no DB).
- **(b) SQLite only** (DB canonical; export to Markdown on demand).
- **(c) Hybrid** — human-owned files are canonical; SQLite is a **rebuildable
  derived index**.
- **(d) Append-only event log** (event-sourcing as the canonical substrate).

## Decision Outcome

**Option (c): hybrid — human-owned files are canonical; SQLite is a fully
rebuildable derived index.**

- **(b) is eliminated by the hard P1 acceptance test:** a binary SQLite blob is
  not "human-readable at any time"; export-on-demand makes the readable form a
  derived snapshot, not the canonical truth. It is also the weakest for
  file-sync (whole-file binary conflicts, no line-level merge).
- **(a) fails the queryability half:** link/backlink traversal and recurrence
  expansion become O(all files) per command, and Google sync-state has no natural
  home in owner-authored note files.
- **(d) loses human-readable current state:** reading "my note" requires folding a
  delta log; greppability of current content is lost. Over-engineered for a
  single-user MVP — and it can be *added later* as a journal layer over (c)
  without being the canonical substrate.
- **(c) gets both** and matches the Logseq-validated precedent: files satisfy P1
  (the files *are* the export); the index supplies query power but is disposable
  and reconstructible. Sync the files (line-level merges), rebuild the index per
  machine — this *is* the DEC-06 path, with no canonical-format change required.

### The three-layer split (load-bearing for SPECTRA + DEC-05/06/09)

| Layer | Contents | Guarantee | Synced? |
|---|---|---|---|
| **Canonical (owner files)** | Notes (Markdown+frontmatter), Tasks, local Events, Google-mirrored Events — all human-readable; source-side links (ADR-0001) | Sovereign; the P1 acceptance set; the export | **Yes** (Syncthing/git, line-level) |
| **Derived index** (`.jin/index.sqlite`) | Parsed metadata, the **edge graph + materialised backlinks**, **recurrence-expansion cache**, optional FTS | Holds **nothing** non-derivable from canonical files; delete = rebuild, lose nothing | **No** (rebuilt per machine) |
| **Operational** (`.jin/sync/`, `.jin/reminder-state.sqlite*`) | Google sync tokens, etag / `resourceId ↔ jin-id` map, last-sync timestamps; per-device reminder occurrence, lease, retry, and delivery bookkeeping | Not canonical and not the index; sync data is re-fetchable, while reminder state is device-local runtime bookkeeping reconstructed from canonical task reminders | **No** |

**The cardinal invariant:** the index is a *pure deterministic function* of the
canonical files (plus, for Google-source events, the operational map). It is a
cache, never a source. The CLI core writes files first, then refreshes/marks the
index dirty. This crisp boundary is what keeps the sovereignty guarantee honest
and the file-sync-later path a no-rewrite addition.

### Recommended on-disk layout (lean; SPECTRA may refine the [SPEC] details)

```
jin/                          # the sovereign canonical root (owner-controlled dir)
  notes/<id>--<slug>.md       # YAML frontmatter + Markdown body
  tasks/<id>.md               # frontmatter: status, due, list, links[] (+ optional body)
  events/<id>.md              # frontmatter: RFC-5545 fields + source/authority + links
  .jin/
    index.sqlite              # DERIVED — rebuildable; gitignored / not synced
    reminder-state.sqlite     # OPERATIONAL — device-local reminder delivery state; not synced
    sync/                     # OPERATIONAL — Google tokens, etag & id maps; re-fetchable
    config.*
```

Every primitive is an addressable record with a **stable id (ULID/UUID)** and is
**fully represented in human-readable files**. (Exact task-file granularity —
one-file-per-task vs per-list file — is a [SPEC] detail; the invariants hold
either way.)

### Event file — carries RFC-5545 now, expansion stays derived

```yaml
# events/<id>.md
---
id: 01J...EVENT
type: event
title: "Team sync"
dtstart: 2026-07-01T14:00:00       # IANA tz, all-day vs timed preserved
dtend:   2026-07-01T14:30:00
tz:      America/Sao_Paulo
all_day: false
rrule:   null                      # full RFC-5545 RRULE/EXDATE/RECURRENCE-ID slots reserved
# --- source-of-truth / sync (DEC-09) ---
source:    google                  # google | jin  (per-object authority, not a structural fork)
google_id: "abc123@google.com"
# --- links (ADR-0001, source-side) ---
derived_from: null                 # set when this Event was promoted from a Task
---
Body / agenda notes...
```

The canonical file holds the **RRULE**; the **expanded instances** are an
index-only cache. Adding recurrence later (DEC-07) is therefore expansion logic +
index work — **no canonical-format change**, honouring "no rewrite."

## Consequences

**Good**
- Satisfies the P1 acceptance test literally (canonical = human-readable files =
  the export) **and** delivers fast queries/link traversal/recurrence expansion.
- File-sync-later is a no-rewrite addition: sync canonical files, rebuild index
  per machine (DEC-06 path validated by the Logseq precedent).
- Crisp sovereignty boundary: operational Google sync-state is quarantined in
  `.jin/sync/` and excluded from the sovereign guarantee.
- Open, language-agnostic formats (Markdown + YAML + SQLite) — unblocks DEC-03/04
  without binding a runtime.
- Google-mirrored company events are *also* human-readable files (bonus
  sovereignty), with per-object authority (`source:`) expressing DEC-09 without a
  structural fork.

**Bad / costs**
- **[RISK] Rebuild determinism is the linchpin.** The index must be a pure
  function of canonical files (+ operational map for Google-source events). Any
  nondeterminism (wall-clock in the index, ambiguous edge-resolution ordering)
  breaks multi-machine convergence. Mitigation: SPECTRA must spec a deterministic,
  content-ordered rebuild + a "delete index, rebuild, byte-compare query results"
  test.
- **[TRADE-OFF]** Two representations to keep coherent. Mitigated by the cardinal
  invariant (files are truth; index is a disposable cache; writes go to files
  first).
- A write path must update files then refresh/dirty the index (one-time cost).

## Confidence + key assumptions / [GAP]s

- **Confidence: DEC-02 = 0.85.** High-reliability precedent (Logseq
  markdown↔DB unification) + the hard P1 acceptance test decisively select (c);
  robust to ±1 perturbation. The one real risk (rebuild determinism) is
  well-understood and testable.
- **[ASSUMPTION]** Standard properties of Markdown+YAML (greppable/diffable) and
  SQLite (single-file, fast local queries, deterministically rebuildable) hold —
  domain knowledge, reliability M–H.
- **[GAP] DEC-C company-calendar privacy posture** (owner-only) gates whether
  Google events are mirrored as files at all; the model permits it (owner stated
  mirroring is allowed) but the *policy* is owner-decided.
- **[GAP] Index schema is an internal contract, not an API** — see reversal
  condition; this directly constrains DEC-04.
- **[REVERSAL-CONDITION]** Revisit if deterministic rebuild proves infeasible/too
  slow at the owner's data scale, or if multi-device needs real-time convergence
  (CRDT) rather than file-sync + rebuild — then (c) gains a CRDT-backed canonical
  layer. If a GUI or external tool is ever allowed to read `.jin/index.sqlite`
  directly, the derived-cache boundary is violated and this ADR is breached
  (DEC-04 must route the GUI through the headless core, **not** option (b)).
- **Handoff:** → SPECTRA to spec the canonical file schemas, the deterministic
  index-rebuild contract, and the write path; → the DEC-05/07/09 deliberations to
  consume the three-layer split.
