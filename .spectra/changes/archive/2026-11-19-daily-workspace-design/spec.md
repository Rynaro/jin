---
eidolon: ramza
kind: spec
version: 1
created_at: 2026-11-19
---

# Daily workspace design

Jin should feel comfortable to use throughout a day of writing, completing tasks, and planning time. The redesign brings the shell, typography, controls, and working layouts into one coherent visual system. A persistent desktop Notes library makes moving between documents easier while the editor retains its save and recovery behavior.

## Scope

The user authorizes a substantial visual and interaction redesign across the desktop app, with Notes, Tasks, and Calendar as the priority. The implementation covers shared tokens, typography, layout, navigation, controls, dialog presentation, useful motion, and adaptive route presentation. Existing connected planning flows remain daily-use acceptance paths.

Assumptions are that the application remains a local-first Tauri workspace, its current business operations remain authoritative, and aesthetic decisions can be made within the requested calm, clean, cozy direction. The native system font and the bundled Inter fallback already serve that direction. A deliberate scale and layout hierarchy will carry the new identity.

## Approach

### Shared visual foundation

Use a warm stone shell with a brighter working canvas, a quiet single edge, and one restrained outer radius at spacious desktop widths. Compact screens use the full available width. Define adaptive light and dark values in tokens.css, with clearly distinct text, separator, action, selected, current-day, and danger roles.

Use the system text family, with its bundled Inter fallback, for navigation, route headings, controls, library rows, working text, and metadata. Route titles sit around 32px, with rows and controls around 15–16px and metadata around 13px. Give authored Notes a separate literary reading voice: use an unbundled native serif fallback stack (`ui-serif`, New York, Charter, Georgia, platform serif) for the 34px document title, Markdown headings, and 18px prose in both Edit and Read. Keep code and technical values monospaced. Express the roles through rem-based semantic tokens, with readable measure, paragraph rhythm, generous leading, and text scaling.

Provide a compact desktop navigation rail around 228–236px with distinct softly tinted route icons, consistent selected state, and sufficient room for folders, lists, and calendars. Capture and Find remain visible actions. Useful route context sits near its content. Collapse uses the existing accessible drawer behavior.

Compose route headings, counts, and primary actions as one clear header with generous breathing room. Treat labels consistently, using sentence case wherever appropriate. Align controls to a common height and radius, with larger targets for coarse pointers. Keep long task lists and calendars as continuous working surfaces.

### Notes

At desktop widths of 1100px and above at the standard text scale, retain a compact live Notes library beside the selected document. At accessibility text scale, use the single-pane library-to-document presentation so writing remains usable. The library contains actual note rows with title, a useful excerpt, and compact date/folder/tag information grouped together. Opening a row changes the document through the existing controller navigation and save/conflict guards. Current selection remains visible and keyboard reachable. The Hide/Show note library control offers focused writing while preserving the same editor, selection, and undo state. Search and folder filtering remain real existing operations.

The document uses a focused reading measure, a prominent title, a calm toolbar, and quiet persistence feedback. Preserve the live CodeMirror instance when unrelated state changes and retain selection, undo, reading mode, source links, and creation-from-selection behavior. Shared toolbar actions remain discoverable through text or accessible labels. In compact layouts, use the existing library-to-document navigation and a clear return control. Opening Notes through Find or another route must reveal the requested document even when it is outside the current filtered library.

### Tasks

Create a balanced planning column with a prominent current list or smart-view title, actual open count, contextual controls, and a readable continuous list. Use roughly 48px comfortable rows that can expand for long text and metadata. Place due state and supporting information near task titles. Keep the rapid add row easy to locate and usable with the keyboard. Preserve list/board choice, grouped sections, completion, details, recurrence, reminders, and scheduling. Detail presentation should feel part of the same workspace.

### Calendar

Bring the current date range and month identity into one composed header with view choices, date navigation, Today, and the create action. Use the available screen area for the calendar grid and timeline. Day numbers and event labels follow the shared type roles, with careful cell padding, quiet weekend distinction, current-day identity, selected state, and readable calendar colors. Keep month overflow, week/day scrolling, event preview, full detail, drag/keyboard entry points, and reviewed task scheduling operable.

### Remaining surfaces and motion

Today, Find, Capture, Settings, Notifications, dialogs, and empty or recovery states inherit the new typography and control system. Apply transitions to state changes that help orientation, around 150–180ms for hover/selection and up to 220ms for panels or dialogs. Avoid animating the writing surface on each keystroke. Reduced-motion settings remove movement while keeping immediate state feedback. Native window drag regions remain operable.

## Stories

1. As a person working across the day, I can recognize the same type hierarchy, controls, spacing, and selected state in every route. The shared-system implementation owns tokens.css, typography.css, components.css, layout.css, navigation.css, sidebar.css, motion.css, and the relevant shared chrome markup. Timebox 2 days, risk P1, executor standard.
2. As a writer, I can switch between notes from a visible desktop library and keep reliable editing, saved content, recovery, and linked work. Notes and Tasks share browse.css and index.html, so one writer owns those files or coordinates sequential changes. Notes controller/render/editor changes belong with this story. Timebox 3 days, risk P1, executor standard.
3. As a planner, I can scan and complete tasks and read my calendar using a shared visual hierarchy and working interactions. Task presentation and calendar-owning renderers/controllers/styles use the agreed foundation. Coordinate shared index.html edits. Timebox 2 days, risk P1, executor standard.
4. As a keyboard or compact-screen user, I can reach the same work and see focus, feedback, and recovery at enlarged text sizes and in either appearance. A separate checker verifies real routes and the signed app. Timebox 1 day, risk P1, executor standard.

## Acceptance Criteria

### AC-DW-1 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user navigates among Today, Notes, Tasks, Calendar, Settings, and Notifications
THEN the application shall present the shared type hierarchy, adaptive surfaces, control geometry, and selected navigation state.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-2 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content at the standard text scale on a desktop viewport of at least 1100px
WHEN the user selects a note in the live library
THEN the application shall show the requested live document beside the library through the existing save and conflict guards, with a Hide/Show control that preserves the same editor and a path back to the library.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-3 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user opens a note through Find or a linked object while library filtering is active
THEN the application shall show that requested note and retain a usable path back to the library.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-4 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user edits, reads, switches, or creates a task from a selected passage
THEN the application shall preserve persistence, conflict recovery, editor selection and undo behavior according to the existing operation contracts.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-5 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user adds or completes a task, changes list or board view, or opens scheduling
THEN the application shall preserve those operations within the redesigned task workspace.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-6 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user navigates month, week, or day, opens an event, or schedules a task
THEN the application shall show the correct dates, event identity, times, and reviewed duration within the redesigned calendar.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-7 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the viewport narrows or text size increases
THEN the application shall reflow its content and expose reachable navigation and actions without page-level horizontal overflow or clipped essential controls.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-8 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the user uses dark appearance, keyboard navigation, reduced motion, or higher contrast
THEN the application shall retain readable content, visible focus, and truthful interaction feedback.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.
### AC-DW-9 (event-driven)
GIVEN the redesigned Jin workspace is running with deterministic content
WHEN the complete meeting-note-to-task-to-calendar flow is exercised
THEN the application shall save the linked work and return the user to the correct source objects through the redesigned UI.
VERIFY: Inspect actual browser/native route evidence and run the corresponding controller or production smoke regression.

## Verification

Capture before/after evidence from actual deterministic routes at 1280×800 and verify the responsive seams at 320, 390, 760, and 1440 pixels as applicable. Inspect both light and dark appearance, large text, keyboard focus, reduced motion, and relevant empty/recovery states. Verify native rendering and functional save paths in the signed Mac application using a disposable vault.

Run focused behavior regressions for the live Notes library and guarded navigation, existing editor and connected-flow production smokes, stylesheet checks, TypeScript/build, and the full required frontend suite. Review changed screenshot references before accepting them, then verify the visual detector. Run the native build/signing gate. Preserve canonical behavior while changing render structure and presentation.

## Rejected Alternatives

A palette and button-only pass scored 77/100 on the planning rubric. It would leave the small route titles, widely separated metadata, sparse planning layout, and full-route note switching that the current screenshots expose. A fully custom canvas and command-only navigation scored 63.5/100 because it would enlarge the behavioral rewrite and reduce familiar discovery. The chosen shared workspace with a live Notes library scored 88/100 and directly improves the daily actions identified in the request.

## Risks

The existing cascade has late sidebar rules that override earlier browse layouts. Update the owning rule and remove superseded declarations rather than accumulating another override layer. Notes controller state currently makes library and detail mutually exclusive, so desktop coexistence must be implemented explicitly with navigation guards and compact behavior. Both list selection and external navigation must work with filtered or missing source rows. Enlarged text must reflow the library, header, and controls rather than relying on fixed widths. User-owned dirty work exists across the repository and must be preserved.

## Confidence

The change reuses existing tokens, controllers, row renderers, editor lifecycle, and real operations. Desktop library coexistence is the principal interaction change and receives direct regression coverage. Visual acceptance relies on inspected browser/native evidence and the owner's judgment of the delivered application. The mechanical planning confidence and emission records live under .spectra/plans/daily-workspace-design.state.json.
