# FORGE Deliberation — calendar-event-edit-when-surface

- Verdict: `Calendar resizes; relative input relocates`
- Conversion: `all-day + explicit time becomes one-hour timed`
- Temporal boundary: `exact draft baseline; existing wall-time/TZID bridge`
- Lifecycle decision: `DECIDE`
- Decision gates: DG-01 and DG-02 resolved
- Date: 2026-08-26

## DG-01 — Preserve two different editing intentions

Direct Calendar range selection is an explicit resize. It replaces both visible
endpoint dates exactly and retains the current clock values. The first click is
a one-day date range, the second extends it, and the third restarts it under the
already-shipped live range contract. The editor must not infer duration from the
old interval or silently add a day. Consequently, choosing one day while an
overnight clock pair such as 23:30–01:15 is retained creates a temporarily
invalid timed draft; Save remains blocked until the person changes a time or
selects a later end date.

Relative input is a relocation shortcut:

- Date-only input computes the signed wall-date delta from old draft start to
  new start and applies the same delta to the end. All-day/timed type, endpoint
  spacing, and clock values remain unchanged.
- Date-and-time input on a timed draft computes the draft's naive wall-clock
  duration in whole minutes, places the new start at the parsed date/time, and
  derives the end with ISO wall-date arithmetic. This preserves overnight and
  multi-day wall duration without introducing DST elapsed-time policy.
- Date-and-time input on an all-day draft intentionally becomes a one-hour timed
  interval beginning at the supplied time. The previous all-day day span is not
  meaningful once a precise instant is requested. The one-hour default matches
  Add Event and rolls into the next date if necessary.
- Invalid input mutates no valid draft field.

This asymmetry is desirable: Calendar exposes duration by showing endpoints;
relative text offers fast rescheduling while retaining the existing meeting
shape. Making both inputs resize would make “tomorrow” unexpectedly collapse a
multi-day Event. Making both relocate would prevent a Calendar range from doing
what its highlighted endpoints visibly promise.

## DG-02 — Exact passthrough belongs in the GUI draft, not a new core API

The current bridge accepts all-day dates or naive local datetimes plus one
optional TZID and derives both endpoint TZIDs/floating state from that value.
The eligible Jin-created Event paths already use the bridge-representable
invariant of equal endpoint TZIDs. This milestone adds no offset parser, second
TZID field, timezone selector, capability rule, or core mutation contract.

The editor must retain two layers of temporal state:

1. the visible projection (`start_date`, `end_date`, `is_all_day`,
   `start_time`, `end_time`); and
2. an exact baseline (`start`, `end`, all-day type, TZID/floating semantics)
   from the canonical detail that produced that draft.

Composition first compares the current projection to its retained baseline
projection. If equal, it sends the retained `start` and `end` strings unchanged,
including seconds, and keeps the existing TZID path. This covers untouched,
title-only, locale-only, same-date Calendar activation, relative-to-the-same-
start, and change-then-revert flows. An action-history boolean alone is
insufficient because it would normalize a reverted draft.

If the projection is genuinely changed, composition uses the existing M2
contract: all-day inclusive end becomes the next exclusive date; timed values
become naive `YYYY-MM-DDTHH:mm:00`; timed TZID is retained and all-day TZID is
omitted. Validation happens before `editEvent`. Exact preservation is promised
within this existing accepted wall-time grammar, not for new offset-suffixed
input the bridge does not parse.

## Dirty, conflict, and rebase semantics

- Dirty/no-op comparison is value-based, not action-history-based. It includes
  both endpoint dates/type/times and all other editable fields.
- For temporal comparison, use the composed exact interval. Two projections
  that look identical to the minute are still different when their retained
  canonical seconds differ.
- On stale conflict, latest canonical detail becomes the fresh command token and
  comparison target, but it does not overwrite the user's draft or its exact
  baseline.
- **Review my draft** dismisses the conflict while preserving all draft fields,
  relative text/preview, Calendar selection/focus context, and the draft's exact
  baseline. A later Save with the fresh token is the only write.
- **Use latest** replaces the entire draft, including visible projection,
  relative input state, exact baseline, and token, with latest canonical data.
- Neither conflict choice calls `editEvent`.
- Pending, localized, validation, and transient-error rerenders never rebuild
  the draft from canonical detail.

This is a rebase of command authority only, not an automatic merge. If latest
changed the interval and Review preserves the older untouched interval, the
next explicit Save deliberately writes that preserved exact interval using the
fresh token. Conflict copy reports Date when either resulting endpoint/type/TZID
differs.

## Exact Vivi handoff

Vivi may implement S1–S5 with these invariants:

- introduce one reusable edit When draft that carries visible values and an
  exact temporal baseline;
- Calendar `calendar:change` replaces endpoint dates and never auto-corrects an
  invalid retained clock pair;
- date-only relative input shifts both dates; timed relative input preserves
  naive wall minutes; all-day plus explicit time becomes one hour;
- exact-baseline equality selects verbatim start/end passthrough; changed values
  alone use minute-resolution serialization;
- no core/bridge/schema/capability/TZID API change;
- Review keeps the complete draft and baseline with the fresh token; Use latest
  replaces both; neither writes;
- dirty comparison uses composed exact temporal values against latest;
- Add Event, task single Calendar, grid chronology, M1/M2 authority, Time block
  linkage, pending, keyboard, focus, and canonical refetch remain unchanged.

VIGIL should add fixtures for canonical seconds, semantic change-then-revert,
same-minute/different-seconds conflict, overnight one-day resize invalidity,
multi-day relocation, 23:30 all-day-to-timed rollover, matching/floating TZID
preservation, and fresh-token Review/Use-latest behavior.
