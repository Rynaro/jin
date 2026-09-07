# FORGE Deliberation — calendar-chronological-grid-restoration

- Verdict: `auto-expand occupied/current nighttime`
- State lifetime: `active-view-local`
- Lifecycle decision: `DECIDE`
- Decision gates: DG-01 and DG-02 resolved
- Date: 2026-08-26

## Decision

Treat 00:00–06:00 and 22:00–24:00 as independent fixed nighttime bands. On first render, expand a band whenever any visible timed Event segment intersects it or today's current-time marker lies inside it. Empty, non-current bands remain compressed. Week derives one shared state per band across all seven columns, so Day and Week use the same predicate and Week never loses y-axis alignment.

Manual collapse or expansion overrides the derived state only for the active view identity: the current Day date or Week-start window plus mode. The override survives data refetch, locale/theme/resize rerenders, icon hydration, and detail open/Back. It resets on date/week navigation, Day/Week mode change, controller disconnect, or app restart. No state enters settings, local storage, canonical files, sync, or a session-wide map.

## Why

The official HEY references establish a single readable line of time, days that fit together, visible free space, and a fixed collapsed/revealable 22:00–06:00 nighttime boundary. They do not define how occupied nighttime or reveal state persists. Jin therefore owns those policies.

Keeping occupied nighttime compressed by default is visually calm but makes the summary control carry the burden of discovering a real commitment. Auto-expansion is the safer interpretation of chronology: a visible Event receives normal geometry on first reading, and the now marker cannot disappear into an abstract band. Empty nighttime still compresses, so the design preserves calm where no information is lost.

Session-wide state was rejected because a choice made for one unusual date would silently alter unrelated dates and Weeks. Render-only state was also rejected because locale/theme changes, refetches, or detail Back could unexpectedly recollapse content during an interaction. Active-view-local state is the narrow stable lifetime.

## Safety and accessibility contract

- Auto-expansion is deterministic from semantic intersection, not DOM measurement.
- Automatic state is monotonic for the active view: new content/current time may expand a band; removal or time departure never auto-collapses it until the identity resets.
- An explicit manual collapse may keep an occupied/current band compressed, but no Event leaves chronological DOM or accessibility order.
- A collapsed occupied/current band exposes a localized visible/accessibility summary with Event count, time range, and current-time presence, accurate `aria-expanded`, minimum readable geometry, and a keyboard-operable focus-visible toggle.
- Early and late bands toggle independently. Week toggles each band across all seven columns.
- The fixed 22:00–06:00 boundary is not user-configurable in this change.

## Exact Vivi boundary

Vivi may implement the pure shared Day/Week grid, deterministic semantic geometry, two fixed nighttime bands, content/current-time derived initial expansion, active-view-local manual overrides, localized summaries, timer-safe monotonic auto-expansion, internal scroll/focus restoration, and all existing M1/M2 source/detail/edit boundaries. Vivi must not add configurable work/night hours, local-storage/settings/canonical/sync persistence, session-wide expansion memory, grid-local mutation controls, Month redesign, or code copied wholesale from the dirty primary prototype.

## Memory preflight

Crystalium recall and execution checkpoint were attempted as required, but the MCP transport was closed. The lifecycle records the existing zero-record preflight and no direct memory-store access was attempted.
