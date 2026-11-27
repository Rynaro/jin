---
spec: engram/1.0
name: jin-today-projection-date-integrity
id: egr_a44b362c
version: 1
intent:
  does: Preserve Jin Today projection date, lane, and refresh semantics across core and controller.
  use_when: Changing Today projection, selected-day behavior, agenda or focus lanes, or completion refresh.
  not_when: Changing general calendar grid interaction.
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
  - Today projection
  - selected Today date
  - Today completion refresh
  negative:
  - calendar grid interaction
  body_digest: 7be36e41d0fa07485377bffa152cb8debc13c6269d1bd23b38a2a67339c2f8dd
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 7be36e41d0fa07485377bffa152cb8debc13c6269d1bd23b38a2a67339c2f8dd
assets: {}
extensions: {}
---
## Procedure
1. Start with `today_projection_for_date_at` in `jin-core/src/ops/agenda.rs` and preserve its single read transaction across agenda, focus, and task lanes.
2. Use the selected display-zone date rather than a browser-derived current date. Keep attention, due, and flexible lanes disjoint and ordered by the core projection. Current-day attention, flexible, and focus behavior is not reused for a noncurrent day. Timed focus compares instants with an exclusive end, and promoted tasks remain represented through their event.
3. Preserve a user-selected day through refreshes, reject stale controller responses, and refresh the projection after a completion or notification mutation.
4. Run `cargo test -p jin-core --lib today_projection_tests`, `pnpm --dir jin-gui exec vitest run src/__tests__/today_controller.test.ts`, and `pnpm --dir jin-gui build`.

## Pitfalls
- Recomputing the date in the browser breaks display-zone and noncurrent-day behavior.
- A late projection response can repaint a later selection.

## Examples
+ Keep an explicitly selected tomorrow visible after completing a task in Today.
- Change month-grid drag selection → not this engram.

## Provenance
- Derived from agenda projection operations, Today controller tests, and dashboard delivery work.
