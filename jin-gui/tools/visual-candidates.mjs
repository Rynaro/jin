/** Deterministic screenshot reference gate; persistent refs are platform-bound evidence. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, release, tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const buildManifest = join(dist, '.jin-visual-build.json');
const fixtureScript = join(root, 'tools', 'tauri-fixture-init.js');
const defaultReferences = join(root, 'visual-references', 'cohesive-workspace-v1');
const artifactRoot = join(root, '..', '.artifacts', 'playwright-mcp', 'ui-ux-overhaul', 'continuation');
const origin = 'http://127.0.0.1:1420';
const mime = new Map([['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2']]);
const scenarios = [
  { id: 'today-dense-390', viewport: { width: 390, height: 844 }, storage: { 'jin.fixture.todayScenario': 'dense' }, section: 'Today — agenda view', ready: '.today-focus-item__event' },
  { id: 'calendar-dense-1440', viewport: { width: 1440, height: 900 }, storage: { 'jin.fixture.calendarScenario': 'dense' }, section: 'Calendar', ready: '.calendar-day-grid' },
  { id: 'notifications-recovery-1280', viewport: { width: 1280, height: 800 }, storage: { 'jin.fixture.notificationsScenario': 'recovery' }, section: /Notifications/, ready: '[data-notification-select]' },
  { id: 'notes-writing-1280', viewport: { width: 1280, height: 800 }, storage: {}, section: 'Notes', ready: '.browse-row__inner[data-note-id="n1"]' },
  { id: 'tasks-planning-1280', viewport: { width: 1280, height: 800 }, storage: {}, section: 'Tasks', ready: '[data-section-name="tasks"] .task-item' },
];

function parseArgs(argv) {
  const options = { compare: false, record: false, selftest: false, visibleMutation: false, environmentMismatch: false, reason: '', scenarios: [], referenceDir: defaultReferences };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--compare') options.compare = true;
    else if (arg === '--record') options.record = true;
    else if (arg === '--selftest') options.selftest = true;
    else if (arg === '--test-visible-mutation') options.visibleMutation = true;
    else if (arg === '--test-environment-mismatch') options.environmentMismatch = true;
    else if (arg === '--reason' || arg === '--scenario' || arg === '--reference-dir') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--reason') options.reason = value.trim();
      if (arg === '--scenario') options.scenarios.push(value);
      if (arg === '--reference-dir') options.referenceDir = normalize(value);
    } else throw new Error(`unknown visual reference option: ${arg}`);
  }
  if (options.selftest && (options.compare || options.record || options.visibleMutation || options.environmentMismatch || options.scenarios.length || options.reason)) throw new Error('--selftest cannot be combined with capture options');
  if (!options.selftest && options.record === options.compare) throw new Error('choose exactly one of --record or --compare');
  if (options.record && !options.reason) throw new Error('reference updates require --record --reason <non-empty reason>');
  if ((options.visibleMutation || options.environmentMismatch) && !options.compare) throw new Error('test mutations require --compare and never update references');
  return options;
}

async function sourceFingerprint() {
  const inputs = [join(root, 'src'), join(root, 'index.html'), join(root, 'vite.config.ts'), fixtureScript]; const files = [];
  async function walk(path) { const info = await stat(path); if (!info.isDirectory()) return files.push(path); for (const entry of await readdir(path, { withFileTypes: true })) if (!entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(join(path, entry.name)); }
  for (const input of inputs) await walk(input);
  const hash = createHash('sha256'); for (const file of files.sort()) { hash.update(file.slice(root.length)); hash.update(await readFile(file)); } return hash.digest('hex');
}
async function assertFreshBuild() {
  await stat(join(dist, 'index.html'));
  const manifest = JSON.parse(await readFile(buildManifest, 'utf8'));
  if (manifest.version !== 1 || manifest.sourceFingerprint !== await sourceFingerprint()) throw new Error('stale production bundle: run npm run visual:compare, npm run visual:record -- --reason <reason>, or npm run visual:selftest');
}
async function browserPath() {
  const configured = chromium.executablePath(); if (await stat(configured).then(() => true).catch(() => false)) return configured;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const version of (await readdir(cache, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-')).sort((a, b) => b.name.localeCompare(a.name))) for (const platform of await readdir(join(cache, version.name), { withFileTypes: true })) { const candidate = join(cache, version.name, platform.name, 'chrome-headless-shell'); if (await stat(candidate).then(() => true).catch(() => false)) return candidate; }
  throw new Error('Playwright Chromium is not installed; run npx playwright install chromium');
}
async function fulfillDist(route) {
  const requestUrl = new URL(route.request().url()); const relative = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, ''); const file = normalize(join(dist, relative));
  if (!file.startsWith(`${dist}/`) && file !== join(dist, 'index.html')) return route.abort('blockedbyclient');
  try { await route.fulfill({ status: 200, contentType: mime.get(extname(file)) ?? 'application/octet-stream', body: await readFile(file) }); } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
}
async function selectSection(page, name) {
  const link = page.getByRole('navigation', { name: 'Application navigation', exact: true })
    .getByRole('link', typeof name === 'string' ? { name, exact: true } : { name });
  const reveal = page.getByRole('button', { name: 'Show navigation', exact: true });
  if (await reveal.isVisible()) await reveal.click();
  await link.waitFor({ state: 'visible' });
  await link.click();
}
async function assertScenario(page, scenario) {
  await page.locator(scenario.ready).first().waitFor({ state: 'visible' });
  if (scenario.id === 'today-dense-390') { const focus = await page.locator('.today-focus-item__event').count(); const scheduled = await page.getByRole('region', { name: 'Scheduled events' }).getByRole('button', { name: /^Open event:/ }).count(); if (focus < 2 || scheduled < 12) throw new Error(`dense Today expected two focus controls and twelve scheduled event controls, found ${focus} and ${scheduled}`); }
  else if (scenario.id === 'calendar-dense-1440') { const month = page.getByRole('button', { name: 'Month', exact: true }); if (await month.getAttribute('aria-pressed') !== 'true') await month.click(); const cell = page.locator('.calendar-day-button[data-date="2026-08-20"]').locator('xpath=ancestor::*[contains(@class, "calendar-day-cell")]'); const allEvents = cell.locator('.calendar-event-chip'); const total = await allEvents.count(); if (total !== 16) throw new Error(`dense Calendar expected 16 unique Aug 20 events, found ${total}`); const more = cell.locator('.calendar-event-more'); await more.waitFor({ state: 'visible' }); const visible = await allEvents.evaluateAll(events => events.filter(event => !event.hidden && getComputedStyle(event).display !== 'none').length); if ((await more.getAttribute('aria-label')) !== `${total - visible} More Events`) throw new Error('dense Calendar overflow label did not match rendered event count'); }
  else if (scenario.id === 'notifications-recovery-1280') { await page.getByRole('option', { name: /Vendor contract review/i }).click(); await page.getByRole('button', { name: 'Retry' }).waitFor({ state: 'visible' }); }
  else if (scenario.id === 'notes-writing-1280') await prepareWritingScenario(page);
  else if (scenario.id === 'tasks-planning-1280') {
    const tasks = page.locator('[data-section-name="tasks"]');
    await tasks.getByRole('button', { name: /^Work — Existing work/ }).click();
    await tasks.getByRole('heading', { name: 'Work', exact: true }).waitFor({ state: 'visible' });
    const rows = tasks.locator('.task-item--row[data-task-id]');
    await page.waitForFunction(() => document.querySelectorAll('[data-section-name="tasks"] .task-item--row[data-task-id]').length === 3);
    if (await rows.count() !== 3) throw new Error('Tasks planning reference requires the three Work tasks');
    await tasks.getByRole('textbox', { name: 'New task title', exact: true }).first().waitFor({ state: 'visible' });
    await tasks.getByRole('heading', { name: 'Work', exact: true }).click();
  }
}

async function prepareWritingScenario(page) {
  const notes = page.locator('[data-section-name="notes"]');
  await notes.locator('.browse-row__inner[data-note-id="n1"]').click();
  const editor = notes.locator('.cm-content[contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  const title = notes.getByRole('textbox', { name: 'Note title', exact: true });
  await title.fill('Studio journal');
  await editor.click();
  await notes.getByRole('button', { name: 'Studio journal', exact: true }).waitFor({ state: 'visible' });
  const body = 'A few observations from this morning’s walk through the studio.\n\n## Materials and light\n\nThe linen sample softens the afternoon light. Keep it next to the oak, and look at both again before the next review.\n\n## For our next conversation\n\nBring the finish samples to the lighting review. Leave time to compare the reading nook once the sun moves behind the building.';
  await editor.fill(body);
  await page.waitForFunction(expected => {
    const noteBody = document.querySelector('.notes-detail-pane .note-detail__body');
    const saved = document.querySelector('.cm-toolbar__status[data-save-state="saved"]');
    return noteBody?._cmHandle?.getDoc() === expected && Boolean(saved);
  }, body);
  await notes.getByRole('button', { name: 'Hide note library', exact: true }).focus();
  const activeRow = notes.locator('.browse-row__inner[data-note-id="n1"][aria-current="page"]');
  await activeRow.waitFor({ state: 'visible' });
  const expectedExcerpt = Array.from(body.split(/\p{White_Space}+/u).filter(Boolean).join(' ')).slice(0, 200).join('');
  await page.waitForFunction(expected => document.querySelector('.browse-row__inner[data-note-id="n1"] .note-row__snippet')?.textContent === expected, expectedExcerpt);
  if (!await editor.isVisible()) throw new Error('Notes writing reference requires a visible editor beside its active library row');
  await notes.getByRole('button', { name: 'Hide note library', exact: true }).waitFor({ state: 'visible' });
  // Filling a long note scrolls to its insertion caret. Capture the document
  // from its natural start after returning focus to the library control.
  const writingScroll = notes.locator('.cm-scroll-region');
  await writingScroll.evaluate(region => region.scrollTo({ top: 0, behavior: 'instant' }));
  if (await writingScroll.evaluate(region => region.scrollTop) !== 0) throw new Error('Notes writing reference did not return to the document start');
}
function selectedScenarios(ids) { const selected = ids.length ? scenarios.filter(scenario => ids.includes(scenario.id)) : scenarios; if (ids.length && (selected.length !== new Set(ids).size || ids.some(id => !scenarios.some(scenario => scenario.id === id)))) throw new Error(`unknown visual scenario; choose one of: ${scenarios.map(scenario => scenario.id).join(', ')}`); return selected; }
async function captureStableScreenshot(page, scenarioId) {
  // The editor interaction can leave the pointer over the More disclosure.
  // Normalize hover before checking its fractional rounded-border paint.
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  // Require consecutive identical frames before either recording or comparing.
  let previous;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
    if (previous?.equals(screenshot)) return screenshot;
    previous = screenshot;
  }
  throw new Error(`${scenarioId} did not reach a stable rendered frame`);
}

async function capture(options, selected = selectedScenarios(options.scenarios)) {
  await assertFreshBuild(); const fixtureSource = await readFile(fixtureScript, 'utf8'); const runEvidence = join(artifactRoot, 'visual-runs', `${Date.now()}-${process.pid}`); const browser = await chromium.launch({ executablePath: await browserPath(), headless: true }); const captures = [];
  try { for (const scenario of selected) { const context = await browser.newContext({ viewport: scenario.viewport, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' }); await context.addInitScript(storage => { for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value); }, scenario.storage); await context.addInitScript({ content: fixtureSource }); const page = await context.newPage(); const errors = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); page.on('pageerror', error => errors.push(error.message));
    try { await page.clock.setFixedTime(new Date('2026-08-20T10:00:00Z')); await page.route(`${origin}/**`, fulfillDist); await page.goto(`${origin}/`, { waitUntil: 'networkidle' }); const bridge = await page.evaluate(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; return typeof invoke === 'function' ? await invoke('today_projection', { input: { date: '2026-08-20' } }) : null; }); if (!bridge) throw new Error(`fixture bridge was not installed before ${scenario.id} boot`); await selectSection(page, scenario.section); await assertScenario(page, scenario); await page.evaluate(() => document.fonts.ready); if (options.visibleMutation) await page.evaluate(() => { const marker = document.createElement('div'); marker.id = 'jin-visual-regression-mutation'; marker.textContent = 'visual regression mutation'; marker.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#ff00ff;color:#000;font:700 32px sans-serif;padding:24px'; document.body.append(marker); }); if (options.visibleMutation && !await page.locator('#jin-visual-regression-mutation').isVisible()) throw new Error(`visible mutation was not rendered for ${scenario.id}`); const manifest = { version: 2, id: scenario.id, viewport: scenario.viewport, locale: options.environmentMismatch ? 'en-GB' : 'en-US', timezone: 'UTC', reducedMotion: 'reduce', clock: '2026-08-20T10:00:00Z', storage: scenario.storage, browser: await browser.version(), platform: process.platform, os: `${process.platform}-${process.arch} ${release()}`, theme: 'system', fixture: 'tauri-fixture-init.js', fonts: 'bundled Inter + system fallback', reviewStatus: 'agent-reviewed' }; const screenshot = scenario.id === 'notes-writing-1280' ? await captureStableScreenshot(page, scenario.id) : await page.screenshot({ fullPage: true }); if (errors.length) throw new Error(`${scenario.id} console errors: ${errors.join('\n')}`); captures.push({ scenario, manifest, screenshot }); }
    catch (error) { await mkdir(runEvidence, { recursive: true }); try { await page.screenshot({ path: join(runEvidence, `${scenario.id}.failure.png`), fullPage: true }); } catch {} await writeFile(join(runEvidence, `${scenario.id}.failure.json`), `${JSON.stringify({ id: scenario.id, failure: String(error), console: errors }, null, 2)}\n`); throw error; } finally { await context.close(); }
  } } finally { await browser.close(); } return captures;
}
async function referenceDigest(referenceDir, selected) { const hash = createHash('sha256'); for (const scenario of selected) for (const suffix of ['png', 'json']) { const file = join(referenceDir, `${scenario.id}.${suffix}`); hash.update(file); hash.update(await readFile(file)); } return hash.digest('hex'); }
function sourceContext() {
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, '..'), encoding: 'utf8' }).trim();
  const workingTree = execFileSync('git', ['status', '--porcelain'], { cwd: join(root, '..'), encoding: 'utf8' }).trim() ? 'dirty' : 'clean';
  return { sourceRevision, workingTree };
}
async function run(options) {
  const selected = selectedScenarios(options.scenarios); const captures = await capture(options, selected);
  if (options.compare) { for (const { scenario, manifest, screenshot } of captures) { const baseline = JSON.parse(await readFile(join(options.referenceDir, `${scenario.id}.json`), 'utf8')); delete baseline.reason; delete baseline.recordedAt; delete baseline.sourceRevision; delete baseline.workingTree; if (JSON.stringify(baseline) !== JSON.stringify(manifest)) throw new Error(`environment mismatch for ${scenario.id}; persisted references are platform-bound and must not be regenerated during compare`); const reference = await readFile(join(options.referenceDir, `${scenario.id}.png`)); if (!reference.equals(screenshot)) { await mkdir(join(artifactRoot, 'visual-runs'), { recursive: true }); await writeFile(join(artifactRoot, 'visual-runs', `${Date.now()}-${scenario.id}.actual.png`), screenshot); throw new Error(`visual difference for ${scenario.id}: ${createHash('sha256').update(reference).digest('hex')} != ${createHash('sha256').update(screenshot).digest('hex')}`); } } return; }
  await mkdir(options.referenceDir, { recursive: true }); const context = sourceContext(); for (const { scenario, manifest, screenshot } of captures) { await writeFile(join(options.referenceDir, `${scenario.id}.png`), screenshot); await writeFile(join(options.referenceDir, `${scenario.id}.json`), `${JSON.stringify({ ...manifest, reason: options.reason, recordedAt: new Date().toISOString(), ...context }, null, 2)}\n`); }
}
async function selftest() {
  const directory = await mkdtemp(join(tmpdir(), 'jin-visual-reference-selftest-')); const references = join(directory, 'references'); const record = { compare: false, record: true, selftest: false, visibleMutation: false, environmentMismatch: false, reason: 'ephemeral detector selftest', scenarios: [], referenceDir: references };
  try { const stamp = await readFile(buildManifest); await writeFile(buildManifest, '{"version":1,"sourceFingerprint":"stale"}\n'); try { await assertFreshBuild(); throw new Error('stale build stamp unexpectedly accepted'); } catch (error) { if (!String(error).includes('stale production bundle')) throw error; } finally { await writeFile(buildManifest, stamp); } await run(record); const before = await referenceDigest(references, scenarios); await run({ ...record, record: false, compare: true }); await run({ ...record, record: false, compare: true, visibleMutation: true }).then(() => { throw new Error('visible mutation unexpectedly compared clean'); }, error => { if (!String(error).includes('visual difference')) throw error; }); if (await referenceDigest(references, scenarios) !== before) throw new Error('visible mutation modified ephemeral references'); await run({ ...record, record: false, compare: true }); await run({ ...record, record: false, compare: true, environmentMismatch: true }).then(() => { throw new Error('environment mismatch unexpectedly compared clean'); }, error => { if (!String(error).includes('environment mismatch')) throw error; }); if (await referenceDigest(references, scenarios) !== before) throw new Error('environment mismatch modified ephemeral references'); try { selectedScenarios(['not-a-scenario']); throw new Error('invalid scenario unexpectedly accepted'); } catch (error) { if (!String(error).includes('unknown visual scenario')) throw error; } try { parseArgs(['--record', '--reason', 'no mutation writes', '--test-visible-mutation']); throw new Error('invalid mutation flags unexpectedly accepted'); } catch (error) { if (!String(error).includes('test mutations require --compare')) throw error; } if (await referenceDigest(references, scenarios) !== before) throw new Error('invalid flags modified ephemeral references'); console.log('visual reference selftest: pass (stale-build → record → compare → mutation fails → restore → environment mismatch/invalid flags fail; references unchanged)'); } finally { await rm(directory, { recursive: true, force: true }); }
}
const options = parseArgs(process.argv.slice(2)); if (options.selftest) await selftest(); else await run(options);
