import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { isAllowedPagesFile } from './stage_pages_deploy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const workerPath = path.join(root, 'sw.js');
let worker = await readFile(workerPath, 'utf8');

const match = /const TASK26_INTEGRITY = Object.freeze\((\{[\s\S]*?\})\);/.exec(worker);
if (!match) throw new Error('Existing publication integrity contract is missing');

// Evaluate the declared INSTALL_SHELL graph directly from sw.js so every
// required text/code/CSS/JS/HTML/manifest publication asset is automatically
// integrity-hashed (eliminating manual partial lists and CSS/JS version drift).
const ctx = { self: { addEventListener() {} } };
vm.runInNewContext(`${worker}\n;globalThis.__SHELL = INSTALL_SHELL;`, ctx);
const shellAssets = Array.isArray(ctx.__SHELL) ? [...ctx.__SHELL] : [];
if (!shellAssets.length) throw new Error('INSTALL_SHELL is empty');

const TEXT_ASSET_RE = /^(?:\/|\/index\.html|.*\.(?:html|css|js|mjs|json|txt|webmanifest|svg))$/i;
const entries = {};
for (const url of shellAssets) {
  const pathname = new URL(url, 'https://isolated.example').pathname;
  if (!TEXT_ASSET_RE.test(pathname)) continue;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!isAllowedPagesFile(file) || file.startsWith('functions/')) {
    throw new Error(`Publication path outside the static allowlist: ${file}`);
  }
  const text = (await readFile(path.join(root, file), 'utf8')).replace(/\r\n?/g, '\n');
  entries[url] = createHash('sha256').update(text).digest('hex');
}

const hash = createHash('sha256').update(JSON.stringify(Object.entries(entries))).digest('hex');
worker = worker
  .replace(match[0], `const TASK26_INTEGRITY = Object.freeze(${JSON.stringify(entries, null, 2)});`)
  .replace(/const PUBLICATION_HASH = "[a-f0-9]{64}";/, `const PUBLICATION_HASH = "${hash}";`);
await writeFile(workerPath, worker);
console.log(JSON.stringify({
  publication_hash: hash,
  integrity_entries: Object.keys(entries).length,
  install_shell_total: shellAssets.length,
  prior_core_shell_preserved: true,
}));
