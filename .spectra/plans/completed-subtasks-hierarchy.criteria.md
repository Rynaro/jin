# Completed-subtask acceptance criteria

### AC-CS-01 (event-driven)
WHEN a child is completed in an unfiltered concrete checklist List while its parent remains open
THEN Jin shall render the checked child immediately within the parent's child group and SHALL omit that child from the Completed disclosure.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-02 (event-driven)
WHEN an attached child is cancelled while its parent remains open
THEN Jin shall retain that child in its parent's child group with the existing cancelled appearance.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-03 (event-driven)
WHEN a parent is completed or cancelled
THEN Jin shall render the parent and all matching children together in the disclosure determined by the parent's status, with each task appearing once.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-04 (event-driven)
WHEN the existing lifecycle reopens a parent or child
THEN Jin shall recompute placement by the visible root's resulting status while preserving its family relationship and sibling sort order.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-05 (state-driven)
GIVEN a family is visible
THEN Jin shall derive parent progress from every matching child, including done children, with existing cancelled-child counting semantics.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-06 (state-driven)
GIVEN terminal disclosures are displayed
THEN Jin shall count top-level entries in each summary, exclude children retained under other roots from that count, and omit empty disclosures.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-07 (event-driven)
WHEN an open family belongs to a List section
THEN Jin shall keep its completed children beneath that parent in the same section.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-08 (event-driven)
WHEN a parent is excluded by an active filter or absent from the fetched set
THEN Jin shall preserve matching children as standalone filtered results without inserting excluded tasks; clearing filters SHALL restore nesting when the parent is present.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-09 (state-driven)
GIVEN an explicit status filter is active
THEN Jin shall retain the existing single filtered list and nest matching family members when both parent and child are present.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-10 (state-driven)
GIVEN a family is rendered in either the open area or a terminal disclosure
THEN Jin shall retain its existing collapse/expand control, checkbox actions and inspector access.
VERIFY: focused controller/render regression and representative browser inspection.

### AC-CS-11 (event-driven)
WHEN these rendering changes are applied
THEN Jin shall retain Board card placement, Smart/All Lists standalone results, persisted parent IDs, status lifecycle rules, and workspace open-count semantics.
VERIFY: focused controller/render regression and representative browser inspection.
