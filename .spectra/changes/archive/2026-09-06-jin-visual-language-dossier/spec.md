# Jin Visual Language Dossier and Maintenance Skill

## Objective

Close the visual-overhaul work by turning the accepted interface into durable, repo-local guidance. Create one canonical, code-grounded visual-language dossier and one concise implementation/review skill, then extend the existing visual-QA skill so future UI changes can detect drift. The documentation must describe Jin as it exists after the overhaul rather than inventing brand mythology or copying the historical Apple research in `design.md`.

The canonical product evidence is the current logo asset, the semantic roles and comments in `jin-gui/src/styles/tokens.css`, the stylesheet ownership/import order, accepted screen implementations, archived change specifications and verification records, and the GUI testing contract. Where meaning is not encoded in those sources, say so rather than speculating.

## Architecture decision

Use a single comprehensive dossier at `docs/visual-language/README.md`, with anchored sections for foundations, screen recipes, engineering ownership, and maintenance. This keeps one normative source while allowing skills and reviewers to link directly to the needed section. Do not duplicate the dossier into a second design-system reference.

Create one `.agents/skills/jin-visual-language/SKILL.md` for designing, implementing, and reviewing Jin UI work. Extend `.agents/skills/jin-gui-visual-qa/SKILL.md` with visual-language fidelity and drift-review checks. Do not create a separate drift-review skill: it would share the same evidence loop, source ownership, responsive matrix, and native-signoff boundary as visual QA, making discovery ambiguous and guidance easy to desynchronize. Leave the lower-level `jin-playwright-mcp` skill focused on deterministic browser operation.

## Canonical dossier contract

`docs/visual-language/README.md` must be comprehensive but operational. Use tables where they make token roles, screen ownership, or state mappings easier to scan. Include exact selectors/files only when they help contributors place a change correctly.

### 1. Authority and identity

- Declare the dossier normative for Jin GUI visual and interaction presentation. `design.md` remains historical/inspirational Apple research and is not the current Jin specification.
- Ground the identity in actual assets and tokens: warm continuous paper/workspace surfaces, black/near-black nanquim ink, sparse brush/ink marks, indigo for operational focus/selection/linkage/time, and the seal/cinnabar family.
- Keep `--seal` distinct from semantic danger. Seal/cinnabar represents the brand mark and explicit intent; `--capture-vermilion` represents Capture/Add/today emphasis where implemented; `--system-red` and danger roles represent destructive/error meaning. Similar warm hues do not make these roles interchangeable.
- State that Jin's name or logo symbolism beyond what the asset and source comments establish is not codified. Do not invent a spiritual, linguistic, or cultural origin story.

### 2. Foundations grounded in `tokens.css`

- **Typography:** document `--font-text`, `--font-mono`, and `--font-display`; the HIG-derived 11-step rem scale; 17/22 body baseline; `--dynamic-type-scale`; and the rule that Mincho/display is reserved for brand/editorial titles at roughly 20px and above while prose, controls, dense metadata, and editor body use the text face. Explain title/body hierarchy and readable measure using existing document/editor tokens, including the Notes 66ch/1.125rem/1.7 roles.
- **Color and material:** map workspace, ink, agenda/indigo, seal, capture, task, note, calendar, operational, dialog, and state roles by semantic purpose. Explain adaptive light/system-dark/explicit-dark ownership and that explicit appearance wins. Raw color values belong only in `tokens.css`; components consume roles.
- **Spacing and geometry:** document the 4/8 spacing system, desktop/coarse hit targets, rail/control/row geometry, reading width, and existing radius categories. Rounding is an affordance for controls, badges, popovers, and elevated dialogs, not the default container for lists, calendars, settings sections, or documents.
- **Material depth:** content lives on continuous paper/ledger fields. Glass/material blur is limited to chrome and transient elevated UI and must have reduced-transparency fallbacks. Shadows communicate actual elevation, not section grouping.
- **Motion:** document existing duration/easing roles and the principle that motion communicates state/location. Preserve reduced-motion media and manual preferences; do not add decorative movement or use animation to conceal latency.

### 3. Interaction and state language

- Document primary, secondary, icon, destructive, capture/seal, segmented/tab, row, field, link, and disclosure treatment using existing classes/tokens.
- Preserve real DOM semantics, accessible names, pressed/current/selected/disabled state, live regions, focus restoration, and controller actions. Visual polish never fabricates save, loading, selection, provider, sync, permission, conflict, or success state.
- Describe focus as a visible indigo/default system cue separate from selected/current/today/error meaning. Semantic states use text or icon/shape plus color.
- Give concise recipes for loading, empty, not-found, offline, pending, queued, success, warning, failure, conflict, read-only, and destructive confirmation based on current components.

### 4. Responsive and accessibility contract

- Record the maintained reference widths: 320, 390, 760, and 1440 CSS px. Treat these as regression anchors, not universal layout breakpoints; use the owning stylesheet's actual seam.
- Document repository accessibility text mode with `--dynamic-type-scale: 3.1`, reflow before scroll, and keyboard-focusable component-only scrolling when intrinsic structures such as seven-column calendars cannot fit. The document itself should not horizontally overflow.
- Cover light, dark, automatic, increased contrast, reduced transparency, reduced motion, forced colors, coarse-pointer targets, keyboard navigation, readable long values, and color independence.
- Preserve the browser/native evidence boundary: deterministic Playwright verifies web layout and interactions; only owner inspection can approve native Tauri rendering, motion feel, and tap ergonomics.

### 5. Screen recipes

Document the accepted purpose, visual hierarchy, key interaction/state invariants, responsive behavior, and owning files for:

- shell/brand/navigation (`layout.css`, `navigation.css`);
- Today living agenda (`today.css`, agenda renderer/controller);
- Capture and shared forms/dialogs (`forms.css`, `components.css`, Capture/actions/modal primitives);
- Tasks paper ledger and inspector (`browse.css`, Tasks renderer/controller);
- Notes browser and continuous CM6 writing desk (`browse.css`, `a11y.css`, Notes renderer/controller/editor);
- Events Month/Week/Day, event detail/edit, and compact mobile Month (`calendar.css`, relevant event rendering, CalendarViewController);
- Notifications triage (`notifications.css`, notification renderer/controller);
- Settings document and its four panes (`settings.css`, Settings renderer/controller).

Each recipe must name behavior that styling must preserve. Do not turn screen recipes into mock product requirements or repeat every selector.

### 6. Code ownership and cascade

- Document `styles/index.css` import order and authority: tokens → typography → spacing → materials/components/navigation/motion/layout/features → `a11y.css` final fallback authority.
- Include a compact ownership table mapping concern to stylesheet and render/controller seam. The closest surface stylesheet owns its responsive rules. `tokens.css` owns raw colors and shared semantic roles. `a11y.css` owns cross-surface preference fallbacks, while feature-specific large-text reflow may stay beside the component when it depends on its intrinsic geometry.
- Explain that controller changes require a real presentation state unavailable in existing DOM; they must preserve control flow, targets/actions, payloads, storage, focus, and lifecycle.

### 7. Demonstrated drift traps and maintenance

Ground anti-patterns in the current code and completed work:

- stacking a late override block over an earlier generic and paper authority instead of consolidating the owning seam;
- broad changes to generic background/fill tokens with an accepted-route blast radius;
- raw colors outside `tokens.css`, or using the same warm red role for brand, capture/today, danger, and error;
- gray rounded card accumulation, nested paper rectangles, cardifying lists/calendar/settings/documents, and decorative shadows;
- applying the display face to controls, dense metadata, or long body copy;
- copying a reference literally, introducing fake state, hiding real controls, or adding product behavior to achieve a visual;
- page-level horizontal overflow, fixed heights at enlarged text, non-focusable component scrollers, and normal-scale compression leaking into accessibility scale;
- `!important` or a final global patch except a documented, narrow authority exception;
- weakening tests into selector snapshots that do not protect behavior.

Record the current fragmented responsive seams (including 560/639/640/700/720/760/860/900/1079) as history to inspect, not a new mandatory breakpoint system. Require future changes to state desktop/mobile/accessibility intent, extend the closest owner, test real behavior, and update the dossier only after a visual rule is accepted and implemented.

## Skill contract

### New `.agents/skills/jin-visual-language/SKILL.md`

- Frontmatter name `jin-visual-language` and a discriminating description: use for designing, implementing, or reviewing Jin GUI visual styling, interaction presentation, responsive behavior, or design-system consistency; exclude product/backend-only changes.
- Keep the entrypoint concise. Require reading `../../../docs/visual-language/README.md`, then inspecting the affected surface and real behavior before making decisions.
- Direct the agent to select existing semantic roles first, add narrow adaptive roles in `tokens.css` only when necessary, edit the closest owning stylesheet, preserve semantic/controller contracts, and verify proportionally.
- Link to `jin-gui-visual-qa` for browser evidence rather than duplicating its operational procedure.
- Include completion checks: focused behavior tests, CSS/token discipline, responsive/accessibility states relevant to the change, visual comparison, console/overflow, and explicit native-review boundary.
- Do not add scripts, assets, `agents/openai.yaml`, blanket approval gates, or a universal fixed workflow. Automatic skill discovery remains the default.

### Extend `.agents/skills/jin-gui-visual-qa/SKILL.md`

- Link to the canonical dossier and add a **design fidelity/drift review** mode.
- In that mode, check semantic role use, type/material hierarchy, correct stylesheet ownership, absence of override/card accumulation, state truth, and unchanged accepted neighboring surfaces.
- Keep the existing evidence loop and 1280×800 baseline. Use 320/390/760/1440 plus dynamic scale 3.1 only for cross-screen/responsive-system work; for a local change choose the smallest matrix that exercises its actual seams and record it.
- Add light/dark and relevant forced-colors/contrast/transparency/motion checks when the change touches those roles. Preserve the owner-native sign-off distinction.

## Repository integration

- Update `README.md` Design Philosophy to link the canonical dossier and describe the current Jin paper/ink/indigo/vermilion system. Remove or subordinate claims that Liquid Glass is the complete current visual authority; keep Apple HIG as inspiration rather than the product specification.
- Add a concise link from `docs/gui-testing.md` to the dossier and the repo skills. Do not rewrite the historical testing matrix or hard-coded counts as part of this documentation change.
- Leave `design.md` unchanged and identify it as background research from the new canonical dossier.

## Acceptance criteria

- **AC1 — Canonical and grounded:** WHEN a contributor opens `docs/visual-language/README.md` THEN one clearly normative dossier SHALL explain Jin identity, foundations, interaction, motion, accessibility, responsive behavior, screen recipes, ownership, anti-patterns, evidence, and maintenance using current asset/token/style/controller sources without invented brand meaning.
- **AC2 — Role precision:** WHEN the dossier discusses warm red, typography, material, or color THEN it SHALL distinguish seal/brand, capture/today intent, and semantic danger/error; constrain display type and glass to their implemented uses; and direct raw colors to `tokens.css` and components to adaptive semantic roles.
- **AC3 — Screen coverage:** WHEN the dossier is checked against the app THEN shell, Today, Capture, Tasks, Notes/editor, Events/mobile Month, Notifications, Settings, dialogs, and system states SHALL each have a concise recipe with correct ownership and behavior invariants.
- **AC4 — Drift prevention:** WHEN an agent uses `jin-visual-language` for a Jin UI change THEN it SHALL be directed to the canonical dossier, the closest style owner, preserved real semantics/state, proportional automated checks, and visual evidence without gaining authority for product/backend changes.
- **AC5 — Review integration:** WHEN `jin-gui-visual-qa` is used for a design-system or drift review THEN it SHALL check dossier fidelity, neighboring-surface regression, responsive/accessibility intent, console/overflow, and the browser/native evidence boundary without forcing a whole-app matrix for every local edit.
- **AC6 — Discoverability:** WHEN a contributor reads `README.md` or `docs/gui-testing.md` THEN the canonical dossier SHALL be directly discoverable and the old `design.md` SHALL not be presented as the normative current product language.
- **AC7 — Lean skill package:** WHEN skill structure is inspected THEN there SHALL be one new self-contained implementation/review skill and one focused extension to the existing QA skill, with no duplicate drift skill, placeholder resources, scripts, assets, UI metadata, or duplicated dossier content.
- **AC8 — Validation:** WHEN documentation work is complete THEN both skills SHALL pass the bundled `quick_validate.py` using the repository's available dependency runtime, Markdown links/relative paths SHALL resolve, `git diff --check` SHALL pass, and an independent review SHALL confirm the dossier matches current code and accepted visual evidence.

## Scope

Expected files:

- `docs/visual-language/README.md`
- `README.md`
- `docs/gui-testing.md`
- `.agents/skills/jin-visual-language/SKILL.md`
- `.agents/skills/jin-gui-visual-qa/SKILL.md`

No product source, CSS, HTML, TypeScript, Rust, tests, fixtures, design assets, `design.md`, agent configuration, plugin metadata, or external memory changes. This change documents and operationalizes the accepted visual system; it does not redesign it.

## Verification

Validate the new and updated skills with:

```bash
/Users/henrique/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/henrique/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/jin-visual-language

/Users/henrique/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/henrique/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/jin-gui-visual-qa
```

Also resolve every new relative link, run `git diff --check`, and compare documented token/stylesheet/route claims against the current files. An independent checker should review for invented doctrine, role conflation, duplicated guidance, stale ownership, excessive prescriptiveness, and missing screen or accessibility coverage.
