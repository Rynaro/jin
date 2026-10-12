---
{
  "spec": "engram/1.0",
  "name": "jin-calendar-projection-interaction",
  "id": "egr_0f2a9102",
  "version": 1,
  "intent": {
    "does": "Keep calendar projection, temporal semantics, and interaction behavior consistent across Jin core and GUI.",
    "use_when": "Changing calendar rendering, projection deltas, selection, dragging, or event interaction.",
    "not_when": "Account enrollment or first-run storage selection."
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
      "calendar projection delta",
      "calendar interaction rendering",
      "event drag selection"
    ],
    "negative": [
      "account enrollment"
    ],
    "body_digest": "bf4b8dba6a9f1f8070f6ead6617ce50ab32fc51ca8a56178fe0399b79494dc5a"
  },
  "origin": {
    "channel": "authored",
    "verification_status": "pending",
    "content_hashes": {
      "body_sha256": "bf4b8dba6a9f1f8070f6ead6617ce50ab32fc51ca8a56178fe0399b79494dc5a"
    }
  },
  "assets": {},
  "extensions": {}
}
---
## Procedure
1. Read `jin-core/tests/s2_calendar_projection_and_delta.rs` and the relevant pure modules under `jin-gui/src/lib/calendar/`.
2. Identify whether the change belongs in projection/transform, interaction state, or rendering. Keep controllers thin; preserve the existing typed projection boundary rather than embedding domain rules into DOM handlers.
3. Preserve all-day versus timed values, timezone identity, recurring occurrence identity, and exact delta application. Reuse existing temporal helpers and explicit DST policy.
4. Exercise selection, drag/resize cancellation, visibility, and overflow behavior where affected. Keep transform tests independent of browser side effects.
5. Run `cargo test -p jin-core --test s2_calendar_projection_and_delta`; select existing calendar GUI tests relevant to the changed module; run `pnpm --dir jin-gui build` for TypeScript and production bundle checks. For stylesheet changes run `pnpm --dir jin-gui lint:css`.
6. Report the projection invariants verified, the interaction cases exercised, and the limits of browser fixtures versus native rendering.

## Pitfalls
- Do not collapse all-day dates into UTC instants or treat a screenshot as proof of core projection correctness.

## Examples
+ "Change month overflow without breaking selected occurrence identity" → this engram
- "Account enrollment or first-run storage selection." → NOT this engram

## Provenance
- Authored for current Jin contracts on 2026-10-12; pending independent operator review.
