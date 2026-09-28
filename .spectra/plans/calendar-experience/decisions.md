# Decision log and alternatives

## D1 — One stable Event Companion, not anchored popovers

**Decision:** Calendar observes the content box of its route workspace, not the window. At normal text scale with at least 920 CSS px of available workspace content, it uses a 360px non-modal right companion rail separated by a 1px rule; the grid retains at least 559px. Below 920px, or whenever accessibility text scale is active, the same content is presented by `JinModal` as a modal sheet. The outer workspace measurement does not change when the rail opens, so the host cannot oscillate. Sidebar expand/collapse and window resize may cross the seam once and must preserve companion state, draft, focus target, range, and scroll. There are no event-anchored popovers.

Why: a companion has stable geometry for long titles, guests, recurrence, conflict, and sync recovery; it preserves schedule context without collision logic. The compact modal is the same host state and renderer, not a separate editor. Wide companion focus is not trapped and its background remains operable. Modal focus is trapped and the background is inert.

Rejected: an anchored event popover scores well for spatial association but collides with viewport edges, dense overlaps, large text, and long provider state. A full-page editor breaks context. Modal-first everywhere hides the grid even where space exists.

## D2 — Preview → edit/create in the same host

**Decision:** Event selection opens Preview. Edit changes the companion mode in place. Empty-slot selection opens Create directly because there is no saved object to preview. Save returns to Preview in the same host. “Open full details” is an optional focus view and never the ordinary edit path.

The Back control inside edit means “return to preview” for existing events and “review/discard draft” for new events. Companion mode changes do not write browser history. Sidebar/direct app navigation while dirty enters the same inline discard decision; it never silently loses a draft or opens a nested confirmation modal.

## D3 — Explicit calendar interaction rules

**Decision:** Day/Week use a 15-minute temporal cursor and 15-minute snapping. A click/tap on empty time creates a 60-minute draft. Pointer drag selects a custom duration with a 15-minute minimum. Month day-number activation opens Day; clicking unused cell space creates an all-day one-day draft; dragging unused cell space across dates creates an inclusive all-day range. Each Month cell exposes an “Add on {date}” button on focus-within and always for coarse pointers, so drag/double-click is never required.

Event click/tap opens Preview. Move/resize handles appear only after current detail capabilities say schedule edit is allowed. Drag/resize changes an in-memory draft and opens Edit; Save is always required. Pointer-down never mutates data.

## D4 — Direct manipulation semantics

**Decision:** Moving a timed event chooses a new start instant from the viewing-timezone grid and preserves elapsed duration. Resizing changes the end instant only, with a 15-minute minimum. Crossing midnight is allowed and the companion always shows both dates when they differ. All-day drag works in inclusive user dates; canonical serialization retains the existing exclusive end date.

The single-pointer alternative is Edit → When with date/time inputs. Keyboard equivalents while an editable event is selected are `Alt+Arrow` to move by one snap/day and `Alt+Shift+Up/Down` to resize the end by one snap. These modify the same draft and still require Save. The help surface lists shortcuts; shortcuts do nothing while a text field or menu owns focus.

## D5 — Capability before affordance

**Decision:** Selecting an event starts a sequenced detail request. Move/resize handles and mutation actions do not appear before that current request resolves. Navigating range, selecting another event, or closing the companion invalidates stale responses. A cached detail may render preview immediately, but any mutation uses its edit token and existing stale-event recovery.

Read-only invitations remain selectable and actionable for Preview, RSVP, Join, copy, and full details. They do not enter a fake move or proposal mode. Native proposed-time remains deferred.

## D6 — One shared draft, progressive sections

**Decision:** Create and Edit share `EventDraft` and one composer renderer. Calendar identity plus start/end/all-day/timezone summary remain visible at all times. Optional sections—Guests & updates, Google Meet, Repeat, Location & notes—show concise collapsed summaries and preserve values while folded. Capture may start with a compact preset, and Today may show only preview actions, but both hand into the same draft/serializer when expanded.

No surface maintains an independent payload builder for supported fields.

## D7 — Recurrence scope belongs in the composer

**Decision:** A recurring event shows `Apply to` in the companion. The values are exactly `capabilities.recurrence_scopes`; if more than one is available, no value is preselected and Save remains disabled until the user chooses. Pattern controls appear only when `entire_series` is selected and `recurrence_pattern_supported` is true. Occurrence edits keep the master rule untouched. `this_and_following` is absent and remains core-rejected.

The same reusable scope choice is used for RSVP/cancel/Meet flows that need scope. Notifications do not own a second static scope dialog.

## D8 — Timezone and DST are visible, deterministic truth

**Decision:** The grid renders in Jin's configured display timezone. New timed drafts inherit that IANA zone. Existing drafts show their event timezone. Changing timezone keeps the entered local clock values and visibly previews the corresponding viewing-zone time before Save.

Jin preserves core's established DST policy: ambiguous fall-back wall time resolves to the earlier chronological instant; an ordinary one-hour spring-forward gap shifts forward one hour; a non-standard or still-unresolved gap returns an error. A read-only temporal preview contract returns `exact`, `ambiguous_earlier`, or `nonexistent_shifted_forward` for start/end, or typed `unresolvable_local_time`. The companion presents the chosen/adjusted instant before commit; invalid IANA zones and unresolvable gaps block Save.

Jin's current canonical wall-time plus timezone model cannot distinguish the later physical occurrence of a repeated fall-back wall time. The grid exposes one ambiguous slot labelled as the first occurrence and does not offer a later repeated slot for creation or direct movement. Supporting both repeated instants is a separate temporal-model migration.

## D9 — Save and external-state language

**Decision:** Before submit, Cancel discards only after an inline dirty-draft decision. While the durable mutation call is unresolved, fields and Save are disabled; Escape/backdrop cannot imply cancellation. After durable local success, the grid updates and the companion returns to Preview:

- local: `Saved in Jin`;
- routed pending: `Saved in Jin · syncing to {calendar}`;
- provider confirmed: `Google accepted the event update`;
- paused/auth/conflict: stable explanation plus the existing review/reconnect/retry path.

Jin never says invite email “delivered.” A provider-confirmed event operation may say Google accepted it. Closing after durable save never cancels its outbox work. Reconnect never auto-resubmits paused work; review remains explicit.

## D10 — Display filter is not sync enablement

**Decision:** The Calendar route gets a local visibility filter keyed by exact calendar identity, including Jin. It hides or shows already-loaded events and persists as GUI preference. It never changes Settings `enabled`, provider discovery, sync, outbox, or calendar permissions. The filter shows each calendar name, account alias where needed, color, and visible state. “All calendars hidden” is a truthful empty field with a Reset filter action.

## D11 — Today stays Today

**Decision:** Today keeps `TodayProjectionDto`, disjoint schedule/task lanes, and its continuous agenda. It consumes the shared event preview and can expand to the shared composer in its existing modal host. Calendar does not absorb Today or place due tasks on the time grid. Day preserves its existing due-task appendage after the time-grid scroller, its scroll behavior, and Promote to event; copy clarifies that the items are unscheduled.

## D12 — Navigation and draft history

**Decision:** Preview/Create/Edit transitions are component state and do not write browser history or hashes. Only `Open full details` invokes the existing router. Companion Back exits Edit to Preview or requests dirty-draft disposition; it does not call browser history. Add one cancelable app-route guard at `RouterController` so sidebar/direct navigation can be paused by a dirty companion and retried after Discard. No `popstate` contract is introduced.

## D13 — Selected architecture

RAMZA's internal planning rubric scored alternatives for alignment, correctness, maintainability, performance, simplicity, risk, and innovation:

| Candidate | Score | Result | Decision |
|---|---:|---|---|
| Reskin existing create/detail/edit surfaces | 64 | weak | Rejected: cosmetic consistency leaves workflow and ownership fragmentation. |
| Calendar workspace + stable companion + shared presenter | 88.5 | elite | Selected. |
| Modal-first shared editor everywhere | 72.5 | solid | Rejected: shared content helps, but every action still erases spatial context. |
| Route-first full-page detail/edit | 65.5 | weak | Rejected: clear deep view, poor ordinary calendar flow. |

Pattern assessment: **adapt**. Jin already has time geometry, event capabilities, durable mutations, shared invitation controls, the modal primitive, and the preview-first Today pattern. The work consolidates and connects those foundations; it does not replace the calendar engine.
