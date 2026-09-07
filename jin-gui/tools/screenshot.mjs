/**
 * Headless visual-QA harness for the real built frontend.
 *
 * The browser uses the same deterministic Tauri fixture as Playwright MCP so
 * scope filtering, note detail lookup, and screenshots cannot drift apart.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/jin-shots';
const PORT = 1420;
const URL = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

async function showSection(page, name) {
  await page.evaluate((sectionName) => {
    document.querySelectorAll('[data-router-target="section"]').forEach((section) => {
      section.classList.toggle('hidden', section.getAttribute('data-section-name') !== sectionName);
    });
  }, name);
  await sleep(700);
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(URL);
      if (response.ok) break;
    } catch {
      // Preview is still starting.
    }
    await sleep(250);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(800);

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  };

  await showSection(page, 'tasks');
  await shot('01-task-ledger');

  const workList = page.locator('.lists-rail__row-btn[data-list-id="work"]').first();
  if (await workList.count()) {
    await workList.click();
    await sleep(500);
    await shot('02-work-scope');
  }

  const firstTask = page.locator('.task-item--row .task-item__body').first();
  if (await firstTask.count()) {
    await firstTask.click();
    await sleep(600);
    await shot('03-task-detail');
    const closeDetail = page.locator('.tasks-detail-pane__close-btn').first();
    if (await closeDetail.count()) {
      await closeDetail.click();
      await sleep(300);
    }
  }

  const toggle = page.locator('.tasks-view-toggle, [data-action*="toggleView"], [aria-label*="Board" i]').first();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await sleep(500);
    await shot('04-board-view');
  }

  await showSection(page, 'notes');
  await shot('05-notes-ledger');

  const fieldNotes = page.locator('.folder-row__btn[data-folder-path="Field Notes"]').first();
  if (await fieldNotes.count()) {
    await fieldNotes.click();
    await sleep(500);
    await shot('06-field-notes-scope');
  }

  const firstNote = page.locator('.note-row .browse-row__inner').first();
  if (await firstNote.count()) {
    await firstNote.click();
    await sleep(700);
    await shot('07-note-detail');
  }

  await page.keyboard.press('Escape').catch(() => {});
  await browser.close();
  console.log('DONE ->', OUT);
} finally {
  server.kill('SIGKILL');
}
