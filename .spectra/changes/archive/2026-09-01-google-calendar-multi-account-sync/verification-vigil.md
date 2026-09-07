# VIGIL verification — Google Calendar multi-account synchronization

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified: 2026-09-01T15:46:15Z
- Implementation head: `d5515ed206c1edac4bb237f143906a4f32f7e6f5`
- Change state: `in_progress` (intentionally unchanged)
- Change tier: `full`
- Tonberry: `0.5.3`, pinned digest `sha256:df6ec882ed2b932483b9cb44449b2e2a233d8e71901e9c6307f627df3979be73`, enforcement `block`

## Independent verdict

VIGIL is identity-distinct from maker Vivi. The restored implementation and
lifecycle evidence satisfy the amended 54-check contract: **54 PASS/PASS-static,
0 FAIL, 0 UNVERIFIED offline acceptance checks**. The previous retry-ceiling
blockers AC-GCAL-034 and AC-GCAL-043 are closed. No transition, drift check,
archive, commit, or push was performed by this verification.

Live two-account Google/OAuth behavior remains correctly labelled
`live-unvalidated`, and native Tauri visual sign-off was not re-attested during
this power-outage recovery. Those external attestations are not represented as
offline test evidence.

## Mechanical verification

All commands were run independently in the restored repository. The OAuth
loopback test's expected sandbox bind denial was superseded by the successful
outside-sandbox gate.

- `make verify` — PASS: formatting, strict core/CLI clippy, full core/CLI tests,
  and determinism loop 5/5.
- `cargo test --workspace` — PASS: core, CLI, Tauri, integration, and doc tests.
- `make verify-gui` — PASS: strict Tauri clippy; 21 library, 65 bridge, and 2
  Google mutation-routing Rust tests; TypeScript check; 43 files / 1,727
  frontend tests; stylelint; Vite production build.
- Pinned Tonberry `verify .spectra/changes/google-calendar-multi-account-sync
  --mode block --json` — PASS, exit 0: C1, C2a, C2b, C3, C6, and C7 for
  AC-GCAL-001 through AC-GCAL-054 all OK.
- `git diff --check` — PASS.

The Vite chunk-size message is informational and unchanged; it is not a gate
failure.

## Residual-blocker closure

### AC-GCAL-034 — PASS

`jin-core/tests/event_dto_cross_language_parity.rs` serializes a complete
provider-backed `EventDto`, including stable identity, provenance, role, and
sync context. `jin-gui/src/__tests__/dto_shapes.test.ts` reads that exact Rust
fixture, constructs the typed TypeScript fixture, and asserts byte-equal JSON
plus structural equality of `sync_context`. Both Rust and frontend suites pass.

### AC-GCAL-043 — PASS under the planner amendment

The criterion is identically amended in `change.json`, `spec.yaml`, `spec.md`,
and the restored frozen plan. The accepted contract now distinguishes:

1. the current fail-closed singleton-write guard;
2. VIGIL's real pinned historical executable counterexample at commit
   `c11fa991d86024549875101b5e7b5250c1047ec6`; and
3. the explicit boundary that current product code cannot retrofit an already
   built historical executable.

The current guard regression passes. The historical counterexample remains in
the lifecycle evidence: the old executable created canonical event
`01M10FCFTJCAKAFJ56QW0VAWSS` despite the v2 marker. The amendment makes no false
claim that this old binary can be changed by the current patch and requires it
not be used against an activated v2 root.

## Corrective recovery evidence

- The clippy-only borrow/default cleanups pass strict `-D warnings` gates and do
  not alter recurrence behavior.
- `seam_conflict_auto_resolved_google_wins_sovereignty_preserved` now derives
  the mock provider update as one day after the local timestamp, eliminating
  the stale wall-clock dependency; it passed the initial run, the full
  workspace run, and all five determinism passes.
- The previously verified Google account isolation, routing, recurrence,
  conflict, Settings, and unified-agenda evidence remains covered by the full
  suites. No GUI production code changed in this recovery patch.

## Provenance

- `change.json`: `0152e1b6aef95f84c0f404aa67318d9b82d63dc28cd173db3c0558005ceed3bd`
- `spec.md`: `2c06d18e4230d0c69289167780b78cd66f0fa115f785537387152a4f5ee9945d`
- `spec.yaml`: `73c6fdbe0f8d06f58ed35d0dae7f693d450d98a33a7658c499909f45944d0491`
- AC-GCAL-043 amendment: `30a82a0f670365a25fd005576f2cdb59cb7240ae8175bbbd9ad8844ef89b6112`
- Restored frozen plan: `e7173c289f64713adbfebf09808f7043c29cbdba46db603acf1d540ae945ed60`
- Stale-date seam test: `0002bea2b4191768ed6bfc0405109ff2296a904c25d7bf33ea5cf9b663d10699`
- Rust DTO parity test: `2c061365dfd8c152dc593c8b345b2b3f35b3482be925bab8f9798bb3555b3190`
- TypeScript DTO parity test: `5e46f53a5e97107f1a99ba2c4d3710df3cacb09f6545f6814d61bce8cb671cbd`

**CI STATUS: LOGIC VERIFIED — RECOVERY PATCH HAS NO VISUAL DELTA; NATIVE OWNER SIGN-OFF NOT RE-ATTESTED**
