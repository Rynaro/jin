# Writing brief and ownership

IDG is the sole writer for this documentation phase. Other agents must not edit these files while IDG is active.

## IDG-owned files

1. `docs/visual-language/README.md` — write the canonical dossier described in `spec.md`. Keep it comprehensive, scan-friendly, and grounded in current code. Link to source files rather than copying long CSS blocks or raw token values.
2. `.agents/skills/jin-visual-language/SKILL.md` — create one concise design/implementation/review skill that loads the dossier and defers browser mechanics to the existing visual-QA skill.
3. `.agents/skills/jin-gui-visual-qa/SKILL.md` — preserve the existing evidence loop and add proportional design-fidelity/drift review against the dossier.
4. `README.md` — replace the current Design Philosophy hand-off so the new dossier is normative, Apple HIG is inspiration, and `design.md` is background research.
5. `docs/gui-testing.md` — add concise dossier/skill links near the testing authority and visual sign-off guidance; do not rewrite historical gate tables or counts.

## Evidence to use

- Identity and foundations: `docs/assets/jin.png`; `jin-gui/src/styles/tokens.css` lines 26–102, 152–267, and adaptive dark sections.
- Cascade: `jin-gui/src/styles/index.css`.
- Shell/navigation: `layout.css`, `navigation.css`.
- Today: `today.css`, agenda renderer/controller.
- Capture/forms/dialogs: `forms.css`, `components.css`, Capture/actions/modal code.
- Tasks and Notes: late accepted authority blocks in `browse.css`, plus Notes editor and `a11y.css`.
- Events and mobile Month: accepted authority in `calendar.css`, relevant renderer/controller contracts.
- Notifications: `notifications.css`, renderer/controller.
- Settings: `settings.css`, renderer/controller.
- Accessibility and QA: `a11y.css`, `docs/gui-testing.md`, both existing Jin GUI skills, and archived visual-change verification records through 2026-09-06.

## Delivery checks

- Preserve current behavior and source ownership; do not speculate about Jin's name/logo meaning.
- Distinguish brand seal, capture/today vermilion, and semantic danger/error.
- Do not create another drift skill, supporting folders, scripts, assets, or UI metadata.
- Run both skill validators with the dependency-runtime Python specified in `spec.md`.
- Resolve new links and run `git diff --check`.
- Hand the complete five-file diff to ATLAS for an independent source-fidelity review.
