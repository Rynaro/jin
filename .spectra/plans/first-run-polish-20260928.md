---
eidolon: ramza
kind: spec
version: 1.0.0
created_at: 2026-09-28T22:38:00Z
target_repos: [jin]
stories_count: 1
validation_gates_count: 5
---
# First-run setup visual finish

## Scope
Intent: CHANGE. Beautify the existing five-step first-run setup and matching storage-recovery presentation. Scope defaults to first-run because it is explicitly named setup in the product; the separate Settings route has its own ongoing changes.
In: presentation in `jin-gui/index.html` setup section and `jin-gui/src/styles/first-run.css`; controller/test edits only for necessary presentation state. Out: new steps, native/backend/storage behavior, Settings route, sidebar/glass, global tokens, invented preview/product state. Preserve all existing unrelated uncommitted changes, especially the remainder of index.html.
RS: trivial (3 estimated files, low stakes); complexity 4/12 standard. One bounded story, 1d, P2; executor Sol Medium with explicit implementation plan.

## Approach
The normative `docs/visual-language/README.md` takes precedence over historical paper/display-type language in the skill. Use neutral adaptive surfaces, system type, blue actions and restrained brand artwork. Warmth comes from the existing koi mark, confident spacing and clear welcoming copy rather than decorative panels.
Baseline observed at http://127.0.0.1:1420, 1280x800: welcome/storage screenshots in `.artifacts/playwright-mcp/first-run-before-{welcome,storage}-1280.png`, zero console warnings/errors. Current rail is 352px and mostly empty; huge serif step headings overlap the watermark; storage combines four unlike actions in one row, including a long absolute path inside a button.
1. Refactor only the opening first-run section in `jin-gui/index.html`. Preserve every `data-first-run-*`, `data-action`, input ID, hidden state, live region, button type and heading tabindex. Preserve the step sequence and exact DTO/persistence contracts.
2. Compose a deliberate desktop split: approximately 17rem contextual brand/progress rail and flexible main field. Place existing `/jin-logo.png` artwork within a bounded lower brand region; remove giant artwork behind working controls. Retain a Jin wordmark and quiet introductory line. No new image generation, dependency, fake application preview, floating cards or gradients. Brand image can be decorative with empty alt. Native top safe spacing must use existing platform hooks if necessary without touching native shell code.
3. Make progress legible: retain the ordered list, its aria-current and is-current/is-complete hooks; add small numbered markers and concise labels (Welcome, Storage, Essentials, Appearance, Review; keep internal functions/settings values). Current and completed states differ through shape/text as well as color; rail is progress, not newly interactive navigation. Ensure no empty five-step scaffold remains conspicuous in recovery.
4. Give main content a stable readable measure around 42rem with generous gutters and system-font headings around 2.25–2.75rem at baseline. Welcome may retain prominent branding, while instructional headings stay concise: welcome, choose storage, learn essentials, choose appearance, review. Avoid fixed heights. Shared supporting copy stays around body size with readable contrast. Preserve focus transfer; do not blanket-remove focus outlines.
5. Storage becomes an explicit selected-folder field (visible label plus existing live target), followed by suggested-folder information with its path outside the button. Keep the suggested span hook; button label becomes concise `Use suggested folder`. Put `Choose folder…` and suggested action beside their folder information. Separate these actions from the step footer; Back is quiet and Continue uses shared primary style. Do not change when advancing is allowed or imply success before selection.
6. Keep Essentials a continuous five-row list with clear label/description columns, separators and optional small local SVG icons. Avoid lucide placeholders unless initialization exists during setup; normal controllers are intentionally absent. Existing shortcut and product claims remain truthful.
7. Appearance uses an accessible pressed-state segmented group from existing primitives, a labelled slider and a quiet checkbox row. Keep immediate appearance/text scaling and reduce-motion persistence. Review becomes aligned definition rows with path wrapping and comfortable separation; finish and recovery actions share the same footer rhythm. Preserve actual preparing/restarting/error copy from controller.
8. Own the complete cascade in `first-run.css`: consolidate duplicate media rules, consume current semantic colors/action roles; do not alter shared tokens. Compact screens stack the brand/progress above content, reduce/hide decorative artwork, and wrap progress labels with intrinsic sizing. Large text stacks early; controls/path/actions remain reachable at 310% text scale and 320px width. Support manual/system contrast, reduced transparency/motion, dark appearance and forced colors using existing preference hooks; decoration can disappear.

## Acceptance Criteria
### AC-001 (event-driven)
GIVEN a fresh first-run fixture
WHEN Begin setup, a valid folder choice, Continue and Finish are used
THEN the existing five-step flow SHALL complete through its existing command contract.
VERIFY: existing first_run_controller and launch_bootstrap tests plus fixture walkthrough.

### AC-002 (state-driven)
GIVEN first-run setup is displayed at desktop size
THEN the interface SHALL use the specified brand rail and unobstructed system-type content hierarchy.
VERIFY: compare welcome, storage, appearance and review screenshots at 1280x800 against baseline and dossier.

### AC-003 (state-driven)
GIVEN a compact 320px viewport or accessibility text scale
THEN every setup control SHALL remain reachable without horizontal page overflow.
VERIFY: browser geometry checks at 390x844, 320x800 and 760x800 with 310% text scale; inspect long storage path and keyboard focus.

### AC-004 (unwanted-behavior)
GIVEN setup or storage recovery returns a failure
THEN the existing truthful recovery actions SHALL remain visible and legible in the new composition.
VERIFY: fixture picker error/cancel, missing folder guard and root-unavailable states; preserve existing controller tests.

### AC-005 (state-driven)
GIVEN dark appearance, reduced motion/transparency, increased contrast or forced colors
THEN setup content SHALL remain legible with visible focus and non-color state cues.
VERIFY: proportional preference screenshots and computed-style/keyboard inspection; browser results do not certify native Tauri rendering.

## Execution and verification
Run `npm --prefix jin-gui test -- src/__tests__/first_run_controller.test.ts src/__tests__/launch_bootstrap.test.ts`; confirm actual filename before invocation. Run GUI build, `npm --prefix jin-gui run lint:css`, repository applicable visual-token check if present, and `git diff --check`. Existing behavior tests suffice for pure markup/CSS; add a meaningful focused regression only if controller state changes.
Use Playwright MCP fixture by setting localStorage `jin.fixture.firstRun=true`, clearing `jin.fixture.firstRunState`, then reloading. Browser is currently on Storage. Save all evidence under `.artifacts/playwright-mcp/`. Capture accessibility snapshot before visual states, record console warnings/errors, verify all steps plus recovery; inspect neighboring Today after leaving fixture. Keep native platform validation explicitly unverified. No owner-approval pause is needed to finish authorized implementation; do not claim native sign-off.

```json
{"owner":"Vivi","model":"gpt-6-sol","reasoning":"medium","files":["jin-gui/index.html:first-run section only","jin-gui/src/styles/first-run.css"],"conditional_files":["jin-gui/src/controllers/first_run_controller.ts","jin-gui/src/__tests__/first_run_controller.test.ts"],"preserve":["all unrelated working-tree edits","five step and recovery contracts","native sidebar glass"],"verification":["focused existing behavior tests","build","CSS lint","proportional Playwright visual matrix","diff check"],"approval_required":false}
```
