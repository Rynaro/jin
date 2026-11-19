/** Stamp or verify the production bundle's relevant source fingerprint. */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stampPath = join(root, 'dist', '.jin-gui-build.json');

async function fingerprint() {
  const files = [];
  async function walk(path) {
    const info = await stat(path);
    if (!info.isDirectory()) { files.push(path); return; }
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(join(path, entry.name));
    }
  }
  for (const input of [join(root, 'src'), join(root, 'index.html'), join(root, 'vite.config.ts'), join(root, 'package.json'), join(root, 'package-lock.json'), join(root, 'tools', 'tauri-fixture-init.js')]) await walk(input);
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(file.slice(root.length)); hash.update(await readFile(file)); }
  return hash.digest('hex');
}

const sourceFingerprint = await fingerprint();
if (process.argv.includes('--verify')) {
  const recorded = JSON.parse(await readFile(stampPath, 'utf8'));
  if (recorded.sourceFingerprint !== sourceFingerprint) throw new Error('dist is stale for the current GUI source; run `npm run build` before this browser smoke');
} else {
  await writeFile(stampPath, `${JSON.stringify({ version: 1, sourceFingerprint })}\n`);
}
