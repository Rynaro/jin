# Jin — Test Strategy

> **Story S9.** This document is the authoritative test-strategy reference for the
> Jin MVP.  It records the test layers, the offline Google-sync approach, the
> determinism contract, and the VG→test traceability matrix required by the
> specification (`mvp-integrated-thin-slice.md` §8, VG1–VG11).

---

## 1. Test layers

### Layer 1 — `jin-core` unit tests (`src/**`)

Inline `#[cfg(test)]` modules co-located with production code.  These test
pure functions and small subsystems in isolation:

| Source file | What is tested |
|---|---|
| `src/store/frontmatter.rs` | YAML frontmatter split/render/round-trip; CRLF normalisation; BOM stripping |
| `src/store/fs.rs` | File read/write helpers |
| `src/time/mod.rs` | `resolve_to_utc` exact/gap/overlap; `validate_tzid` |
| `src/google/client.rs` | `ulid_to_google_event_id` base32hex charset/length/determinism/property; `MockHttpClient` mechanics; `CalendarClient` bootstrap + 410 |
| `src/google/mapping.rs` | `google_to_jin` / `jin_to_google` round-trips (VG5); status/all-day/recurring/floating edge cases |
| `src/google/sync.rs` | Full sync-state machine (bootstrap, incremental, 410 wipe, push insert/patch, idempotency, conflict detection, token refresh, cancelled-event delete) |
| `src/google/auth.rs` | PKCE verifier/challenge; state param; URL params |
| `src/google/secrets.rs` | Token encryption/decryption round-trip (file fallback) |
| `src/sync/audit.rs` | Append-only audit log; JSONL validity; human-readability |
| `src/sync/state.rs` | Sync-state SQLite CRUD (token round-trip; upsert+dirty) |
| `src/ops/init.rs` | `init` idempotency; directory layout |

**Run:** `cargo test -p jin-core --lib`

### Layer 2 — `jin-core` integration tests (`tests/*.rs`)

Separate test crates that link `jin_core` as a library dependency.  Each uses
a fresh `TempDir` — no shared state.  These tests are **shipped-path** and
**offline**: no live network, no OS keyring calls, no global env mutation.

| File | Coverage |
|---|---|
| `tests/vg1_rebuild_equivalence.rs` | VG1: delete index → rebuild → byte-identical queries; second-run determinism |
| `tests/vg4_no_direct_sqlite.rs` | VG4: all public API calls return typed DTOs; no `Connection` leaks; `api::refresh` return-type annotation; compile-time proof via `pub(crate) mod index` |
| `tests/vg6_additive_write.rs` | VG6: `attach` / `promote` mutate only the source file; target byte-unchanged; backlinks re-materialised after rebuild |
| `tests/m1_dangling_tombstone.rs` | VG10: tombstoned targets detected as dangling; `list_dangling` surfaces them |
| `tests/m3_event_row_parity.rs` | RFC-5545 field fidelity (created/updated/floating/ical_uid/end_tzid) survive write → rebuild → read |
| `tests/s1_store_schema.rs` | S1 acceptance criteria: init layout, idempotency, note/task soft-delete tombstones, event RFC-5545 fields |
| `tests/s3_dto_contract.rs` | VG3: DTO envelope has `jin_dto_version`; no `file_path`/raw columns in Note/Task/Event/List DTOs; edge vocabulary validation |
| `tests/s5_temporal_correctness.rs` | VG9: spring-forward gap (NonexistentShiftedForward); fall-back overlap (AmbiguousUsedEarlier); mid-summer exact; all-day/floating/anchored disk round-trips; promote with/without tzid; invalid tzid → `JinError::InvalidTimezone` |
| `tests/s61_auth.rs` | S6.1: PKCE challenge/verifier; state match/mismatch; loopback parse; token expiry; exchange code via real mock HTTP; `invalid_grant` → exit 5; encrypted-file store round-trip |

**Run:** `cargo test -p jin-core --tests`

### Layer 3 — CLI shipped-path tests (`jin/tests/*.rs`)

These tests drive the **real `jin` binary** via `env!("CARGO_BIN_EXE_jin")`.
Every invocation goes through the full CLI → `jin-core` → filesystem/SQLite
pipeline.  Isolation is enforced by:

- A fresh `TempDir` per test.
- `token_backend = "file"` forced in `config.toml` so subprocesses never
  touch the OS keyring (prevents races in parallel test execution).
- No `std::env::set_var` / `remove_var` calls — no global-env mutation.
- Direct passphrase injection via `save_tokens_with_passphrase` (not the
  `JIN_PASSPHRASE` env var) where token-storage is needed.

| File | Coverage |
|---|---|
| `tests/cli_auth.rs` | Auth help/logout/status exit codes and `--json` envelopes; encrypted-file backend label in status |
| `tests/cli_backlinks.rs` | `show` surfaces derived-from / prep-for / references backlinks after promote/attach |
| `tests/cli_sync.rs` | `jin sync` without credentials exits 5; `--json` envelope; error message mentions `auth login` |
| `tests/s4_tasks_notes_crud.rs` | Tasks/Notes full CRUD + state machine (36 tests): add/edit/list/done/cancel/reopen; priority; due; list filter; tag filter; JSON parity for all commands; invalid transitions rejected; tombstone exclusion from lists |
| `tests/s62_sync_seam.rs` | Offline `sync_with_http_and_passphrase` seam: bootstrap pulled > 0; conflict auto-resolved by S6.3 policy (sovereignty preserved) |
| `tests/s63_conflict_resolution.rs` | VG8: all six conflict scenarios (company-mirror remote-wins; promoted LWW google/jin; remote-delete→unpublish; push-412 jin-wins re-push; two-conflict append-only audit) |
| `tests/s7_today_agenda.rs` | S7 merged agenda: both sources merged/sorted; promoted event → originating task; prep note surfaced; all-day bucket; recurring unexpanded label; empty day; cross-tz sort |
| `tests/s8_export_sovereignty.rs` | VG2: export → fresh-init → rebuild → identical results; all MD files byte-identical; secrets/caches excluded; audit.jsonl exported + human-readable; empty store; dest collision refused/forced; `--json` parity; Google-source event included |

**Run:** `cargo test -p jin -- --test-threads=1` (CLI tests spawn subprocesses;
default parallelism is fine because each test uses a unique TempDir).

---

## 2. How Google sync is tested offline

### Multi-account route matrix

The v2 implementation keeps provider effects injectable and validates account
isolation without live credentials. Relevant coverage includes immutable account
identity and alias uniqueness, resumable singleton migration, account-scoped
secret namespaces, paginated CalendarList discovery, role downgrade behavior,
composite cursor/mapping keys, exact-route outbox drain, 410 isolation, 412
remote-wins resolution, recurrence-scope rejection, and disconnect quarantine.

Cross-tier product validation also requires:

```sh
cargo test --workspace
pnpm --dir jin-gui test
pnpm --dir jin-gui build
```

These commands do not establish live Google fidelity or native Tauri appearance.
Use `docs/google-smoke-test.md` for those explicitly owner-run gates.

All Google Calendar API interactions are intercepted via the `HttpClient` trait
defined in `jin-core/src/google/client.rs`:

```rust
pub trait HttpClient: Send + Sync {
    fn get(&self, url: &str, auth: &str) -> Result<HttpResponse>;
    fn post(&self, url: &str, auth: &str, body: &serde_json::Value) -> Result<HttpResponse>;
    fn patch(&self, url: &str, auth: &str, body: &serde_json::Value, etag: Option<&str>) -> Result<HttpResponse>;
    fn delete(&self, url: &str, auth: &str, etag: Option<&str>) -> Result<HttpResponse>;
}
```

`MockHttpClient` is the cassette player: it holds a `Vec<HttpResponse>` and
returns them in order.  Each test constructs an exact cassette that mirrors a
real Google API interaction:

```rust
let mock = MockHttpClient::new(vec![
    HttpResponse { status: 200, body: bootstrap_page, etag: None },
    HttpResponse { status: 412, body: precondition_error, etag: None },
    HttpResponse { status: 200, body: current_remote_event, etag: Some("\"v2\"") },
    HttpResponse { status: 200, body: repush_success, etag: Some("\"v3\"") },
]);
let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, passphrase)?;
```

**No real network or Google account is ever required to run the test suite.**

The cassette approach covers:

| Scenario | Test |
|---|---|
| BOOTSTRAP (paginated `pageToken`) | `bootstrap_with_pagination_persists_sync_token` |
| INCREMENTAL add + `status=cancelled` delete | `incremental_applies_adds_and_cancellations` |
| HTTP 410 → wipe + full re-sync | `http_410_triggers_wipe_and_full_resync` |
| Push `insert` with base32hex ULID id (idempotent) | `push_insert_is_idempotent_base32hex_ulid` |
| Push `patch` 412 → conflict detected | `push_patch_412_detected_as_conflict` |
| Recurring event mirror + unexpanded flag | `recurring_event_mirrored_with_unexpanded_flag_never_pushed` |
| Google-authored event `source`/`authority` | `google_authored_event_written_with_correct_source_authority` |
| Token refresh via injected HTTP | `m4_expired_token_refresh_uses_injected_http` |
| `invalid_grant` → exit 5 | `m4_invalid_grant_refresh_returns_auth_error` |
| Cancelled Jin event → `events.delete` | `m5_cancelled_jin_event_issues_google_delete` |
| Pull-both-sides-changed conflict detection | `pull_both_sides_changed_detected_as_conflict` |
| S6.3 all conflict types (6 tests) | `s63_conflict_resolution.rs` |

**Gated live smoke test** (never required in CI): a sandbox-account end-to-end
round-trip (create → push → pull → delete) can be run manually when a developer
sets `JIN_LIVE_SMOKE_TEST=1` and provides real credentials.  This flag is not
set in any CI job.

---

## 3. Determinism contract

The test suite is deterministic by construction:

1. **No wall-clock leaks in derived data.** The index rebuild is ordered by ULID
   (monotonic, insertion-deterministic).  `vg1_rebuild_is_deterministic` verifies
   this by running rebuild twice on identical inputs and asserting identical
   query results.

2. **No global-env mutation.** Tests that need a passphrase call
   `save_tokens_with_passphrase(root, cfg, tokens, "literal-passphrase")` directly
   rather than setting `JIN_PASSPHRASE` in the process environment.  No test
   calls `std::env::set_var` / `remove_var`.

3. **Isolated temp roots.** Every test uses a dedicated `TempDir::new()` root.
   Shared state (filesystem, SQLite, sync-state) does not exist between tests.

4. **Determinism loop in `make verify`.** The full suite is run N=5 consecutive
   times; any non-zero exit from `cargo test` aborts with `DETERMINISM FAIL`.

---

## 4. How to run the full verification

```
make verify
```

This single command runs (in order):

1. `cargo fmt --check` — formatting gate
2. `cargo clippy --all-targets -- -D warnings` — lint gate
3. `cargo test --workspace` — full test suite (all layers)
4. Determinism loop — 5 consecutive full-suite runs

See the [Makefile](../Makefile) for the exact target definition.

Individual targets:

```
make fmt        # auto-format (writes files)
make clippy     # lint (alias for clippy-check)
make test       # one-shot full suite
make check      # cargo check only (fast type-check)
```

---

## 5. VG→test traceability matrix

The table below maps each validation gate to the test(s) that enforce it.
Tests marked `[NEW S9]` were added by Story S9 (this file's story) specifically
to make the gate explicit.

### VG1 — Rebuild-equivalence

> Delete `index.sqlite` → rebuild → every query returns byte-identical results.

| Test | File | Layer |
|---|---|---|
| `vg1_rebuild_equivalence` | `jin-core/tests/vg1_rebuild_equivalence.rs` | L2 |
| `vg1_rebuild_is_deterministic` | `jin-core/tests/vg1_rebuild_equivalence.rs` | L2 |

### VG2 — Sovereignty round-trip

> Export → fresh `jin init` → index rebuild → identical query results; every
> exported byte is human-readable.

| Test | File | Layer |
|---|---|---|
| `s8_round_trip_vg2` | `jin/tests/s8_export_sovereignty.rs` | L3 |
| `s8_all_canonical_files_present_byte_identical` | `jin/tests/s8_export_sovereignty.rs` | L3 |
| `s8_secrets_and_derived_caches_excluded` | `jin/tests/s8_export_sovereignty.rs` | L3 |
| `s8_audit_log_exported_and_human_readable` | `jin/tests/s8_export_sovereignty.rs` | L3 |

### VG3 — `--json` DTO parity

> Every command has a versioned-DTO `--json` form; no raw SQLite columns cross
> the boundary.

| Test | File | Layer |
|---|---|---|
| `vg3_note_dto_envelope_has_version` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `vg3_task_dto_has_version` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `vg3_event_dto_has_version` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `vg3_list_dto_envelope_valid` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `m7_envelope_version_round_trips` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `m7_error_envelope_round_trips` | `jin-core/tests/s3_dto_contract.rs` | L2 |
| `json_parity_task_start` … `json_parity_note_list_tag_filter` (8 tests) | `jin/tests/s4_tasks_notes_crud.rs` | L3 |
| `s8_json_parity` | `jin/tests/s8_export_sovereignty.rs` | L3 |
| `cli_auth_status_json_no_creds_envelope` | `jin/tests/cli_auth.rs` | L3 |
| `sync_unauthenticated_json_envelope_exit_5` | `jin/tests/cli_sync.rs` | L3 |

### VG4 — No-direct-SQLite boundary

> Only `jin-core` opens `index.sqlite`; schema stays private.

**Primary enforcement:** `pub(crate) mod index` in `jin-core/src/lib.rs` — the
index module is invisible to all external crates (including the `jin` CLI binary
and `jin-core/tests/`).  This is verified at every `cargo check` invocation.

| Test | File | Layer | Note |
|---|---|---|---|
| `vg4_public_api_returns_dto_types_not_raw_sql` | `jin-core/tests/vg4_no_direct_sqlite.rs` | L2 | **[NEW S9]** |
| `vg4_refresh_does_not_leak_connection` | `jin-core/tests/vg4_no_direct_sqlite.rs` | L2 | **[NEW S9]** |
| `vg4_list_dangling_returns_dto_not_raw_rows` | `jin-core/tests/vg4_no_direct_sqlite.rs` | L2 | **[NEW S9]** |
| All CLI tests in `jin/tests/` | various | L3 | Empirical: CLI binary never accesses SQLite directly |

### VG5 — RFC-5545 fidelity / lossless field mapping

> Recurring mirror stored verbatim; `google_to_jin` / `jin_to_google` field
> mapping round-trips losslessly.

| Test | File | Layer |
|---|---|---|
| `vg5_timed_event_round_trip_lossless` | `jin-core/src/google/mapping.rs` | L1 |
| `vg5_all_day_event_round_trip` | `jin-core/src/google/mapping.rs` | L1 |
| `vg5_all_day_exclusive_end_round_trip` | `jin-core/src/google/mapping.rs` | L1 |
| `vg5_recurring_event_stored_verbatim` | `jin-core/src/google/mapping.rs` | L1 |
| `vg5_tentative_status_round_trip` | `jin-core/src/google/mapping.rs` | L1 |
| `vg5_cancelled_status_maps_to_tombstone` | `jin-core/src/google/mapping.rs` | L1 |
| `google_to_jin_sets_source_and_authority_google` | `jin-core/src/google/mapping.rs` | L1 |
| `m8_timed_event_without_timezone_flagged_floating` | `jin-core/src/google/mapping.rs` | L1 |
| `jin_to_google_jin_origin_event` | `jin-core/src/google/mapping.rs` | L1 |
| `google_authored_event_written_with_correct_source_authority` | `jin-core/src/google/sync.rs` | L1 |
| `recurring_event_mirrored_with_unexpanded_flag_never_pushed` | `jin-core/src/google/sync.rs` | L1 |
| `seam_bootstrap_returns_pulled_and_ok_status` | `jin/tests/s62_sync_seam.rs` | L3 |

### VG6 — Additive-write linking

> `promote` / `attach` mutate only the source file; target is byte-unchanged;
> backlinks are derived in the index, never written to disk.

| Test | File | Layer |
|---|---|---|
| `vg6_attach_note_to_event_target_unchanged` | `jin-core/tests/vg6_additive_write.rs` | L2 |
| `vg6_promote_task_file_unchanged` | `jin-core/tests/vg6_additive_write.rs` | L2 |
| `vg6_backlinks_derived_from_rebuild` | `jin-core/tests/vg6_additive_write.rs` | L2 |
| `s5_promote_with_tzid_anchors_event` (includes VG6 assertions) | `jin-core/tests/s5_temporal_correctness.rs` | L2 |

### VG7 — Sync idempotency / crash-safety

> Client-specified `base32hex(ULID)` event id; `If-Match` etag concurrency;
> outbox is re-runnable with no duplication.

| Test | File | Layer |
|---|---|---|
| `base32hex_charset_is_a_v_0_9` | `jin-core/src/google/client.rs` | L1 |
| `base32hex_length_is_26` | `jin-core/src/google/client.rs` | L1 |
| `base32hex_is_deterministic` | `jin-core/src/google/client.rs` | L1 |
| `different_ulids_produce_different_ids` | `jin-core/src/google/client.rs` | L1 |
| `base32hex_property_charset_and_length_many_ulids` | `jin-core/src/google/client.rs` | L1 |
| `push_insert_is_idempotent_base32hex_ulid` | `jin-core/src/google/sync.rs` | L1 |
| `push_patch_412_detected_as_conflict` | `jin-core/src/google/sync.rs` | L1 |
| `m3_promote_enqueues_dirty_and_push_fires_vg7_idempotent` | `jin-core/src/google/sync.rs` | L1 |
| `s63_push_412_jin_wins_re_push_attempted` | `jin/tests/s63_conflict_resolution.rs` | L3 |

### VG8 — Conflict-audit completeness

> Every conflict logged with timestamp, both object versions, policy applied,
> winner, and loser snapshot; log is append-only JSONL, export-included.

| Test | File | Layer |
|---|---|---|
| `append_creates_file_and_writes_valid_json` | `jin-core/src/sync/audit.rs` | L1 |
| `append_only_two_entries_both_lines_preserved` | `jin-core/src/sync/audit.rs` | L1 |
| `entry_is_human_readable_jsonl` | `jin-core/src/sync/audit.rs` | L1 |
| `s63_company_mirror_remote_changed_remote_wins` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `s63_promoted_diverged_google_newer_google_applied_sovereignty_preserved` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `s63_promoted_diverged_jin_newer_jin_kept_repush_enqueued` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `s63_remote_delete_of_promoted_unpublish_jin_file_intact` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `s63_push_412_jin_wins_re_push_attempted` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `s63_audit_log_is_append_only_two_conflicts_two_lines` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `seam_conflict_auto_resolved_google_wins_sovereignty_preserved` | `jin/tests/s62_sync_seam.rs` | L3 |

### VG9 — DST correctness

> `chrono-tz` `Ambiguous`/`None` cases handled explicitly, never silently
> coerced; both gap and overlap produce a `warning_note`.

| Test | File | Layer |
|---|---|---|
| `spring_forward_gap_is_shifted_forward` | `jin-core/src/time/mod.rs` | L1 |
| `fall_back_overlap_uses_earlier_instant` | `jin-core/src/time/mod.rs` | L1 |
| `exact_resolution_is_exact` | `jin-core/src/time/mod.rs` | L1 |
| `invalid_tzid_returns_error` | `jin-core/src/time/mod.rs` | L1 |
| `validate_tzid_accepts_valid` | `jin-core/src/time/mod.rs` | L1 |
| `validate_tzid_rejects_invalid` | `jin-core/src/time/mod.rs` | L1 |
| `vg9_spring_forward_gap_exact_utc` | `jin-core/tests/s5_temporal_correctness.rs` | L2 |
| `vg9_fall_back_overlap_uses_earlier_instant` | `jin-core/tests/s5_temporal_correctness.rs` | L2 |
| `vg9_non_dst_time_is_exact` | `jin-core/tests/s5_temporal_correctness.rs` | L2 |
| `s5_promote_invalid_tzid_returns_error` | `jin-core/tests/s5_temporal_correctness.rs` | L2 |

### VG10 — Soft-delete / tombstone distinguishability

> "Deleted" is distinguishable from "never existed"; tombstoned edges are
> dangling; correct delete propagation in the sync loop.

| Test | File | Layer |
|---|---|---|
| `s1_note_soft_delete_tombstone` | `jin-core/tests/s1_store_schema.rs` | L2 |
| `s1_task_soft_delete_tombstone` | `jin-core/tests/s1_store_schema.rs` | L2 |
| `m1_tombstoned_target_is_dangling` | `jin-core/tests/m1_dangling_tombstone.rs` | L2 |
| `vg5_cancelled_status_maps_to_tombstone` | `jin-core/src/google/mapping.rs` | L1 |
| `incremental_applies_adds_and_cancellations` | `jin-core/src/google/sync.rs` | L1 |
| `m5_cancelled_jin_event_issues_google_delete` | `jin-core/src/google/sync.rs` | L1 |
| `s63_remote_delete_of_promoted_unpublish_jin_file_intact` | `jin/tests/s63_conflict_resolution.rs` | L3 |
| `task_list_excludes_deleted` | `jin/tests/s4_tasks_notes_crud.rs` | L3 |

### Cross-cutting: P1 Sovereignty

> Owner-authored data is never destroyed by a Google event (authority: jin
> preserved through conflicts; remote delete of promoted = unpublish only).

| Test | File | What is validated |
|---|---|---|
| `s8_round_trip_vg2` | `s8_export_sovereignty.rs` | Export → fresh store → identical results |
| `s63_remote_delete_of_promoted_unpublish_jin_file_intact` | `s63_conflict_resolution.rs` | Jin file not deleted on Google cancel |
| `seam_conflict_auto_resolved_google_wins_sovereignty_preserved` | `s62_sync_seam.rs` | `source=jin` + `derived_from` preserved after Google-wins LWW |
| `s63_promoted_diverged_jin_newer_jin_kept_repush_enqueued` | `s63_conflict_resolution.rs` | Jin content preserved when Jin is newer |
| `s63_promoted_diverged_google_newer_google_applied_sovereignty_preserved` | `s63_conflict_resolution.rs` | `source=jin`, `authority=jin`, `derived_from` preserved even when Google wins |

### Cross-cutting: Determinism

| Test | What is validated |
|---|---|
| `vg1_rebuild_is_deterministic` | Index rebuild twice on identical inputs → identical results |
| `make verify` determinism loop | Full suite run 5× consecutively; any failure → gate fails |

### Cross-cutting: Error-path / exit codes

| Test | Exit code | What is validated |
|---|---|---|
| `sync_unauthenticated_exits_5` | 5 | No tokens → auth error |
| `sync_unauthenticated_mentions_auth_login` | 5 | Error message directs user to `jin auth login` |
| `s63_push_412_jin_wins_re_push_attempted` | — | 412 detected, resolved, not surfaced as exit 4 |
| `cli_auth_logout_no_creds_exits_cleanly` | 0 | Logout without prior auth exits 0 |
| `cli_auth_status_no_creds_exits_zero` | 0 | Status without auth is informational (not an error) |
| `s8_dest_collision_refused_by_default` | non-0 | Non-empty dest without `--force` → non-zero exit |

---

## 6. `[GAP]` / `[ASSUMPTION]` notes

- **VG4 structural:** The primary VG4 enforcement is `pub(crate) mod index;` in
  `lib.rs`. The `vg4_no_direct_sqlite.rs` tests provide an explicit runtime
  complement but the compile-time guarantee is the load-bearing one.  This was
  the only gate previously lacking a dedicated test file — three tests were added
  in S9 (`[NEW S9]`).

- **VG5 live API fidelity `[ASSUMPTION]`:** Cassette fixtures were constructed
  from training knowledge of the Google Calendar API (field shapes, charset
  rules, 410 handling). They should be verified against live API responses at
  the first real sync run, per the `[ASSUMPTION]` in the spec.

- **VG9 property tests:** DST edge cases are tested with concrete time values
  (America/New_York spring 2023, fall 2023).  A full property test over arbitrary
  IANA tzids was considered but the `proptest` crate is not yet a dependency;
  the concrete cases cover the two structurally distinct DST scenarios (gap and
  overlap).  This is sufficient for the MVP but noted as a future enhancement.

- **Gated smoke test:** A real Google account round-trip (S9 AC-2) is not
  included in any CI job.  It can be triggered manually; see `[OWNER-CONFIRM]`
  in the spec.
