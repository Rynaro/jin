---
{
  "spec": "engram/1.0",
  "name": "jin-google-account-route-isolation",
  "id": "egr_0f2a9101",
  "version": 1,
  "intent": {
    "does": "Preserve Google Calendar account isolation across discovery, sync, mutation, and disconnect.",
    "use_when": "Changing multi-account Calendar routing or investigating effects crossing account boundaries.",
    "not_when": "Generic OAuth setup or unrelated calendar rendering."
  },
  "compatibility": {
    "os": [
      "linux",
      "macos"
    ]
  },
  "capabilities": {
    "requires": [],
    "produces": [
      {
        "kind": "artifact",
        "id": "artifact.jin-verification-report",
        "version": "1.0.0"
      }
    ]
  },
  "risk": {
    "filesystem": "write-project",
    "subprocess": {
      "mode": "declared-tools",
      "tools": [
        "cargo",
        "pnpm"
      ]
    },
    "network": {
      "mode": "none",
      "destinations": []
    },
    "secrets": "none"
  },
  "routing": {
    "positive": [
      "isolate Google Calendar accounts",
      "multi-account sync route",
      "account disconnect quarantine"
    ],
    "negative": [
      "generic OAuth setup"
    ],
    "body_digest": "5f28a09ee6f7180935d64f1baae6545a12e5a9c6731b9e9ac2f1471b40cc9c7a"
  },
  "origin": {
    "channel": "authored",
    "verification_status": "pending",
    "content_hashes": {
      "body_sha256": "5f28a09ee6f7180935d64f1baae6545a12e5a9c6731b9e9ac2f1471b40cc9c7a"
    }
  },
  "assets": {},
  "extensions": {}
}
---
## Procedure
1. Read `docs/testing.md` multi-account route matrix and `jin-core/tests/google_multi_account_regressions.rs` before changing account routing.
2. Trace the exact account identity through CalendarList pagination, calendar mapping, cursor keys, secret namespace, and outbox drain. Keep immutable identities distinct from human aliases; preserve alias uniqueness and resumable singleton migration.
3. Keep role downgrades and write permission checks account scoped. Exercise 410 cursor reset only on the affected route, 412 remote-wins handling, recurrence-scope rejection, and disconnect quarantine without affecting another account.
4. Use injectable provider effects and offline fixtures. Do not obtain credentials, call live Google endpoints, or infer production coverage from fixture results.
5. Run `cargo test -p jin-core --test google_multi_account_regressions` and `pnpm --dir jin-gui test -- src/__tests__/google_multi_account_acceptance.test.ts`; then run broader workspace tests when the change touches shared sync behavior.
6. Report changed route keys, the two-account adversarial scenario, exact tests run, and any untested native or live-provider behavior.

## Pitfalls
- Do not resolve ambiguity by silently choosing the first account or reusing another account's cursor.

## Examples
+ "Fix a 410 reset clearing a different Google account" → this engram
- "Generic OAuth setup or unrelated calendar rendering." → NOT this engram

## Provenance
- Authored for current Jin contracts on 2026-10-12; pending independent operator review.
