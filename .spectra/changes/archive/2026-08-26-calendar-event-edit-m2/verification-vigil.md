# VIGIL Verification — calendar-event-edit-m2

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified commit: `f3fc576a3c90c9a8c62199065d03895f7f242f29`
- Verified: 2026-08-26
- Change tier: `full`

## Independence and scope

Maker and checker are identity-distinct (`Vivi` != `VIGIL`). VIGIL reviewed the
complete M2 specification, manifest, FORGE deliberation, implementation diff,
and prior M1 verification before checking the exact final commit. The review
covered all 18 acceptance checks, including canonical token semantics,
operation/request binding, zero-side-effect no-op and stale paths, immutable
Event fields, Time-block Task isolation, recovery divergence, refetch/focus,
read-only matrices, localization, keyboard access, and deterministic browser
behavior.

## Acceptance verdict

All 18 acceptance checks pass within the checker-owned logic and deterministic
browser scope. The final fixture correction emits the complete typed stale
contract (`code`, `kind`, `message`, `retriable`, and `details`), so the real
browser controller preserves the draft, refetches the latest canonical Event,
identifies changed fields, and exposes `Use latest` / `Review my draft` without
writing. The same behavior was exercised in Portuguese at 480px under the dark
theme and reduced motion.

The surrounding browser smoke confirmed that no-op Save leaves the edit token,
sequence, and canonical fields unchanged; focus returns to Edit; Description
Enter inserts a newline without saving; Escape discards the draft and restores
focus; Google recurring and cancelled Events expose no Edit action; and the
responsive editor has no unintended horizontal overflow. The browser console
reported zero warnings and zero errors.

## Core and bridge semantics

The core audit and suites establish that the detail token hashes exact canonical
bytes while holding the read lock; edit operation identity binds Event id, token,
and patch; retries return their original staged semantic result; no-op and stale
requests create no canonical, index, sync, sequence, or operation-journal side
effects; only allowed fields plus `updated` and `sequence` change; Time-block
edits retain `derived_from` and byte-preserve the originating Task; all external,
cancelled, master, occurrence, `original_start`, and unexpanded recurrence shapes
fail closed; and divergent recovery never overwrites canonical state or emits
derived effects.

## Mechanical verification

All commands were run at the exact verified commit.

- Focused fixture/controller regressions: PASS, 83/83 tests.
- Full core suite: PASS, 245 unit tests, 54 integration tests, and 1 doc test.
- Native bridge package: PASS, 18 unit tests and 64 bridge tests.
- Full GUI suite: PASS, 39 files and 1,638/1,638 tests.
- Production GUI build: PASS.
- CSS lint: PASS.
- `cargo fmt --all -- --check`: PASS.
- `cargo clippy --workspace --all-targets -- -D warnings`: PASS.
- Commit diff check and checker pre-write worktree check: PASS.
- Browser console: zero warnings and zero errors.

## Browser visual evidence

- English stale comparison, 1280x800:
  `.artifacts/playwright-mcp/calendar-event-edit-m2-stale-resolved-f3fc576-1280x800.png`
- Portuguese, dark, reduced-motion stale comparison, 480x800:
  `.artifacts/playwright-mcp/calendar-event-edit-m2-stale-ptbr-dark-480-f3fc576.png`
- Accessibility snapshots were captured under `.artifacts/playwright-mcp/`,
  including the English conflict state at `page-2026-08-26T15-49-27-647Z.yml`
  and responsive Portuguese state at `page-2026-08-26T15-51-24-173Z.yml`.

## Native visual verification boundary

The owner/operator explicitly approved the native Tauri M2 visual result on
2026-08-26 after verification commit `f3fc576a3c90c9a8c62199065d03895f7f242f29`.
The exact verified build loaded the real bridge without startup errors and
presented the calm, detail-resident Portuguese edit surface without clipping or
unintended overflow at the native window size. Title received initial focus;
Escape cancelled and returned focus to Edit; and no-op Save returned to detail
and restored focus to Edit. The QA application was then closed cleanly.

This owner-observed native evidence remains distinct from deterministic
Playwright evidence. The browser fixture is not represented as proof of native
window chrome, platform scaling, or native WebView rendering.

`CI STATUS: LOGIC VERIFIED — NATIVE VISUALS OWNER-APPROVED`

## Tonberry enforcement

`eidolons.mcp.lock` records Tonberry enforcement as `block`; lifecycle
verification therefore runs in block mode. This chronicle and the sibling ECL
envelope are checker evidence for verification, transition, and drift checking.
IDG retains ownership of archive.

## Promotion hand-off

Tonberry generated `promotion.envelope.json` during archive. IDG attempted to
route the promotion through CRYSTALIUM: the compact Tonberry sidecar was rejected
because it lacks Crystalium's required full-ECL transport fields, and a
schema-complete retry ended with the Crystalium transport closing before a
result was returned. No further retry was made because the outcome is uncertain
and duplicate ingestion must be avoided. The durable promotion intent remains
recorded in this archive for a later idempotent hand-off.
