---
spec: engram/1.0
name: jin-google-desktop-signin-setup
id: egr_04bc06eb
version: 1
intent:
  does: Preserve Jin desktop Google connection setup, credential precedence, and user-owned browser handoff.
  use_when: Changing Google account onboarding, Connect UI, loopback cancellation, credential configuration, or
    publisher setup guidance.
  not_when: Changing token encryption, sync conflict resolution, or calendar event import semantics.
compatibility: {}
capabilities:
  requires: []
  produces: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - cargo
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - Google desktop sign in
  - Google account connect UI
  - Google credential setup
  negative:
  - Google token encryption
  body_digest: d1d83ce0ecfb2055437f5bcd79a6c5024b04ef8a4b30acfcc1f59394920b4081
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: d1d83ce0ecfb2055437f5bcd79a6c5024b04ef8a4b30acfcc1f59394920b4081
assets: {}
extensions: {}
---
## Procedure
1. Read `jin-core/src/google/config.rs`, the Settings account flow, and `docs/google-smoke-test.md` before changing connection setup or guidance.
2. Offer one-action Connect with an optional alias, present loopback browser handoff as user-controlled, and preserve a cancelled attempt as one retryable pending slot.
3. Import only a native Desktop or installed-app OAuth JSON. Reject web-client and service-account JSON. Preserve credential precedence. Per-field runtime environment values win and may combine with per-vault owner configuration. Publisher build-time fallback applies only when both owner fields are absent. Reject a partial owner pair rather than mixing owner and publisher values.
4. Use synthetic credential fixtures in tests. Keep imported JSON and secrets in the native process, return status only to the UI, check only required publisher secret names in release configuration, and never read or expose their values.
5. Run focused Google Settings/controller tests, relevant `cargo test -p jin-core` Google configuration coverage, and `pnpm --dir jin-gui build`. A calendar-discovery failure after token storage retains the connection for retry.

## Pitfalls
- Mixing one owner field with one publisher field can silently connect the wrong client.
- Clearing all pending state on cancellation removes the supported retry path.

## Examples
+ Cancel browser authorization and retry through the same pending slot; retain a successful connection when later calendar discovery has partial failure.
- Change encrypted token persistence or remote sync reconciliation → not this engram.

## Provenance
- Derived from Google configuration, Settings connection flow, and official publisher setup guidance.
