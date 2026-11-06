import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

const root = path.resolve(import.meta.dirname, '../..');
const at = process.argv.indexOf('--commit');
const sha = at >= 0 ? process.argv[at + 1] : '';
assert.match(sha || '', /^[0-9a-f]{40}$/, 'Pass --commit <40-hex-sha>');

const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'f7949f8253f51ea2621c397743208971c0cec467', sha], { cwd: root });
assert.equal(ancestor.status, 0, 'Preview must descend from the fixed product baseline');

// Check that CDP port 19357 is free
await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen({ host: '127.0.0.1', port: 19357, exclusive: true }, () => s.close(resolve));
});

let source = await fs.readFile(path.join(root, 'qa/p07-d/deploy-and-verify-preview.mjs'), 'utf8');
function replace(before, after) {
  assert.equal(source.split(before).length, 2, 'Preview adapter anchor: ' + before);
  source = source.replace(before, after);
}

replace('const BRANCH_NAME = "v62-p07-d-workspaces";', 'const BRANCH_NAME = "codex-p07-r4c-integration";');
source = source.replaceAll('docs/p07/evidence/p07-d/preview', 'docs/p07/evidence/r5/preview');
replace('const cdpPort = 19328;', 'const cdpPort = 19357;');
source = source.replaceAll('p07-d-workspaces-${COMMIT.slice(0, 10)}', 'p07-r5-${COMMIT.slice(0, 10)}');
source = source.replaceAll('Aeris V6.2 P07-D Business Workspaces isolated Preview', 'Aeris V6.2 P07-R5 Browser Defects isolated Preview');
source = source.replaceAll('P07_D_PREVIEW_DEPLOYED_AND_VERIFIED', 'P07_R5_PREVIEW_DEPLOYED_AND_VERIFIED');

const settled = `await page.waitFor("document.readyState==='complete'&&document.documentElement.dataset.interfacePolicy!=='pending'", 30000, 'authoritative hosted interface state');`;
replace('const shotHome1440 =', `${settled}
    const hostedPolicy = await page.evaluate("({policy:document.documentElement.dataset.interfacePolicy,p07:document.documentElement.dataset.p07Ui,homeVisible:document.getElementById('publicHome').checkVisibility(),logoLoaded:[...document.images].some(n=>n.src.includes('/assets/brand/aeris-lockup.png')&&n.complete&&n.naturalWidth>0)})");
    assert.equal(hostedPolicy.homeVisible, true);
    assert.equal(hostedPolicy.logoLoaded, true);
    assert.ok(['enabled','disabled','error'].includes(hostedPolicy.policy));
    const shotHome1440 =`);
replace('await page.navigate("/tools");', `await page.navigate("/tools");\n    ${settled}`);
replace('await page.navigate("/language");', `await page.navigate("/language");\n    ${settled}`);
replace('runtimeErrors: page.runtimeErrors,', `runtimeErrors: page.runtimeErrors,\n      hostedPolicy,`);

const dir = path.join(root, '.wrangler/p07-r5-preview-driver');
await fs.mkdir(dir, { recursive: true });
const file = path.join(dir, 'run.mjs');
await fs.writeFile(file, source);

const run = spawnSync(process.execPath, [file, '--commit', sha], {
  cwd: root,
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = run.status ?? 1;
