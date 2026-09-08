/** Static guards for the Continuous Ink Workspace contract. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Continuous Ink Workspace', () => {
  const tokens = read('../styles/tokens.css');
  const components = read('../styles/components.css');
  const navigation = read('../styles/navigation.css');
  const typography = read('../styles/typography.css');
  const today = read('../styles/today.css');
  const forms = read('../styles/forms.css');
  const browse = read('../styles/browse.css');
  const calendar = read('../styles/calendar.css');
  const indexCss = read('../styles/index.css');
  const markup = read('../../index.html');
  const noteRenderer = read('../lib/notes/render.ts');
  const listRenderer = read('../lib/lists/render.ts');
  const taskRenderer = read('../lib/tasks/item.ts');
  const taskDetailRenderer = read('../lib/tasks/render.ts');
  const taskController = read('../controllers/tasks_controller.ts');
  const notesController = read('../controllers/notes_controller.ts');
  const spacing = read('../styles/spacing.css');
  const settings = read('../styles/settings.css');
  const a11y = read('../styles/a11y.css');

  it('publishes the continuous workspace geometry and semantic surface tokens', () => {
    for (const contract of [
      '--app-rail-width: 184px',
      '--app-rail-collapsed-width: 52px',
      '--navigation-rail-width: var(--app-rail-width)',
      '--context-rail-width: var(--navigation-rail-width)',
      '--toolbar-height: 40px',
      '--control-height: 28px',
      '--control-height-prominent: 32px',
      '--desktop-hit-target: 28px',
      '--coarse-hit-target: 44px',
      '--icon-size-standard: 15px',
      '--icon-size-small: 13px',
      '--check-visual-size: 16px',
      '--check-mark-size: 12px',
      '--check-hit-size: 28px',
      '--switch-track-width: 32px',
      '--switch-track-height: 20px',
      '--switch-thumb-size: 16px',
      '--rail-row-height: 32px',
      '--task-row-height: 40px',
      '--note-row-height: 68px',
      '--reading-width: 760px',
      '--workspace-canvas',
      '--workspace-chrome',
      '--workspace-row-selected',
      '--ink-stroke',
      '--ink-bleed',
      '--ink-on',
      '--display-title-size: 1.5rem',
      '--document-title-size: 1.5rem',
      '--editor-text-size: 1rem',
    ]) {
      expect(tokens).toContain(contract);
    }
  });

  it('uses the display voice only for prominent identity and title surfaces', () => {
    expect(typography).toContain('.text-display-title');
    expect(typography).toContain('font-family: var(--font-display)');
    expect(today).toMatch(/\.today-date-nav__label \{[\s\S]*?font-family: var\(--font-display\);/);
    expect(settings).toMatch(/\.settings-view__heading \{[\s\S]*?font-family: var\(--font-display\);/);
    expect(forms).toMatch(/\.action-dialog__title \{[\s\S]*?font-family: var\(--font-display\);/);
    expect(browse).toMatch(/\.notes-detail-pane \.browse-detail__title--input\.jin-title-field \{[\s\S]*?font-family: var\(--font-display\);/);
    expect(browse).toMatch(/\.notes-detail-pane \.cm-content \{[\s\S]*?font-size: var\(--editor-text-size\);/);
  });

  it('keeps artistic marks pointer inert and exposes high-contrast fallbacks', () => {
    expect(components).toContain('.jin-section-header::after');
    expect(components).toMatch(/\.tasks-board__column-header::after \{[\s\S]*?pointer-events: none;/);
    expect(navigation).toMatch(/\.jin-navigation-row\.jin-nav-item--active::before,[\s\S]*?pointer-events: none;/);
    expect(components).toContain('.today-section__heading::after');
    expect(a11y).toContain('@media (forced-colors: active)');
    expect(a11y).toContain('.jin-section-header::after');
    for (const selector of [
      '.jin-navigation-row[aria-current="page"]::before',
      '[role="treeitem"][aria-selected="true"] > .jin-navigation-row::before',
    ]) {
      expect(a11y.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it('exports the new primitives and gives accessibility the final cascade position', () => {
    for (const primitive of [
      '.jin-chrome', '.jin-split-view', '.jin-context-rail', '.jin-workspace-pane',
      '.jin-toolbar-strip', '.jin-control', '.jin-control--icon',
      '.jin-control--primary', '.jin-control--secondary', '.jin-control--danger',
      '.jin-list', '.jin-list-row', '.jin-section-header',
      '.jin-badge', '.jin-title-field', '.jin-empty-state',
      '.jin-check', '.jin-checkbox', '.jin-switch', '.jin-range',
    ]) {
      expect(components).toContain(primitive);
    }
    for (const primitive of [
      '.jin-navigation-rail', '.jin-navigation-list', '.jin-navigation-row',
      '.jin-navigation-row__icon', '.jin-navigation-row__label',
      '.jin-navigation-row__meta', '.jin-navigation-row__actions',
      '.jin-navigation-list--inset', '.jin-navigation-row--inset',
      '.jin-navigation-row--tree', '.jin-navigation-row--actions',
    ]) expect(navigation).toContain(primitive);
    const imports = [...indexCss.matchAll(/@import\s+'\.\/([^']+)'/g)].map((match) => match[1]);
    expect(imports.indexOf('navigation.css')).toBe(imports.indexOf('components.css') + 1);
    expect(imports.at(-1)).toBe('a11y.css');
  });

  it('centralizes the shared navigation anatomy and limits it to navigation consumers', () => {
    expect(navigation).toMatch(/\.jin-navigation-rail \{[\s\S]*?inline-size: var\(--navigation-rail-width\);/);
    expect(navigation).toMatch(/\.jin-navigation-rail \{[\s\S]*?border: 0;[\s\S]*?border-inline-end: 0\.5px solid var\(--separator\);/);
    expect(navigation).toMatch(/\.jin-navigation-list\.jin-navigation-list--inset,[\s\S]*?\.jin-navigation-row\.jin-navigation-row--inset \{[\s\S]*?inline-size: calc\(100% - var\(--space-2\)\);[\s\S]*?margin-inline: var\(--space-1\);/);
    expect(navigation).toMatch(/\.jin-navigation-row \{[\s\S]*?gap: var\(--space-1\);[\s\S]*?min-block-size: var\(--rail-row-height\);[\s\S]*?padding: 0 10px;[\s\S]*?border-radius: var\(--radius-sm\);[\s\S]*?font-size: var\(--text-footnote-size\);[\s\S]*?line-height: var\(--text-footnote-line\);/);
    expect(navigation).toMatch(/\.jin-navigation-row__label \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
    expect(navigation).toMatch(/\.jin-navigation-row--tree \{[\s\S]*?var\(--tree-depth, 0\)/);
    expect(navigation).toMatch(/\.jin-navigation-row--actions > \.jin-navigation-row__actions \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
    expect(navigation).toMatch(/@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?opacity: 1;[\s\S]*?var\(--coarse-hit-target\);/);
    for (const feature of [components, browse, settings]) {
      expect(feature).not.toMatch(/\.jin-navigation-row \{/);
      expect(feature).not.toMatch(/\.jin-navigation-row\[aria-current="page"\]::before/);
      expect(feature).not.toMatch(/\.jin-navigation-rail \{/);
    }

    const tasksRailBlock = browse.match(/\.tasks-lists-rail \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(tasksRailBlock).not.toMatch(/(?:^|[;\s])(?:width|inline-size|flex|flex-basis|border|border-inline-end)\s*:/);

    expect(markup.match(/jin-nav-item jin-navigation-row tap-target/g)?.length).toBeGreaterThanOrEqual(5);
    expect(markup).toContain('settings-nav__items jin-navigation-list');
    expect(markup).toContain('notes-folder-rail__list jin-navigation-list jin-navigation-list--inset');
    expect(markup).toContain('notes-collection-row jin-navigation-row jin-navigation-row--inset');
    expect(markup).toContain('notes-collections__list jin-navigation-list jin-navigation-list--inset');
    expect(markup).toContain('folder-row__btn jin-navigation-row jin-navigation-row--tree');
    expect(listRenderer).toContain('lists-rail__row lists-rail__row--smart jin-navigation-row');
    expect(listRenderer).toContain('jin-navigation-row jin-navigation-row--actions');
    expect(markup).toContain('tasks-lists-rail__smart-list jin-navigation-list jin-navigation-list--inset');
    expect(markup).toContain('tasks-lists-rail__list jin-navigation-list jin-navigation-list--inset');
    expect(notesController).toContain("select.className = 'notes-collection-row jin-navigation-row'");

    expect(noteRenderer).not.toContain('jin-navigation-row');
    expect(taskRenderer).not.toContain('jin-navigation-row');
    expect(markup).not.toMatch(/browse-row__inner[^"\n]*jin-navigation-row/);
    expect(markup).not.toMatch(/notification-center__row[^"\n]*jin-navigation-row/);
  });

  it('fully migrates Notes and representative Tasks surfaces without replacing hooks', () => {
    expect(markup).toContain('notes-paned jin-split-view');
    expect(markup).toContain('notes-folder-rail jin-context-rail');
    expect(markup).toContain('notes-list-pane jin-workspace-pane');
    expect(markup).toContain('folder-row__btn jin-navigation-row jin-navigation-row--tree');
    expect(markup).toContain('browse-row__inner jin-list-row tap-target');
    expect(markup).toContain('tasks-lists-rail jin-context-rail');
    expect(markup).toContain('tasks-main jin-workspace-pane');
    expect(noteRenderer).toContain('browse-detail__title--input jin-title-field');
    expect(listRenderer).toContain('lists-rail__row jin-navigation-row jin-navigation-row--actions');
    expect(taskRenderer).toContain("item.classList.add('jin-list-row')");
  });

  it('keeps ledger anatomy stable while allowing Tasks rows to grow with meaning', () => {
    expect(navigation).toContain('grid-template-columns: 14px var(--icon-size-standard) minmax(0, 1fr) auto var(--control-height)');
    expect(browse).toContain('grid-template-columns: 20px 40px minmax(0, 1fr) auto 40px');
    expect(browse).toContain('height: auto;');
    expect(browse).toContain('max-height: none;');
    expect(browse).toContain('min-block-size: var(--note-row-height)');
    expect(browse).toContain('max-block-size: none;');
    expect(browse).toContain('width: min(100%, var(--reading-width))');
    expect(browse).toContain('font-size: var(--document-title-size)');
    expect(browse).toContain('visibility: hidden');
    expect(browse).toContain('opacity: 0');
  });

  it('preserves a usable title track and wraps task metadata beneath it in split states', () => {
    expect(browse).toContain('grid-template-columns: 20px 40px minmax(0, 1fr) auto 40px');
    expect(browse).toMatch(/\.task-item--row \.task-item__content \{[\s\S]*?flex-direction: column;/);
    expect(browse).toMatch(/\.task-item--row \.task-item__title \{[\s\S]*?width: 100%;/);
    expect(browse).toMatch(/\.task-item--row \.task-item__title \{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/);
    expect(browse).toMatch(/\.task-item--row \.task-item__meta \{[\s\S]*?max-width: none;[\s\S]*?flex-wrap: wrap;[\s\S]*?overflow: visible;/);
  });

  it('keeps quick-reschedule controls pointer-aware after calendar composition', () => {
    expect(calendar).toMatch(/\.due-reschedule__btn \{[^}]*min-block-size: var\(--desktop-hit-target\);/);
    expect(calendar).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.due-reschedule__btn \{[\s\S]*?min-block-size: var\(--coarse-hit-target\);/);
    expect(calendar).not.toMatch(/\.due-reschedule__btn \{[^}]*min-block-size: auto;/);
  });

  it('uses sparse ink marks and provides empty-state marks for Notes and Tasks', () => {
    expect(components).toContain('.jin-section-header::after');
    expect(components).toContain('background: var(--ink-stroke)');
    expect(markup.match(/class="jin-empty-state__ink"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('retires the failed island/paper/ambient prototype', () => {
    const all = [tokens, components, browse, markup, noteRenderer, a11y].join('\n');
    for (const retired of [
      'jin-row-island', 'jin-ambient-canvas', 'jin-surface--washi',
      '--water-ambient', '--water-glow', '--betta-glow', '--paper-fiber', '--paper-glow',
      '173px',
    ]) {
      expect(all).not.toContain(retired);
    }
  });

  it('removes blur under reduced transparency without boxing contrast rows', () => {
    expect(a11y).toContain('[data-reduce-transparency="1"] .jin-chrome');
    expect(a11y).toContain('backdrop-filter: none !important');
    expect(a11y).not.toContain('[data-increase-contrast="1"] .jin-list-row {');
    expect(a11y).not.toContain('[data-increase-contrast="1"] .jin-rail-row {');
  });

  it('decouples compact painted controls from pointer-sized wrappers', () => {
    expect(spacing).toMatch(/\.tap-target \{\s*min-block-size: var\(--hit-target\);\s*min-inline-size: var\(--hit-target\);\s*\}/);
    expect(components).toMatch(/\.jin-check::before \{[\s\S]*?width: var\(--check-visual-size\);[\s\S]*?height: var\(--check-visual-size\);/);
    expect(components).toMatch(/\.jin-switch__track \{[\s\S]*?width: var\(--switch-track-width\);[\s\S]*?height: var\(--switch-track-height\);/);
    expect(components).toMatch(/\.jin-switch__track::after \{[\s\S]*?width: var\(--switch-thumb-size\);[\s\S]*?height: var\(--switch-thumb-size\);/);
    expect(markup).not.toMatch(/<(?:input|select|textarea)[^>]*class="[^"]*tap-target/);
  });

  it('uses ink for primary actions and lets native switches own their hit area', () => {
    expect(components).toMatch(/\.jin-control--primary,[\s\S]*?background: var\(--ink-primary\);/);
    expect(forms).toMatch(/\.btn-primary,[\s\S]*?background: var\(--ink-primary\);/);
    expect(forms).toMatch(/\.btn-danger,[\s\S]*?background: var\(--seal\);/);
    expect(components).toMatch(/\.jin-switch > input \{[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?opacity: 0;/);
    expect(components).toMatch(/\.jin-switch__track \{[\s\S]*?pointer-events: none;/);
    expect(calendar).toMatch(/\[data-state="selected"\] \{[\s\S]*?color: var\(--ink-on\);/);
    expect(a11y).toContain(':root[data-text-scale="accessibility"]');
  });

  it('keeps AX Settings content inside the viewport and destructive hooks sealed', () => {
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.settings-view \{[\s\S]*?overflow: visible;/);
    expect(settings).toMatch(/\.gcp-wizard-step__instructions,[\s\S]*?min-inline-size: 0;/);
    expect(settings).toMatch(/overflow-wrap: anywhere;/);
    expect(settings).toMatch(/\.sync-summary__grid \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\);/);
    expect(markup).toContain('class="btn-danger jin-control jin-control--danger"');
    expect(markup).not.toContain('class="btn-primary jin-control jin-control--danger"');
    expect(markup).toContain('data-action="click->notes#confirmDeleteFolder"');
  });

  it('keeps Settings hooks native while skinning their wrappers', () => {
    for (const id of [
      'reduce-transparency-toggle',
      'increase-contrast-toggle',
      'reduce-motion-toggle',
      'text-size-range',
    ]) expect(markup).toContain(`id="${id}"`);
    expect(markup.match(/class="jin-switch"/g)).toHaveLength(3);
    expect(markup).toContain('class="jin-checkbox__mark"');
    expect(markup).toContain('class="jin-range"');
    expect(settings).toMatch(/\.settings-section \{[\s\S]*?background: var\(--bg-secondary\);[\s\S]*?border: 0\.5px solid var\(--separator\);/);
  });

  it('composes Settings as a persistent four-pane split view', () => {
    expect(markup).toContain('settings-view jin-split-view');
    expect(markup).toContain('settings-nav jin-context-rail');
    expect(markup).toContain('settings-workspace jin-workspace-pane');
    expect(settings).toContain('grid-template-columns: var(--context-rail-width) minmax(0, 1fr)');

    const labels = ['General', 'Calendars &amp; Sync', 'Notifications', 'Data &amp; Storage'];
    const offsets = labels.map(label => markup.indexOf(`>${label}</span></button>`));
    expect(offsets.every(offset => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(markup.match(/data-settings-target="settingsPane"/g)).toHaveLength(4);
    expect(markup.match(/data-settings-target="settingsNavItem"/g)).toHaveLength(4);
    expect(markup.match(/data-settings-target="settingsWorkspace"/g)).toHaveLength(1);
    expect(markup.match(/class="settings-nav__item jin-nav-item jin-navigation-row tap-target"/g)).toHaveLength(4);
    expect(markup).not.toMatch(/class="settings-nav__item jin-rail-row tap-target"/);
    expect(markup).not.toContain('<aside class="settings-nav');
    expect(markup.match(/<nav class="settings-nav__items jin-navigation-list" aria-label="Settings categories">/g)).toHaveLength(1);
    expect(settings).toMatch(/\.settings-nav \{[\s\S]*?padding: var\(--space-3\) var\(--space-1\);/);
    expect(navigation).toMatch(/\.jin-navigation-list \{[\s\S]*?gap: 0;/);
    expect(navigation).toMatch(/\.jin-navigation-row \{[\s\S]*?min-block-size: var\(--rail-row-height\);/);
    expect(navigation).toMatch(/\.jin-navigation-row\[aria-current="page"\]::before,[\s\S]*?inline-size: 3px;/);
    expect(settings).not.toContain('.settings-nav__item[aria-current="page"]::before');
    expect(settings).not.toMatch(/\.settings-nav__item\.is-active,[\s\S]*?background:/);
  });

  it('preserves the complete behavior-bearing Settings hook inventory', () => {
    for (const target of [
      'syncBtn', 'syncLoadingState', 'syncResultDisplay', 'syncPulled', 'syncPushed',
      'syncConflicts', 'syncResolved', 'syncStatus', 'syncAuditLink', 'syncResolvedNotice',
      'syncError', 'exportDestInput', 'exportForceToggle', 'exportBtn', 'exportLoadingState',
      'exportResultDisplay', 'exportFileCount', 'exportDestDisplay', 'exportAuditIncluded',
      'exportError', 'infoRootPath', 'infoDisplayTz', 'infoCalendarId', 'infoSchemaVersion',
      'changeStoreFolderBtn', 'changeStoreFolderStatus', 'appearanceLight', 'appearanceDark',
      'appearanceAuto', 'reduceTransparencyToggle', 'increaseContrastToggle',
      'reduceMotionToggle', 'textSizeRange', 'eventLocaleSelect', 'jinCalendarColorPicker',
      'googleAccountsList', 'googleAccountAliasInput', 'googleAccountsError',
      'quarantinedOperationsList', 'quarantinedOperationsError', 'notificationLoading',
      'notificationStatus', 'notificationReason', 'notificationAllowBtn',
      'notificationSettingsBtn', 'notificationTestBtn', 'notificationCheckBtn',
      'notificationResult', 'notificationError',
    ]) expect(markup).toContain(`data-settings-target="${target}"`);

    for (const id of [
      'export-dest', 'event-locale-select', 'appearance-mode-label', 'text-size-label',
      'text-size-range', 'reduce-transparency-label', 'reduce-transparency-toggle',
      'increase-contrast-label', 'increase-contrast-toggle', 'reduce-motion-label',
      'reduce-motion-toggle',
    ]) expect(markup).toContain(`id="${id}"`);

    for (const action of [
      'click->settings#addGoogleAccount', 'click->settings#runSync',
      'click->settings#allowNotifications', 'click->settings#openNotificationSettings',
      'click->settings#sendTestNotification', 'click->settings#checkNotificationStatus',
      'click->settings#submitExport', 'click->settings#changeStoreFolder',
      'change->settings#changeEventLocale', 'click->appearance#setLight',
      'click->appearance#setDark', 'click->appearance#setAuto',
      'input->appearance#setTextSize', 'change->appearance#toggleReduceTransparency',
      'change->appearance#toggleIncreaseContrast', 'change->appearance#toggleReduceMotion',
    ]) expect(markup).toContain(`data-action="${action}"`);
  });

  it('keeps Settings hierarchy responsive, contained, and diagnostics collapsed', () => {
    expect(markup).toMatch(/data-settings-pane-key="calendars"[\s\S]*?Google calendar accounts[\s\S]*?Quarantined calendar changes[\s\S]*?aria-label="Sync"/);
    expect(markup).toMatch(/<details class="settings-section settings-diagnostics">[\s\S]*?infoDisplayTz[\s\S]*?infoCalendarId[\s\S]*?infoSchemaVersion/);
    expect(settings).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.settings-view\.jin-split-view \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.settings-nav__items \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: var\(--space-1\);[\s\S]*?overflow-x: visible;/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.settings-nav__item > \.jin-navigation-row__label \{[\s\S]*?overflow: visible;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/);
    expect(settings).toMatch(/\.settings-pane,\s*\.settings-section,[\s\S]*?\.google-account-card,[\s\S]*?min-inline-size: 0;/);
    expect(settings).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.settings-nav__item:focus-visible \{[\s\S]*?outline: 0;[\s\S]*?box-shadow: inset 0 0 0 2px var\(--accent\);/);
    expect(settings).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.appearance-mode-group \{[\s\S]*?inline-size: 100%;[\s\S]*?max-inline-size: 100%;/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.appearance-mode-group \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.appearance-mode-btn \{[\s\S]*?inline-size: 100%;[\s\S]*?justify-content: flex-start;[\s\S]*?white-space: normal;/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.settings-view :is\([\s\S]*?\.settings-pane__title,[\s\S]*?\.settings-section__heading,[\s\S]*?overflow-wrap: anywhere;/);
    expect(a11y).toMatch(/@media \(forced-colors: active\) \{[\s\S]*?\.jin-navigation-row\[aria-current="page"\]::before,[\s\S]*?background: Highlight;/);
    expect(settings).toMatch(/@media \(forced-colors: active\) \{[\s\S]*?\.settings-nav__item:focus-visible \{[\s\S]*?outline-offset: -2px;/);
  });

  it('owns Settings scrolling by mode without moving the desktop rail', () => {
    expect(settings).toMatch(/\[data-section-name="settings"\]\.jin-content-body \{[\s\S]*?block-size: 100%;[\s\S]*?overflow-y: hidden;/);
    expect(settings).toMatch(/\.settings-view \{[\s\S]*?block-size: 100%;[\s\S]*?max-block-size: 100%;[\s\S]*?overflow: hidden;/);
    expect(settings).toMatch(/\.settings-nav \{[\s\S]*?position: static;[\s\S]*?align-self: stretch;[\s\S]*?block-size: 100%;/);
    expect(settings).toMatch(/\.settings-workspace \{[\s\S]*?min-block-size: 0;[\s\S]*?overflow-y: auto;/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \[data-section-name="settings"\]\.jin-content-body \{[\s\S]*?block-size: auto;[\s\S]*?overflow-y: auto;/);
    expect(settings).toMatch(/:root\[data-text-scale="accessibility"\] \.settings-workspace \{[\s\S]*?overflow-y: visible;/);
    expect(settings).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\[data-section-name="settings"\]\.jin-content-body \{[\s\S]*?overflow-y: auto;[\s\S]*?\.settings-workspace \{[\s\S]*?overflow-y: visible;/);
  });

  it('keeps task checks compact and clears stale detail before a scope reload', () => {
    expect(markup).toContain('task-item__checkbox jin-check tap-target');
    expect(taskRenderer).toContain("statusBtnEl.classList.add('jin-check')");
    expect(taskDetailRenderer).toContain("task-detail__subtask-status jin-check tap-target");
    expect(taskController).toMatch(/setScope\(event: Event\): void \{[\s\S]*?this\.selectedTaskId = null;[\s\S]*?this\.selectedTaskIds\.clear\(\);[\s\S]*?this\.selectionAnchorId = null;[\s\S]*?this\.setDetailOpen\(false\);[\s\S]*?this\.detailContentTarget\.replaceChildren\(\);[\s\S]*?this\.currentScope = ce\.detail\.scope;/);
    expect(browse).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.task-detail__subtask-status\.jin-check,[\s\S]*?min-width: var\(--coarse-hit-target\);[\s\S]*?min-height: var\(--coarse-hit-target\);/);
  });

  it('keeps rescheduling reachable without clipping task metadata', () => {
    expect(browse).toMatch(/\.task-item--row \.task-item__content,[\s\S]*?\.task-item--row \.due-chip-group \{[\s\S]*?overflow: visible;/);
    expect(browse).toMatch(/\.task-item--row \.task-item__meta \{[\s\S]*?overflow: visible;/);
    expect(browse).toMatch(/\.task-item--row \.task-item__tags \{[\s\S]*?overflow: visible;/);
    expect(calendar).toMatch(/\.due-reschedule \{[\s\S]*?position: absolute;[\s\S]*?visibility: hidden;/);
    expect(calendar).toContain('.due-chip-group[data-open="true"] .due-reschedule');
    expect(calendar).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/);
    expect(calendar).not.toContain('.due-chip-group:focus-within .due-reschedule');
  });

  it('contains the folder glyph whether Lucide hydrates the root or a descendant', () => {
    expect(markup).toContain('folder-row__icon jin-navigation-row__icon');
    expect(navigation).toMatch(/\.jin-navigation-row__icon \{[\s\S]*?inline-size: var\(--icon-size-standard\);/);
  });

  it('keeps Notes scope identity, adaptive ink roles, and content-sized rows in the real surface', () => {
    expect(markup).toContain('class="notes-workspace-title" data-notes-target="scopeTitle">All Notes</h1>');
    expect(markup.match(/<h1\b/g)?.length).toBeGreaterThanOrEqual(1);
    expect(notesController).toContain('private updateScopeTitle(): void');
    expect(notesController).toContain("this.scopeTitleTarget.textContent = this.currentFolder || 'All Notes';");
    expect(notesController).toContain('collection?.name ?? \'All Notes\'');
    for (const token of ['--notes-selected-wash', '--notes-selected-edge', '--notes-editor-paper', '--notes-meta']) {
      expect(tokens).toContain(token);
    }
    expect(browse).toMatch(/\.note-row \.browse-row__inner\.jin-list-row \{[\s\S]*?max-block-size: none;[\s\S]*?overflow: visible;/);
    expect(a11y).toContain(':root[data-text-scale="accessibility"] .note-row .browse-row__inner.jin-list-row');
    expect(a11y).toContain('.notes-paned:not(.rail-collapsed) .notes-folder-rail');
    expect(a11y).toMatch(/@media \(min-width: 641px\) \{[\s\S]*?\.notes-paned\.rail-collapsed \.notes-folder-rail \{[\s\S]*?display: none;[\s\S]*?\.notes-paned\.rail-collapsed :is\(\.notes-list-pane, \.notes-detail-pane\) \{[\s\S]*?grid-column: 2;/);
  });

  it('makes the editor one adaptive writing surface with editorial measure and AX reflow', () => {
    for (const token of [
      '--notes-writing-paper:', '--notes-writing-ink:', '--notes-toolbar-wash:',
      '--notes-selection-tint:', '--notes-quote-rule:', '--notes-code-wash:',
      '--notes-prose-measure: 66ch', '--notes-prose-size: 1.125rem', '--notes-prose-line: 1.7',
    ]) expect(tokens).toContain(token);

    expect(browse).toMatch(/\.notes-detail-pane,\n\.notes-detail-pane \.note-detail__body,[\s\S]*?background: var\(--notes-writing-paper\);/);
    expect(browse).toMatch(/\.notes-detail-pane \.cm-content \{[\s\S]*?font-size: var\(--notes-prose-size\);[\s\S]*?line-height: var\(--notes-prose-line\);/);
    expect(browse).toMatch(/\.notes-detail-pane \.cm-reading-wrapper \{[\s\S]*?font-size: var\(--notes-prose-size\);[\s\S]*?line-height: var\(--notes-prose-line\);/);
    expect(browse).toMatch(/\.notes-detail-pane \.browse-detail__title--input\.jin-title-field:focus-visible \{[\s\S]*?border-bottom-color: var\(--notes-focus-tint\);/);
    expect(browse).toContain('.cm-toolbar__group');
    expect(browse).not.toMatch(/\.notes-detail-pane \.cm-editor-wrapper \{[^}]*border-radius:/);
    expect(a11y).toContain('.notes-detail-pane .cm-toolbar__group');
    expect(a11y).toContain('.notes-detail-pane .cm-toolbar__status[data-save-state="failed"]');
    expect(browse).toContain(':root[data-text-scale="accessibility"] .notes-detail-pane .cm-toolbar');
    expect(a11y).toMatch(/:root\[data-text-scale="accessibility"\] \.notes-detail-pane \{[\s\S]*?overflow-y: auto;/);
    expect(a11y).toMatch(/:root\[data-text-scale="accessibility"\] \.notes-detail-pane \[data-notes-target="detailContent"\],[\s\S]*?\.cm-scroll-region \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-block-size: min-content;/);
    expect(browse).toMatch(/:root\[data-text-scale="accessibility"\] \.notes-detail-pane \.cm-footer \{[\s\S]*?flex-basis: auto;/);
  });
});
