/**
 * Isolated production-bundle workflow for the Notes writing surface.
 *
 * This intentionally owns a fresh browser context so the editor's selection,
 * autosave, dialogs, and compact disclosure cannot inherit state from the
 * broad workspace smoke.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUI_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = join(GUI_ROOT, 'dist');
const ORIGIN = 'http://127.0.0.1:1420';
const ARTIFACT_ROOT = join(GUI_ROOT, '..', '.artifacts', 'playwright-mcp', 'ui-ux-overhaul', 'notes-overhaul', 'notes-writing-surface-failures');
const SUCCESS_ARTIFACT = join(GUI_ROOT, '..', '.artifacts', 'playwright-mcp', 'ui-ux-overhaul', 'notes-overhaul', 'notes-writing-surface-last-run.json');
const MIME = new Map([['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2']]);

await stat(join(DIST_ROOT, 'index.html')).catch(() => { throw new Error('dist/index.html is missing; run `npm run build` first'); });

async function findInstalledHeadlessShell() {
  const configured = chromium.executablePath();
  if (await stat(configured).then(() => true).catch(() => false)) return configured;
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  const candidates = (await readdir(cacheRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const candidate of candidates) for (const platformDir of await readdir(join(cacheRoot, candidate.name), { withFileTypes: true })) {
    const executable = join(cacheRoot, candidate.name, platformDir.name, process.platform === 'win32' ? 'headless_shell.exe' : 'chrome-headless-shell');
    if (await stat(executable).then(() => true).catch(() => false)) return executable;
  }
  throw new Error('Playwright Chromium is not installed; run `npx playwright install chromium`');
}

async function fulfillDist(route) {
  const requestUrl = new URL(route.request().url());
  const relative = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
  const filePath = normalize(join(DIST_ROOT, relative));
  if (!filePath.startsWith(`${DIST_ROOT}/`) && filePath !== join(DIST_ROOT, 'index.html')) return route.abort('blockedbyclient');
  try { await route.fulfill({ status: 200, contentType: MIME.get(extname(filePath)) ?? 'application/octet-stream', body: await readFile(filePath) }); }
  catch { await route.fulfill({ status: 404, body: 'Not found' }); }
}

async function captureFailure(page, error, consoleErrors) {
  const directory = join(ARTIFACT_ROOT, `${Date.now()}-${process.pid}`);
  await mkdir(directory, { recursive: true });
  const evidence = { error: error instanceof Error ? error.stack ?? error.message : String(error), url: page.url(), consoleErrors, visibleControls: [] };
  try { await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }); } catch (captureError) { evidence.screenshotError = String(captureError); }
  try { evidence.visibleControls = await page.locator('button:visible, summary:visible, input:visible, [role="button"]:visible').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '', tag: element.tagName.toLowerCase() })).filter(({ name }) => name)); } catch (captureError) { evidence.controlError = String(captureError); }
  await writeFile(join(directory, 'failure.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}

async function openFixtureNote(page) {
  await navigateTo(page, 'Notes');
  const back = page.locator('.notes-detail-pane .browse-back-btn');
  if (await back.isVisible()) await back.click();
  const row = page.locator('.browse-row__inner[data-note-id="n1"]');
  await row.waitFor({ state: 'visible' });
  await row.click();
  const editor = page.locator('.notes-detail-pane .cm-content[contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  return editor;
}

async function navigateTo(page, name) {
  await page.waitForFunction(() => {
    const shell = document.querySelector('.jin-shell');
    const expected = window.innerWidth < 960 || document.documentElement.dataset.textScale === 'accessibility' ? 'drawer' : 'desktop';
    return shell?.dataset.navPresentation === expected;
  });
  const shell = page.locator('.jin-shell');
  if (await shell.getAttribute('data-nav-visible') !== 'true') {
    await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.jin-shell')?.dataset.navVisible === 'true');
  }
  const link = page.getByRole('navigation', { name: 'Application navigation', exact: true }).getByRole('link', { name, exact: true });
  await link.waitFor({ state: 'visible' });
  await link.click();
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector('.notes-detail-pane .cm-toolbar');
    const panel = document.querySelector('.cm-toolbar__more-panel');
    return {
      documentClient: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight,
      toolbarClient: toolbar?.clientWidth ?? 0,
      toolbarScroll: toolbar?.scrollWidth ?? 0,
      panel: panel ? (() => { const rect = panel.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; })() : null,
    };
  });
  const toolbarOverflow = await page.locator('.notes-detail-pane .cm-toolbar').evaluate((toolbar) => getComputedStyle(toolbar).overflowX);
  if (metrics.documentScroll > metrics.documentClient + 1 || ['auto', 'scroll'].includes(toolbarOverflow)) throw new Error(`${label} overflowed the writing surface: ${JSON.stringify(metrics)}`);
  if (metrics.panel && (metrics.panel.left < -1 || metrics.panel.right > metrics.documentClient + 1 || metrics.panel.top < -1 || metrics.panel.bottom > metrics.viewportHeight + 1)) throw new Error(`${label} placed More outside the viewport: ${JSON.stringify(metrics)}`);
}

async function verifyEditorWorkflow(page) {
  const editor = await openFixtureNote(page);
  const readDoc = () => page.locator('.notes-detail-pane .note-detail__body').evaluate((body) => {
    const handle = body._cmHandle;
    if (!handle) throw new Error('Notes editor handle is unavailable');
    return handle.getDoc();
  });
  const original = await readDoc();
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await editor.click();
  await page.keyboard.press(`${modifier}+A`);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.waitForFunction((before) => {
    const body = document.querySelector('.notes-detail-pane .note-detail__body');
    const status = document.querySelector('.cm-toolbar__status[data-save-state="saved"]');
    return Boolean(status && body?._cmHandle?.getDoc() !== before);
  }, original);
  if (!(await readDoc()).includes('**')) throw new Error('Bold did not apply to the actual keyboard selection');
  await editor.press(`${modifier}+z`);
  await page.waitForFunction((expected) => document.querySelector('.notes-detail-pane .note-detail__body')?._cmHandle?.getDoc() === expected, original);
  if (await readDoc() !== original) throw new Error('Undo did not restore the authoritative Markdown body');

  await page.getByRole('button', { name: 'Switch to reading mode', exact: true }).click();
  const reading = page.getByRole('region', { name: 'Reading view', exact: true });
  await reading.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await editor.waitFor({ state: 'visible' });

  await page.getByRole('button', { name: 'Insert link', exact: true }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Insert web link', exact: true });
  await linkDialog.waitFor({ state: 'visible' });
  await linkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await linkDialog.waitFor({ state: 'hidden' });
  const linkTrigger = page.getByRole('button', { name: 'Insert link', exact: true });
  if (!(await linkTrigger.evaluate((element) => element === document.activeElement))) throw new Error('Link Cancel did not restore focus to its trigger');

  const historyTrigger = page.getByRole('button', { name: 'Review note history', exact: true });
  await historyTrigger.click();
  const history = page.getByRole('dialog', { name: 'Note history', exact: true });
  await history.getByRole('button', { name: 'Revision 1', exact: true }).click();
  await history.locator('.notes-history__preview h1').first().waitFor({ state: 'visible' });
  await history.locator('.notes-history__status[data-preview-ready="true"]').waitFor({ state: 'visible' });
  await history.locator('.notes-history__footer-close').click();
  await history.waitFor({ state: 'hidden' });
  if (!(await historyTrigger.evaluate((element) => element === document.activeElement))) throw new Error('History close did not restore focus to its trigger');

  const tagsTrigger = page.getByRole('button', { name: /Manage tags/ });
  await tagsTrigger.click();
  const tags = page.locator('.note-detail__tags.is-floating');
  // Adding a tag starts in the app-owned named text field; the adjacent
  // button is intentionally labelled "Add", not "Add tag".
  await tags.getByRole('textbox', { name: 'Add tag', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await tags.waitFor({ state: 'hidden' });
  if (!(await tagsTrigger.evaluate((element) => element === document.activeElement))) throw new Error('Tags Escape did not restore focus to its trigger');

  await page.locator('.notes-detail-pane .browse-back-btn').click();
  await page.locator('.browse-row__inner[data-note-id="n1"]').waitFor({ state: 'visible' });
  await openFixtureNote(page);
  if (await readDoc() !== original) throw new Error('Undo-restored Markdown did not persist after closing and reopening the note');
}

/** Simulate the native overlay contract while retaining real production layout. */
async function verifyHiddenNativeNavigation(page) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => { document.documentElement.dataset.nativeMacosOverlay = 'true'; });
  const editor = await openFixtureNote(page);
  const before = await editor.evaluate((element) => { window.__hiddenSidebarEditor = element; return element.textContent; });
  const hide = page.getByRole('button', { name: 'Hide navigation', exact: true });
  const reveal = page.getByRole('button', { name: 'Show navigation', exact: true });
  await hide.click();
  await page.waitForFunction(() => document.querySelector('.jin-shell')?.dataset.navVisible === 'false');
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing hidden-navigation element ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      library: box('.notes-list-pane'),
      search: box('.notes-list-pane .notes-search'),
      list: box('.notes-explorer__view-button[data-notes-target="listViewButton"]'),
      cards: box('.notes-explorer__view-button[data-notes-target="cardsViewButton"]'),
      detail: box('.notes-detail-pane'),
      back: box('.notes-detail-pane__header .browse-back-btn'),
      titlebar: box('.jin-content-navigation'),
      reveal: box('.jin-navigation-reveal'),
    };
  });
  if (metrics.search.width < metrics.library.width * 0.75
      || Math.abs(metrics.list.y - metrics.cards.y) > 1
      || metrics.back.x - metrics.detail.x > 24
      || metrics.library.y < metrics.titlebar.bottom - 1
      || metrics.detail.y < metrics.titlebar.bottom - 1
      || metrics.reveal.x < 90 || metrics.reveal.height < 36) {
    throw new Error(`Hidden native Notes layout squeezed controls or overlapped window chrome: ${JSON.stringify(metrics)}`);
  }
  await reveal.focus(); await page.keyboard.press('Enter');
  await hide.waitFor({ state: 'visible' });
  await hide.click();
  if (!(await editor.evaluate((element) => element === window.__hiddenSidebarEditor)) || await editor.textContent() !== before) {
    throw new Error('Toggling shared navigation replaced the active Notes editor or its content');
  }

  for (const name of ['Today — agenda view', 'Tasks', 'Notes', 'Calendar', /^Notifications/, 'Settings']) {
    await reveal.click();
    await page.getByRole('navigation', { name: 'Application navigation', exact: true }).getByRole('link', { name, exact: typeof name === 'string' }).click();
    await hide.click();
    const geometry = await page.evaluate(() => {
      const section = [...document.querySelectorAll('[data-section-name]')].find((element) => !element.classList.contains('hidden'));
      const bar = document.querySelector('.jin-content-navigation');
      const drag = document.querySelector('.jin-content-navigation__drag');
      const sectionRect = section?.getBoundingClientRect();
      const barRect = bar?.getBoundingClientRect();
      const dragRect = drag?.getBoundingClientRect();
      return { section: section?.getAttribute('data-section-name'), top: sectionRect?.top ?? -1, barBottom: barRect?.bottom ?? 0, dragWidth: dragRect?.width ?? 0, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    if (geometry.top < geometry.barBottom - 1 || geometry.dragWidth < 100 || geometry.overflow) {
      throw new Error(`Hidden native route did not retain titlebar clearance: ${JSON.stringify(geometry)}`);
    }
    if (geometry.section === 'tasks') {
      const alignment = await page.evaluate(() => {
        const panel = document.querySelector('[data-tasks-target="listPanel"]');
        const header = panel.querySelector('.jin-workspace-header--paired').getBoundingClientRect();
        const list = panel.querySelector('[data-tasks-target="list"]').getBoundingClientRect();
        return { headerLeft: header.left, listLeft: list.left, headerRight: header.right, listRight: list.right };
      });
      if (Math.abs(alignment.headerLeft - alignment.listLeft) > 1 || Math.abs(alignment.headerRight - alignment.listRight) > 1) {
        throw new Error(`Hidden Tasks heading and list use different working widths: ${JSON.stringify(alignment)}`);
      }
    }
    await assertNoHorizontalOverflow(page, `hidden native ${geometry.section}`);
  }
  await reveal.click();
  await page.evaluate(() => { delete document.documentElement.dataset.nativeMacosOverlay; delete window.__hiddenSidebarEditor; });
}

async function verifyCompactDisclosure(page, accessibility) {
  await page.setViewportSize({ width: accessibility ? 320 : 390, height: 844 });
  if (accessibility) {
    await navigateTo(page, 'Settings');
    const slider = page.getByRole('slider', { name: 'Text size', exact: true });
    await slider.focus(); await page.keyboard.press('End');
    if ((await slider.getAttribute('aria-valuetext'))?.includes('310%') !== true) throw new Error('Settings did not set accessibility text scale');
  }
  await openFixtureNote(page);
  // Native <summary> preserves its disclosure keyboard behavior, but its
  // platform accessibility role is not consistently exposed as Button.
  // Scope the real named trigger under the toolbar without inventing a role.
  const more = page.getByRole('toolbar', { name: 'Formatting toolbar', exact: true }).locator('.cm-toolbar__more-trigger[aria-label="More formatting options"]');
  await more.click();
  const panel = page.locator('.cm-toolbar__more-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.cm-toolbar__more-panel');
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    const inset = 1;
    return rect.left >= -inset && rect.right <= window.innerWidth + inset
      && rect.top >= -inset && rect.bottom <= window.innerHeight + inset;
  });
  await assertNoHorizontalOverflow(page, accessibility ? 'AX compact More' : 'compact More');
  for (const name of ['Heading 1', 'Insert table', 'Inline code', 'Numbered list', 'Blockquote', 'Add image or attachment', 'Focus mode', 'Typewriter scrolling']) await panel.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' });
  const lastCommand = panel.getByRole('button', { name: 'Typewriter scrolling', exact: true });
  await lastCommand.scrollIntoViewIfNeeded();
  const lastBox = await lastCommand.boundingBox();
  if (!lastBox || lastBox.y < -1 || lastBox.y + lastBox.height > (accessibility ? 844 : 844) + 1) throw new Error(`${accessibility ? 'AX ' : ''}More did not keep Typewriter reachable`);
  await more.focus(); await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  if (!(await more.evaluate((element) => element === document.activeElement))) throw new Error('Escape did not restore focus to More trigger');
}

const browser = await chromium.launch({ executablePath: await findInstalledHeadlessShell() });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
await context.addInitScript(() => { localStorage.setItem('jin.appearance', 'light'); });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));
await page.route(`${ORIGIN}/**`, fulfillDist);

try {
  await page.clock.setFixedTime(new Date('2026-08-20T10:00:00Z'));
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await verifyEditorWorkflow(page);
  await verifyHiddenNativeNavigation(page);
  await verifyCompactDisclosure(page, false);
  await verifyCompactDisclosure(page, true);
  if (consoleErrors.length) throw new Error(`Notes workflow emitted console errors: ${consoleErrors.join('\n')}`);
  await mkdir(dirname(SUCCESS_ARTIFACT), { recursive: true });
  await writeFile(SUCCESS_ARTIFACT, `${JSON.stringify({
    status: 'pass',
    viewport: ['1280x800', '1200x800@native-overlay', '390x844', '320x844@310%'],
    checks: ['selection-toolbar-undo-autosave', 'read-edit', 'link-cancel-focus', 'history-preview-close-focus', 'tags-escape-focus', 'hidden-native-split-geometry', 'hidden-native-all-routes', 'compact-more-geometry', 'accessibility-more-reachability'],
  }, null, 2)}\n`);
  console.log('Notes writing surface smoke: selection, undo, autosave, read/edit, link cancel, hidden native navigation, compact More, and AX reachability: ok');
} catch (error) {
  await captureFailure(page, error, consoleErrors);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
