---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-28T11:18:00Z
stories_count: 4
validation_gates_count: 12
---
# ToDo items: compact work, complete context

## Scope

Intent: CHANGE + BUG_SPEC. ATLAS research → RAMZA planning (Astra 6 High) → VIVI implementation (Sol 6 High). This work refines task items, priority/date presentation, completion controls, the existing task inspector, and text-selection leakage during movement. Preserve the accepted Notes/Calendar shell, all current branch work, task/workflow semantics, native command contracts, and draft protections. No dependency, migration, new priority state, calendar scheduling feature, or inspector replacement.

Clarification skipped: the user supplies the desired density, exceptions for usability, examples, and concrete defects. Assumption: due dates retain their existing date-only/time semantics and display timezone; risk if wrong is changing a deadline while merely changing presentation. Existing date helpers remain authoritative. Right-sizing: 12 estimated files, medium stakes → lite (3); complexity 7/12 → extended reasoning. This is a scoped refinement of working primitives, not a new task model.

## Approach

Choose adaptive compact rows (explore score 89): start with one visual line, spend extra height only when content needs it. Keep full task titles readable. Compactness comes from moving real metadata beside the title, shorter date labels, and removing reserved empty space; never from reducing legibility or silently discarding content. Jin keeps its neutral canvas, system face, restrained separators, and blue action language from `docs/visual-language/README.md`.

Research input supplied by ATLAS: [Apple Reminders quick entry](https://support.apple.com/en-ca/guide/reminders/remndc729e28/mac) keeps date/flag close to the item; [Apple priority and Smart Lists](https://support.apple.com/guide/iphone/use-smart-lists-iphe882772ed/27/ios/27) use priority marks and date/priority filtering; [Todoist priority](https://www.todoist.com/help/articles/set-a-priority-in-todoist-Wy82Jp) keeps color meanings consistent; [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) support focus and user agency. Our dimensions and responsive rules below are Jin design decisions, not Apple specifications.

### Row composition

At normal text scale/fine pointer, target a 32px minimum plain row and the existing 15px/20px title rhythm. Use intrinsic height, not a fixed maximum. A short title with priority and date fits one line on a roomy list. Structure: completion target, content region, contextual action/grip. The content region flows title followed by compact metadata (due, priority, existing context/subtask counts), separated by modest 6–8px gaps. Preserve title's useful measure before metadata: when the content region is under roughly 30rem, move metadata below; long titles can wrap at every width. A long unbroken title wraps inside the content region. Do not make metadata compete by shrinking title to a few words.

Align plain, parent, and child completion marks with the first title line. Parent disclosure gets its own small gutter without pushing parent titles off the common text origin. Children inherit one consistent indentation step. Metadata aligns to its own title origin, never under the checkbox. Keep empty metadata containers absent; do not reserve second-line space. Completed titles remain legible; secondary metadata may be quieter without hiding dates, priority, or parent progress. Board cards retain their content-capable layout; share the primitive and metadata language without forcing list density onto Kanban.

### Completion primitive

Use the existing task completion primitive, not a parallel checkbox. Set the visible circle to 16px at standard scale, with a 1.5–2px readable outline and approximately 2.5px rounded tick stroke (optical tuning allowed). Keep a real 28px minimum fine-pointer hit target and 44px coarse-pointer hit target; expand row height accordingly on touch. Unchecked outline is a neutral semantic control stroke; completed fill uses system action blue with a contrasting tick. Focus ring is separate and clearly visible. Disabled/mixed/lifecycle states retain their truthful existing semantics. Do not encode priority in checkbox shape or fill, and do not change Notes checkboxes. Forced colors must retain both outline and check using system roles. Larger text can grow the visual control and row; never clip it.

### Priority

Use a stable text glyph vocabulary: Low `!`, Medium `!!`, High `!!!`; None has no row ornament. Render glyphs with a sturdy system weight and a shared priority helper. Reuse existing semantic priority colors with accessible contrast; if absent, define adaptive roles in tokens. All priority-bearing surfaces share this mapping, including inspector option text. A compact row can show glyph only with accessible name and tooltip `Low priority`, `Medium priority`, or `High priority`; the inspector always exposes full labels (`! Low`, `!! Medium`, `!!! High`). Color reinforces the glyph count. No emoji: platform-varying sizes would reintroduce alignment noise. The glyph is metadata unless an existing edit affordance is wired; do not invent a dead button.

### Due date

For row metadata, use localized Today, Tomorrow, upcoming weekday for dates 2–6 calendar days away, then localized short month/day; include year when it differs from the current year. Past dates use short month/day plus the existing overdue semantic treatment; full accessible label states overdue, exact date, and any stored time. Yesterday may be localized as Yesterday if an existing helper supports it consistently. The accessible name and hover tooltip always include the full unambiguous date. Never strip a stored time or reinterpret a date-only value through UTC; use the existing local/display-timezone date contract and current-date authority. A date due today is not overdue merely because the browser parsed midnight.

All dated row chips open the existing due picker when the callback exists. Keep existing overdue quick-reschedule actions reachable; use one shared picker/menu rather than separate competing date surfaces. If the row has no date, no persistent placeholder wastes space; the inspector and existing creation affordance remain the way to add one. If no edit callback exists, use informative text, not a button. Preserve keyboard activation, Cancel behavior, focus return, and viewport clamping. The inspector displays a fuller date, offers Clear and the existing picker, and does not imply a time block.

### Existing inspector

Improve the current surface at its owning renderer. Header: completion plus readable title, quiet task context, existing close/back and overflow actions. Main field order: title/notes; Timing (Due, existing reminder fields only); Organization (List, Section, Tags, Priority and Board column when supported); Subtasks and existing linked content/actions. Use restrained section labels and one continuous surface with internal field-row alignment. Remove generic stacked cards and unnecessary gaps. Do not add unsupported fields or fake saved status.

At inspector content widths ≥28rem, field rows use a readable label column (about 7rem) plus a flexible value/control column. Below that width or at enlarged text, stack each label above its value. Long values and controls wrap inside the pane. Prefer natural height to nested scrollbars; keep the existing single body scroller and close control accessible. Title/notes editing retains current save/debounce ownership, selection, keyboard shortcuts, pending/rejected-save treatment, and navigation draft protection. Subtask organization remains inherited/disabled with its existing explanation. Destructive actions stay in existing action/menu locations rather than becoming persistent prominent controls.

### Movement without accidental selection

Implement one reusable, lifecycle-bound selection guard for actual user movement. Pointer drag begins after the existing activation threshold; at that moment clear the document's collateral text selection and suppress browser selection for the active gesture. Native HTML drag begins suppression on `dragstart`. Resize/splitter gestures begin suppression only after the owning control actually starts moving. The guard is idempotent/reference-safe and restores prior selection CSS state, not a hard-coded default, on completion/cancellation. Cleanup covers drop, pointerup, pointercancel, lost pointer capture, Escape, window blur, native dragend and route/element teardown. A failed callback cannot leave the application unselectable.

Do not apply permanent `user-select: none` to the page or every task row. Click without crossing the threshold retains normal click behavior and intentional prose selection. Inputs, textareas, contenteditable and editor surfaces remain editable/selectable outside active movement. Interactive controls excluded from drag initiation stay excluded. The guard may temporarily suppress selection globally while a genuine movement is active because the pointer can leave its original element. Existing drag payload, target resolution, parent/child restrictions, whole-card movement, click suppression after drag, keyboard Move and reduced-motion preview remain intact.

ATLAS owners: pointer drag in `lib/tasks/item.ts` and Board wiring in `lib/tasks/render.ts`; native sources in `lib/lists/render.ts`, `lib/notes/render.ts`, and task section headers. Implementation must inventory additional actual app drag/resize owners and wire the same guard there, keeping a call-site checklist in its handoff. Scroll, hover animation, ordinary mouse movement and text editing are not movement gestures for this guard.

## Stories

### S1 — Readable compact task items
As a user, I scan task titles and essential metadata on one line when room permits, with full content available when it does not. Timebox: 1d. Risk: P1. Executor: Sol 6 High / VIVI, goal plus constraints. Owners: `lib/tasks/item.ts`, existing task template, `lib/tasks/completion.ts`, `styles/browse.css`, semantic tokens only when necessary. Adapt existing row/card variants and consolidate owning CSS rather than adding late overrides. Output: compact rows, shared 16px visual completion, stable parent/child alignment, preserved list/board semantics.

### S2 — Priority and dates explain themselves
As a user, I distinguish urgency without color and change a deadline directly where I see it. Timebox: 1d. Risk: P1. Owners: existing task formatting/priority helpers, item renderer and real due callbacks/controller. Output: shared glyph mapping, concise date formatting that preserves semantic date/time, full accessible labels, shared due picker interaction. Do not add new persisted data.

### S3 — A complete, calm inspector
As a user, I can understand and edit a task without a sparse form or navigation workaround. Timebox: 1d. Risk: P1. Owners: `lib/tasks/render.ts` detail rendering/field helpers, `controllers/tasks_controller.ts` only if wiring is necessary, closest `browse.css` field rules. Output: grouped responsive fields, no unused gaps, preserved drafts, save behavior, legal status/column controls and subtask inheritance.

### S4 — Reliable movement across Jin
As a user, I move work or resize a surface without leaving selected text behind. Timebox: 1d. Risk: P1. Owners: shared `lib/ui` movement guard, task pointer/native sources, lists/notes native sources, any discovered existing resize/drag owners, narrow shared CSS. Output: one guard integrated at activation boundaries, complete cleanup, call-site inventory, focused behavior coverage. Parent/child placement, exact Board lane identity and note content remain unchanged by presentation work.

## Acceptance Criteria

The atomic, frozen criteria are in `todo-item-density.criteria.md`. They cover density, content preservation, checkbox targets, priority, date semantics/interaction, inspector drafts, responsive states, pointer/native movement and selection restoration. Product verification belongs to the implementer/root; this plan records no product test execution.

## Confidence

Computed with RAMZA: pattern match 90, requirement clarity 96, decomposition stability 90, constraint compliance 96 → 93% AUTO_PROCEED. Presentation has known owners and primitives. The highest risk is global gesture cleanup; focus meaningful behavior checks there and preserve ordinary text selection.

## Rejected Alternatives

Conservative two-line rows scored 80.5: safe and cheap, but preserve the main visual waste in the user's screenshot. Progressive row expansion scored 76: saves pixels by hiding metadata until focus/selection, but makes scanning and deadline discovery inconsistent and adds another stateful editor. Forced single-line ellipsis is rejected because it conceals task purpose and is directly contrary to the user's usability exception. Emoji priority is rejected for platform-dependent alignment; sturdy exclamation marks give consistent shape and accessible verbal labels.

## Risks

Date shortening can introduce timezone/day-boundary mistakes; reuse current authority and exercise representative boundaries. Completion changes can leak into Notes; scope task primitive carefully. Inspector regrouping can lose field/callback state; reuse field builders and keep existing lifecycle regression coverage. Gesture guards can trap selection or suppress valid editing; activate only on genuine movement and test every cleanup path. Native WebView selection timing remains a native smoke check after browser evidence.

## Handoff

VIVI / Sol 6 High is the sole product writer and is not alone in the branch. Preserve others' edits. Implement S1 and S2 together, S3 next, then S4; early shared-guard work may proceed independently after call-site inventory. Run focused behavior checks for changed interactions, required style/build checks, and browser evidence at 1440, 760, 390 and 320 CSS pixels plus accessibility scale 3.1. Include light/dark, forced colors, coarse pointer and reduced motion where they alter these components. Native browser evidence is not native Tauri verification. Report exact commands/results, screenshots, selection guard call sites, and remaining native checks without claiming owner visual sign-off.
