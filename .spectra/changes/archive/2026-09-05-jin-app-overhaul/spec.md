---
eidolon: ramza
kind: spec
version: 1.0
created_at: 2026-09-05
---

# Jin Whole-App Visual Overhaul

## Objective

Complete Jin's visual renewal across every remaining user-facing surface, beginning with Events and continuing autonomously through Notifications, Settings, capture, search, dialogs, transient states, and a final consistency pass over the already renewed Today, Tasks, and Notes experiences. The finished application should feel like one calm daily workspace rather than a collection of gray panels accumulated over time.

The Jin mark remains the governing image: warm paper is the field, black ink carries information, indigo marks focus, selection, and links, and vermilion marks capture or consequential intent. Hierarchy comes from type, spacing, fine rules, and quiet tonal changes. Full rounded containers, stacked gray cards, heavy segmented strips, and ornamental shadows must not become the default organizing device. Rounded geometry is appropriate for small controls, badges, popovers, and dialogs where the shape communicates affordance.

This is a visual and interaction-quality change over existing behavior. It does not add product features or alter persisted data.

## Approach

Use the accepted Today, Tasks, Notes, and Notes editor work as the visual baseline, then renew remaining surfaces in dependency order: Events first; Notifications; Settings; shared dialogs, Capture, utility controls, and system states; finally a regression-only coherence pass. One maker owns the sequential implementation so tokens and shared primitives can settle before later phases consume them. Each phase is independently testable, but execution continues without an approval pause between phases. Events' existing Calendar remains its sole browse surface; the intentionally hidden legacy events list must not be revived.

## Experience principles

1. **One material language.** Every primary workspace uses adaptive warm paper and readable ink roles. Chrome is quieter than content. Dark mode uses deep warm ink/paper equivalents rather than neutral gray inversion.
2. **Editorial hierarchy.** Each route has a clear identity, expressive display title or date, concise supporting copy where already present, and readable body type. Dense operational metadata recedes without becoming illegible.
3. **Open composition.** Prefer whitespace, alignment, and thin rules. Avoid adding cards around lists, calendars, settings groups, empty states, or content merely to separate them.
4. **Purposeful color.** Indigo means current, focused, linked, or selected. Vermilion identifies Capture/Add Event and destructive confirmation where appropriate. Success, warning, and error colors remain semantic and include text or icon cues.
5. **Cozy efficiency.** Frequently used controls stay obvious and keyboard reachable. Secondary controls become quieter, not hidden. Loading, empty, disabled, offline, pending, conflict, and error states explain what is happening without visual alarm fatigue.
6. **Adaptive by construction.** Light, dark, automatic appearance, increased contrast, reduced transparency, reduced motion, forced colors, and dynamic type use the same semantic hierarchy.

## Implementation contract

### Phase 1 — Events first

1. **Give Events a recognizable workspace identity.** In `jin-gui/src/lib/calendar/render.ts`, `jin-gui/src/lib/calendar/time_grid_render.ts`, and `jin-gui/src/styles/calendar.css`, shape the existing Month/Week/Day calendar into a warm paper planning surface. Add only presentation hooks needed for a small editorial eyebrow/title/date hierarchy. Preserve the existing view modes, date navigation, Today action, locale, event counts, date selection, event activation, current-time marker, time-grid calculations, and controller targets/actions.

2. **Replace the heavy calendar strip with a composed header.** The current monolithic gray segmented toolbar becomes an open header with an expressive current month/day label, compact previous/next/Today controls, and slim view tabs. Current view and selected date use indigo plus text or shape, never color alone. The global `+ Add Event` action remains prominent and uses the capture/vermilion intent role; it must not obscure calendar content at narrow widths or AX5.

3. **Make the calendar grid crisp and legible.** Month cells share one paper field separated by fine rules rather than individual gray cards. Weekday labels are quiet but readable; dates are strong enough to scan; today and selected day are distinct; out-of-month days recede while remaining legible. Event entries keep source/calendar colors and titles, but use restrained fills and clear focus/selected states. Dense days retain the real overflow/count behavior and keyboard reachability. Week and Day time grids preserve hour geometry, collision layout, all-day lanes, scroll behavior, drag/click semantics, and current-time meaning.

4. **Refine event detail into an editorial record.** In `jin-gui/src/lib/events/render.ts`, `jin-gui/src/lib/events/edit.ts`, and the Events rules in `jin-gui/src/styles/browse.css`, present title, source, date/time, recurrence, location, attendees, conference links, reminders, originating task, prep notes, and backlinks as a continuous detail page. Use an expressive title, a clear temporal block, quiet metadata/endnotes, and grouped real actions. Keep source/read-only/time-block truth, edit/delete capability gates, recurrence scope, external links, attachment/link callbacks, conflict resolution, and return-to-calendar behavior unchanged. Do not wrap the event document in a large rounded card.

5. **Make event creation and editing calm under complexity.** Refine `#jin-event-dialog`, `.event-edit`, natural-language date preview, range calendar, all-day and recurrence controls through `jin-gui/src/styles/forms.css`, `calendar.css`, and `browse.css`. `CalendarViewController` remains the creation owner, including routed creation and refresh; `EventsController` remains the detail/edit/delete owner. Their source stays outside visual mutation unless an essential presentation hook is first added to scope. Preserve every field, label, validation, recurrence option, locale string, destination, submit/cancel/delete flow, offline or provider state, and payload. Use sectional headings and fine rules to guide long forms; reveal custom recurrence with clear nesting; keep error and conflict feedback adjacent to the relevant work. The modal remains a real accessible dialog with focus management and a visible close action.

### Phase 2 — Notifications

6. **Turn Notifications into a calm triage desk.** In `jin-gui/src/styles/notifications.css` and only necessary presentation hooks in `jin-gui/src/lib/notifications/render.ts`, align the existing route header, filters, list, and detail with the Jin material language. Filters become a light, wrappable control row rather than a heavy segmented container. Notification rows use typography, spacing, a fine separator, and an indigo selected edge/wash; unread, selected, failed, pending, superseded, historical, and disabled meanings retain explicit text or icon cues.

7. **Keep response truth visible.** Invitation response, task reminder, retry, defer, dismiss, mark-read, recurrence-scope, provider truth, partial source error, and busy states must remain unchanged and reachable. Detail content reads as a continuous page, with a strong title, quiet kind/time/source metadata, and clearly grouped primary/secondary/consequential actions. Errors and queued/provider-pending states use text plus a non-color cue and remain live-region compatible.

### Phase 3 — Settings

8. **Replace the settings card stack with a settings document.** In `jin-gui/src/styles/settings.css` and only necessary hooks in `jin-gui/index.html` or `jin-gui/src/lib/settings/render.ts`, preserve the context navigation and four existing panes while removing the large rounded outer frame and repetitive boxed gray sections. Use a clear pane title/description, section headings, breathing room, and fine dividers. Related controls remain grouped semantically even when their visual container becomes open.

9. **Clarify operational and risky states.** Connected/disconnected/reauthentication, calendar account, quarantine, sync, export, appearance, notification permission, diagnostics, and data/storage states retain all real values and actions. Status badges may remain compact rounded objects; error, warning, queued, collision, conflict-resolved, and loading states must include text and maintain current live-region behavior. Long account names, paths, URLs, audit links, and GCP instructions wrap without hiding meaning. Appearance controls must visibly preview and immediately honor current preferences.

### Phase 4 — Shared moments

10. **Unify shared dialogs and forms.** In `jin-gui/src/styles/forms.css`, `jin-gui/src/styles/components.css`, and `jin-gui/src/styles/a11y.css`, establish one Jin dialog grammar for `JinModal`, confirmation dialogs, list/folder/collection/history dialogs, event dialogs, notification scope, color picker, and action dialogs. Use a warm elevated sheet, decisive title, readable body, stable footer, and restrained radius/shadow. Preserve native dialog semantics, backdrop/cancel behavior, focus return/trap, Escape, initial focus, disabled and pending behavior, all data actions/targets, and destructive confirmation meaning.

11. **Finish Capture and utility interactions.** Keep the renewed Capture identity and vermilion submit action while aligning its tabs, fields, calendar/due-date controls, validation, and responsive sheet with the shared form grammar. Notes search, task filters, select controls, tag inputs, color picker, global errors, tooltips, badges, and inline buttons use the same focus, density, field, and status language. Search remains a labelled native search control and result counts stay announced as they are today.

12. **Make system states feel intentional.** Standardize loading, empty, not-found, offline, disabled, conflict, and error presentation through shared tokens and primitives. Empty states use the existing Jin ink illustration where available, plain language, and an existing action only when one already exists. Loading does not fabricate progress. Errors remain specific, recoverable where current behavior provides a retry, and visible without relying on color.

### Phase 5 — Whole-app closure

13. **Review renewed routes as one system.** Revisit shell/navigation plus Today, Tasks, and Notes only to correct shared-token drift, inconsistent control treatment, responsive collisions, or regressions introduced by the remaining-surface work. Preserve their accepted layouts and product behavior; do not redesign those routes again or introduce additional feature scope.

14. **Consolidate style authority.** Add adaptive semantic roles to `jin-gui/src/styles/tokens.css` where existing roles cannot express calendar paper/rules, operational washes, dialog elevation, or shared state. Keep component code token-only. Place each rule in its owning stylesheet, remove superseded declarations encountered in the touched seams, and avoid a final override layer that merely fights earlier CSS. Update `jin-gui/src/styles/index.css` only when import order must be corrected deliberately.

## Acceptance Criteria

- **AC1 — Events identity:** WHEN the Events route opens in Month, Week, or Day view THEN it SHALL present a recognizable editorial Events header and warm calendar field; the current date/view, Today action, date navigation, and Add Event action SHALL be immediately distinguishable without a heavy gray segmented strip.
- **AC2 — Calendar fidelity:** WHEN users navigate dates, switch Month/Week/Day, select a day, open an event, view dense or overlapping events, or encounter all-day/current-time content THEN every existing interaction, time-grid calculation, source color, accessible name, and navigation callback SHALL remain operative and events SHALL remain legible without clipping or overlap that hides meaning.
- **AC3 — Event detail and edit:** WHEN a local, Google, recurring, read-only, or task-derived event opens THEN its real capabilities, source, date/time, recurrence, location, attendees, conference, reminders, links, backlinks, and actions SHALL remain truthful and reachable in a continuous unboxed detail page. WHEN create/edit/conflict flows run THEN current fields, validation, scope, payload, focus, and error behavior SHALL remain unchanged.
- **AC4 — Notification triage:** WHEN Notifications loads active or historical invitations/reminders THEN filters, list selection, unread state, detail, response actions, retry/defer/dismiss/read actions, provider truth, partial failures, recurrence scope, disabled reasons, and live announcements SHALL remain available in a calm open split view with non-color state cues.
- **AC5 — Settings clarity:** WHEN any General, Calendars & Sync, Notifications, or Data & Storage pane opens THEN its controls, account/config values, appearance preferences, loading/results/errors, GCP guidance, quarantine, sync, export, and diagnostics SHALL remain intact and readable as an open settings document rather than a stack of undifferentiated gray cards.
- **AC6 — Shared dialogs and forms:** WHEN any existing modal, confirmation, Capture flow, select, tag input, date control, color picker, search, filter, or destructive action is used THEN it SHALL follow the shared Jin form language while preserving its labels, keyboard/focus lifecycle, validation, pending/disabled state, submit/cancel/Escape behavior, callbacks, and payloads.
- **AC7 — State language:** WHEN any route is loading, empty, not found, offline, conflicted, disabled, queued, successful, warning, or failed THEN the state SHALL be visually intentional, described in text, perceivable without color alone, and announced through the existing appropriate live-region semantics; no state SHALL claim progress or success that has not occurred.
- **AC8 — Whole-app coherence:** WHEN navigating among Notifications, Today, Notes, Tasks, Events, and Settings THEN paper, ink, display/body typography, indigo selection/focus, vermilion intent, rules, fields, buttons, badges, dialogs, and density SHALL read as one coherent Jin system, while Today, Tasks, and Notes retain their previously accepted information architecture.
- **AC9 — Responsive and dynamic type:** WHEN every route and shared dialog is exercised at 320, 390, 760, and 1440 CSS px and at the repository AX5/310% text setting THEN primary content, navigation, calendars, controls, long values, dialogs, errors, and actions SHALL remain readable and reachable without page horizontal scrolling, clipped meaning, or pointer-only access. A component-internal scroll region MAY scroll only when its existing interaction requires it and it remains keyboard reachable.
- **AC10 — Adaptive accessibility:** WHEN appearance is light, dark, or automatic, or when reduced motion, reduced transparency, increased contrast, or forced colors is active THEN explicit appearance SHALL continue to win, content and controls SHALL retain perceivable hierarchy/focus/boundaries, motion SHALL respect the preference, and no meaning SHALL depend on transparency, texture, or color alone.
- **AC11 — Behavioral boundary:** WHEN the overhaul is complete THEN no Rust, core, DTO, invoke/bridge, persistence, auth, sync, event recurrence semantics, notification state machine, Markdown, routing, or storage contract SHALL have changed, and no new product feature, API, dependency, or fabricated sample content SHALL have been introduced.
- **AC12 — Evidence and regression closure:** WHEN verification completes THEN focused route/component tests and `make verify-gui` SHALL pass; deterministic Playwright evidence SHALL cover each route, Events create/detail, representative shared dialogs and state variants in light/dark plus the responsive/AX5 matrix; console errors and document overflow SHALL be checked. Headless/browser evidence SHALL be reported separately from native Tauri visual review.

## Scope

Expected implementation seams are bounded to:

- `jin-gui/index.html`
- `jin-gui/src/styles/tokens.css`
- `jin-gui/src/styles/calendar.css`
- `jin-gui/src/styles/notifications.css`
- `jin-gui/src/styles/settings.css`
- `jin-gui/src/styles/forms.css`
- `jin-gui/src/styles/components.css`
- `jin-gui/src/styles/browse.css`
- `jin-gui/src/styles/a11y.css`
- `jin-gui/src/styles/index.css` only if stylesheet authority/import order requires it
- `jin-gui/src/lib/calendar/render.ts`
- `jin-gui/src/lib/calendar/time_grid_render.ts`
- `jin-gui/src/controllers/calendar_view_controller.ts` only for render-only header/date-scroller hooks; no control-flow, state, bridge, payload, or lifecycle changes
- `jin-gui/src/lib/events/render.ts`
- `jin-gui/src/lib/events/edit.ts`
- `jin-gui/src/lib/notifications/render.ts`
- `jin-gui/src/lib/settings/render.ts`
- focused existing tests under `jin-gui/src/__tests__/` plus narrowly named visual-system tests for Events and whole-app coherence

`calendar_view_controller.ts` is explicitly permitted only for render-only Events header and keyboard-focusable date-scroller hooks already authorized by the orchestrator. Any other controller change required solely to expose a presentation state must be documented and added to scope before proceeding. Behavior changes are not implicitly authorized by this visual overhaul.

## Explicit boundaries

No Rust/core changes; no DTO, invoke, bridge, database, filesystem, authentication, synchronization, notification-state, recurrence, timezone, sanitizer, Markdown, router, preference-storage, or persistence changes. No dependency additions. No new dashboard, command palette, search engine, onboarding, themes, AI behavior, collaboration, animation system, event semantics, settings option, or notification action. Do not replace native dialogs, existing custom select/calendar/tag primitives, CodeMirror, or controller architecture. Do not manufacture user data or success/loading states in production.

## Verification plan

1. Add or extend focused Vitest coverage for Events render/controller/time grid/edit, Notifications render/controller/accessibility, Settings render/controller/navigation, shared modal/select/capture primitives, token discipline, and responsive source contracts.
2. Run `git diff --check`, TypeScript checking, focused tests, style lint, production build, then `make verify-gui` once the integrated implementation is stable.
3. Use the repository Playwright MCP fixture at `http://127.0.0.1:1420` for route-by-route interaction and visual QA. Capture Events Month/Week/Day, a real detail, create/edit with recurrence, Notifications list/detail/state actions, every Settings pane, Capture, and representative shared dialogs.
4. Exercise light and dark at 1440 and 760 CSS px; 390 and 320 CSS px; AX5/310%; increased contrast; reduced transparency; reduced motion; and forced colors. Check document overflow, component reachability, focus visibility, state text, screenshots, and console warnings/errors.
5. Build the Tauri debug app after browser verification. Native review is the final visual-environment check and must not be represented as proven by headless screenshots.

## Autonomous phase checklist

- [x] Events workspace: Month/Week/Day header, grid/time grid, date/view navigation, Add Event.
- [x] Event record: detail, read-only/source/recurrence truth, links and related context.
- [x] Event work: create, edit, recurrence, conflict, validation, responsive dialog.
- [x] Notifications: filters, list/detail, action and provider states, scope dialog.
- [x] Settings: navigation and all four panes, operational states, appearance controls.
- [x] Shared moments: Capture, dialogs, forms, search/filter/select/tag/color controls, system states.
- [x] Closure: shared tokens and shell consistency; regression-only review of Today, Tasks, Notes.
- [x] Focused and full automated verification.
- [x] Complete browser visual/accessibility matrix with saved evidence.
- [x] Native Tauri build and explicit native-review boundary in the final report.

## Stories

- **S1 — Plan time comfortably:** As a Jin user, I can scan Month, Week, and Day, understand what is current and selected, and open or create an event without fighting gray chrome. Implement Phase 1 first; validate with AC1–AC3.
- **S2 — Resolve attention calmly:** As a Jin user, I can triage invitations and reminders while retaining provider truth, status, and available actions. Implement after shared tokens settle; validate with AC4 and AC7.
- **S3 — Configure Jin confidently:** As a Jin user, I can understand settings sections, operational status, warnings, and long technical values without decoding a stack of similar cards. Validate with AC5 and AC7.
- **S4 — Trust every small interaction:** As a keyboard, pointer, high-contrast, or large-text user, I encounter one consistent form, dialog, control, and state language in Capture and every shared moment. Validate with AC6, AC9, and AC10.
- **S5 — Experience one application:** As a daily Jin user, moving among all six routes feels visually coherent while accepted route behavior stays familiar. Validate with AC8, AC11, and AC12.

## Rejected Alternatives

- **Route-by-route isolated redesigns:** rejected because each surface would create new local tokens and control variants, reproducing the accumulated inconsistency this change is meant to remove.
- **A universal card system:** rejected because surrounding every calendar cell, settings group, notification row, and document section with rounded gray containers weakens hierarchy and conflicts with the approved open paper direction.
- **New navigation, command palette, or interaction model:** rejected because the request is a whole-app quality renewal and existing controllers already provide the required product behavior.
- **One final CSS override layer:** rejected because it would mask conflicting style authority and make later maintenance brittle; touched rules belong in their owning stylesheets.

## Risks

- **P0 — Behavioral regression through presentation hooks:** DOM wrappers can break Stimulus targets, delegated actions, focus restoration, listbox navigation, or calendar geometry. Prefer CSS-only changes and add render hooks only where existing semantics remain structurally identical.
- **P0 — Responsive calendar failure:** Month/time grids and long event forms can force document overflow at 320/390 or AX5. Verify actual reachability and internal scroll intent at every breakpoint.
- **P1 — Shared-token blast radius:** Changing a generic token can unintentionally restyle already accepted routes. Add narrow semantic roles and visually regression-test Today, Tasks, and Notes.
- **P1 — State meaning lost through quiet styling:** Provider, read-only, pending, disabled, conflict, warning, and failure states cannot be made so subtle that users miss them. Preserve explicit text and non-color cues.
- **P1 — Dark/forced-color divergence:** New paper and wash roles can collapse boundaries or contrast. Define adaptive roles at the token source and verify explicit dark, system dark, increased contrast, and forced colors.

## Confidence

Requirements and exclusions are explicit, existing route ownership and test seams are mapped, and the approved visual language is already implemented on three core routes. Confidence is high for a CSS-led sequential implementation. The largest uncertainty is responsive calendar density; the plan isolates that work first and requires interaction plus screenshot evidence before shared styles expand.
