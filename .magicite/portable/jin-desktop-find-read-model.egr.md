---
spec: engram/1.0
name: jin-desktop-find-read-model
id: egr_59aef8aa
version: 1
intent:
  does: Keep cross-workspace Find reads, ranking, and navigation race-safe.
  use_when: Changing Find sources, ranking, full-text note search, filters, or result navigation.
  not_when: Changing a detail route with no global search entry.
compatibility: {}
capabilities:
  requires: []
  produces: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - pnpm
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - workspace Find
  - global record search
  - Find result ranking
  negative:
  - detail route without search
  body_digest: c3ea50e02a04119473287a26f411b4df936167fabb54659e16d83b24d52cadfc
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: c3ea50e02a04119473287a26f411b4df936167fabb54659e16d83b24d52cadfc
assets: {}
extensions: {}
---
## Procedure
1. Read `jin-gui/src/controllers/find_controller.ts`, `lib/find/transform.ts`, and `__tests__/find.test.ts` before adding a source or rank rule.
2. Collect one bounded list snapshot per source when Find opens, debounce full-note search, and retain usable source results when another source fails.
3. Associate asynchronous results with the active open and query generation. Ignore stale responses after close, replacement, or a later query.
4. Keep ranking pure and deterministic. Preserve stable entity identity and use timezone-aware values for recency ordering.
5. Navigate through the existing guarded detail route and run `pnpm --dir jin-gui exec vitest run src/__tests__/find.test.ts` plus `pnpm --dir jin-gui build`.

## Pitfalls
- A late full-text result can overwrite a newer query.
- Treating one provider failure as a total failure hides useful results.

## Examples
+ Add a result source while retaining partial results and keyboard navigation.
- Change a note editor save queue → not this engram.

## Provenance
- Derived from Find controller, pure transform, and focused GUI regression coverage.
