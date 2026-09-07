---
eidolon: vivi
version: 1.1.0
kind: vivi-completion-report
status: corrective-attempt-completed
created_at: 2026-08-27T01:52:33Z
thread_id: 4c6227b5-bf3a-4bd4-a65d-5bca3a3aa5f1
files_changed_count: 21
tests_run: 4386
tests_passed: 4386
deltas_count: 2
escalations_count: 0
evidence_anchors_count: 12
corrective_attempt: 2
---

# Vivi corrective completion — Google Calendar multi-account synchronization

## Outcome

Corrective attempt 2 closes all six residual VIGIL failures and supplies
deterministic evidence for all four previously unverified criteria. It is ready
for identity-distinct VIGIL re-verification on branch
`codex/google-calendar-multi-account-sync` in worktree
`/private/tmp/jin-google-calendar-multi-account-sync`.

The dirty main checkout was not changed. No pre-existing test was edited or
weakened. Corrective evidence was added only to the implementation-owned
regression module and new acceptance modules.

## Residual acceptance mapping

| Acceptance criteria | Corrective implementation / evidence |
|---|---|
| AC-GCAL-020 | CLI `event add/rm` and legacy Tauri edit/delete now cross `EventMutationService`, recover/validate canonical route ownership, and emit exact account/calendar outbox rows. Evidence: `google_calendar_cli_routing` and `google_calendar_mutation_routing`. |
| AC-GCAL-026 | Pull preplans remote-to-Jin identities for every response page and persists an occurrence's canonical `master_id`, independent of item order. The regression invokes an entire-series edit from the occurrence and verifies the master retains its RRULE. |
| AC-GCAL-030 | Ordinary pull preserves Jin source/authority/provenance for published Jin events. A later remote cancellation removes the scoped publication mapping while keeping the canonical Jin event confirmed. |
| AC-GCAL-035 | Core promotion returns typed `AmbiguousDestination` when multiple writable routes exist and no choice is supplied. CLI/Tauri accept an exact account/calendar or explicit Jin-only choice; exact publication creates route ownership and an insert outbox operation without silent fallback. |
| AC-GCAL-043 | V2 activation removes the legacy singleton calendar id tripwire, installs the durable guard before exposure, disables the legacy token slot only after activation, and retained singleton credential deletion checks the guard. Historical-reader and current-writer fixtures both fail closed without mutation. |
| AC-GCAL-054 | Every provider GET/POST/PATCH/DELETE, including the 412 follow-up GET, acquires the per-account request lock and immediately reloads auth/route generations before issuing the request. A stale-generation regression proves zero HTTP calls. Account lifecycle mutations use the same lock. |
| AC-GCAL-042 | Public migration failpoints cover prepared, token-copied, registry-written, and activated phases; every injected interruption is retried and shown to converge idempotently with credentials, registry, mappings, guard, and disabled legacy slot intact. |
| AC-GCAL-033, 034, 036 | A fresh deterministic bridge test proves two aliased accounts and exact roles, Jin plus both Google accounts coexisting in one event list, complete sync-context DTO fields, and exact routed promotion. Fresh Playwright context renders Personal/Work account cards, owner/reader/writer roles, and quarantine controls with zero console errors. |
| Routed-create recovery | Recovery validates the canonical revision, then restores a missing exact route sidecar before finalizing the outbox journal. Regression removes the sidecar at the crash boundary and verifies restoration plus one idempotent outbox row. |

## Corrective attempt 2 changed files (exact)

1. `jin-core/src/config.rs`
2. `jin-core/src/error.rs`
3. `jin-core/src/google/migration.rs`
4. `jin-core/src/google/multi_sync.rs`
5. `jin-core/src/google/secrets.rs`
6. `jin-core/src/ops/event_mutation.rs`
7. `jin-core/src/ops/google_accounts.rs`
8. `jin-core/src/ops/promote.rs`
9. `jin-core/src/ops/sync.rs`
10. `jin-core/tests/google_multi_account_regressions.rs`
11. `jin-gui/src-tauri/src/commands/promote.rs`
12. `jin-gui/src-tauri/src/error.rs`
13. `jin-gui/src-tauri/tests/google_calendar_mutation_routing.rs`
14. `jin-gui/src/__tests__/google_multi_account_acceptance.test.ts`
15. `jin-gui/src/controllers/actions_controller.ts`
16. `jin-gui/src/invoke.ts`
17. `jin-gui/tools/tauri-fixture-init.js`
18. `jin-gui/vite.config.ts`
19. `jin/src/exit_code.rs`
20. `jin/src/main.rs`
21. `jin/tests/google_calendar_cli_routing.rs`

This list excludes this report, its envelope, and the merge report.

## Verification evidence

- `cargo test -p jin-core --test google_multi_account_regressions` — PASS, 13/13.
- `cargo test -p jin-gui --test google_calendar_mutation_routing` — PASS, 1/1.
- `cargo test -p jin --test google_calendar_cli_routing` — PASS, 1/1.
- `cargo test --workspace` — PASS twice against the final correction. The normal unsandboxed listener capability was used for the existing OAuth loopback test after the sandbox correctly rejected its socket bind.
- `cargo build --workspace` — PASS twice.
- `pnpm --dir jin-gui test` — PASS twice, 42 files / 1716 tests per pass.
- `pnpm --dir jin-gui build` — PASS twice (`tsc --noEmit` plus production Vite build).
- `pnpm --dir jin-gui lint:css` — PASS twice.
- Fresh deterministic Playwright context — PASS: account cards `Personal` and `Work`, calendar roles `owner`, `reader`, and `writer`, disabled route state, and explicit quarantine review controls rendered; console errors: 0.
- Browser artifacts: `.artifacts/playwright-mcp/google-calendar-attempt2-settings.yml`, `.artifacts/playwright-mcp/google-calendar-attempt2-settings.png`, and `.artifacts/playwright-mcp/google-calendar-attempt2-final-console.txt`.
- `git diff --check` — PASS.

## Validation boundary / remaining gaps

Live Google OAuth and Calendar API fidelity remains **unvalidated** because no
real Google account was used. Native Tauri appearance and behavior remains
**unvalidated**; Playwright evidence is explicitly the deterministic browser
fixture and is not proof of native Tauri execution.

No acceptance criterion is intentionally deferred in product code. The
live-provider and native-visual boundaries above still require owner/VIGIL
validation and must not be represented as completed live fidelity.
