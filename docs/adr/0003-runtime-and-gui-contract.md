# ADR 0003 — Core Runtime/Language and the CLI-core ↔ GUI Interface Contract

- **Status:** Proposed
- **Date:** 2026-06-26
- **Deciders:** Owner (sole approver); FORGE deliberation (standard tier)
- **Decision type:** TRADE-OFF (two coupled sub-decisions: DEC-03 + DEC-04)
- **Supersedes / relates to:** DEC-02 (storage: files-canonical + rebuildable SQLite index), DEC-05 (Google sync), DEC-07 (RFC-5545 model). Resolves discovery ledger rows **DEC-03** and **DEC-04**.

---

## Context

Jin is a sovereign, local-first, integrated notes+tasks+calendar engine. The MVP is a **CLI-first "Integrated Thin Slice"**; a cross-platform desktop GUI (Linux daily driver + macOS) that *approximates* an Apple HIG / Liquid Glass aesthetic is explicitly deferred but **must not be foreclosed** (P3: the GUI is a pure consumer of the core, never a logic fork).

Two upstream decisions were already resolved by the owner and are **FIXED inputs** here:

- The GUI is **cross-platform desktop, NOT native SwiftUI/Liquid Glass** — an *approximated* Apple look. This frees the core language from Swift (which was the only reason DEC-03 was previously gated on target-OS).
- The canonical store is **human-owned files + a rebuildable derived SQLite index** (DEC-02 outcome). SQLite is a *projection*, not the source of truth.

This ADR decides:

- **DEC-03** — the language/runtime that hosts the headless core.
- **DEC-04** — the interface contract by which the future GUI (and scripts) consume that core.

The two are coupled: the runtime choice determines how cleanly a future GUI can embed the core in-process, which is the crux of preserving P3.

## Decision Drivers

| ID | Driver | Hard/Soft | Source |
|----|--------|-----------|--------|
| D1 | Single, self-contained static binary; no mandatory runtime/cloud (P1 sovereignty) | Hard | Principles, discovery §1 |
| D2 | GUI must embed/consume the **same** core logic with no fork (P3) | Hard | P3, discovery §3-F |
| D3 | RFC-5545 fidelity: RRULE/EXDATE/RECURRENCE-ID, IANA tz, all-day vs timed (P4 forces it) | Hard | discovery §3-C/D, DEC-07 |
| D4 | OS secret-store access for owner-provisioned OAuth tokens | Hard | DEC-05, DEC-S5 |
| D5 | SQLite bindings that link statically into a single binary | Hard | DEC-02 |
| D6 | Storage/projection boundary preserved — consumers see model projections, never raw store rows | Hard | DEC-02, P3 |
| D7 | Cross-platform desktop GUI (Linux + macOS) approximating Liquid Glass | Hard | Owner-resolved |
| D8 | Single-developer iteration velocity | Soft | discovery (solo, senior eng) |
| D9 | Durable, "built-like-corporate-software" correctness for a long-lived canonical-data engine | Soft | discovery §2 persona |
| D10 | Don't foreclose later multi-device (DEC-G) / mobile capture (DEC-J) | Soft | discovery ledger |

## Considered Options

### DEC-03 — Core language / runtime

- **H1 — Rust.** Single static binary; expressive type system (exhaustive enums, no-null, errors-as-values) well-matched to the DEC-01 unified model and DEC-07 recurrence variants; pairs natively with a **Tauri** GUI that links the same crate in-process; strong C-ABI FFI as an escape hatch. Crate coverage exists for every hard driver (`rrule`, `icalendar`, `chrono-tz`/`time`, `keyring`, `rusqlite`/`sqlx` with bundled SQLite). Cost: slowest iteration; borrow-checker / compile-time friction; payoff is contingent on owner Rust fluency.
- **H2 — Go.** Single static binary (its headline strength); fast compile and gentle curve; built-in IANA tzdata; a Tauri-analog exists (**Wails** = Go backend + webview frontend) that also embeds core functions in-process. Workable RRULE/iCal/keyring/SQLite libraries (`rrule-go`, `golang-ical`, `go-keyring`, `modernc.org/sqlite` for cgo-free static builds). Weaker: type-system expressiveness for the unified model; FFI to *non-Go* GUI stacks; Tauri's ecosystem/leanness edge over Wails.
- **H3 — TypeScript/Node.** Fastest iteration; arguably the **most battle-tested iCal library** (`ical.js`, powers Thunderbird) and `rrule.js`. But a weak *durable-sovereign-engine* story: single-binary packaging is fragile (Node SEA / bundlers + native addons), the secret-store path is weak (`keytar` effectively abandoned), and a GUI implies Electron (heavy, runtime-dependent) — undercutting D1/D9. Wrong tool for the *engine* role even though it would be fine for the *presentation* layer.

### DEC-04 — Interface contract

- **H-a — Embeddable library + thin CLI + `--json` contract.** A `jin-core` library is the single locus of all logic; the CLI is a thin wrapper; the GUI links the same library in-process; scripts use the stable `--json` output. A local daemon is held in reserve only if a future GUI stack cannot embed the core.
- **H-b — GUI reads the SQLite store directly.** GUI opens the SQLite index itself.
- **H-c — Local HTTP/gRPC daemon.** A long-running service the CLI and GUI both call over localhost.

## Decision Outcome

### DEC-03 → **Rust** (with Go+Wails as a near-equal, architecture-preserving fallback)

Rust scored 3.75 vs Go 3.70 on the weighted rubric — **inside the 0.3 tie threshold**, so this verdict explicitly acknowledges genuine ambiguity. Rust is recommended; the tiebreakers are:

1. **Correctness-first fit (D9).** Exhaustive sum types and compile-enforced error handling are a materially better substrate for a long-lived engine that must never silently corrupt the owner's canonical data, and for modeling the DEC-01 typed-primitives-plus-edges shape and DEC-07 RRULE variants.
2. **GUI pairing (D2/D7).** **Tauri** is leaner and more mature than Wails (OS-webview, small binaries, strong security model). With a Tauri GUI the core is *literally the same compiled crate* invoked by Tauri command handlers in-process — the strongest possible realization of P3 (zero logic fork, no IPC tax for core calls).
3. **FFI optionality (D10).** Rust's C-ABI keeps non-webview GUI stacks reachable later; Tauri 2.x also targets mobile, which would let the *same* core crate ship to a future mobile capture client (DEC-J) `[ASSUMPTION: Tauri mobile maturity]`.

The decisive *against* is velocity (D8), which is **contingent on the owner's Rust fluency** — an open `[GAP]`. If a pre-build spike shows Rust velocity is prohibitive for a solo project under the chosen time posture (DEC-I, also `[GAP]`), switch to **Go+Wails**: the entire DEC-04 architecture below is preserved unchanged — only the language swaps. **TS/Node is rejected for the engine role** (fails D1/D4/D9), though it is the correct language for the GUI's *presentation* layer.

> Note: choosing Rust+Tauri does **not** banish TypeScript — it relocates it to the GUI frontend (HTML/CSS/JS approximating Liquid Glass via CSS `backdrop-filter`/vibrancy), which is exactly where the fast-iteration UI work belongs. The engine stays Rust; the chrome stays web-tech. This neutralizes much of the velocity objection.

### DEC-04 → **(a) Embeddable library + thin CLI + `--json` contract.** Daemon (c) only as a justified fallback.

- The CLI is a thin shell (e.g. `clap`) over a `jin-core` crate; `--json` emits **serde-serialized DTOs** — *projections of the model*, never raw SQLite rows. The Tauri GUI depends on `jin-core` directly and consumes the same DTO surface through its command layer. One core, multiple thin consumers.
- **(b) GUI reads SQLite directly is rejected** — it violates D6/P3: SQLite is a *rebuildable derived index*, so the GUI would (i) couple to an internal projection schema that can change/rebuild, (ii) bypass core business logic (link maintenance, promote/attach semantics, RRULE expansion, Google-sync invariants), and (iii) become a second writer with its own logic = the exact logic fork P3 forbids.
- **(c) Local daemon is rejected for MVP** — adds a long-running process, localhost auth, port management, and serialization overhead with no benefit on a single-machine, in-process-capable stack (contradicts DEC-H "single-process for MVP"). It becomes correct **only** if a future GUI runtime cannot embed the core via in-process linking or C-FFI; in that case escalate to a local **JSON-RPC** daemon that exposes the *same DTO contract*.

**Concrete shape:** `jin-core` (library, all logic + the public DTO/view layer) → consumed by (1) `jin` CLI binary with `--json` parity from day one, and (2) the Tauri GUI app, both in-process where applicable. SQLite schema stays **private** to `jin-core`.

## Consequences

### Good

- P3 is preserved structurally, not by discipline: the GUI runs the identical compiled core. No logic can fork because there is only one logic.
- D1 satisfied: a single lean static binary for the CLI; sovereign and dependency-free.
- D6 satisfied: both `--json` and the GUI see the same DTO projection; the storage schema is encapsulated and stays rebuildable.
- The architecture is **language-portable** (lib + thin CLI + webview GUI), which de-risks the one irreversible choice (DEC-03): a Rust→Go pivot keeps the whole design intact.
- Type-safety gives a durable correctness floor for canonical-data and RFC-5545 handling (D3/D9).

### Bad / costs

- **[TRADE-OFF]** Rust front-loads a learning/velocity cost (D8) that a faster-to-iterate stack (Go, TS) would avoid. Justified only if the engine's longevity/correctness payoff outweighs MVP speed for this owner.
- **[RISK]** *Pre-mortem (Rust):* owner stalls on borrow-checker/compile friction for a solo project and the MVP never ships. Mitigation: bounded CLI surface; a 1-week Rust spike before committing.
- **[RISK]** *Cross-platform Liquid-Glass approximation:* Tauri uses WebKitGTK (Linux) vs WKWebView (macOS); CSS glass effects (`backdrop-filter`, vibrancy) may render differently. GUI-phase risk, not an MVP blocker — flag against D7.
- **[RISK]** Tauri↔webview IPC serializes JSON between the JS frontend and Rust core. This is unavoidable and actually *reinforces* D6 (the frontend only ever sees DTOs), but adds a (small) per-call serialization cost for the GUI.
- **[ASSUMPTION]** Crate/library maturity (`rrule`, `icalendar`, `chrono-tz`/`time`, `keyring`, `rusqlite`/`sqlx`, Tauri 2.x) is asserted from training knowledge (cutoff Jan 2026), not live-verified — **M reliability**. Recommend an ATLAS/spike verification before commit.

### Dependencies the downstream deliberations MUST respect

- **Storage (DEC-02) deliberation:** SQLite binding = **`rusqlite`** with the `bundled` feature (synchronous, single-process, static link) — or **`sqlx`** if the Google-sync layer demands async concurrency. The SQLite schema is **private to `jin-core`**; expose only DTOs across the `--json`/library boundary.
- **Google-sync (DEC-05) deliberation:** OS secret store = **`keyring`** crate (macOS Keychain / Linux Secret Service / Windows Credential Manager) for owner-provisioned OAuth tokens. RFC-5545 stack = **`rrule`** (recurrence) + **`icalendar`** (parse/build) + **`chrono-tz`** or **`time`** for IANA/DST. These crate choices are inputs those deliberations inherit, not re-open.
- **CLI/spec (DEC-S1):** the `--json` DTO contract is the *stable public boundary* and must be specced as model projections, version-tagged, decoupled from storage internals.

## Confidence + key assumptions / [GAP]s

**Composite confidence: 74%** (Evidence 72 · Logic 85 · Constraints 85 · Sensitivity 55) — *Moderate: act with monitoring, validate the flagged gaps before commit.* The low Sensitivity factor is the honest signal: DEC-03 is sensitive to two owner-only unknowns.

- **[VERDICT] DEC-03 = Rust — confidence 0.72.** Recommended, but Go+Wails is within 0.05 on the rubric; the verdict turns on owner Rust fluency and time posture.
- **[VERDICT] DEC-04 = (a) embeddable library + thin CLI + `--json` — confidence 0.86.** Robust and largely language-independent; (b) rejected on P3/boundary grounds, (c) deferred as a justified fallback.

**Open gaps:**
- `[GAP]` **Owner Rust fluency** — the primary DEC-03 sensitivity. Unknown.
- `[GAP]` **DEC-I time/effort posture** (long-burn vs time-boxed) — gates whether Rust's front-loaded curve is acceptable.
- `[GAP]` Library currency for the named crates — verify before commit (M-reliability assumption).
- `[ASSUMPTION]` Tauri 2.x mobile target maturity (relevant only to the DEC-J supporting point, not load-bearing for the verdict).
- *(No hard `[DISPUTED]`: Rust-vs-Go is a flagged near-tie with an issued verdict + reversal condition, not an unresolved dispute.)*

**[REVERSAL-CONDITION]s:**
1. If a pre-build Rust spike shows velocity is prohibitive for a solo project under DEC-I → switch DEC-03 to **Go+Wails**; DEC-04 architecture is preserved unchanged.
2. If a future GUI runtime cannot embed the core in-process or via C-FFI → escalate DEC-04 from (a) to (c) a local **JSON-RPC daemon** exposing the same DTO contract.
3. If the `--json`/library DTO surface is ever found leaking SQLite schema internals → the projection boundary is broken; reintroduce a strict DTO/view layer (re-verify D6).

**Handoffs:**
- **→ human (owner):** resolve DEC-I and confirm Rust fluency — these set the final DEC-03 confidence. Consider a 1-week Rust-vs-Go spike as the cheapest way to close both.
- **→ ATLAS (optional):** verify current versions/maturity of `rrule`, `icalendar`, `chrono-tz`/`time`, `keyring`, `rusqlite`/`sqlx`, Tauri 2.x before commit.
- **→ SPECTRA:** spec the `jin-core` API surface, the versioned `--json` DTO contract, and the thin-CLI verb grammar (DEC-S1).
- **→ IDG/Scribe:** chronicle this ADR into the project record.

---

## Provenance

- **Decision type:** TRADE-OFF (coupled DEC-03 + DEC-04)
- **Deliberation depth:** deep-leaning (score 8/9), single-trace standard tier — 3 reasoning passes, no G2/TRANCE fan-out
- **Evidence sources:** 2 primary docs (discovery §1/§3-F/§5, design.md) at H reliability + ecosystem/library knowledge at M reliability
- **Hypotheses evaluated:** 3 (DEC-03) + 3 (DEC-04)
- **Confidence:** 74% (Evidence 72%, Logic 85%, Constraints 85%, Sensitivity 55%)
- **Gate result:** PASS (Rust-vs-Go near-tie surfaced and flagged per scoring rule 3; sensitivity reflected in confidence)
- **Markers:** 2 ASSUMPTION, 4 GAP, 4 RISK, 3 REVERSAL-CONDITION
- **Memory:** CRYSTALIUM unavailable in this environment — recall/checkpoint/ingest gracefully skipped (EIIS-standalone-conformant)
