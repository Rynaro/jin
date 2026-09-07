/**
 * Production-bundle smoke gate for the shared task due editor.
 *
 * Requests are fulfilled directly from dist/ at the deterministic fixture's
 * allowlisted origin. This exercises Vite's production output without relying
 * on a dev server or the DEV-only window.__jin_stimulus__ escape hatch.
 */
import { chromium } from 'playwright';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUI_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = join(GUI_ROOT, 'dist');
const ORIGIN = 'http://127.0.0.1:1420';
const MIME = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.svg', 'image/svg+xml'],
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

await page.route(`${ORIGIN}/**`, async (route) => {
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
});

try {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const devGlobal = await page.evaluate(() => window.__jin_stimulus__);
  if (devGlobal !== undefined) throw new Error('production bundle exposed DEV-only __jin_stimulus__');

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
  if (consoleErrors.length > 0) throw new Error(`browser console errors:\n${consoleErrors.join('\n')}`);

  console.log('production due editor smoke: ok');
} finally {
  await browser.close();
}
