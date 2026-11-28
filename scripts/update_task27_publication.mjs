import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isAllowedPagesFile } from './stage_pages_deploy.mjs';
const root=path.resolve(import.meta.dirname,'..'),workerPath=path.join(root,'sw.js');
let worker=await readFile(workerPath,'utf8');
const match=/const TASK26_INTEGRITY = Object.freeze\((\{[\s\S]*?\})\);/.exec(worker);
if (!match) throw new Error('Existing publication integrity contract is missing');
const entries=JSON.parse(match[1]);
const release=(await readFile(path.join(root,'js/core/config.js'),'utf8')).match(/ASSET_RELEASE = "([^"]+)"/)[1];
for(const file of ['js/account/security-center.js','js/account/policy-page.js','js/account/policy-version.js','js/account/password-policy.js','js/account/password-fields.js','js/core/api.js','js/core/router.js','js/core/session.js','js/transfer/app.js'])entries[`/${file}?release=${release}`]='';
for(const url of Object.keys(entries)) {
  const pathname=new URL(url,'https://isolated.example').pathname,file=pathname==='/'?'index.html':pathname.slice(1);
  if (!isAllowedPagesFile(file)||file.startsWith('functions/'))throw new Error('Publication path outside the static allowlist');
  entries[url]=createHash('sha256').update((await readFile(path.join(root,file),'utf8')).replace(/\r\n?/g,'\n')).digest('hex');
}
const hash=createHash('sha256').update(JSON.stringify(Object.entries(entries))).digest('hex');
worker=worker.replace(match[0],`const TASK26_INTEGRITY = Object.freeze(${JSON.stringify(entries,null,2)});`).replace(/const PUBLICATION_HASH = "[a-f0-9]{64}";/,`const PUBLICATION_HASH = "${hash}";`);
await writeFile(workerPath,worker);
console.log(JSON.stringify({publication_hash:hash,integrity_entries:Object.keys(entries).length,prior_core_shell_preserved:true}));
