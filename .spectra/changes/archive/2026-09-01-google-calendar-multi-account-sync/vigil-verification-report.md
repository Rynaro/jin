# VIGIL verification — Google Calendar multi-account synchronization

**Mission:** `VIGIL-20260827-GCAL-001`
**Checker:** VIGIL (identity-distinct from maker Vivi)
**Implementation:** `/private/tmp/jin-google-calendar-multi-account-sync`, product `1fcfd8e8f52fcabf97db88c7ed901872effd32de`, handoff `75fdd97a18eff639aa3b802ae848e8678837e69c`
**Authority:** read-only verification; product code and existing tests were not modified
**Verdict:** **VERIFY FAIL — keep `in_progress`; do not drift-check or archive**

## Blocking summary

Corrective attempt 2 closes all but two offline gates, but the branch still does not satisfy the frozen 54-check contract: **52 PASS/PASS-static, 1 FAIL, 1 UNVERIFIED**. AC-GCAL-043 fails against an actual compiled historical executable, and AC-GCAL-034 still lacks the frozen Rust-serialization-equals-TypeScript fixture. This is the final retry-ceiling escalation; lifecycle remains `in_progress`.

Tonberry's recorded enforcement is `block`. `mcp__tonberry__verify` passes formal ESL checks C1–C3/C7, but those checks validate manifest/spec shape, not implementation behavior. This report is therefore the blocking implementation verdict.

## Verification evidence

- `mcp__tonberry__verify(..., mode="block")`: PASS for formal conformance only.
- `cargo test --workspace`: PASS outside the sandbox after the expected sandbox-only localhost-bind failure in the OAuth callback fixture.
- `cargo check --workspace`: PASS.
- Focused corrective Rust regression binary: PASS, 13/13.
- Focused CLI routing integration: PASS, 1/1.
- Focused Tauri routing integration: PASS, 1/1.
- `pnpm test`: PASS, 42 files / 1716 tests.
- `pnpm build`: PASS.
- `git diff --check db50c93..1fcfd8e8`: PASS.
- Fresh Playwright: PASS for multi-account Settings, review controls, and mixed Jin/Google Month/Week/Day; zero console warnings/errors.
- Historical counterexample: compiled commit `c11fa99` and successfully created canonical event `01M10FCFTJCAKAFJ56QW0VAWSS` in an activated v2 root.
- Live Google/OAuth two-account run: **UNVERIFIED**.
- Native Tauri appearance/interaction: **UNVERIFIED; owner sign-off required**.

## Per-acceptance-check verdict

`PASS-static` means source inspection establishes the narrow stated behavior but the canonical named test is absent. `UNVERIFIED` means the required evidence cannot be produced from the shipped harness. Any `FAIL` is blocking.

| AC | Verdict | Evidence / reason |
|---|---|---|
| AC-GCAL-001 | PASS | Archived rescue Rust regressions passed twice; headless Month/Week/Day remained reachable at 1280×800 and the half-open multi-day fixture remained visible. |
| AC-GCAL-002 | PASS-static | Singleton preparation creates one generated account in `config.rs:132-177`; no named migration test exists. |
| AC-GCAL-003 | PASS-static | Completed-v2 migration returns early in `migration.rs:76-85`; interrupted phases do not satisfy AC-042. |
| AC-GCAL-004 | PASS | Canonical v1 config/tokens remain intact on token verification failure; the focused rollback regression passes (`google_multi_account_regressions.rs:127-147`; `migration.rs:122-188`). |
| AC-GCAL-005 | PASS-static | Rename mutates alias/timestamp only (`google/account.rs:297-311`). |
| AC-GCAL-006 | PASS-static | V2 keyring/file addresses derive from immutable account id (`google/secrets.rs:486-582`). |
| AC-GCAL-007 | PASS-static | Account id is embedded in OAuth state and mismatch validation rejects the callback (`google/auth.rs:426-479`). |
| AC-GCAL-008 | PASS-static | Missing CalendarList scope marks the prepared account `needs_reauth` without deleting local data (`google/migration.rs:147-161`). |
| AC-GCAL-009 | PASS-static | CalendarList pagination feeds full-account reconciliation (`google/client.rs`, `google/account.rs:314-361`). |
| AC-GCAL-010 | PASS-static | Newly discovered calendars default enabled (`google/account.rs:347-358`). |
| AC-GCAL-011 | PASS-static | Reconciliation retains existing `enabled` and enables only new rows (`google/account.rs:334-358`). |
| AC-GCAL-012 | PASS-static | Existing rows are marked unavailable, not deleted (`google/account.rs:321-327`). |
| AC-GCAL-013 | PASS-static | Pull includes enabled reader calendars while writable destinations reject reader roles (`ops/sync.rs:57-83`; `event_mutation.rs:258-291`). |
| AC-GCAL-014 | PASS-static | Calendar refresh compares prior roles and quarantines the exact changed route before exposing refreshed capabilities (`ops/google_accounts.rs:104-148`; `google/account.rs:314-366`). |
| AC-GCAL-015 | PASS-static | Aggregate scheduling filters disabled/unavailable destinations before token load/network (`ops/sync.rs:57-63`). |
| AC-GCAL-016 | PASS-static | Cursor/mapping lookups include provider/account/calendar and recurrence identity (`sync/state.rs:44-72,401-515`). |
| AC-GCAL-017 | PASS-static | 410 cleanup deletes only the exact composite destination's clean mappings (`google/multi_sync.rs:71-78`; `sync/state.rs:536-558`). |
| AC-GCAL-018 | PASS-static | Routed create journals one exact target and enqueues its destination (`event_mutation.rs:55-85,323-348`). |
| AC-GCAL-019 | PASS-static | `target=None` writes a local event without an outbox (`event_mutation.rs:86-88`). |
| AC-GCAL-020 | PASS | CLI create/delete and public legacy Tauri edit/delete now route through `EventMutationService`; focused CLI and Tauri tests prove scoped insert/patch/delete intents. |
| AC-GCAL-021 | PASS-static | An unfinished journal whose canonical revision matches is idempotently finalized (`event_mutation.rs:223-255,323-348`); no crash-injection test exists. |
| AC-GCAL-022 | PASS-static | Core projects writable mapped Google events editable (`ops/events.rs:268-305`), although the UI then invokes the rejecting legacy mutation path. |
| AC-GCAL-023 | PASS-static | Provider-backed GUI edit resolves `sync_context` and invokes the routed sparse-PATCH command with the exact immutable destination (`events_controller.ts:323-355`; `commands/events.rs:268-345`). |
| AC-GCAL-024 | PASS-static | Provider-backed GUI delete now invokes the routed delete command, and exact route ownership is validated before the canonical cancellation (`events_controller.ts:426-448`; `event_mutation.rs:345-352`). |
| AC-GCAL-025 | PASS-static | Occurrence key derives from `original_start` and persists in mapping/outbox (`event_mutation.rs:374-397`). |
| AC-GCAL-026 | PASS | Pull plans master identity independent of response order and assigns occurrence `master_id`; the end-to-end regression edits the master through an occurrence while preserving its RRULE. |
| AC-GCAL-027 | PASS-static | `ThisAndFollowing` returns before canonical/outbox writes (`event_mutation.rs:102-107,175-180`). |
| AC-GCAL-028 | PASS-static | 412 fetches remote state, writes remote-wins canonical state, and completes without unconditional retry (`google/multi_sync.rs:228-283`). |
| AC-GCAL-029 | PASS-static | Losing delta is appended with scoped immutable route identity (`google/multi_sync.rs:258-280`). |
| AC-GCAL-030 | PASS | Pull preserves Jin origin/authority/derivation on a published replica; the regression performs a normal pull then remote cancellation and proves the canonical event remains present and unpublished. |
| AC-GCAL-031 | PASS-static | Destinations are processed independently and preserve per-destination errors/results (`ops/sync.rs:53-128`). |
| AC-GCAL-032 | PASS | Exact-route review is exposed through core/Tauri/Settings, updates generations, and resumes only the reviewed original destination; the focused reconnect review regression passes (`ops/sync.rs:99-147`; `settings_controller.ts:375-425`). |
| AC-GCAL-033 | PASS | Fresh Playwright projects Jin and Google/Work together in Day and Week, and the Google/Personal recurring event in Month; the deterministic multi-account fixture regression passes. |
| AC-GCAL-034 | **UNVERIFIED** | Rust/TS declarations align statically and the JS fixture asserts the full sync context, but the frozen method requires a Rust serialization fixture equal to a TypeScript fixture. No Rust test serializes `EventDto`/`EventSyncContextDto`, and no shared cross-language fixture exists. |
| AC-GCAL-035 | PASS | Core returns typed `AmbiguousDestination` before mutation and publishes an explicit route; CLI/Tauri/GUI carry exact destination or explicit Jin-only selection. Focused promotion regression passes. |
| AC-GCAL-036 | PASS | Fresh Playwright renders independently operable Personal and Work cards, roles/toggles, refresh/disconnect, and exact-route quarantine review. |
| AC-GCAL-037 | PASS | Existing `google::mapping::tests::local_context_never_serialized` passes and provider mapping is allowlisted. |
| AC-GCAL-038 | PASS-static | Disconnect does not delete canonical events, mappings, or audit (`ops/google_accounts.rs:74-93`). |
| AC-GCAL-039 | PASS | `docs/google-smoke-test.md:5-9` labels multi-account behavior `LIVE-UNVALIDATED`; no live evidence exists. |
| AC-GCAL-040 | PASS-static | Userinfo subject is bound to the generated id before credential save (`ops/google_accounts.rs:17-41`). |
| AC-GCAL-041 | PASS-static | Subject mismatch occurs in a cloned registry before account credential replacement (`ops/google_accounts.rs:24-41`; `google/account.rs:147-176`). |
| AC-GCAL-042 | PASS | Failpoints cover Prepared, TokenCopied, RegistryWritten, and Activated; rerun converges to one activated v2 account without duplicates. The 13-test focused binary passes. |
| AC-GCAL-043 | **FAIL** | The added “historical” test is a newly written surrogate that explicitly checks `calendar_id`, not an old executable. VIGIL compiled real commit `c11fa99`; against a root carrying `.jin/google-v2-required`, `google_sync_schema_version=2`, and no singleton calendar, it successfully ran `event add` and wrote canonical event `01M10FCFTJCAKAFJ56QW0VAWSS`. The old binary ignores both new guards. |
| AC-GCAL-044 | PASS-static | V2 credential APIs address only the requested account namespace and do not call legacy token APIs (`google/secrets.rs:486-582`). |
| AC-GCAL-045 | PASS-static | Refresh uses an account-scoped lock and reloads auth generation before credential commit, discarding stale refreshes (`ops/sync.rs:149-178,206-267`). |
| AC-GCAL-046 | PASS | Outbox identity is now destination-composite; the corrective collision regression enqueues the same operation id for two accounts and retrieves both (`sync/state.rs:44-113`; `google_multi_account_regressions.rs:27-49`). |
| AC-GCAL-047 | PASS-static | Inbound scheduling is independent of access role while outbound validation requires owner/writer (`ops/sync.rs:57-83`; `event_mutation.rs:286-289`). |
| AC-GCAL-048 | PASS-static | Downgrade/removal detection quarantines the exact destination and the review surface requires an explicit decision (`ops/google_accounts.rs:104-148`; `settings_controller.ts:375-425`). |
| AC-GCAL-049 | PASS | Durable route sidecars store provider/account/calendar and reject a same-calendar wrong-account target; the focused immutability regression passes (`route_ownership.rs:13-66`; `google_multi_account_regressions.rs:90-107`). |
| AC-GCAL-050 | PASS-static | The scoped 412 record now includes operation, both etags, redacted delta, remote snapshot/hash, policy/resolution, and winner; recursive denylist redaction is regression-tested (`multi_sync.rs:342-367`; `audit.rs:59-102`). |
| AC-GCAL-051 | PASS | Disconnect cleanup is provider/account scoped and quarantines only that account's outbox; the provider-collision regression passes (`state.rs:738-770`; `google_accounts.rs:75-101`). |
| AC-GCAL-052 | PASS | Paused rows do not replay automatically and exact-route accept/reject review is exposed to Settings (`ops/sync.rs:99-147`; `settings_controller.ts:375-425`). |
| AC-GCAL-053 | PASS-static | Disconnect is non-destructive to cached canonical data and audit records (`ops/google_accounts.rs:74-93`). |
| AC-GCAL-054 | PASS | Pull, outbox mutation, and 412 refetch acquire the account lifecycle lock and reload exact generations/capabilities immediately before the provider request; stale-generation regression proves zero HTTP calls. |

## EventFrontmatter compatibility delta

Keeping public `EventFrontmatter` source-compatible while storing immutable identity in a sibling route sidecar satisfies the equivalent durable identity allowance. Recovery now restores a missing sidecar or rejects a mismatched sidecar before outbox finalization; the routed-create recovery regression passes.

## Browser evidence

Deterministic headless context: `http://127.0.0.1:1420`, Chromium, 1280×800, `en-US`, UTC, reduced motion.

The fresh corrective fixture loaded successfully. Settings renders Personal and Work account cards, owner/writer/reader roles, toggles, refresh/disconnect controls, and the quarantined Work/Team Calendar operation. Day and Week expose both `Source: Jin` and `Source: Google, Work, Team Calendar`; Month exposes the Personal recurring Google event. Browser console: 0 errors, 0 warnings.

Headless browser evidence never proves native WKWebView/WebKitGTK rendering, OAuth handoff, filesystem/core behavior, or owner visual sign-off. Native Tauri and live two-account Google behavior remain explicitly unvalidated.

**CI STATUS: LOGIC FAILED — HEADLESS VISUAL/INTERACTION PASS; NATIVE OWNER SIGN-OFF UNVERIFIED**

## Final retry-ceiling escalation

1. Replace the surrogate old-writer test with an actual pinned historical executable fixture and a compatibility mechanism that makes that executable refuse all canonical/config/token/sync writes on an activated v2 root. Clearing the optional singleton calendar field is insufficient.
2. Add the frozen shared DTO parity fixture: serialize a provider-backed `EventDto` in Rust and assert byte/structural equality from TypeScript, covering stable identity, display provenance, access role, and sync state.

No further Vivi retry is authorized without nexus direction.
