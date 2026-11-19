/** Build once, stamp source content, then run the screenshot reference command. */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function fingerprint() { const files = []; async function walk(path) { const info = await stat(path); if (!info.isDirectory()) return files.push(path); for (const entry of await readdir(path, { withFileTypes: true })) if (!entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(join(path, entry.name)); } for (const input of [join(root, 'src'), join(root, 'index.html'), join(root, 'vite.config.ts'), join(root, 'tools', 'tauri-fixture-init.js')]) await walk(input); const hash = createHash('sha256'); for (const file of files.sort()) { hash.update(file.slice(root.length)); hash.update(await readFile(file)); } return hash.digest('hex'); }
function command(program, args) { return new Promise((resolve, reject) => { const child = spawn(program, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`))); }); }
await command(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
await writeFile(join(root, 'dist', '.jin-visual-build.json'), `${JSON.stringify({ version: 1, sourceFingerprint: await fingerprint() })}\n`);
await command(process.execPath, [join(root, 'tools', 'visual-candidates.mjs'), ...process.argv.slice(2)]);
