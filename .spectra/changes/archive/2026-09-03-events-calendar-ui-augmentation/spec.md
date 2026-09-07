---
eidolon: idg
version: 1.0.0
kind: retrospective-spec
status: frozen
created_at: 2026-09-03T00:00:00Z
change_id: events-calendar-ui-augmentation
maker: vivi
checker: vigil
spec_ref: spec.md
acceptance_checks_count: 14
---

# Events Calendar UI Augmentation

> **FROZEN / RETROSPECTIVE** — This specification records the owner-accepted implementation after delivery. It is the release contract for verification and must not be treated as authorization for further product expansion.

## Outcome

Modernize Jin's Month, Week, and Day calendar surfaces; make calendar identity legible through user-controlled color; provide one reusable Jin color picker with a custom chroma path; and normalize passive badges without changing calendar data authority or interaction semantics.

## Scope

### In scope

- Stable seven-column Month geometry whose cells cannot be widened by long Event titles.
- Refined Week and Day surfaces using Jin spacing, typography, borders, shadows, and restrained calendar-color tinting.
- Removal of the circular `G`/`J` source glyphs from calendar blocks while preserving source and Time block text in visible or accessible identity.
- A frontend-local color preference for the Jin calendar and each exact Google account/calendar pair, with immediate mounted-calendar rerender.
- One reusable Jin palette picker for calendar, List, and Tag color selection, ending with a chromatic custom-color circle.
- A custom Jin modal with preview, hue spectrum, saturation/value map, separate native Hue/Saturation/Brightness ranges, HEX, RGB, validation, and transactional Apply/Cancel behavior.
- Canonical color representation as a Jin palette token or uppercase six-digit HEX.
- Core write-boundary normalization and validation for List and Tag colors.
- A shared passive-badge visual primitive applied only to non-interactive metadata/status labels in the touched surfaces.
- Responsive and forced-colors-safe styling plus focused, full-suite, build, lint, browser, and native-owner verification.

### Out of scope

- Adding color to the canonical Event or calendar provider schema, syncing color to Google, or changing Event identity/authority.
- Cross-device synchronization of calendar color preferences; calendar choices remain local to the frontend profile.
- Accepting arbitrary CSS color syntax, alpha channels, gradients as persisted values, or unvalidated strings in style properties.
- Replacing the custom experience with the platform-native `input[type=color]`.
- Converting interactive controls, notification counts, task state controls, code-language labels, or every object called a badge to the passive primitive.
- Redesigning calendar chronology, Event mutation, recurrence, account sync, or detail behavior.
- Pixel-for-pixel reproduction of HEY Calendar or another product's brand language.

## Decisions and constraints

1. Calendar preferences are frontend-local under a versioned storage key. Jin uses the exact key `jin`; Google calendars use an encoded tuple of account id and calendar id so same-named calendars from different accounts remain distinct.
2. Missing preferences receive deterministic palette defaults. A preference update emits one calendar-colors-changed event and mounted calendar views rerender from current data.
3. The shared value domain is the eight semantic palette tokens or canonical `#RRGGBB`. `#RGB` is accepted only as an editing draft and expands to uppercase `#RRGGBB` at its commit boundary.
4. Palette colors are applied through known data attributes and tokens. Custom color is written to a CSS custom property only after validation and canonicalization; invalid persisted or inbound values fail safely to `accent`.
5. The final picker circle retains a chromatic ring. When a custom color is selected, an inset sample communicates the current value without turning the trigger into a flat ninth preset.
6. The custom picker is modal and transactional. Opening seeds a working value; only Apply invokes the owner's change callback. Cancel, close, or Escape leaves the owner value unchanged, and focus returns to the trigger.
7. Draft editing must not fight the user. Active HEX/RGB text is not reformatted, auto-completed, or caret-shifted on each keystroke. IME composition is ignored until `compositionend`.
8. A valid six-digit HEX or complete RGB draft updates the preview and synchronized controls while preserving the active field text. **A valid `#RGB` is a draft that previews and canonicalizes only on blur, change, or Apply**, matching the owner-accepted typing behavior.
9. Hue is presented as a full-width chromatic spectrum with a live degree value and a contrast-safe thumb. Saturation and Brightness expose live percentage values.
10. The two-dimensional SV map is a supplemental pointer/keyboard convenience. The separate native Saturation and Brightness ranges are the canonical accessible controls; the map does not replace them.
11. Native ranges retain platform keyboard semantics and explicit accessible names/value text. The SV map supports directional keys, with Shift as the larger step, and reports both saturation and brightness.
12. Responsive layout uses `minmax(0, ...)`, zero minimum inline sizes, bounded modal width, and narrow-screen stacking. Visual constants live in Jin tokens; forced-colors mode restores usable native range rendering.
13. Lists and Tags accept the same palette-or-HEX domain at core write boundaries. Reads remain tolerant, while new or edited values are normalized and invalid writes are rejected without corrupting the previous value.
14. Badge normalization is intentionally passive-only: shared capsule geometry and typography may be composed with source/status-specific classes, but interactive chips keep their existing affordances and semantics.

## Acceptance checks

- **AC-01 — Month geometry.** When a Month Event has a title longer than its cell, the calendar shall retain seven equal `minmax(0, 1fr)` columns, keep the cell/event within its column, and truncate or clip text without widening that day or the document.
- **AC-02 — Week/Day identity.** When Week or Day renders timed or all-day Events, the surface shall use Jin tokens and the resolved calendar color for border/tint, shall render no circular `G` or `J` glyph, and shall preserve non-color source/Time block identity in text and accessible names.
- **AC-03 — Exact calendar colors and reactivity.** Given Jin and Google calendars, the system shall key Google preferences by exact account id plus calendar id, keep same-named calendars distinct, choose a deterministic default when unset, persist valid local choices, and rerender a connected calendar immediately after a preference change.
- **AC-04 — One shared picker.** Wherever the touched Calendar, List, or Tag UI selects color, it shall use the same ordered eight-token Jin picker plus a final chromatic custom trigger, with accurate group labels and selected state.
- **AC-05 — Modal lifecycle.** When the custom trigger opens the picker, one owned Jin modal shall initialize from the current custom value or a safe default; close/Cancel/Escape shall preserve the owner value and restore trigger focus, and controller/picker destruction shall remove modal ownership and listeners.
- **AC-06 — HEX draft and IME behavior.** While a user types or composes in HEX, the control shall preserve their literal text, selection, and caret without auto-completion; valid `#RRGGBB` shall preview without rewriting the active draft, while valid `#RGB` shall preview and canonicalize only on blur, change, or Apply.
- **AC-07 — RGB preview and validation.** While complete integer RGB drafts remain within 0–255, the picker shall preview and synchronize the color without rewriting the active field; on blur/change it shall canonicalize presentation, while empty, fractional, or out-of-range channels shall disable Apply and expose a field-associated error without marking unrelated fields invalid.
- **AC-08 — Hue spectrum.** When the custom picker is visible, Hue shall be a full-width red-through-spectrum range with visible focus, a contrast-safe color-aware thumb, live degree output, native range keyboard behavior, and a usable forced-colors fallback.
- **AC-09 — Saturation/Brightness accessibility.** When color is adjusted, separate labeled native Saturation and Brightness ranges shall remain the canonical accessible controls with live percentage/value text; the supplemental SV map shall mirror them, expose both values, support pointer and directional-key input, and never be the only adjustment path.
- **AC-10 — Transactional selection.** Given any valid draft, Apply shall commit exactly once as an uppercase `#RRGGBB`, update the invoking picker, and close; given an invalid or incomplete draft, Apply shall remain disabled; Cancel, close, or Escape shall commit nothing.
- **AC-11 — Safe responsive CSS.** When applying a color or narrowing the window, only known token selectors or validated canonical HEX shall reach the color custom property, invalid values shall fall back safely, controls shall clamp/stack without internal or document overflow, and styling shall use Jin tokens including forced-colors handling.
- **AC-12 — List/Tag core normalization.** When List creation/edit or Tag recoloring receives a palette token or three/six-digit HEX, core shall persist a lowercase token or uppercase expanded `#RRGGBB`; when input is outside that domain, core shall reject the write and preserve prior canonical data.
- **AC-13 — Passive badges.** When passive source, recurrence, metadata, authorization-state, export, error-code, Task-detail status, or priority badges render in touched surfaces, they shall share the Jin capsule primitive while retaining readable text/accessible labels; interactive chips and controls shall not be indiscriminately converted.
- **AC-14 — Release quality.** Before merge, the focused color/calendar regressions, complete frontend suite, affected core tests, production build, CSS lint, browser interaction/accessibility checks, and CI shall pass; browser evidence shall show Month/Week/Day/Settings at representative and narrow sizes with no console errors, and native Tauri appearance shall receive owner visual sign-off.

## Release boundary

Maker is `vivi`; checker is `vigil`. Verification must preserve maker/checker separation. This frozen retrospective spec describes the accepted code and typing behavior; any behavioral expansion requires a new change or an explicit lifecycle amendment.
