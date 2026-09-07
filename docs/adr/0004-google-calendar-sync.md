# ADR-0004: Google Calendar Sync — Architecture, Recurrence/Timezone Model, and Per-Object Source-of-Truth

**Status:** Proposed
**Date:** 2026-06-26
**Decision makers:** Owner (sole approver) + FORGE (deliberation)
**Consulted:** `discovery/00-discovery-and-gaps.md` (§3-C, §3-D, §5 — DEC-05/07/09), `product.md` (Strategic Observations #1, #3, #5; Huly residency note)
**Resolves:** DEC-05, DEC-07, DEC-09. Constrained by owner-FIXED inputs (one Google calendar; single events first; company events may be **mirrored** locally; single machine; no baked-in client secret).

> **2026-08-26 scoped supersession — multi-account/calendar routing.** The
> one-account/one-calendar constraint in this ADR is superseded by
> `.spectra/changes/google-calendar-multi-account-sync`. Provider identity is now
> `(issuer, subject)` bound to an immutable Jin `account_id`; aliases such as
> Personal, Work, and Project OSS are presentation only. Calendar identity is
> `(provider, account_id, calendar_id)`. Cursors, mappings, credentials, and
> outbox operations are isolated by that exact route. The authority, temporal,
> audit, direct-REST, and owner-provisioned OAuth decisions below remain in force.

> **2026-08-27 productization amendment — distributor client vs BYO.** The
> owner-provisioned client remains the advanced BYO/source-build fallback and a
> runtime/per-vault override. The official-release target is a
> distributor-owned Desktop OAuth client so ordinary users do not create a
> Google Cloud project. The distributor owns consent-screen branding, policy
> pages, scope minimization, and Google's verification for sensitive Calendar
> scopes; "In production" is not synonymous with verified. No real credential
> is committed to the repository, and a build must not claim the verified-client
> path unless its release pipeline and Google project have completed that
> process. Embedding a distributor client secret remains pending explicit owner
> security approval; this amendment does not silently authorize it.

---

## Context

Jin's headline value is a single, owner-controlled model of notes + tasks + events, with **bidirectional Google Calendar sync** as the lead integration (P4). This collides head-on with sovereignty/local-first (P1): bidirectional sync means owner data leaves the machine and company data enters it, and `product.md` flags exactly this for Huly — *"Google sync still routes through [the tool's] integration infrastructure rather than purely through your own server — a data residency concern."* The market survey shows this is the white space: every competitor punts (AFFiNE read-only iCal, Vikunja VTODO-only "alpha", NotePlan EventKit pass-through). Doing real, writable `VEVENT`/`RRULE` is where the field stops.

Three decisions must be fixed before the data model freezes and before SPECTRA can spec the sync loop and field mapping:

- **DEC-05** — how Jin talks to Google (transport, OAuth credential model, token storage, sync-loop shape, offline behavior).
- **DEC-07** — the recurrence/timezone model. The MVP implements only single (non-recurring) events plus at most simple daily/weekly recurrence, but Google's API forces RFC-5545 fidelity on the wire regardless, so the **internal model** must not foreclose recurrence.
- **DEC-09** — which side is canonical per object class, and the auditable conflict policy. This is where the P1↔P4 tension must be resolved concretely.

This ADR also assumes (from the parallel storage deliberation, DEC-02) a **hybrid store: human-readable files canonical + a rebuildable SQLite derived index.** Where that assumption is load-bearing it is marked, and the dependencies the storage deliberation must honor are listed in §Consequences.

---

## Decision Drivers

| ID | Constraint | Hard/Soft | Source |
|----|-----------|-----------|--------|
| C1 | Core in a systems language with good HTTP/OAuth/SQLite/RRULE libs; GUI cross-platform; **do not depend on a specific language** | Hard | Owner (parallel decision) |
| C2 | MVP = bidirectional sync for **one** Google account/calendar; **single non-recurring events first**; incremental sync token; **basic, AUDITED** conflict policy | Hard | Owner (MVP scope) |
| C3 | Company Google calendar events **may be mirrored locally** (local copy permitted) | Hard | Owner (resolves DEC-C; biases DEC-09 toward a mirror) |
| C4 | Single machine for MVP | Hard | Owner |
| C5 | Private-first but **designed as if it could be open-sourced → cannot ship a baked-in client secret** | Hard | Owner |
| C6 | P1 sovereignty/local-first · P2 integration-first · P3 CLI-first · P4 Google-first | Hard | Principles |
| C7 | Hybrid storage: files canonical + rebuildable SQLite index | Soft | DEC-02 (parallel, provisional) |
| C8 | Offline reads/writes must always succeed (local-first) | Hard | P1 spirit |
| C9 | Conflicts must be auditable per object | Hard | C2 |

---

## Considered Options

### DEC-05 — Sync architecture

**Transport.**
- **(5-T1) Direct Google Calendar REST API** — `events.list` + `syncToken` for incremental pull; `events.insert`/`patch`/`update`/`delete` for push; `etag` optimistic concurrency; optional push channels (`events.watch`). First-class, documented, evolving surface; clean change-feed.
- **(5-T2) CalDAV bridge** — speak CalDAV to Google's CalDAV endpoint. *Rejected:* Google's CalDAV is a compatibility layer with weaker incremental ergonomics (`sync-collection` REPORT vs the much cleaner opaque `syncToken`), forces an extra iCalendar serialization round-trip, and is a second-class citizen Google has deprioritized. We must speak RFC-5545 **semantics** internally regardless (DEC-07), but that does not require CalDAV-on-the-wire to Google.

**OAuth credential model (C5 — can't ship a secret).**
- **(5-O1) Owner-provisioned OAuth client** — owner creates their own Google Cloud project, enables the Calendar API, configures the consent screen, and creates an OAuth **Desktop/Installed-app** client. Jin ships **no** credentials; a first-run wizard guides provisioning. Authorization-Code flow with **PKCE** and a **loopback redirect** (`http://127.0.0.1:<ephemeral-port>`); `access_type=offline` + `prompt=consent` to obtain a refresh token. For installed apps Google documents that the client secret is *not* confidential, and PKCE removes reliance on it — so an OSS build can ship secretless and require BYO-client.
- **(5-O2) Hosted token broker** — a Jin-operated service mediates OAuth. *Rejected:* reintroduces a third party into the data path (the exact Huly residency concern), requires operating server infrastructure (violates C4/sovereignty), and creates a token-custody liability for a single-user tool.

**Token storage.**
- **(5-S1) OS secret store primary + encrypted-file fallback** — refresh/access tokens in the platform keychain (Secret Service/libsecret, macOS Keychain, Windows Credential Manager); fall back to an **AEAD-encrypted file** (key from a passphrase or machine-bound key) when no Secret Service is available. The fallback matters: a CLI-first tool on a headless/SSH Linux box frequently has **no running Secret Service daemon**, so keychain-only would break the daily driver.
- **(5-S2) Encrypted file only** / **(5-S3) keychain only** — *Rejected:* (S2) misses the desktop-keychain UX and ties security to one passphrase; (S3) breaks on headless Linux.

**Sync-loop shape.**
- **(5-L1) Incremental via `syncToken`, full-sync bootstrap, 410-triggered re-sync, polling** *(chosen).* See Decision Outcome for the state machine.
- **(5-L2) Full re-list every sync** — *Rejected:* O(calendar) cost each run, no clean delete signal, races.
- **(5-L3) Push channels (`events.watch`) for near-real-time** — *Deferred/`[GAP]`:* requires a public, domain-verified HTTPS webhook, which a single-machine local app does not have (C4). Polling is the MVP; push is a post-MVP option behind a tunnel/relay (itself a residency concern).

### DEC-07 — Recurrence & timezone model

- **(7-A) Adopt full RFC-5545 semantics internally as the *model*; implement only a subset in the MVP** *(chosen).* Carry `RRULE`/`RDATE`/`EXDATE`/`RECURRENCE-ID`, IANA tzids + DST, all-day vs timed, floating time as first-class (nullable) fields from day one. MVP *implements* single events fully bidirectional + simple daily/weekly recurrence (display/best-effort), but **stores everything losslessly.**
- **(7-B) Simplified internal model + lossy iCal mapping** — *Rejected:* Google delivers `recurrence[]`, `recurringEventId`, `originalStartTime`, and `{dateTime,timeZone}` whether we model them or not; a lossy model corrupts these on round-trip and, worse, retrofitting recurrence later is a model rewrite + data migration. The cost of carrying the fields now is near-zero (nullable columns / optional frontmatter keys); the cost of not carrying them is catastrophic.

### DEC-09 — Per-object source-of-truth & residency

- **(9-A) Mirror everything; Google is the single authority for anything synced** — *Rejected:* once an owner-authored "promoted" event is pushed, Google would own it; that erodes P1 for the owner's *own* data.
- **(9-B) Live read-through (store nothing for Google)** — *Rejected, decisively:* breaks offline (`jin today` would fail without network, violating C8/P1), and — the decisive blow — **destroys the integration thesis**: JTBD-2 ("attach prep notes to an appointment") requires a **durable local event identity** to link a note against. Read-through gives ephemeral identities; you cannot build P2 on it.
- **(9-C) Hybrid, authority assigned by *authorship/origin* (not by calendar)** *(chosen).* Owner-authored objects are Jin-canonical (Google is a replica for promoted ones); company/Google-authored events are Google-canonical and held locally as a **mirror/cache**. Per-class conflict policy. A near-variant — authority *per calendar* — collapses to the same thing for the single-calendar MVP but mishandles "promote onto a Google-authoritative calendar," so origin is the correct axis with calendar as a default seed.

---

## Decision Outcome

> **[DECISION] DEC-05:** Direct Google Calendar REST API (5-T1) + owner-provisioned OAuth desktop client with PKCE/loopback, secretless distribution (5-O1) + OS secret store with encrypted-file fallback (5-S1) + incremental `syncToken` loop with full-sync bootstrap and 410 re-sync, **polling** for MVP (5-L1). Push channels deferred.
>
> **[DECISION] DEC-07:** Adopt **full RFC-5545 semantics internally** (7-A). MVP implements single events bidirectionally; recurring events are **mirrored read-only and stored verbatim**. All-day vs timed and IANA tzid are first-class on disk from day one.
>
> **[DECISION] DEC-09:** **Hybrid, authority by authorship** (9-C). Owner-authored data is Jin-canonical; company/Google events are Google-canonical, locally mirrored (permitted by C3). Conflicts resolved by a deterministic per-class policy and written to an **append-only, exportable audit log.**

### DEC-05 — the sync loop (state machine for SPECTRA)

```
BOOTSTRAP (no syncToken for this calendar):
  events.list(calendarId, singleEvents=false, showDeleted=false,
              timeMin = now - WINDOW, maxResults=page)
    → page through with pageToken
    → persist each event to the mirror; record mapping+etag+google_updated
    → final page returns nextSyncToken → persist as sync_state.sync_token

INCREMENTAL (have syncToken):
  events.list(calendarId, syncToken=<stored>)        # do NOT resend timeMin/singleEvents
    → 200: apply deltas (incl. status=cancelled = deletes); persist new nextSyncToken
    → 410 GONE: token invalidated → discard token → BOOTSTRAP again (safe)

PUSH (outbox drain, on each sync):
  for each dirty local mutation:
    create (Jin-origin):  events.insert(id=base32hex(ULID), body) [idempotent]
    update:               events.patch(eventId, body, If-Match: <stored etag>)
    delete:               events.delete(eventId, If-Match: <stored etag>)
    → 412 Precondition Failed = remote changed first → CONFLICT → policy + audit
    → on success: store returned etag/updated; clear dirty
```

- `singleEvents=false` preserves recurring **masters** (with `recurrence[]`) and exception instances (`recurringEventId` + `originalStartTime`) — required for DEC-07 lossless storage. Agenda display (`jin today`) expands only the supported RRULE subset in-process; unsupported recurrences are flagged "recurring (not expanded)". A second read-only `singleEvents=true` stream scoped to the visible window is a post-MVP display option `[GAP]`.
- **Offline (C8):** all reads/writes hit the local store and always succeed. Local mutations to synced objects set a `dirty` flag and enqueue an **outbox** entry. Sync is an explicit reconciliation (`jin sync`; optional interval). No network → no sync; nothing blocks.
- **Concurrency:** every synced event stores the last-seen `etag`; pushes carry `If-Match`; pulls compare incoming `etag`/`updated` against stored values and the `dirty` flag to detect conflict.
- **Scopes:** request the narrowest sufficient scope — `https://www.googleapis.com/auth/calendar.events` for the single configured calendar (the calendar ID is configured, not discovered, in MVP). Avoid the broad `calendar` scope.

### DEC-07 — minimal internal event-model fields that MUST exist day one

These must be in the model (nullable/empty for MVP single events) so recurrence is added later without a rewrite:

**Temporal core**
- `id` — Jin ULID, stable canonical identity.
- `start`, `end` (or `start` + `duration`), each with `value_type` ∈ {`date-time`, `date`}.
- `is_all_day` — true ⇒ `value_type=date`, **no time, no tz** (RFC-5545 DATE).
- `start_tzid`, `end_tzid` — IANA timezone (e.g. `America/Sao_Paulo`). **Store wall-clock local time + tzid; do NOT pre-convert to UTC in the canonical file** — expanding an RRULE across a DST boundary requires the originating tzid. A derived `start_utc` MAY be cached in the SQLite index for range queries.
- `floating` — datetime present with **no** tzid and not all-day (RFC-5545 floating time). Must be representable.

**Recurrence (empty for MVP single events, present in schema)**
- `recurrence[]` — the RFC-5545 lines **verbatim** (`RRULE:…`, `RDATE:…`, `EXDATE:…`), matching Google's `recurrence` array 1:1. Lossless; no parse-required round-trip.
- `recurring_event_id` — link from an exception instance to its series master.
- `original_start` (+ its `value_type`/tzid) — identifies which occurrence an exception overrides (Google `originalStartTime`).
- `master_id` — local FK from exception to master.

**Identity / lifecycle (also needed for DEC-09 round-trip safety)**
- `ical_uid` — RFC-5545 UID / Google `iCalUID`; stable cross-calendar identity. **Lives in the canonical file** (so the index can rebuild the mapping).
- `sequence` — RFC-5545 SEQUENCE (reserve; bump on significant change).
- `status` ∈ {`confirmed`, `tentative`, `cancelled`} — cancellation/tombstone signal.
- `created`, `updated` (local last-modified).
- `transparency`, `visibility` — reserve (busy/free + privacy); cheap to carry, used by future free/busy.

**Sync-state (NOT in canonical files — see residency rule below):** `google_event_id`, `etag`, `google_updated`, `dirty`, `last_synced_at`, per-calendar `sync_token`.

### DEC-07 — on-disk representation

- All-day: `start: 2026-07-01` (date only), `is_all_day: true`, no `start_tz`.
- Timed: `start: 2026-07-01T14:30:00` + `start_tz: America/Sao_Paulo` (local wall time + tzid, **un-normalized**).
- Recurrence: `recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]` (verbatim list).
- Durable identity (`ical_uid`, and `google_event_id` for mapping survival) lives in the file frontmatter; volatile sync cursors (`etag`, `sync_token`, `dirty`, `last_synced_at`) live **only** in the SQLite index / a dedicated sync-state store and are re-derived by a full re-sync.

### Google `events` resource ↔ Jin model (field mapping for SPECTRA / DEC-S4)

| Google `events` field | Jin field | Layer | Notes |
|---|---|---|---|
| `id` | `google_event_id` | sync-state | Jin-origin inserts supply a **client-specified** id = base32hex(ULID) ⇒ idempotent insert |
| `iCalUID` | `ical_uid` | canonical file | stable cross-calendar identity |
| `etag` | `etag` | sync-state | optimistic concurrency (`If-Match`) |
| `status` | `status` | file | `cancelled` ⇒ tombstone / mirror removal |
| `summary` | `title` | file | |
| `description` | `body`/`description` | file | |
| `location` | `location` | file | |
| `start.dateTime` + `start.timeZone` | `start` (date-time) + `start_tzid` | file | timed |
| `start.date` | `start` (date) + `is_all_day=true` | file | all-day |
| `end.*` | `end` / `duration` | file | mirrors start handling |
| `recurrence[]` | `recurrence[]` | file | verbatim RRULE/RDATE/EXDATE |
| `recurringEventId` | `recurring_event_id` | file | exception → master |
| `originalStartTime` | `original_start` (+ value-type/tzid) | file | exception identity |
| `sequence` | `sequence` | file | reserve |
| `updated` | `google_updated` | sync-state | LWW comparison |
| `created` | `created` | file | |
| `transparency` / `visibility` | `transparency` / `visibility` | file | reserve |
| `organizer` | `organizer` | file | retained for faithful mirrors; read-only on ordinary writes (`events.move` changes organizer) |
| `attendees[]` / `attendeesOmitted` | `attendees[]` / `attendees_omitted` | file | writable attendee fields round-trip; provider-only identity flags remain local; `attendeesOmitted: true` is emitted only when the canonical event is already truncated and the patch preserves its exact single-self attendee identity/non-response fields while changing only `responseStatus`/`comment` |
| `conferenceData` / `hangoutLink` | `conference_data` / `hangout_link` | file | full conference metadata retained; writes opt into `conferenceDataVersion=1` and recursively project only known conference fields; a server-returned `createRequest` (including consumed `requestId`/read-only `status`) is never replayed, while a separately typed pending request may be emitted only with a request id different from the retained provider request; `hangoutLink` is read-only |
| `reminders` | `reminders` | file | event-scoped Google default/override policy; distinct from Jin task reminders |

### Identity & delete propagation (DEC-09 mechanics)

- **Jin-origin promotion → Google identity:** Jin creates the event locally with a ULID. On first push, `events.insert` supplies a **client-specified event id = base32hex(ULID)** (Google's id charset is `a-v0-9`, 5–1024 chars), making insert idempotent and crash-safe (retry can't duplicate). Persist `google_event_id` ↔ `jin_id`, `ical_uid`, `etag` in sync-state.
- **Delete — Jin-origin event deleted locally:** keep a tombstone; `events.delete` (If-Match) to Google; retain tombstone in sync-state until confirmed.
- **Delete — Google-origin event cancelled on Google:** arrives via incremental sync as `status=cancelled`; remove from the local mirror (tombstone in index; Google is canonical so no sovereign loss).
- **Delete — the *Google replica* of a Jin-origin event is deleted remotely:** treat as **unpublish**, not destroy. Sever the publish link, mark the Jin event `unpublished`, write to audit. **Do NOT delete the Jin-canonical object** — a remote actor must not destroy owner-authored sovereign data. Owner decides to re-push or local-delete. (Policy choice — see footer.)

---

## Conflict & source-of-truth matrix

> **What "canonical" means here:** the copy that is the source of truth on conflict, toward which the other side is reconciled, and that is guaranteed exportable/owner-readable for the P1 sovereignty test. The P1↔P4 tension is resolved by **splitting authority by authorship**: *owner-authored data is Jin's; company-authored data is Google's; Jin mirrors the latter for convenience and offline/linking, flagged as a non-sovereign cache.*

| Object class | Authoritative / canonical | Stored locally? | Conflict policy (auditable) | Delete semantics |
|---|---|---|---|---|
| **Jin-local-only** (note/task, or event never promoted) | **Jin** | Yes (files canonical) | N/A — never synced | Local soft-delete (tombstone) |
| **Owner-authored, promoted event** (created in Jin, published to Google) | **Jin** (Google holds a downstream **replica**) | Yes (canonical file) | **LWW by `updated` timestamp, guarded by `etag` (`If-Match`)**; on `412`/diverged-pull, compare `google_updated` vs `local_updated`, newer wins; **tie → prefer Jin** (owner authored). Every conflict + losing snapshot → audit log. | Local delete ⇒ `events.delete` to Google. Remote delete ⇒ **unpublish** (sever link, keep Jin object), audited. |
| **Company/Google-authored event** (created on Google, mirrored into Jin) | **Google** | Yes — as a **mirror/cache**, flagged `authority: google` (exempt from the strict owner-sovereignty guarantee; still stored as a readable file, permitted by C3) | **Remote-wins (Google authoritative).** A local edit to a mirrored event is allowed but is **overwritten** by Google on conflict; the overwritten local delta is captured in the audit log before being discarded. | Remote `status=cancelled` ⇒ remove mirror (index tombstone). Local "delete" of a mirror = stop mirroring locally only; never calls `events.delete` (owner doesn't own it). |

**Audit log (satisfies C9):** append-only, exportable, human-readable (JSONL in the sovereign file layer + indexed in SQLite). Each entry records: timestamp, `jin_id`, `google_event_id`/`ical_uid`, conflict type (`pull-diverged` / `push-412` / `remote-delete-of-promoted`), both versions' key fields (or a field-level diff), policy applied, winner, and a snapshot of the loser. Conflict resolution is **deterministic** (no interactive prompt required in MVP), and reviewable after the fact — exactly the "basic, audited" bar in C2.

---

## Consequences

### Multi-account operational consequences (2026-08-26)

- CalendarList discovery is per account and paginated. Missing calendars become
  unavailable rather than silently deleted; owner enablement toggles survive refresh.
- `owner` and `writer` routes permit mutations. `reader` and `freeBusyReader`
  remain visible but are read-only. A role downgrade increments route generation
  so stale queued writes pause for review instead of targeting a changed route.
- Mutation intent records account, calendar, recurrence key, etag, canonical
  revision, and auth/route generations before the canonical write completes.
- A 410 reset clears only the affected calendar cursor and clean mappings.
  Disconnect clears only that account's credentials/cursors and quarantines only
  that account's queued writes.
- The original singleton config/tokens are migrated by a resumable prepare → copy
  → verify → activate journal. Legacy material is retained until verification;
  new v2 writes never fall back to singleton credentials.

### Good

- **P1↔P4 resolved concretely.** "My notes are mine" holds literally: owner-authored data is Jin-canonical and exportable; company data — which the owner does not fully own anyway — is a flagged mirror. Nothing routes through any Jin-operated infrastructure (no broker), directly answering the Huly residency critique.
- **Integration thesis (P2) is preserved offline.** Durable local event identities mean notes/tasks link to events that survive without network — JTBD-2/JTBD-3 work offline; `jin today` (JTBD-4) renders the merged agenda from the local mirror.
- **Recurrence is never foreclosed.** Lossless verbatim storage of `recurrence[]`/exceptions + tzid-preserving temporal fields means recurrence ships later as a *feature add*, not a model migration. Round-trips don't corrupt recurring company meetings even in the MVP where they're read-only.
- **Crash-safe, idempotent push.** Client-specified event ids + etag preconditions + an outbox make sync re-runnable without duplicates or lost updates.
- **Secretless, OSS-ready.** BYO OAuth client + PKCE means the repo can go public with zero credential exposure; the only cost is first-run setup.
- **Clean separation for the storage layer.** Sovereign files stay free of Google implementation noise (etags/tokens), so the sovereignty export test stays clean.

### Bad / accepted trade-offs

- **[TRADE-OFF] Setup friction.** Owner-provisioned OAuth requires creating a GCP project, enabling the API, and configuring a consent screen before first sync. A first-run wizard mitigates but cannot eliminate this. Accepted as the price of sovereignty (rejecting the broker).
- **[TRADE-OFF] No real-time push in MVP.** Polling means changes appear on the next `jin sync`/interval, not instantly. Accepted under C4 (no public endpoint on a single machine).
- **[TRADE-OFF] Mirrored company events are a second-class, remote-wins cache.** A local edit to a company event can be silently overwritten (with audit). This is correct given Google authority, but is a UX sharp edge to surface in the CLI (warn when editing an `authority: google` object).
- **[TRADE-OFF] Carrying RFC-5545 fields the MVP doesn't implement** adds schema surface and the discipline to keep them lossless. Cheaper than the alternative, but not free.

### Risks

- **[RISK] OAuth refresh-token expiry in "Testing" publishing status.** `[ASSUMPTION — Google behavior per training knowledge]` An external-user-type OAuth client left in **Testing** status invalidates refresh tokens after **7 days**, forcing weekly re-auth. *Mitigation:* the provisioning wizard must instruct the owner to move the client to **"In production"** (accepting the unverified-app warning, which an individual owner can click through for the sensitive Calendar scope), or use an **Internal** user type if the client lives in a Workspace org. Must be verified against current Google docs at spec time.
- **[RISK] No Secret Service on headless Linux.** The daily driver is Linux; an SSH/headless box may have no keychain daemon. *Mitigation:* the encrypted-file fallback (5-S1) is mandatory, not optional.
- **[RISK] syncToken/window edge cases.** Events moving outside the bootstrap `timeMin` window can surface as `cancelled`; query params must stay constant once a token is in use, or Google rejects/forces re-sync. *Mitigation:* generous/relative window; treat 410 as routine; document params as immutable per token.
- **[RISK] LWW timestamp skew.** `updated` comparison assumes trustworthy clocks; rapid same-second edits on both sides can mis-order. *Mitigation:* etag precondition is the primary guard; timestamp is the tiebreaker; tie → prefer Jin; all logged. Field-level merge is post-MVP.

### Dependencies the data-model / storage deliberation MUST respect

1. **Mirror events live in the files-canonical store**, flagged `authority: google` (a cache, not a sovereign asset), in the same human-readable format as owner events.
2. **Durable identity in the file, volatile cursors in the index.** `ical_uid` (and `google_event_id` for mapping survival) live in the canonical file so the SQLite index is fully rebuildable. `etag`, per-calendar `sync_token`, `dirty`, `last_synced_at` live **only** in SQLite / a dedicated sync-state store and are re-derived by a full re-sync.
3. **The store must provide durable homes for:** (a) per-calendar `sync_token`; (b) per-event sync mapping (`jin_id`↔`google_event_id`↔`ical_uid`, `etag`, `google_updated`); (c) an **outbox / dirty set** of unpushed mutations; (d) the **append-only conflict audit log** (exportable/human-readable). (a)–(c) are rebuildable via re-sync + file-vs-last-sync comparison; (d) is closer to sovereign and must survive index rebuilds.
4. **Soft-delete / tombstones are required** (not hard delete) so "deleted locally" is distinguishable from "never existed" for correct delete propagation.
5. **Temporal fields are stored un-normalized** (local wall time + IANA tzid); any UTC value is a derived index column, never the canonical source.

### Handoffs

- **→ SPECTRA:** spec the sync loop (state machine above), the OAuth provisioning wizard + token storage, the field mapping (table above) as DEC-S4, and the conflict/audit-log format. Honor the storage dependencies in §above.
- **→ owner (human):** confirm the OAuth publishing-status path (production-unverified vs Internal/Workspace) and the **remote-delete-of-promoted-event = unpublish (don't destroy)** policy choice.
- **→ data-model/storage deliberation (DEC-01/02):** consume the 5 dependencies above as hard inputs.

---

## Confidence + key assumptions / [GAP]s

**Per-decision verdicts:**
- **DEC-05** — direct REST API + owner-provisioned PKCE/loopback OAuth + keychain-with-encrypted-file-fallback + incremental polling loop. **Confidence 0.85.** Architecture is essentially forced by the constraints; residual uncertainty is operational (OAuth publishing status, keychain availability), both flagged with fallbacks.
- **DEC-07** — full RFC-5545 semantics internally, subset implemented. **Confidence 0.86.** Strongly forced (Google forces fidelity on the wire; retrofitting is a rewrite; fields are cheap). Residual uncertainty is on-disk serialization shape (spec-level, non-foreclosing).
- **DEC-09** — hybrid, authority by authorship; mirror permitted; remote-wins for company events, etag-guarded LWW for promoted events, append-only audit. **Confidence 0.78.** The read-through rejection is decisive; residual uncertainty is in conflict edge-cases (remote-delete-of-promoted policy is a judgment call; LWW granularity).

**Composite confidence ≈ 0.80** (Evidence quality 75 — several Google-API specifics rest on training knowledge marked `[ASSUMPTION]`; Logical coherence 82; Constraint coverage 85 — C1–C9 each addressed; Sensitivity 75 — robust except DEC-09 edges).

**Key [ASSUMPTION]s (verify at spec time):**
- `[ASSUMPTION]` Google OAuth refresh-token 7-day expiry under Testing/external status; production-unverified yields long-lived tokens for the owner.
- `[ASSUMPTION]` `syncToken`/`410 GONE` semantics, `events.watch` requiring a public domain-verified webhook, client-specified event-id charset, `If-Match`/`etag` concurrency, PKCE+loopback for installed apps — all per training knowledge of the Google Calendar API; confirm against current docs.
- `[ASSUMPTION]` DEC-02 resolves to files-canonical + rebuildable SQLite index (this ADR's storage placement depends on it; if DEC-02 changes, revisit the durable-identity-in-file rule).

**Open [GAP]s / [DISPUTED]:**
- `[GAP]` **Push notifications need a public HTTPS endpoint** — infeasible on a single-machine local app (C4). Deferred; only viable later via a tunnel/relay, which is itself a residency concern. Polling is the MVP answer.
- `[GAP]` **Two-stream display** (`singleEvents=true` window pull for agenda rendering of unimplemented recurrences) — deferred; MVP flags unexpanded recurrences.
- `[GAP]` **Multi-account / multi-calendar, CalDAV, other providers** — out of MVP by C2; model uses a `calendar_id` and `authority` per object so it does not foreclose them.
- `[DISPUTED]` **Remote-delete-of-promoted-event = unpublish (keep) vs delete (mirror Google).** This ADR chooses *keep* (sovereignty-preserving); owner to confirm.
- Meeting metadata is modeled losslessly in event frontmatter and projected to DTOs. Ordinary event writes deliberately omit read-only organizer, attendee identity flags, and `hangoutLink`; `attendeesOmitted: true` is reserved for the validated limited self-RSVP flow, and organizer transfer remains an explicit future `events.move` flow.

**[REVERSAL-CONDITION]s:**
- If the owner adopts **multi-device sync** (DEC-G flips), the single-machine assumptions behind polling-only and the outbox-durability model must be re-deliberated (CRDT/file-sync interplay with sync-state).
- If Google **deprecates the REST `syncToken`/installed-app PKCE path** or mandates verification/CASA for single-user sensitive-scope access, revisit DEC-05 transport/credential model.
- If a future requirement makes **company events first-class editable from Jin** (not remote-wins cache), DEC-09's company-event row must move to an etag-guarded merge policy.
- If DEC-02 lands on a non-hybrid store, the file-vs-index split in §Dependencies must be re-derived.

---

*Generated by FORGE (Reasoner) via the FORGE cycle — standard tier, 2-pass single-trace, gate PASS. Reasoning-only; this ADR is the Emit artifact. CRYSTALIUM memory hooks gracefully skipped (tools unavailable).*
