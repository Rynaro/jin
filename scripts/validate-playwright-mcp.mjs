#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path) => readFile(new URL(path, root), 'utf8');
const staticOnly = process.argv.slice(2).includes('--static-only');

for (const argument of process.argv.slice(2))
  assert.equal(argument, '--static-only', `Unknown argument: ${argument}`);

const expectedArgs = ['-y', '@playwright/mcp@0.0.79', '--config', '.agents/playwright/mcp.config.json'];
const expectedServer = { command: 'npx', args: expectedArgs };
const installCommand = 'npx -y @playwright/mcp@0.0.79 install-browser';
const mcp = JSON.parse(await read('.mcp.json'));
assert.deepEqual(mcp.mcpServers.playwright, expectedServer);

const codex = await read('.codex/config.toml');
const managedEnd = codex.indexOf('# eidolon:mcp end');
const playwrightBlock = codex.indexOf('[mcp_servers.playwright]');
assert.ok(managedEnd >= 0 && playwrightBlock > managedEnd, 'Codex registration must remain outside the managed block');

function parseCodexServerBlock(source, header) {
  const lines = source.slice(source.indexOf(header) + header.length).split('\n');
  const parsed = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) break;
    const assignment = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    assert.ok(assignment, `Unsupported line in ${header}: ${trimmed}`);
    const [, key, rawValue] = assignment;
    assert.ok(key === 'command' || key === 'args', `Unexpected key in ${header}: ${key}`);
    assert.ok(!(key in parsed), `Duplicate key in ${header}: ${key}`);
    parsed[key] = JSON.parse(rawValue);
  }
  return parsed;
}

assert.deepEqual(parseCodexServerBlock(codex, '[mcp_servers.playwright]'), expectedServer);

const config = JSON.parse(await read('.agents/playwright/mcp.config.json'));
assert.equal(config.browser.browserName, 'chromium');
assert.equal(config.browser.isolated, true);
assert.equal(config.browser.launchOptions.headless, true);
assert.deepEqual(config.browser.contextOptions.viewport, { width: 1280, height: 800 });
assert.equal(config.browser.contextOptions.locale, 'en-US');
assert.equal(config.browser.contextOptions.timezoneId, 'UTC');
assert.equal(config.browser.contextOptions.reducedMotion, 'reduce');
assert.equal(config.browser.contextOptions.serviceWorkers, 'block');
assert.deepEqual(config.browser.initScript, ['../../jin-gui/tools/tauri-fixture-init.js']);
assert.deepEqual(config.network.allowedOrigins, ['http://127.0.0.1:1420']);
assert.equal(config.outputDir, '.artifacts/playwright-mcp');

const gitignore = await read('.gitignore');
assert.match(gitignore, /^\.artifacts\/$/m);
const packageJson = JSON.parse(await read('jin-gui/package.json'));
assert.equal(packageJson.scripts['dev:agent'], 'vite --host 127.0.0.1 --port 1420 --strictPort');

for (const name of ['jin-playwright-mcp', 'jin-gui-visual-qa']) {
  const skill = await read(`.agents/skills/${name}/SKILL.md`);
  assert.match(skill, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
  assert.equal(await readlink(new URL(`.claude/skills/${name}`, root)), `../../.agents/skills/${name}`);
}

const fixtureSource = await read('jin-gui/tools/tauri-fixture-init.js');
function fixtureWindow(origin, existingBridge) {
  const window = { location: { origin }, structuredClone };
  if (existingBridge) window.__TAURI_INTERNALS__ = existingBridge;
  vm.runInNewContext(fixtureSource, { window, Error, Promise, Object, JSON });
  return window;
}

assert.equal(fixtureWindow('https://example.com').__TAURI_INTERNALS__, undefined);
const realBridge = { invoke() {} };
assert.equal(fixtureWindow('http://127.0.0.1:1420', realBridge).__TAURI_INTERNALS__, realBridge);
const fixtureBridge = fixtureWindow('http://127.0.0.1:1420').__TAURI_INTERNALS__;
const firstTasks = await fixtureBridge.invoke('list_tasks');
firstTasks[0].title = 'mutated by test';
assert.equal((await fixtureBridge.invoke('list_tasks'))[0].title, 'Reply to the design review email');
await assert.rejects(fixtureBridge.invoke('unknown_command'), /Unsupported Jin fixture command/);

async function findPinnedMcpPackage() {
  const candidates = [path.join(rootPath, 'node_modules/@playwright/mcp/package.json')];
  const npmCache = process.env.npm_config_cache || path.join(homedir(), '.npm');
  const npxCache = path.join(npmCache, '_npx');
  for (const entry of await readdir(npxCache).catch(() => []))
    candidates.push(path.join(npxCache, entry, 'node_modules/@playwright/mcp/package.json'));

  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(await readFile(candidate, 'utf8'));
      if (packageJson.name === '@playwright/mcp' && packageJson.version === '0.0.79')
        return candidate;
    } catch {
      // Candidate is absent or incomplete; continue looking for the exact pin.
    }
  }
  return undefined;
}

async function probeBrowserAvailability() {
  const mcpPackage = await findPinnedMcpPackage();
  if (!mcpPackage)
    throw new Error('the pinned @playwright/mcp@0.0.79 package is not available locally');

  const requireFromMcp = createRequire(mcpPackage);
  const playwright = requireFromMcp('playwright-core');
  const browserType = playwright[config.browser.browserName];
  assert.ok(browserType, `Pinned MCP does not provide browser type: ${config.browser.browserName}`);

  const browser = await browserType.launch(config.browser.launchOptions);
  await browser.close();
}

if (staticOnly) {
  console.log('Playwright MCP static registration, config, skills, and fixture validation passed.');
} else {
  try {
    await probeBrowserAvailability();
    console.log('Playwright MCP registration, config, skills, fixture, and browser readiness validation passed.');
  } catch (error) {
    const rawDetail = error instanceof Error ? error.message : String(error);
    const missingExecutable = rawDetail.match(/Executable doesn't exist at ([^\n]+)/);
    const detail = missingExecutable
      ? `configured ${config.browser.browserName} executable does not exist at ${missingExecutable[1]}`
      : rawDetail;
    console.error(`Playwright MCP browser readiness failed: ${detail}`);
    console.error(`Install the browser for the exact repository pin, then rerun validation:\n  ${installCommand}`);
    process.exitCode = 1;
  }
}
