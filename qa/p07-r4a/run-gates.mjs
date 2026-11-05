// Reuse PR #124 without merging its report/screenshots/framework into product.
// Copies are ignored, and only target selection/transport inputs are adapted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
const root=path.resolve(import.meta.dirname,'../..'),qa=path.resolve(process.env.P07_R4A_QA_ROOT||path.join(process.env.USERPROFILE,'.codex/worktrees/p07-round3-independent-qa/thewyj.uk'));
const git=(dir,...args)=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8',maxBuffer:20*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
assert.equal(git(qa,'rev-parse','HEAD'),'882efdb9978f2608c54bc6c9c19eb8843e80945f','PR124 driver must be fixed');
assert.equal(git(qa,'status','--porcelain','--untracked-files=no'),'','do not alter the independent QA checkout');
const sha=git(root,'rev-parse','HEAD');assert.match(sha,/^[0-9a-f]{40}$/);
assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','commit product inputs before exact-SHA validation');
const label=process.argv[2];assert.match(label||'',/^[a-z0-9-]+$/);
const args=process.argv.slice(3),cache=args.includes('--cache-upgrade'),warmBaseline=args.includes('--warm-baseline');
const target=cache?path.join(process.env.USERPROFILE,`.codex/worktrees/${warmBaseline?'p07-round3-final-ci-review':'p07-round3-red-baseline'}/thewyj.uk`):root;
const work=path.join(qa,'.wrangler','p07-r4a-driver-'+label);await fs.mkdir(work,{recursive:true});
let runner=await fs.readFile(path.join(qa,'qa/p07-d/run.mjs'),'utf8');
function replace(before,after){assert.equal(runner.split(before).length,2,'QA adapter anchor must be unique: '+before.slice(0,70));runner=runner.replace(before,after);}
replace('const PINNED_TARGETS=new Map([',`const PINNED_TARGETS=new Map([\n  ['p07-r4a-runtime','${sha}'],`);
replace('const EVIDENCE_DIR = path.join(ROOT, "docs/migration-evidence/p07-d", LABEL);',`const EVIDENCE_DIR = path.join(${JSON.stringify(root)}, 'docs/migration-evidence/p07-r4a', LABEL);`);
const relative=path.relative(qa,work).replaceAll('\\','/');
replace('[\'cache-upgrade\',\'qa/p07-round3/cache-upgrade.mjs\']',`['cache-upgrade','${relative}/cache-upgrade.mjs']`);
replace('const suites = ZOOM_ONLY',`const suites = process.env.P07_R4A_EXTRA_ONLY ? [['r4a-runtime','${relative}/runtime-browser.mjs']] : ZOOM_ONLY`);
// Miniflare opens HTTP before serve.mjs finishes verifying the one-user seed.
// Do not create browser fixture users until that existing guard has completed.
replace('if (statusRes.ok && uiRes.ok && cdpOk) {', `if (statusRes.ok && uiRes.ok && cdpOk && (!COMPILED || (await fsp.readFile(path.join(QA_WORK_ROOT, 'pages.log'), 'utf8')).includes('READY: compiled Pages worker'))) {`);
replace('[["p07-round3-browser","qa/p07-round3/browser.mjs"],',`[["p07-round3-browser","qa/p07-round3/browser.mjs"],...(FLAG_MODE==='on'?[['r4a-runtime','${relative}/runtime-browser.mjs']]:[]),`);
await fs.writeFile(path.join(work,'runtime-browser.mjs'),`await import(${JSON.stringify(new URL('./runtime-browser.mjs',import.meta.url).href)});\n`);
let upgrade=await fs.readFile(path.join(qa,'qa/p07-round3/cache-upgrade.mjs'),'utf8');
upgrade=upgrade.replace("assert.equal(process.env.P07_D_TARGET_HEAD,'21b83316cbfdeb366c587b9e818a2c64e2199215','warm the exact RED source before upgrade');",
  "assert.ok(['21b83316cbfdeb366c587b9e818a2c64e2199215','f7949f8253f51ea2621c397743208971c0cec467'].includes(process.env.P07_D_TARGET_HEAD),'warm a fixed original source');");
upgrade=upgrade.replace("const oldSha=process.env.P07_D_TARGET_HEAD,newSha=process.env.P07_D_UPGRADE_CANDIDATE_SHA||'fb936d109d0900d02d35eb3493212e4c32c39699';",`const oldSha=process.env.P07_D_TARGET_HEAD,newSha='${sha}';`);
upgrade=upgrade.replace("['fb936d109d0900d02d35eb3493212e4c32c39699','f7949f8253f51ea2621c397743208971c0cec467'].includes(newSha)",`newSha==='${sha}'`);
const files=git(root,'ls-tree','-r','--name-only',sha).split(/\r?\n/).filter(f=>isAllowedPagesFile(f)&&!f.startsWith('functions/')&&!f.startsWith('assets/')&&/\.(?:html|js|css|webmanifest|json|txt)$/.test(f));
upgrade=upgrade.replace(/^const files=\[.*\];$/m,'const files='+JSON.stringify(files)+';');
upgrade=upgrade.replace("const bytes=generation==='candidate'&&next[file]!==undefined?Buffer.from(next[file]):Buffer.from(await original.arrayBuffer());",
  "if(generation==='candidate'&&next[file]!==undefined){headers['content-type']=file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':headers['content-type'];} const bytes=generation==='candidate'&&next[file]!==undefined?Buffer.from(next[file]):Buffer.from(await original.arrayBuffer());");
await fs.writeFile(path.join(work,'cache-upgrade.mjs'),upgrade);await fs.writeFile(path.join(work,'run.mjs'),runner);
const browser=await fs.readFile(path.join(qa,'qa/p07-round3/browser.mjs'));
const provenance={product_sha:sha,qa_sha:git(qa,'rev-parse','HEAD'),frozen_browser_sha256:createHash('sha256').update(browser).digest('hex'),
  adapter_sha256:createHash('sha256').update(await fs.readFile(import.meta.filename)).digest('hex'),assertions_weakened:false,
  transport_changes:cache?['candidate exact-SHA allowlist text assets, including sw.js and all release-qualified modules','optional fixed f7949f8 warm source']:['new pinned product target only']};
const output=path.join(root,'docs/migration-evidence/p07-r4a',label);await fs.mkdir(path.dirname(output),{recursive:true});
const run=spawnSync(process.execPath,[path.join(work,'run.mjs'),...args.filter(a=>a!=='--warm-baseline')],{cwd:qa,env:{...process.env,P07_D_TARGET_ROOT:target,P07_D_RUN:label},stdio:'inherit',windowsHide:true});
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'r4a-driver-provenance.json'),JSON.stringify(provenance,null,2));
process.exitCode=run.status??1;
