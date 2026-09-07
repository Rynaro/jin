# VIGIL final retry-ceiling escalation

**Mission:** `VIGIL-20260827-GCAL-001-C2`
**Implementation:** product `1fcfd8e8f52fcabf97db88c7ed901872effd32de`, handoff `75fdd97a18eff639aa3b802ae848e8678837e69c`
**Routing:** Vivi → nexus; retry ceiling reached
**Verdict:** verify-fail; canonical remains `in_progress`

## Outcome

Corrective attempt 2 closes the routing, recurrence, provenance, promotion, migration, request-generation, sidecar-recovery, and deterministic-browser residuals. Final tally is **52 PASS/PASS-static, 1 FAIL, 1 UNVERIFIED**.

All executable implementation gates are green:

- focused core regressions 13/13;
- focused CLI routing 1/1;
- focused Tauri routing 1/1;
- full Rust workspace PASS;
- GUI 42 files / 1716 tests PASS;
- frontend production build PASS;
- 24-file diff check PASS;
- fresh Playwright multi-account Settings and unified Month/Week/Day PASS with zero warnings/errors.

Live Google remains `live-unvalidated`. Native Tauri appearance remains owner-sign-off-required; neither external gate is treated as an offline failure.

## [FINDING-C2-001] AC-GCAL-043 FAIL — real historical executable writes through v2 marker

The new regression `config_migration_historical_singleton_layout_refuses_write` is not historical code. It defines a new surrogate writer that explicitly checks `calendar_id` and therefore proves only the newly chosen assumption.

VIGIL independently compiled commit `c11fa991d86024549875101b5e7b5250c1047ec6` and ran its real `jin event add` against a root containing:

- `.jin/google-v2-required`;
- `google_sync_schema_version = 2`;
- a non-empty v2 registry;
- no singleton `calendar_id`.

The command succeeded and created canonical event `01M10FCFTJCAKAFJ56QW0VAWSS`. The historical binary ignores both new marker mechanisms and therefore does not “refuse before modifying canonical, config, token, or sync data.” Removing the optional singleton routing input is not a compatibility barrier for ordinary canonical writes, and old token APIs likewise do not know the new guard.

**Required evidence:** pin and execute a real historical binary in the acceptance fixture, and provide a compatibility design that actually forces it to reject every prohibited write.

## [FINDING-C2-002] AC-GCAL-034 UNVERIFIED — frozen cross-language DTO fixture absent

Rust `EventDto`/`EventSyncContextDto` and TypeScript declarations align by inspection, and the new JavaScript fixture asserts the expected provider/account/calendar context. However, the frozen verification method is “Rust serialization fixture equals TypeScript fixture.” Repository search finds no Rust test serializing either DTO and no shared fixture consumed by both languages.

**Required evidence:** serialize one provider-backed DTO from Rust and assert structural or byte equality from TypeScript, including stable identity, account/calendar labels and ids, access role, writable flag, and sync state.

## Retry-ceiling disposition

No verify-pass envelope, lifecycle transition, drift check, or archive was performed. Per VIGIL retry policy, no further Vivi retry is authorized without nexus direction.

No product code or existing tests were modified during verification. These are evidence-backed findings, not `[ROOT-CAUSE]` claims.
