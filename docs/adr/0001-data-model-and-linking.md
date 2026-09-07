# 0001 — Unified Data Model and Linking Semantics

- **Status:** Proposed
- **Date:** 2026-06-26
- **Deciders:** Owner (sole approver) · authored by FORGE
- **Covers:** DEC-01 (unified data-model shape) · DEC-08 (linking semantics & the dual-nature/"promote" problem)
- **Decision type:** TRADE-OFF / CONSTRAINT-SATISFACTION

---

## Context

Jin's headline value (P2, integration-first) is that notes, tasks, and calendar
events are **one linked model**, not three silos bridged by import/export. The
discovery doc and `product.md` name the precise failure surface this decision
must avoid:

1. **Domain dominance** — a single polymorphic super-entity collapses three
   incompatible "shapes" (free-form rich content; a status/priority/recurrence
   workflow; a precise RFC-5545 temporal object), so one domain's needs degrade
   the others. `product.md` documents this as *the* reason the triangle is
   unsolved in 2026.
2. **Silent silo re-formation** — three foreign-keyed tables whose only
   connective tissue is buried FK columns quietly rebuild the silos the product
   exists to abolish.

DEC-08 is the literal mechanism of P2: how is *"a todo important enough that it
must also appear on the calendar"* (JTBD-1) represented — one object viewed two
ways, or two linked objects? The same question covers note↔event prep (JTBD-2)
and note↔task reference (JTBD-3). The model must represent multi-context
participation **without duplication or drift**.

This ADR fixes the *logical* model and link vocabulary. The *physical* canonical
store is ADR-0002; the two are co-designed.

## Decision Drivers

- **[CONSTRAINT] P1 sovereignty** — every primitive and every link must be fully
  representable in owner-readable, portable, exportable files (acceptance test:
  "every byte exportable and human-readable at any time").
- **[CONSTRAINT] P2 integration-first** — links are a first-class product
  feature; neither domain dominance nor FK-silo regression is acceptable.
- **[CONSTRAINT] P3 CLI-first / language-agnostic** — the model must be portable
  across runtimes (owner fixed: cross-platform desktop, do **not** assume Swift).
- **[CONSTRAINT] RFC-5545 fidelity (DEC-07)** — the Event primitive must retain
  native temporal depth (IANA tz, all-day vs timed, `RRULE`/`EXDATE`/
  `RECURRENCE-ID`) even though the MVP implements only single events first.
- **[CONSTRAINT] File-sync-later without rewrite (DEC-G/DEC-06)** — link writes
  must be merge-friendly for Syncthing/git and a deterministic index rebuild.
- **Native depth per primitive** — Task keeps its state machine; Note keeps
  free-form Markdown; Event keeps temporal precision.
- **No-drift** — the "promote" mechanism must not duplicate mutable state across
  two records that can diverge.

## Considered Options

**DEC-01 — model shape**
- **(a) Single polymorphic super-entity** — one `item` type + a discriminator and
  a union of all fields.
- **(b) Three typed primitives (Note / Task / Event) + a first-class typed edge**
  — each primitive keeps native fields; links are their own first-class entity
  with type, direction, endpoints, metadata.
- **(c) General property-graph** — everything is an untyped node; types are
  labels; edges are typed.

**DEC-08 — dual-nature / promote**
- **(a) Typed bidirectional edges; objects stay distinct** — `promote` = create a
  new Event + a `derived-from` edge to the Task; objects keep their own lifecycle.
- **(b) Shared-identity dual-typed object** — one record that is *both* Task and
  Event.
- **(c) Duplication + soft-sync** — copy the task into an event and run a
  reconciler.

## Decision Outcome

**DEC-01 → Option (b): three typed primitives + a first-class typed edge.**
**DEC-08 → Option (a): typed bidirectional edges; promote keeps objects distinct.**

Option (b) is effectively a *constrained* property-graph: three schema-enforced
node types plus a controlled edge vocabulary. It buys the graph's linking power
(option c) while keeping the schema-level invariants (Task state machine, Event
RFC-5545 precision) that an untyped node-soup cannot guarantee. The super-entity
(a) is rejected on the explicitly-documented dominance failure mode.

The load-bearing rule that prevents (b) from degenerating into FK-silos:
**edges are first-class records, not foreign-key columns on the primitives.** An
edge is `{ id, type, source_ref, target_ref, created, metadata? }`, queryable
from either endpoint.

DEC-08(a) follows directly: keeping objects distinct means each retains native
fields/lifecycle, Google sync touches only the Event, and there is no single
mutable record straddling two conflicting lifecycles (the fatal flaw of (b)) and
no reconciler drift (the fatal flaw of (c)).

### Concrete MVP link vocabulary

Edges are **directed** (a defined `source-type → target-type` signature) but
**bidirectionally queryable** (backlinks are always derivable). The MVP needs
exactly three, one per JTBD edge:

| Edge type | Signature (source → target) | Created by | Meaning / backlink shown on target |
|---|---|---|---|
| `derived-from` | Event → Task | `promote` | "this event was promoted from this task" (JTBD-1). Target task shows backlink "scheduled-as / has-event". |
| `prep-for` | Note → Event | `attach` | "this note is prep/context for this appointment" (JTBD-2). Event shows "prep-notes". |
| `references` | Note → {Task \| Event \| Note} | `attach` | "this note is reference material" (JTBD-3). Target shows "referenced-by / notes". |

A generic `relates-to` is **deliberately deferred** — keeping the vocabulary
small and typed is what prevents the "untyped soup" risk of option (c).

### `promote` and `attach` semantics (exact effect on the model)

- **`promote(task, when)`** — (1) creates a **new Event** primitive (own stable
  id) copying `title`/summary and a temporal slot supplied by the user or
  inferred from the task's due date; (2) creates a `derived-from` edge
  Event→Task; (3) **leaves the Task untouched** (its status/fields unchanged).
  The edge — not a mutated task field — is the fact that "this task is
  scheduled." `jin today` surfaces the Event and, via the backlink, the
  originating Task.
- **`attach(note, target, kind?)`** — creates one edge from the Note to the
  target. `kind` defaults by target type: Event → `prep-for`, Task/Note →
  `references`; an explicit `kind` may override.

**Additive-write invariant (key property).** Both `promote` and `attach` write a
link **only into the source endpoint's record** (`promote` writes a brand-new
Event file; `attach` adds a line to the Note's frontmatter). The pre-existing
target file is never mutated; its backlink is **derived** by the index. This
makes every link operation a single-file additive write — ideal for diffs,
line-level merge under file-sync, and deterministic rebuild.

### Calendar detail M1 scheduling exception

Calendar detail M1 deliberately introduces one narrow exception to the
additive-write rule. A Task may carry optional `agenda_bucket: flexible`, which
records agenda-placement intent only. It does not merge Task and Event identity,
change the Task state machine, or make Task content provider-owned.

Creating a Time block clears `agenda_bucket: flexible`; removing the last
eligible Time block may set it when the user explicitly chooses “Return task to
flexible agenda.” Completion, cancellation, and deletion clear the marker. These
Task/Event changes use a durable recoverable operation journal: complete before
and post images and hashes are staged under a per-vault lock before canonical
writes, recovery converges canonical files before the derived index or provider
queue observes success, and divergent unknown hashes become blocked conflicts.
All other `promote`/`attach` sovereignty and source-side edge rules remain the
default.

### On-disk link representation (interface for ADR-0002 / SPECTRA)

Edges are canonical and live **source-side** in the source primitive's
frontmatter — never only in the index (that would violate P1). The **inverse
direction (backlinks) is NOT stored on disk**; it is materialised in the derived
index. One on-disk home per edge ⇒ no two-sided maintenance, no drift.

```yaml
# events/<id>.md  (the Event created by `promote`)
---
id: 01J...EVENT
type: event
title: "Dentist — annual checkup"
derived_from: 01J...TASK        # the derived-from edge, source-side
# ... RFC-5545 temporal fields (see ADR-0002 / DEC-07)
---

# notes/<id>--prep.md
---
id: 01J...NOTE
type: note
title: "Dentist prep"
links:
  - { type: prep-for,   target: 01J...EVENT }   # JTBD-2
  - { type: references, target: 01J...TASK  }    # JTBD-3
---
Questions to ask...
```

Referential integrity (dangling edges after a target delete) is checked and
reported at index-rebuild time — greppable and detectable, never silent.

## Consequences

**Good**
- Each primitive keeps full native depth; no domain dominates (P2 satisfied at
  the model layer).
- Links are first-class and an explicit feature, not buried FKs — silos cannot
  silently re-form.
- `promote`/`attach` are additive single-file writes ⇒ excellent diff/merge/
  rebuild behaviour (de-risks DEC-06 file-sync-later).
- Distinct objects mean Google sync touches Events only and never the Task; the
  `derived-from` backlink tells the sync layer "do not push this Task" (clean
  input to DEC-05/09).
- Model is language-agnostic (no runtime assumption) — unblocks DEC-03/04.

**Bad / costs**
- **[TRADE-OFF]** Distinct objects mean no automatic field-sync between a Task and
  its promoted Event (e.g., completing the task does not auto-cancel the event).
  MVP treats the *link itself* as the integration; field/completion propagation
  is **out of MVP scope** and flagged below.
- A generic link resolver + backlink derivation must be built into the index
  (one-time cost; see ADR-0002).
- **[RISK]** If links are ever implemented as plain FK columns instead of
  first-class edge records, the design silently regresses to option (a)/FK-silos.
  This is the single invariant SPECTRA must guard.

## Confidence + key assumptions / [GAP]s

- **Confidence: DEC-01 = 0.86, DEC-08 = 0.82.** High-reliability sources
  (discovery §3, `product.md` failure-mode + provisional leans) converge; logic
  is robust to ±1 perturbation.
- **[ASSUMPTION]** Field/completion auto-sync between a Task and its promoted
  Event is not required for MVP daily usefulness — the hero flow ("promote so it
  appears on the calendar") is satisfied by the Event + `derived-from` edge alone.
- **[GAP] Task↔Event completion-propagation policy** — deferred micro-decision:
  does completing/deleting a Task affect its `derived-from` Event (and vice
  versa)? Out of MVP; needs a follow-up spec.
- **[GAP] Notes power ceiling (DEC-E)** — if notes later become block-level
  (Logseq-style), link endpoints become *blocks*, not whole notes. Not foreclosed
  (frontmatter targets can gain a `#block-id` fragment), but the "primitive =
  note" assumption would need revisiting.
- **[GAP] Task on-disk granularity** (one-file-per-task vs per-list file) is a
  [SPEC] detail (DEC-S2/S3); invariants here hold either way.
- **[REVERSAL-CONDITION]** Revisit (b)/(a) if the typed-edge vocabulary balloons
  beyond ~a dozen types (then a general property-graph (c) earns its complexity),
  or if a future requirement fuses Task and Event into one genuine lifecycle.
- **Handoff:** → SPECTRA to spec the primitive schemas, edge resolver, and
  `promote`/`attach` CLI verbs against this model.
