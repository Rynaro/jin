### AC-01 (state-driven)
GIVEN a short task title with priority and due metadata in a roomy list at normal text scale
THEN the item shall fit on one visual line with a minimum 32px fine-pointer row.
VERIFY: screenshot and geometry for plain, parent and child rows at 1440px.
### AC-02 (state-driven)
GIVEN a long task title or narrow content region
THEN the item shall preserve the complete readable title by growing naturally and reflowing metadata.
VERIFY: long prose and unbroken strings at 760, 390, 320 and accessibility scale 3.1; no page overflow.
### AC-03 (state-driven)
GIVEN task completion controls across list, board and inspector
THEN each control shall show the shared proportional mark with a visible tick and a target of at least 28px for fine pointer or 44px for coarse pointer.
VERIFY: aligned first baselines, checked/unchecked/focus/forced-colors states, no Notes style leakage.
### AC-04 (state-driven)
GIVEN task priority values none, low, medium and high
THEN their presentation shall consistently use no ornament, one exclamation mark, two exclamation marks and three exclamation marks with full accessible names.
VERIFY: row, card and inspector mapping is usable without color; stored values remain identical.
### AC-05 (state-driven)
GIVEN a date-only or timed task deadline
THEN the compact due presentation shall preserve its existing calendar date, time and overdue semantics.
VERIFY: Today, Tomorrow, weekday, short date, cross-year, DST and local-day boundaries with full accessible date.
### AC-06 (event-driven)
WHEN a user activates an editable row due chip
THEN the existing shared date picker shall open without navigating away or losing the item context.
VERIFY: future and overdue chips, keyboard activation, quick-reschedule availability, Cancel/focus restoration and viewport clamping.
### AC-07 (state-driven)
GIVEN an inspector with long values at wide, narrow or enlarged-text widths
THEN its grouped fields shall remain visible and reachable in the existing body scroll region.
VERIFY: title, notes, timing, organization, subtasks and existing linked actions with no horizontal document overflow.
### AC-08 (event-driven)
WHEN the inspector changes task ownership during a pending or failed save
THEN its existing draft protection shall retain the correct task's unsaved content.
VERIFY: existing save/navigation regressions and editable notes selection remain valid.
### AC-09 (event-driven)
WHEN a pointer or native drag actually activates
THEN the shared movement guard shall clear collateral text selection and suppress further selection until that gesture ends.
VERIFY: list task grip, whole Board card, section, list navigation and note row movement plus discovered resize owners.
### AC-10 (event-driven)
WHEN an active movement ends through drop, cancellation, Escape, lost capture, window blur, dragend or teardown
THEN the guard shall restore the previous selection state and release its listeners.
VERIFY: every terminal path, rejected movement and repeated gestures; ordinary text selection works afterward.
### AC-11 (unwanted-behavior)
WHEN a click or text-editing gesture does not activate a valid movement
THEN normal click, intentional text selection and editing behavior shall remain available.
VERIFY: below-threshold card click, row text selection, title/notes inputs and contenteditable; no drop commit.
### AC-12 (event-driven)
WHEN a task is moved by pointer or keyboard
THEN its existing exact destination and legal workflow transition shall remain unchanged by selection suppression.
VERIFY: same-column reorder, neutral Board column, canceled drag, excluded controls, reduced-motion behavior and parent/child restrictions.
