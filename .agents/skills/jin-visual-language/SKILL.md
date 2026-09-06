---
name: jin-visual-language
description: Design, implement, or review Jin GUI visual styling, interaction presentation, responsive behavior, and design-system consistency; do not use for product or backend-only changes.
---

# Jin visual language

Use this skill when a Jin GUI change affects how a surface looks, feels, reads,
responds, or communicates state. Start with the canonical guide at
[`docs/visual-language/README.md`](../../../docs/visual-language/README.md).
It is the source of truth; `design.md` is historical research.

Before editing, identify the affected route, state, renderer/controller, and
closest owning stylesheet. Inspect the existing DOM and behavior. Choose an
existing semantic token and primitive first. Add a narrow adaptive token in
`jin-gui/src/styles/tokens.css` only when a real distinction is missing, and
keep raw colors there. Put responsive rules beside the feature that owns the
geometry. Preserve accessible names, real buttons/links/fields, focus,
`aria-*` state, handlers, storage, and controller payloads. Visual polish must
not create fake product state or expand into backend work. If a visual request
depends on a state, action, or dataset that does not exist, first locate the
real renderer/controller contract or define that contract deliberately before
styling; never invent a retry, deadline, loading, or success state in CSS.

Use the smallest change that expresses Jin's paper, ink, indigo, and restrained
vermilion language. Keep continuous lists, calendars, settings, and documents
out of generic rounded gray cards. Reserve display type for prominent
editorial/brand titles; keep controls, metadata, and prose in the text face.
Keep seal/brand, capture, and semantic danger roles distinct; reuse existing
seal-based explicit-action primitives where the surface already has them.

For verification, run focused behavior tests when interaction changes, the
relevant style/token checks, and a proportional visual review. Exercise the
actual responsive seams and preference states involved, including large text,
focus, contrast, transparency, motion, and forced colors when relevant. Check
console output and document/page overflow. Use
[`jin-gui-visual-qa`](../jin-gui-visual-qa/SKILL.md) for Playwright evidence;
its browser results do not constitute native Tauri owner sign-off.

Finish by checking the owning cascade, neighboring accepted surfaces, and
`git diff --check`. Update the dossier only when the visual rule is implemented
and accepted, and link to the new rule rather than duplicating it elsewhere.
