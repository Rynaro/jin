# FORGE Deliberation — calendar-event-when-recovery

- Verdict: `live range change; optional generic commit`
- Locale boundary: `Event host owns preference/copy; generic Calendar owns explicit-locale date presentation`
- Lifecycle decision: `DECIDE`
- Decision gates: DG-01 and DG-02 resolved
- Date: 2026-08-26

## DG-01 — Selection is live; commit remains opt-in

Add Event must treat `calendar:change` as the authoritative user-interaction
signal. The shared Calendar emits it synchronously after pointer/keyboard date
activation, range-mode Today, and Clear. Add Event updates its one When draft
from that detail in the same turn. Month/year navigation emits nothing because
it changes presentation, not selection.

Retain `calendar:commit` as an opt-in generic affordance, carrying the same
immutable selection detail, for future consumers that genuinely stage a date
choice. The commit control is not rendered for Add Event and Add Event does not
listen to the event. Requiring it would create two sources of truth, make the
visible summary lag behind the Calendar, and add a redundant confirmation
before Create.

Programmatic `setSelection` is silent. The host can therefore apply a natural
date result to its draft and project the result into Calendar without an event
loop. If a future consumer needs to announce a programmatic mutation, it must do
so explicitly rather than relying on a setter side effect.

The selection payload remains:

```ts
type CalendarSelection =
  | { mode: 'single'; iso: string }
  | { mode: 'range'; start: string; end: string; complete: boolean };
```

Single mode continues to emit only its established `calendar:selected`
contract. Range `complete` records the next-click phase; it is not a validation
flag. `{start: D, end: D, complete: false}` is already a valid one-day range.
An empty start/end is invalid; after a second activation `complete` is true, and
the next activation restarts a valid one-day range.

### Alternatives rejected

- **Commit-only Add Event:** rejected because Calendar highlighting, summary,
  and controller draft could disagree until an extra action.
- **Remove commit entirely:** rejected because the generic component can safely
  support explicitly staged consumers without imposing their workflow on Add
  Event.
- **Emit change from programmatic setters:** rejected because natural-input
  synchronization becomes cyclic and event origin metadata would add avoidable
  state.

## DG-02 — Locale is explicit and ownership stays one-way

The existing Event setting is the product-level locale authority for this
surface. `CalendarViewController` resolves the effective `EventLocaleKey` and
passes the same explicit value to three independent seams:

1. the pure natural date/time parser;
2. the preview/range formatter;
3. the generic Calendar controller.

The parser accepts `{input, today, locale}` and returns structured data or a
stable error code. It does not read `navigator`, local storage, Event modules,
or produce localized prose. The Event catalog maps error codes and owns every
Add Event string, including relative examples, Use, summaries, validation, and
the generic Calendar labels supplied by this host.

The generic Calendar accepts an explicit BCP-47 locale for `Intl` date labels
and supplied generic labels for Today, Clear, and optional commit. It imports no
Event module and never resolves the Event preference. Consumers that omit those
inputs retain template copy and a supported system-locale fallback captured at
connect, which preserves existing task due-date behavior.

A live Calendar & Events language change updates the host's labels and date
formatting without clearing the When draft. A cached valid parse result is
reformatted, not reparsed under the new grammar; later keystrokes use the new
locale. This prevents an English expression from invalidating merely because
the user switches the interface to Portuguese while the dialog is open.

### Alternatives rejected

- **Parser resolves locale itself:** rejected as nondeterministic and difficult
  to test across system locales.
- **Generic Calendar imports the Event catalog:** rejected because task and
  future consumers would inherit Event preference/policy.
- **Duplicate visible copy inside parser/Calendar:** rejected because it creates
  drifting translation sources and makes live locale switching inconsistent.

## Exact Vivi handoff

Vivi may implement S1–S6 with these invariants:

- Add Event listens to range `calendar:change` only; it never requires or
  renders generic commit.
- `calendar:commit` stays opt-in and carries exactly the current selection.
- `setSelection` is silent; Calendar user actions are the event boundary.
- First range selection is valid even while `complete === false`.
- Single mode keeps the exact existing `calendar:selected` behavior.
- The host resolves Event locale and owns all prose; parser returns error codes;
  generic Calendar imports no Event code and receives locale/labels explicitly.
- Locale changes preserve selection, text, times, and cached valid parse data.
- No dirty grid-local mutation, old edit modal, multi-select consumer, Capture
  expansion, Month label recovery, or Notes FTS work enters this milestone.

VIGIL should specifically test event counts/order (no setter feedback loop),
one-day validity with `complete: false`, absence of a commit control in Add
Event, single-mode event parity, deterministic parser output under differing
system locales, and live en/pt-BR switching without draft loss.
