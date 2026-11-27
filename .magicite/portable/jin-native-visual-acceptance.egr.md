---
spec: engram/1.0
name: jin-native-visual-acceptance
id: egr_e26742e4
version: 1
intent:
  does: Gather proportionate GUI visual evidence and distinguish browser checks from native owner acceptance.
  use_when: Reviewing Jin layout, responsive behavior, appearance accessibility, or native desktop presentation.
  not_when: Changing backend-only behavior or treating a headless fixture as native proof.
compatibility:
  os:
  - linux
  - macos
  - windows
capabilities:
  requires: []
  produces:
  - kind: artifact
    id: artifact.jin-visual-evidence
    version: 1.0.0
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - npm
    - pnpm
  network:
    mode: required
    destinations:
    - http://127.0.0.1:1420
  secrets: none
routing:
  positive:
  - Jin visual QA
  - native desktop acceptance
  - responsive GUI review
  negative:
  - backend-only change
  body_digest: aa1f82b52e92dd57f58966b31a31dbb61405f63ffcc24a9d260da11a74d9b2ef
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: aa1f82b52e92dd57f58966b31a31dbb61405f63ffcc24a9d260da11a74d9b2ef
assets: {}
extensions: {}
---
## Procedure
1. Read `docs/gui-testing.md` and the visual-language dossier, then use the tracked `.agents/skills/jin-playwright-mcp/SKILL.md` or the existing Playwright engram to start the deterministic local harness.
2. Capture an accessibility snapshot, console findings, and screenshot evidence for each tested state. Check clipping, focus, readable text, relevant empty or error states, and reduced motion.
3. Use 1280×800 as the reproducible baseline. Add responsive seams or enlarged-text viewports that the changed layout crosses and record every size.
4. For release-significant window, persistence, or platform behavior, check the packaged native QA build with seeded persisted state and compact-window keyboard reachability.
5. Run `npm --prefix jin-gui run visual:selftest` for the deterministic reference checks and `npm --prefix jin-gui run visual:compare` for matching-environment comparisons. Keep the build fingerprint current. Retain both reference and actual images on a difference. After an intentional reviewed design change, record only the selected scenario and reason. Report browser evidence separately from untested native rendering and retain `CI STATUS: LOGIC VERIFIED — VISUALS NOT VERIFIED` until owner sign-off.

## Pitfalls
- Headless browser evidence cannot approve WebKit or Tauri appearance, motion feel, or tap ergonomics.
- Screenshots without state, viewport, and console evidence are not reproducible acceptance evidence.

## Examples
+ Verify a responsive sidebar with browser artifacts and owner-native follow-up.
- Prove a core storage migration → not this engram.

## Provenance
- Derived from `docs/gui-testing.md`, the maintained visual-QA skill, and native onboarding QA work.
