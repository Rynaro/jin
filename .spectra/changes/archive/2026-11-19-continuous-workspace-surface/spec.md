---
eidolon: ramza
kind: spec
version: 1
created_at: 2026-11-19
---

# Continuous workspace surface

## Scope

The user requests a more organic sidebar with no visual separation from the workspace. Implement a shared desktop canvas for the shell, navigation rail, and main working region across the existing routes. The previous change left separate workspace-context and workspace-canvas backgrounds, a native sidebar glass tint, and an inset main surface with a radius and shadow. These treatments can continue to divide the window even after removing borders.

This is a targeted presentation change. Use the existing adaptive surface roles and owning stylesheets. Scope covers shell surface tokens, layout, sidebar, associated accessibility overrides, the implemented visual-language description, and reviewed visual evidence. Existing route data, storage, and navigation behavior constrain the implementation.

## Approach

Give the desktop sidebar and surrounding workspace the same opaque adaptive canvas. Remove the raised outer main-region treatment and the native-only color treatment that produces a seam. Use spacing, typography, and interactive state to organize navigation and content. Keep internal calendar grid lines, document structure, form fields, selected rows, and focused controls legible.

The compact navigation drawer remains an overlay with a readable surface and dismissal affordance. Scope its separation to the overlay state. Increased contrast and forced colors retain functional contrast and focus visibility. Reduced transparency uses the same desktop canvas contract.

## Stories

1. A person moving between Today, Tasks, Notes, Calendar, Settings, and Notifications sees one continuous window surface. Implement through the owning CSS and adaptive tokens in one focused iteration. Vivi owns production edits and reports the affected files and checks.
2. A person using a compact window or enlarged text can still open navigation, identify the current destination, activate header utilities, and return to their work. Browser verification covers the drawer and large text, with native macOS review covering the actual compositor.

## Acceptance Criteria

### AC-CS-1 (event-driven)

GIVEN The desktop shell in light or dark appearance
WHEN Sidebar and main region are rendered
THEN The desktop chrome presents one adaptive canvas without a contrasting shell seam
VERIFY: Desktop light and dark screenshots plus computed background styles

### AC-CS-2 (event-driven)

GIVEN The desktop workspace is visible
WHEN Its outer main-region treatment is inspected
THEN The main region has a continuous surface without a raised outer card
VERIFY: Desktop screenshots and owning layout CSS review

### AC-CS-3 (event-driven)

GIVEN The native macOS overlay or Reduce Transparency is active
WHEN The sidebar is shown beside working content
THEN The shared desktop canvas remains uniform across the sidebar boundary
VERIFY: Signed macOS screenshot and reduced-transparency browser check

### AC-CS-4 (event-driven)

GIVEN Existing Today, Tasks, Notes, Calendar, Settings and Notifications routes
WHEN The user navigates among them
THEN Working content retains readable hierarchy and interactive state
VERIFY: All-route screenshot review and real navigation checks

### AC-CS-5 (event-driven)

GIVEN Compact navigation or enlarged text
WHEN The drawer is opened and its destinations are activated
THEN Navigation controls remain reachable with visible focus and working dismissal
VERIFY: Compact and large-text keyboard drawer checks

### AC-CS-6 (event-driven)

GIVEN Increase Contrast or forced colors is active
WHEN The desktop shell and its interactive states are displayed
THEN Readable labels and visible focus remain available on continuous desktop chrome
VERIFY: Contrast and forced-color visual checks

## Rejected Alternatives

Changing the sidebar tint alone leaves the main-region shadow and inset geometry visible. This scored 78 in the planning tool. Extending native vibrancy across the entire window creates variable contrast and additional compositor work and scored 66.5. The shared opaque adaptive canvas scored 92.5 and directly addresses the requested visual continuity through existing surface roles.

## Risks

Native sidebar transparency can override browser styling. Verify the signed macOS build. Shared token edits can affect compact drawer contrast or selected rows, so inspect the owning cascade and focused accessibility states. A flat shell must retain useful internal document, calendar, and form organization.

## Verification

Inspect the desktop boundary in light and dark appearance, then native macOS and reduced transparency. Check all six main destinations, compact navigation, enlarged text, focus, contrast, and document overflow. Run style and token checks appropriate to the touched files and focused behavior tests if behavior changes. Review candidate screenshots before updating references. Capture actual native behavior separately from browser fixture evidence. Vigil independently verifies the acceptance criteria before lifecycle closure.

## Confidence

The scope is concrete and the source identifies the remaining separation. The planning tool evaluates implementation confidence after linting. Browser and native review remain the evidence for the rendered result. ESL is full from the parent lifecycle gate, while the separate RAMZA sizing tool assigns lite to this localized presentation plan.
