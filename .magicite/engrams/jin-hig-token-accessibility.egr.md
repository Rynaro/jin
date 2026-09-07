---
spec: engram/0.2
name: jin-hig-token-accessibility
id: egr_c7c5e966
version: 1
provenance: authored
intent:
  does: "Extend Jin's HIG-inspired visual system through semantic tokens and accessibility fallbacks"
  use_when: "changing CSS colors, typography, spacing, materials, motion, focus, status indicators, or accessible interaction"
  not_when: "changing headless Rust behavior with no visual or interaction effect"
triggers:
  positive:
    - "add or change a Jin CSS design token"
    - "implement dark mode contrast reduced motion or transparency fallback"
    - "style a status without relying on color alone"
    - "preserve keyboard focus and accessible hit targets"
  negative:
    - "change a jin-core storage or sync invariant"
context_affinity: [jin-gui, hig, css, tokens, accessibility]
plasticity: {storage_strength: 0.0, exposure_count: 0, outcome: {success: 0, failure: 0}, excitability: 0.05, status: nascent}
needs: [jin-gui-controller-transform-render]
yields: [accessible-token-disciplined-ui]
composes: [jin-verification-gates]
inhibits: []
provenance_journal:
  - {version: 1, timestamp: '2026-08-18T00:00:00Z', author: vivi, event: authored, note: "Grounded in GUI token and a11y gates"}
trust: {origin: authored, verification_status: pending}
exports: {skill_md: true}
---
## Procedure
1. Reuse semantic variables from `jin-gui/src/styles/tokens.css`; add a token there before using a new bare `var(--name)` elsewhere.
2. Keep raw color literals confined to `tokens.css`, including distinct light and dark semantic tiers.
3. Preserve the system font stack with bundled Inter fallback; never bundle Apple SF Pro font files.
4. Provide reduced-transparency, increased-contrast, and reduced-motion behavior in `styles/a11y.css` through both media queries and manual data attributes.
5. Encode state with text and glyph/shape as well as color, preserve visible keyboard focus, and use the hit-target tokens.
6. Run `token_discipline.test.ts`, `css_tokens.test.ts`, relevant component tests, stylelint, and documented manual visual checks.

## Pitfalls
- Adding a raw hex value to component CSS bypasses theme semantics and fails the token gate.
- Using color as the only task-state signal violates the established accessibility baseline.
- Glass effects without opaque fallbacks make reduced-transparency mode unusable.

## Examples
+ Add a semantic warning token in `tokens.css`, use it in component CSS, and verify both dark tiers plus contrast mode.
- Copy an SF Pro font file into the application bundle to improve visual fidelity.

## Provenance
- Derived from `jin-gui/src/styles/tokens.css`, `a11y.css`, `token_discipline.test.ts`, and `css_tokens.test.ts`.
