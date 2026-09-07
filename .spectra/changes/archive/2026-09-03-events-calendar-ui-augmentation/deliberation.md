---
eidolon: forge
version: 1.0.0
kind: deliberation
performative: DECIDE
status: retrospective
created_at: 2026-09-03T00:00:00Z
change_id: events-calendar-ui-augmentation
---

# FORGE Deliberation — Events Calendar UI Augmentation

> **RETROSPECTIVE DECIDE** — This record captures the trade-offs embodied in the owner-accepted implementation and freezes the decision boundary for release verification.

## Decision

Accept a bounded UI augmentation: frontend-local exact-calendar colors, a shared palette-token-or-canonical-HEX value model, a custom Jin HSV picker, passive-only badge normalization, and responsive clamping based on `minmax(0, ...)`. Preserve core Event/calendar schemas and provider boundaries.

## Accepted choices

### Frontend-local exact-calendar colors

Calendar color is presentation preference, not canonical Event meaning. Persist it under a versioned frontend key, using `jin` for local Events and encoded account-id/calendar-id tuples for Google. This distinguishes calendars accurately, avoids provider coupling, and allows a mounted view to react immediately to a local preference event.

### Palette token plus canonical HEX

Use one narrow domain: eight semantic Jin tokens or uppercase six-digit HEX. Expand `#RGB` only at a commit boundary. This preserves theme-aware presets, enables custom colors, makes persistence deterministic, and prevents arbitrary style injection. Lists and Tags enforce the same domain in core; calendar preferences validate on load/write and fall back safely.

### Custom Jin HSV picker

Use a Jin-owned modal containing a chromatic Hue range, separate native Saturation and Brightness ranges, HEX/RGB fields, preview, and a supplemental SV map. Native S/B ranges are the canonical accessible path. Draft input remains stable during typing and IME composition; specifically, `#RGB` previews/canonicalizes only on blur, change, or Apply. Apply commits once; dismissal is non-mutating.

### Passive-only badge primitive

Adopt a shared capsule primitive only for passive metadata and status labels in touched surfaces. Source, recurrence, authorization state, and similar labels retain semantic/accessibility text. Interactive chips, task controls, counters, and specialized code labels keep their established behavior.

### Responsive minmax and clamping

Use zero-minimum grid tracks, bounded inline sizes, wrapping/stacking, and container-local overflow so long Month titles and compact modal controls cannot expand their layout. Continue using Jin tokens and explicit forced-colors behavior.

## Rejected alternatives

- **Core calendar color schema:** rejected because this change is visual preference, would introduce migration/sync/provider questions, and is unnecessary for local rendering.
- **Arbitrary CSS color values:** rejected because permissive strings weaken validation, persistence consistency, and style safety.
- **Native `input[type=color]`:** rejected because platform presentation and capabilities vary and do not provide the accepted Jin palette, coordinated HEX/RGB drafts, explicit H/S/B controls, or reliable Jin visual language.
- **Universal badge conversion:** rejected because “badge” names include interactive controls, counters, task-state affordances, and specialized labels whose semantics should not be flattened into passive metadata styling.

## Consequences

- Calendar preferences do not synchronize between devices and may be cleared with frontend storage.
- Custom colors remain visually stable but do not automatically adapt like semantic palette tokens across themes.
- The custom picker owns conversion and draft-state complexity; its tests must guard caret stability, IME behavior, canonicalization boundaries, modal teardown, and single-commit behavior.
- Color supports grouping but cannot replace source/kind text or accessible identity.
- Broad visual consistency improves incrementally; untouched badge families are not evidence of incomplete scope.

## Risks and verification obligations

- **Geometry regression:** long Month titles or compact forms may reintroduce page overflow. Verify equal columns, truncation, bounded modal width, narrow stacking, and no document-level horizontal overflow.
- **Identity collision:** same calendar ids across Google accounts may share a color accidentally. Verify the encoded account/calendar tuple and exact Event resolution.
- **Unsafe/stale preference:** malformed storage or style values may enter rendering. Verify strict normalization, invalid-entry filtering, deterministic fallback, and validated CSS custom-property assignment only.
- **Typing regression:** synchronized controls may rewrite the active field or move its caret. Verify partial HEX, owner-accepted `#RGB`, six-digit HEX, RGB leading zeros, blur/change/Apply boundaries, selection retention, and composition events.
- **Accessibility regression:** a visual spectrum or SV map may become the only usable route. Verify labeled native H/S/B ranges, live values, keyboard behavior, visible focus, field-associated errors, focus restoration, non-color Event identity, and forced-colors behavior.
- **Lifecycle leak/double commit:** repeated renders may orphan modals or callbacks. Verify one callback per Apply, no callback on all dismiss paths, listener/modal destruction, and Settings rerender cleanup.
- **Canonical color divergence:** frontend and core may normalize differently. Verify token case, three-digit expansion, uppercase six-digit HEX, invalid List/Tag rejection, and preservation of previous canonical Tag data after rejection.
- **Badge semantic drift:** shared styling may erase affordance or accessibility. Verify only passive labels compose `jin-badge`; interactive elements retain their roles, focus, click behavior, and existing specialized classes.
- **Release regression:** require focused tests, complete frontend tests, affected core tests, build, CSS lint, browser console/accessibility checks, representative screenshots, green CI, and owner-reviewed native Tauri rendering before merge.

## DECIDE boundary

Vivi may ship only the accepted bounded implementation. Vigil must verify the frozen 14 acceptance checks independently. Core calendar schema, provider sync, arbitrary CSS syntax, native color input substitution, and universal badge conversion remain rejected and require a separate deliberate change.
