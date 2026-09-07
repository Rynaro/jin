# Google Calendar Sync — Real-Account Smoke Test

> **Status:** the bidirectional Google Calendar sync (S6.2/S6.3) is **fully verified offline** (mock-HTTP cassettes — no real account ever touched in CI). This runbook is the **one remaining validation**: confirming the offline cassette assumptions match the live Google Calendar API on a real account. Run it once on your desktop; report any divergence so the mapping can be corrected.

> **Multi-account status (2026-08-26): LIVE-UNVALIDATED.** Registry, migration,
> scoped credentials/cursors/mappings/outbox, discovery, role enforcement, routed
> mutations, provider drain, DTOs, CLI, Tauri commands, and Settings surfaces are
> implemented and covered by offline tests/builds. No claim is made yet for a live
> two-account Google round trip or native Tauri visual sign-off.

## Why this is needed
CI proves the sync *logic* (incremental `syncToken`, 410 re-sync, etag concurrency, base32hex event-id, conflict resolution, audit) against canned responses. It does **not** prove those canned responses match Google's real API today. That fidelity is the last gap (flagged `[ASSUMPTION]` in the S6.2 review).

## ⚠️ Use a throwaway calendar first
Do the first run against a **dedicated test Google Calendar**, not your primary/company calendar. Jin's policies are non-destructive to *your* data (remote-delete of a promoted event **unpublishes but keeps** the local object), but validate on a disposable calendar before trusting it with real events.

## Prerequisites
- A working `jin` binary: `cargo build --release` (or run via `cargo run -p jin --`).
- A Google account.

## Step 1 — Choose the OAuth credential mode

An official distributor build may provide a production Desktop OAuth client so
the user can connect without creating a Google Cloud project. Before describing
that path as public or verified, the distributor must have completed Google's
verification for every sensitive Calendar scope requested by that client.
Publishing status **In production is a prerequisite, not verification itself**.

This repository and ordinary source builds do not contain real credentials.
For those builds, use the advanced BYO path below.

## Step 1A — Advanced BYO client (Google Cloud Console)

1. https://console.cloud.google.com → create a project (e.g. "jin").
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **OAuth consent screen:** User type **External**. Fill the minimal fields.
   - During development, add the accounts as test users. Authorizations for
     scopes beyond basic identity expire after seven days while the app remains
     in Testing, including associated refresh tokens.
   - For a personal/few-known-users BYO app, Google documents an exception from
     mandatory verification; an unverified warning and user cap can still apply.
   - A user-facing public app is different: sensitive Calendar scopes require
     verification. Moving it to **In production** does not waive that review.
4. **Credentials → Create credentials → OAuth client ID → Application type: "Desktop app".** Copy the **client ID** and **client secret**.

## Step 2 — Configure an unbundled/BYO Jin build
Provide the client credentials (env or the `[google]` section of `config.toml` in your jin root):
```
export JIN_GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
export JIN_GOOGLE_CLIENT_SECRET="…"
# If your machine has no OS keyring (Secret Service), also set a passphrase for the encrypted-file token fallback:
export JIN_TOKEN_PASSPHRASE="<a strong passphrase>"
```

Runtime environment variables and per-vault config are advanced overrides; they
take precedence over any distributor default when a release supports one.

## Step 3 — Authenticate and discover calendars

In the GUI, open **Settings → Calendar Accounts**, add an alias, and choose
**Connect**. Successful authentication immediately refreshes CalendarList, so
visible calendars and access roles should appear without a second action. If
authentication succeeds but discovery is temporarily unavailable, Jin keeps the
account connected and reports a retriable partial-success error; choose
**Refresh calendars** later.

The equivalent CLI/operator flow is:

```
jin google add Personal
jin google login <account-id> # opens browser; successful login also discovers calendars
jin google list
```

## Step 4 — Exercise the bidirectional flow (on the test calendar)
```
jin sync                                   # bootstrap: pulls existing events, stores a syncToken
jin event add "Smoke timed" --start 2026-07-10T10:00:00 --end 2026-07-10T11:00:00 --tz America/Sao_Paulo
jin sync                                   # PUSH: the event should now appear on Google
# → edit that event's title on Google's web UI, then:
jin sync                                   # PULL: jin should reflect the edit (company-style remote-wins / promoted LWW)
# hero flow:
TID=$(jin --json task add "Prep for review" | jq -r .data.id)
jin promote "$TID" --when 2026-07-11T14:00:00 --tz America/Sao_Paulo
jin sync                                   # the promoted (source=jin) event publishes to Google
jin today --date 2026-07-11                # shows it, linked back to the task
# delete the promoted event on Google, then:
jin sync                                   # policy: UNPUBLISH — Google copy gone, local jin object KEPT (status confirmed)
```

## Step 4A — Multi-account isolation and aliasing

Use two disposable Google accounts and at least two calendars on one account.
Until the account-scoped OAuth UX is live-validated, treat these commands as an
operator checklist rather than proof of Google fidelity.

```sh
jin google add Personal
jin google add Work
jin google list --json

# Authenticate each returned immutable account id (account-bound PKCE/state +
# Google issuer/subject validation; a different subject is rejected). Login
# automatically discovers calendars; refresh is only a retry/manual update:
jin google login <personal-account-id>
jin google login <work-account-id>
jin google refresh <personal-account-id> # optional discovery retry
jin google calendar <work-account-id> <calendar-id> --disable
jin google rename <work-account-id> "Project OSS"
jin google list
```

Verify all of the following:

- Renaming Work to Project OSS changes labels only; account/calendar ids and
  mappings remain unchanged.
- The same Google event id in two account/calendar routes does not collide.
- A reader calendar is visible and cannot be selected for create/edit/delete.
- Disabling or losing access to one calendar does not stop other routes syncing.
- A 410 response on one calendar resets only that cursor.
- Disconnecting one account leaves the other account's credentials, cached
  events, cursors, mappings, and pending writes intact.
- A queued mutation never changes destination after an alias change, refresh,
  role downgrade, reconnect, or default-calendar change.
- A 412 response fetches the remote version and applies the documented authority
  policy; there is no unconditional overwrite.

For native GUI sign-off, additionally verify keyboard-only alias editing,
calendar toggles, visible read-only roles, loading/errors, and the combined
Month/Week/Day agenda. Record this separately from headless browser evidence.

## Step 5 — Divergence checklist (what the offline cassettes assume)
If any of these behave differently against the live API, capture the **raw Google response** and report it — the field mapping / sync loop can then be corrected:
- [ ] Event resource shape: `start`/`end` as `{date}` (all-day) vs `{dateTime, timeZone}` (timed); **all-day `end.date` is exclusive**.
- [ ] `etag` header/field format and **`If-Match`** precondition behavior (412 on mismatch).
- [ ] Incremental sync: `events.list` with `syncToken`; an invalid token returns **HTTP 410 `fullSyncRequired`** → full re-sync.
- [ ] **Client-specified event id** on insert accepted: base32hex (`a-v` + `0-9`), 5–1024 chars (jin derives it from the event ULID; insert must be idempotent — a retry must not duplicate).
- [ ] Recurring events: `recurrence` (RRULE) returned verbatim; jin mirrors them **read-only** (flagged unexpanded) and never pushes them.
- [ ] Refresh: long-lived refresh token survives past 7 days (confirms the "In production" publishing step).

## What to report back
For each Step-4 action: pass/fail. For any Step-5 item that diverges: the action, the **real Google JSON**, and what jin did instead. That's enough to fix the live-API mapping. Until then, treat real-account sync as **unvalidated**.
