/**
 * Production-bundle smoke gate for the shared task due editor.
 *
 * Requests are fulfilled directly from dist/ at the deterministic fixture's
 * allowlisted origin. This exercises Vite's production output without relying
 * on a dev server or the DEV-only window.__jin_stimulus__ escape hatch.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUI_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = join(GUI_ROOT, 'dist');
const FAILURE_ARTIFACT_ROOT = join(GUI_ROOT, '..', '.artifacts', 'playwright-mcp', 'ui-ux-overhaul', 'continuation', 'production-due-smoke-failures');
const ORIGIN = 'http://127.0.0.1:1420';
const MIME = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

await stat(join(DIST_ROOT, 'index.html')).catch(() => {
  throw new Error('dist/index.html is missing; run `npm run build` before this smoke gate');
});

async function findInstalledHeadlessShell() {
  const configured = chromium.executablePath();
  if (await stat(configured).then(() => true).catch(() => false)) return configured;

  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright'));
  const versions = await readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
  const candidates = versions
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const candidate of candidates) {
    const platformDirs = await readdir(join(cacheRoot, candidate.name), { withFileTypes: true });
    for (const platformDir of platformDirs) {
      const executable = join(
        cacheRoot,
        candidate.name,
        platformDir.name,
        process.platform === 'win32' ? 'headless_shell.exe' : 'chrome-headless-shell',
      );
      if (await stat(executable).then(() => true).catch(() => false)) return executable;
    }
  }
  throw new Error('Playwright Chromium is not installed; run `npx playwright install chromium`');
}

const browser = await chromium.launch({ executablePath: await findInstalledHeadlessShell() });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

async function navigateToSection(page, label) {
  await page.waitForFunction(() => {
    const shell = document.querySelector('.jin-shell');
    const expected = window.innerWidth < 960 || document.documentElement.dataset.textScale === 'accessibility'
      ? 'drawer'
      : 'desktop';
    return shell?.dataset.navPresentation === expected;
  });
  const destinationName = label === 'today'
    ? 'Today — agenda view'
    : label === 'events'
      ? 'Calendar'
      : label === 'notifications'
      ? /^Notifications/
      : label[0].toUpperCase() + label.slice(1);
  const destination = page.getByRole('navigation', { name: 'Application navigation', exact: true })
    .getByRole('link', typeof destinationName === 'string'
      ? { name: destinationName, exact: true }
      : { name: destinationName });

  const shell = page.locator('.jin-shell');
  // At compact widths and accessibility text scale the sidebar is a drawer.
  // A committed route closes it, so drive the controller's settled state
  // instead of inferring availability from a transformed or inert element.
  if (await shell.getAttribute('data-nav-visible') !== 'true') {
    const reveal = page.getByRole('button', { name: 'Show navigation', exact: true });
    await reveal.click();
    await page.waitForFunction(() => document.querySelector('.jin-shell')?.dataset.navVisible === 'true');
  }
  await destination.waitFor({ state: 'visible' });
  await destination.click();
}

async function captureFailureEvidence(page, error, consoleErrors) {
  const artifactDirectory = join(FAILURE_ARTIFACT_ROOT, `${Date.now()}-${process.pid}`);
  await mkdir(artifactDirectory, { recursive: true });
  const evidence = {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    url: page.url(),
    consoleErrors,
    captureErrors: [],
  };
  try {
    await page.screenshot({ path: join(artifactDirectory, 'failure.png'), fullPage: true });
  } catch (captureError) {
    evidence.captureErrors.push(`screenshot: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
  try {
    evidence.visibleControls = await page.locator('button:visible, a:visible, input:visible, [role="button"]:visible').evaluateAll((elements) => elements.map((element) => ({
      role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
    })).filter(({ name }) => name));
  } catch (captureError) {
    evidence.captureErrors.push(`visible controls: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
  await writeFile(join(artifactDirectory, 'failure.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}

async function assertNoDocumentOverflow(page, label, viewport) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    throw new Error(`${label} at ${viewport.width}px caused document horizontal overflow: ${JSON.stringify(metrics)}`);
  }
}

async function assertRouteOverview(page, label, ready, viewport, consoleErrors) {
  const errorCount = consoleErrors.length;
  await page.setViewportSize(viewport);
  await navigateToSection(page, label);
  await ready.waitFor({ state: 'visible' });
  const surface = page.locator(`[data-section-name="${label}"]`);
  if (!(await surface.isVisible())) throw new Error(`${label} route did not become visible after its navigation control was activated`);
  await assertNoDocumentOverflow(page, `${label} overview`, viewport);
  const newErrors = consoleErrors.slice(errorCount);
  if (newErrors.length) throw new Error(`${label} overview produced console errors: ${newErrors.join('\n')}`);
}

async function assertTodayAccessibilityLayout(page, viewport) {
  const rows = page.locator('.today-event-row');
  await rows.first().waitFor({ state: 'visible' });
  const result = await rows.evaluateAll((elements) => elements.map((row) => {
    const body = row.querySelector('.today-event-row__body');
    const title = row.querySelector('.today-event-row__title');
    return {
      rowClient: row.clientWidth,
      rowScroll: row.scrollWidth,
      bodyWidth: body?.getBoundingClientRect().width ?? 0,
      titleWidth: title?.getBoundingClientRect().width ?? 0,
    };
  }));
  for (const metrics of result) {
    if (metrics.rowScroll > metrics.rowClient + 1 || metrics.bodyWidth <= 1 || metrics.titleWidth <= 1) {
      throw new Error(`Today scheduled row collapsed or overflowed at ${viewport.width}px accessibility text: ${JSON.stringify(metrics)}`);
    }
  }
  const masthead = page.locator('.today-masthead__date');
  const previous = page.getByRole('button', { name: 'Previous day', exact: true });
  const next = page.getByRole('button', { name: 'Next day', exact: true });
  for (const element of [masthead, previous, next]) {
    const box = await element.boundingBox();
    if (!box || box.width <= 1 || box.x < -1 || box.x + box.width > viewport.width + 1) throw new Error(`Today masthead or date navigation was clipped at ${viewport.width}px accessibility text`);
  }
}

const FIXTURE_MONTH_LABEL = 'August 2026';
const FIXTURE_MONTH_CURSOR = 2026 * 12 + 7;
const MONTH_INDEX = new Map([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((month, index) => [month, index]));

function monthCursor(label) {
  const [monthName, yearText] = label.trim().split(/\s+/);
  const month = MONTH_INDEX.get(monthName);
  const year = Number(yearText);
  if (month === undefined || !Number.isInteger(year)) return null;
  return year * 12 + month;
}

async function navigateToFixtureMonth(page) {
  const monthLabel = page.locator('.calendar-month-view:not(.hidden) .calendar-month-label');
  await monthLabel.waitFor({ state: 'visible' });
  for (let step = 0; step < 24; step += 1) {
    const current = (await monthLabel.textContent())?.trim() ?? '';
    if (current === FIXTURE_MONTH_LABEL) return;
    const cursor = monthCursor(current);
    if (cursor === null) throw new Error(`Calendar month label was not the expected English month/year: ${JSON.stringify(current)}`);
    const direction = cursor > FIXTURE_MONTH_CURSOR ? 'Previous' : 'Next';
    await page.getByRole('button', { name: `${direction} Month`, exact: true }).click();
    await page.waitForFunction((previous) => document.querySelector('.calendar-month-view:not(.hidden) .calendar-month-label')?.textContent?.trim() !== previous, current);
  }
  throw new Error(`Calendar did not reach the fixture month ${FIXTURE_MONTH_LABEL} through its navigation controls`);
}

async function assertEventDetailLayout(page, viewport) {
  await page.setViewportSize(viewport);
  await navigateToSection(page, 'events');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await navigateToFixtureMonth(page);
  const monthLabel = page.locator('.calendar-month-view:not(.hidden) .calendar-month-label');
  if ((await monthLabel.textContent())?.trim() !== FIXTURE_MONTH_LABEL) {
    throw new Error(`Calendar navigation did not reach the fixed fixture month: ${JSON.stringify(await monthLabel.textContent())}`);
  }
  const augustTwentieth = page.locator('.calendar-day-cell').filter({
    has: page.locator('.calendar-day-button[data-date="2026-08-20"]'),
  });
  if (await augustTwentieth.count() !== 1) throw new Error('Calendar did not render one August 20 fixture cell');
  const moreEvents = augustTwentieth.getByRole('button', { name: /^\d+ More Events$/ });
  await moreEvents.waitFor({ state: 'visible' });
  const moreName = await moreEvents.getAttribute('aria-label');
  if (!moreName || !/^[1-9]\d* More Events$/.test(moreName)) {
    throw new Error(`Calendar August 20 overflow control did not expose a positive computed count: ${JSON.stringify(moreName)}`);
  }
  await moreEvents.click();
  const partnerReview = page.locator('.calendar-timegrid__event[data-event-id="e8"]');
  await partnerReview.waitFor({ state: 'visible' });
  await partnerReview.click();
  await page.getByRole('button', { name: 'Open full details', exact: true }).click();

  const pane = page.locator('.events-detail-pane');
  const back = page.getByRole('button', { name: /^Back(?: to)? Calendar$/ });
  const edit = page.getByRole('button', { name: /^Edit Partner review$/, exact: true });
  // e8 is a writable Google event in the production fixture, with no
  // notifiable guests projected by this fixture. Its policy is therefore the
  // solo Google cancellation action, not a local Delete or shared-meeting
  // cancellation.
  const remove = page.getByRole('button', { name: 'Cancel event', exact: true });
  await Promise.all([pane.waitFor({ state: 'visible' }), back.waitFor({ state: 'visible' }), edit.waitFor({ state: 'visible' }), remove.waitFor({ state: 'visible' })]);
  await pane.evaluate((element) => { element.scrollTop = 0; });
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.events-detail-pane');
    const back = pane.querySelector('.calendar-back-btn');
    const edit = pane.querySelector('.event-detail__edit');
    const remove = pane.querySelector('.event-detail__destructive');
    if (!pane || !back || !edit || !remove) return null;
    const rect = (element) => element.getBoundingClientRect();
    const paneRect = rect(pane);
    const boxes = { back: rect(back), edit: rect(edit), remove: rect(remove) };
    const within = (box) => box.left >= paneRect.left - 1 && box.right <= paneRect.right + 1
      && box.top >= paneRect.top - 1 && box.bottom <= paneRect.bottom + 1;
    const overlap = !(boxes.edit.right <= boxes.remove.left || boxes.remove.right <= boxes.edit.left
      || boxes.edit.bottom <= boxes.remove.top || boxes.remove.bottom <= boxes.edit.top);
    return {
      paneClientWidth: pane.clientWidth,
      paneScrollWidth: pane.scrollWidth,
      paneClientHeight: pane.clientHeight,
      paneScrollHeight: pane.scrollHeight,
      within: { back: within(boxes.back), edit: within(boxes.edit), remove: within(boxes.remove) },
      actionsOverlap: overlap,
      backHeight: boxes.back.height,
      backFits: back.scrollWidth <= back.clientWidth + 1,
      backWhiteSpace: getComputedStyle(back).whiteSpace,
      accessibilityText: document.documentElement.dataset.textScale === 'accessibility',
    };
  });
  if (!geometry || geometry.paneScrollWidth > geometry.paneClientWidth + 1 || !geometry.within.back || !geometry.within.edit || !geometry.within.remove || geometry.actionsOverlap || geometry.backHeight <= 1 || geometry.backFits !== true || (!geometry.accessibilityText && geometry.backHeight > 48) || geometry.backWhiteSpace !== 'nowrap') {
    throw new Error(`Event detail controls escaped, overlapped, or wrapped at ${viewport.width}px: ${JSON.stringify(geometry)}`);
  }
  if (geometry.paneScrollHeight <= geometry.paneClientHeight) {
    throw new Error(`Rich event detail did not retain its dedicated scroll surface at ${viewport.width}px: ${JSON.stringify(geometry)}`);
  }
  const more = page.locator('.event-detail__more > summary');
  await more.scrollIntoViewIfNeeded();
  const moreVisible = await more.evaluate((element) => {
    const pane = document.querySelector('.events-detail-pane');
    if (!pane) return false;
    const rect = element.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    return rect.top >= paneRect.top - 1 && rect.bottom <= paneRect.bottom + 1;
  });
  if (!moreVisible) throw new Error(`Rich event detail More control was not reachable through its pane scroll at ${viewport.width}px`);
  const source = page.locator('.event-detail__source-label');
  const destination = page.locator('.event-detail__destination');
  const timezone = page.locator('.event-detail__tz');
  if ((await source.textContent())?.includes('Google Calendar · Team Calendar') !== true
    || (await destination.textContent())?.includes('Work — Team Calendar') !== true
    || !(await timezone.isVisible())) {
    throw new Error(`Event detail lost provider, destination, or timezone meaning at ${viewport.width}px`);
  }
  const contextMetrics = await page.locator('.event-detail__context-empty').evaluateAll((sections) => sections.map((section) => {
    const heading = section.querySelector('.browse-detail__links-heading');
    const action = section.querySelector('.event-detail__context-search');
    return {
      headingClient: heading?.clientWidth ?? 0,
      headingScroll: heading?.scrollWidth ?? 0,
      actionClient: action?.clientWidth ?? 0,
      actionScroll: action?.scrollWidth ?? 0,
    };
  }));
  if (contextMetrics.length < 2 || contextMetrics.some((metrics) => metrics.headingClient <= 1 || metrics.headingScroll > metrics.headingClient + 1 || metrics.actionClient <= 1 || metrics.actionScroll > metrics.actionClient + 1)) {
    throw new Error(`Event detail Prep or Related context collapsed or clipped at ${viewport.width}px: ${JSON.stringify(contextMetrics)}`);
  }

  await edit.click();
  const composer = page.locator('.event-composer');
  await composer.waitFor({ state: 'visible' });
  // The fixture source has two ordinary words. This catches a grid track
  // collapsing to single glyphs while still allowing ordinary word-level wrapping.
  const sourceGeometry = await composer.locator('.event-composer__calendar-name').evaluate((name) => {
    const row = name.closest('.event-composer__calendar-row');
    const range = document.createRange();
    const text = name.firstChild;
    if (!text) return null;
    const wordEnd = text.textContent?.indexOf(' ') ?? -1;
    range.setStart(text, 0);
    range.setEnd(text, wordEnd < 0 ? text.textContent?.length ?? 0 : wordEnd);
    const wordLines = [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => Math.round(rect.top));
    return {
      rowWidth: row?.getBoundingClientRect().width ?? 0,
      nameClientWidth: name.clientWidth,
      nameScrollWidth: name.scrollWidth,
      wordLineCount: new Set(wordLines).size,
    };
  });
  if (!sourceGeometry
    || sourceGeometry.rowWidth <= 1
    || sourceGeometry.nameScrollWidth > sourceGeometry.nameClientWidth + 1
    || sourceGeometry.wordLineCount !== 1) {
    throw new Error(`Calendar source collapsed, clipped, or split into glyphs at ${viewport.width}px: ${JSON.stringify(sourceGeometry)}`);
  }
  // The composer body and its action footer are sibling slots in the active
  // companion, so scope the footer control to that host rather than its body.
  const activeCompanion = page.locator('.event-companion:has(.event-composer)');
  await activeCompanion.locator('.event-composer__cancel').click();
  await composer.waitFor({ state: 'hidden' });

  await back.click();
  await page.getByRole('button', { name: 'Month', exact: true }).waitFor({ state: 'visible' });
}

async function serveProduction(route) {
  const requestUrl = new URL(route.request().url());
  const relative = requestUrl.pathname === '/'
    ? 'index.html'
    : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
  const filePath = normalize(join(DIST_ROOT, relative));
  if (!filePath.startsWith(`${DIST_ROOT}/`) && filePath !== join(DIST_ROOT, 'index.html')) {
    await route.abort('blockedbyclient');
    return;
  }
  try {
    await route.fulfill({
      status: 200,
      contentType: MIME.get(extname(filePath)) ?? 'application/octet-stream',
      body: await readFile(filePath),
    });
  } catch {
    await route.fulfill({ status: 404, body: 'Not found' });
  }
}

async function assertConnectedWorkflows() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    timezoneId: 'America/Sao_Paulo',
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  const workflow = await context.newPage();
  const errors = [];
  workflow.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  workflow.on('pageerror', error => errors.push(error.message));
  await workflow.route(`${ORIGIN}/**`, serveProduction);
  try {
    await workflow.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await workflow.getByRole('button', { name: 'Find in Jin', exact: true }).click();
    const find = workflow.getByRole('dialog', { name: 'Find in Jin', exact: true });
    await find.getByRole('combobox').fill('Sprint Planning');
    await find.getByRole('option', { name: /^Sprint Planning Event/ }).click();
    await workflow.getByRole('button', { name: 'New meeting note', exact: true }).click();

    const noteTitle = 'Production launch discussion';
    const taskTitle = 'Send the production launch brief';
    const prep = workflow.getByRole('dialog', { name: 'New meeting note', exact: true });
    await prep.getByRole('textbox', { name: 'Title', exact: true }).fill(noteTitle);
    await prep.getByRole('textbox', { name: 'Note content', exact: true })
      .fill(`## Agenda\n\nReview the launch.\n\n## Action items\n\n${taskTitle}`);
    await prep.getByRole('button', { name: 'Create and open note', exact: true }).click();

    const notes = workflow.locator('[data-section-name="notes"]');
    const title = notes.getByRole('textbox', { name: 'Note title', exact: true });
    await title.waitFor({ state: 'visible' });
    if (await title.inputValue() !== noteTitle) throw new Error('Meeting prep did not open its new note');
    const editor = await notes.locator('.cm-editor').elementHandle();
    if (!editor) throw new Error('Meeting prep note did not mount its editor');
    await notes.locator('.cm-line').filter({ hasText: taskTitle }).last().click({ clickCount: 3 });
    await notes.getByRole('button', { name: 'Create task from selection', exact: true }).click();
    const create = workflow.getByRole('dialog', { name: 'Create task from selection', exact: true });
    if ((await create.getByRole('textbox', { name: 'Title', exact: true }).inputValue()) !== taskTitle) {
      throw new Error('Selected note text did not seed the task review');
    }
    await create.getByRole('button', { name: 'Create task', exact: true }).click();
    const openTask = notes.getByRole('status').filter({ hasText: /^Task created\./ })
      .getByRole('button', { name: `Open task: ${taskTitle}`, exact: true });
    await openTask.waitFor({ state: 'visible' });
    if (!(await editor.evaluate(element => element.isConnected
      && element === document.querySelector('[data-section-name="notes"] .cm-editor')
      && element.contains(document.activeElement)))) {
      throw new Error('Create task replaced the source editor or failed to return writing focus');
    }
    await openTask.click();

    const tasks = workflow.locator('[data-section-name="tasks"]');
    await tasks.getByRole('button', { name: `Schedule time for "${taskTitle}"`, exact: true }).click();
    const schedule = workflow.getByRole('dialog', { name: 'Schedule time for task', exact: true });
    await schedule.getByLabel('Start', { exact: false }).fill('2026-08-24T14:15');
    await schedule.getByLabel('Duration (minutes)', { exact: true }).fill('45');
    await schedule.getByLabel('Timezone', { exact: false }).fill('UTC');
    await schedule.getByLabel('Calendar', { exact: true }).selectOption('local');
    await schedule.getByRole('button', { name: 'Schedule time', exact: true }).click();

    const events = workflow.locator('[data-section-name="events"]');
    await events.getByRole('heading', { name: taskTitle, exact: true }).waitFor({ state: 'visible' });
    const eventTime = await events.locator('.event-detail__time').textContent();
    if (!/02:15 PM.*03:00 PM/.test(eventTime ?? '')) {
      throw new Error(`Scheduling lost the reviewed 45-minute range: ${JSON.stringify(eventTime)}`);
    }
    await events.getByRole('region', { name: 'Originating task', exact: true }).getByRole('button').click();
    await tasks.getByRole('region', { name: 'Backlinks', exact: true })
      .getByRole('button', { name: `Source note: ${noteTitle}`, exact: true }).click();
    await title.waitFor({ state: 'visible' });
    if (await title.inputValue() !== noteTitle) throw new Error('Source backlink opened a different note');
    const links = notes.getByRole('region', { name: 'Links', exact: true });
    await links.getByRole('button', { name: new RegExp(taskTitle) }).waitFor({ state: 'visible' });
    await links.getByRole('button', { name: /Sprint Planning/ }).waitFor({ state: 'visible' });
    if (errors.length) throw new Error(`Connected workflows produced browser errors:\n${errors.join('\n')}`);
    console.log('connected workflow: Find → meeting note → selected task → keep writing → 45-minute time block → source note: ok');
  } catch (error) {
    await captureFailureEvidence(workflow, error, errors);
    throw error;
  } finally {
    await context.close();
  }
}

await page.route(`${ORIGIN}/**`, serveProduction);

try {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const devGlobal = await page.evaluate(() => window.__jin_stimulus__);
  if (devGlobal !== undefined) throw new Error('production bundle exposed DEV-only __jin_stimulus__');

  await assertConnectedWorkflows();

  await page.getByRole('button', { name: 'Quick capture (Ctrl+N)' }).click();
  await page.getByRole('tab', { name: 'Task' }).click();
  const captureDialog = page.getByRole('dialog', { name: 'Capture or create' });
  const dueTrigger = page.getByRole('button', { name: 'Pick due date' });
  await dueTrigger.click();

  const dueDialog = page.getByRole('dialog', { name: 'Set due date' });
  await dueDialog.waitFor({ state: 'visible' });
  const dateButton = dueDialog.getByRole('gridcell').nth(10).getByRole('button');
  await dateButton.click();
  if (!(await dueDialog.isVisible())) throw new Error('date selection closed the due editor');

  const timeInput = dueDialog.getByRole('textbox', { name: 'Due time (optional)' });
  const confirmButton = dueDialog.getByRole('button', { name: 'Set Date' });
  await confirmButton.evaluate((button) => {
    button.dataset.smokeClicks = '0';
    button.addEventListener('click', () => {
      button.dataset.smokeClicks = String(Number(button.dataset.smokeClicks) + 1);
    });
  });
  await timeInput.fill('16:2');
  await confirmButton.click();
  if (await confirmButton.getAttribute('data-smoke-clicks') !== '1') {
    throw new Error('invalid time blur swallowed the first Set Date click');
  }
  if (!(await dueDialog.isVisible())) throw new Error('invalid time closed the due editor');
  if (!(await timeInput.evaluate((element) => element === document.activeElement))) {
    throw new Error('invalid commit did not return focus to the due-time input');
  }
  const validation = dueDialog.locator('#jin-due-validation');
  if (!(await validation.isVisible()) || !(await validation.textContent())?.includes('9:30')) {
    throw new Error('invalid commit did not expose the inline clock guidance');
  }

  await timeInput.fill('09:45');
  await confirmButton.click();
  const dueValue = await page.locator('[data-capture-target="taskDue"]').inputValue();
  if (!/^\d{4}-\d{2}-\d{2}T09:45:00[+-]\d{2}:\d{2}$/.test(dueValue)) {
    throw new Error(`date+time commit produced invalid due value: ${JSON.stringify(dueValue)}`);
  }

  await dueTrigger.click();
  await dueDialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dueDialog.waitFor({ state: 'hidden' });
  if (!(await captureDialog.isVisible())) throw new Error('Escape also closed the underlying Capture dialog');
  if (!(await dueTrigger.evaluate((element) => element === document.activeElement))) {
    throw new Error('Escape did not restore focus to the due-date trigger');
  }

  // Reference workspace path: give an artificial task an explicit due date,
  // follow its real post-capture navigation, then prove Today projects it as
  // due work rather than creating a scheduled event.
  const referenceTitle = 'Production workflow due task';
  const naturalInput = dueDialog.getByRole('textbox', { name: 'Date and time' });
  await dueTrigger.click();
  await dueDialog.waitFor({ state: 'visible' });
  await naturalInput.fill('2026-08-20');
  await dueDialog.getByRole('button', { name: 'Use' }).click();
  await dueDialog.getByRole('button', { name: 'Set Date' }).click();
  await dueDialog.waitFor({ state: 'hidden' });
  await page.locator('[data-capture-target="taskTitle"]').fill(referenceTitle);
  await captureDialog.getByRole('button', { name: /create task/i }).click();
  await captureDialog.waitFor({ state: 'hidden' });
  const taskList = page.locator('[data-tasks-target="list"]');
  const createdTask = taskList.locator('.task-item__title', { hasText: referenceTitle }).locator('xpath=ancestor::button[1]');
  await createdTask.waitFor({ state: 'visible' });
  const referenceTaskId = await createdTask.getAttribute('data-task-id');
  if (!referenceTaskId) throw new Error('captured task row did not expose its stable task identity');
  await createdTask.click();
  const taskDetail = page.locator('[data-tasks-target="detailContent"]');
  const detailTitle = taskDetail.getByRole('heading', { name: 'Task title (editable)', exact: true });
  await detailTitle.waitFor({ state: 'visible' });
  if ((await detailTitle.textContent())?.trim() !== referenceTitle) {
    throw new Error('Task detail did not retain the captured task identity');
  }
  const taskBody = taskDetail.getByRole('textbox', { name: 'Task notes (body)', exact: true });
  await taskBody.fill('Smoke workflow note');
  await taskBody.blur();
  await taskBody.waitFor({ state: 'visible' });
  if (await taskBody.inputValue() !== 'Smoke workflow note') {
    throw new Error('task inspector did not retain the supported body edit');
  }

  await navigateToSection(page, 'today');
  const dueList = page.locator('[data-today-target="dueList"]');
  const dueTask = dueList.getByRole('button', { name: `Open task: ${referenceTitle}`, exact: true });
  await dueTask.waitFor({ state: 'visible' });
  if (await dueTask.getAttribute('data-today-preview-id') !== referenceTaskId) {
    throw new Error('Today due lane did not retain the captured task identity');
  }
  if (await page.locator('[data-today-target="timedList"]').getByRole('button', { name: `Open event: ${referenceTitle}`, exact: true }).count()) {
    throw new Error('a due-only task was incorrectly rendered as a timed calendar event');
  }

  await navigateToSection(page, 'tasks');
  const returnedTask = taskList.locator(`.task-item[data-task-id="${referenceTaskId}"]`);
  await returnedTask.waitFor({ state: 'visible' });
  await returnedTask.locator('.task-item__body').click();
  await detailTitle.waitFor({ state: 'visible' });
  if (await taskDetail.getByRole('textbox', { name: 'Task notes (body)', exact: true }).inputValue() !== 'Smoke workflow note') {
    throw new Error('task inspector body edit did not persist after returning from Today');
  }
  const completion = taskDetail.getByRole('checkbox', { name: `Mark "${referenceTitle}" as done`, exact: true });
  await completion.click();
  await taskDetail.getByRole('checkbox', { name: `Reopen "${referenceTitle}"`, exact: true }).waitFor({ state: 'visible' });
  // Isolated style state: this production fixture does not expose a Board
  // control, so exercise the real card selector without fabricating workflow
  // behavior. The daily workflow above remains control-driven.
  await page.evaluate(() => {
    const card = document.createElement('div');
    card.id = 'smoke-board-card';
    card.className = 'task-item task-item--card';
    document.body.append(card);
  });
  const boardCard = page.locator('#smoke-board-card');
  await boardCard.waitFor({ state: 'visible' });
  await boardCard.hover();
  const boardShadow = await boardCard.evaluate((card) => getComputedStyle(card).boxShadow);
  if (boardShadow === 'none' || !boardShadow.includes('rgba')) {
    throw new Error(`board hover did not resolve to one computed shadow: ${JSON.stringify(boardShadow)}`);
  }
  await boardCard.evaluate((card) => card.remove());
  await taskDetail.getByRole('button', { name: 'Close task details', exact: true }).click();
  await taskDetail.waitFor({ state: 'hidden' });
  await navigateToSection(page, 'today');
  await dueList.waitFor({ state: 'visible' });
  if (await dueList.getByRole('button', { name: `Open task: ${referenceTitle}`, exact: true }).count()) {
    throw new Error('completed task remained in Today due work');
  }
  await navigateToSection(page, 'settings');
  const textSize = page.getByRole('slider', { name: 'Text size', exact: true });
  await textSize.focus();
  await page.keyboard.press('End');
  if ((await textSize.getAttribute('aria-valuetext'))?.includes('310%') !== true) {
    throw new Error('Settings did not apply the supported maximum text scale');
  }
  const reveal = page.getByRole('button', { name: 'Show navigation', exact: true });
  await reveal.click();
  await page.getByRole('navigation', { name: 'Application navigation', exact: true })
    .getByRole('link', { name: 'Notes', exact: true }).click();
  await page.getByRole('heading', { name: 'All Notes', exact: true }).waitFor({ state: 'visible' });
  if (!(await reveal.evaluate((element) => element === document.activeElement))) {
    throw new Error('drawer route change did not restore focus to Show navigation');
  }

  // A small controls-driven route matrix catches shared shell regressions at
  // the documented compact and normal anchors without creating a baseline for
  // every surface. Each route waits for a real, route-owned control or title.
  await navigateToSection(page, 'settings');
  const baselineTextSize = page.getByRole('button', { name: 'Use default', exact: true });
  if (await baselineTextSize.isEnabled()) await baselineTextSize.click();
  if ((await page.getByRole('slider', { name: 'Text size', exact: true }).getAttribute('aria-valuetext'))?.includes('100%') !== true) {
    throw new Error('Settings did not restore the default 100% text scale for the standard layout matrix');
  }
  const lightMode = page.getByRole('radio', { name: 'Light mode', exact: true });
  await lightMode.click();
  if (await page.locator('html').getAttribute('data-appearance') !== 'light') throw new Error('Light mode control did not apply the light appearance');
  const overviewRoutes = [
    ['today', page.getByRole('button', { name: 'Calendar', exact: true })],
    ['notes', page.getByRole('heading', { name: 'All Notes', exact: true })],
    ['tasks', page.locator('[data-tasks-target="list"]')],
    ['events', page.getByRole('button', { name: 'Month', exact: true })],
    ['notifications', page.getByRole('button', { name: 'All', exact: true })],
    ['settings', page.getByRole('radio', { name: 'Light mode', exact: true })],
  ];
  for (const viewport of [{ width: 320, height: 844 }, { width: 760, height: 900 }]) {
    for (const [label, ready] of overviewRoutes) await assertRouteOverview(page, label, ready, viewport, consoleErrors);
  }
  await assertEventDetailLayout(page, { width: 1280, height: 800 });
  await assertEventDetailLayout(page, { width: 390, height: 844 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToSection(page, 'settings');
  const darkMode = page.getByRole('radio', { name: 'Dark mode', exact: true });
  await darkMode.click();
  if (await page.locator('html').getAttribute('data-appearance') !== 'dark') throw new Error('Dark mode control did not apply the dark appearance');
  for (const [label, ready] of overviewRoutes) await assertRouteOverview(page, label, ready, { width: 1280, height: 800 }, consoleErrors);
  await navigateToSection(page, 'settings');
  const matrixTextSize = page.getByRole('slider', { name: 'Text size', exact: true });
  await matrixTextSize.focus();
  await page.keyboard.press('End');
  if ((await matrixTextSize.getAttribute('aria-valuetext'))?.includes('310%') !== true) throw new Error('large-text matrix did not apply 310% text scale');
  await lightMode.click();
  for (const name of ['Reduce transparency', 'Increase contrast']) {
    const toggle = page.getByRole('switch', { name, exact: true });
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  }
  await assertEventDetailLayout(page, { width: 390, height: 844 });
  await assertRouteOverview(page, 'today', page.getByRole('region', { name: 'Scheduled events', exact: true }), { width: 320, height: 844 }, consoleErrors);
  await assertTodayAccessibilityLayout(page, { width: 320, height: 844 });
  await assertRouteOverview(page, 'notifications', page.getByRole('button', { name: 'All', exact: true }), { width: 320, height: 844 }, consoleErrors);
  await page.getByRole('option', { name: /Vendor contract review/i }).click();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await retry.waitFor({ state: 'visible' });
  await retry.click();
  const notificationBack = page.getByRole('button', { name: 'Back to notifications', exact: true });
  await notificationBack.waitFor({ state: 'visible' });
  const notificationGeometry = await page.locator('.notifications-detail').evaluate((detail, width) => {
    const back = detail.querySelector('.notifications-back');
    const rect = back?.getBoundingClientRect();
    return { detailClient: detail.clientWidth, detailScroll: detail.scrollWidth, backWidth: rect?.width ?? 0, backRight: rect?.right ?? 0, viewport: width };
  }, 320);
  if (notificationGeometry.detailScroll > notificationGeometry.detailClient + 1 || notificationGeometry.backWidth <= 1 || notificationGeometry.backRight > notificationGeometry.viewport + 1) {
    throw new Error(`Notification recovery Back control overflowed at 320px accessibility text: ${JSON.stringify(notificationGeometry)}`);
  }
  await assertRouteOverview(page, 'notes', page.getByRole('heading', { name: 'All Notes', exact: true }), { width: 760, height: 900 }, consoleErrors);
  const notesSearch = page.getByRole('searchbox', { name: 'Search notes', exact: true });
  await notesSearch.fill('no matching note fixture 9f894');
  await page.getByText('No notes match this search.', { exact: true }).waitFor({ state: 'visible' });
  await assertNoDocumentOverflow(page, 'Notes empty search at 310%', { width: 760, height: 900 });
  await page.setViewportSize({ width: 320, height: 844 });
  await navigateToSection(page, 'today');
  const keyboardReveal = page.getByRole('button', { name: 'Show navigation', exact: true });
  await keyboardReveal.focus(); await page.keyboard.press('Enter');
  const keyboardNotes = page.getByRole('navigation', { name: 'Application navigation', exact: true }).getByRole('link', { name: 'Notes', exact: true });
  await keyboardNotes.focus(); await page.keyboard.press('Enter');
  await notesSearch.waitFor({ state: 'visible' });
  await page.getByText('No notes match this search.', { exact: true }).waitFor({ state: 'visible' });
  if (!(await keyboardReveal.evaluate((element) => element === document.activeElement))) throw new Error('keyboard drawer route change did not restore focus to Show navigation');
  await assertNoDocumentOverflow(page, 'keyboard drawer Notes at 320px', { width: 320, height: 844 });
  console.log('layout matrix: light all routes at 320×844 and 760×900; dark all routes at 1280×800; 310% Notes empty search at 760×900; keyboard drawer Notes at 320×844: ok');
  if (consoleErrors.length > 0) throw new Error(`browser console errors:\n${consoleErrors.join('\n')}`);

  console.log('production due editor and workspace workflow smoke: ok');
} catch (error) {
  await captureFailureEvidence(page, error, consoleErrors);
  throw error;
} finally {
  await browser.close();
}
