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
const round=process.env.P07_QA_ROUND||'p07-r4a';assert.ok(['p07-r4a','p07-r4c'].includes(round));
const output=path.join(root,'docs/migration-evidence',round,label);
assert.equal(await fs.stat(output).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}),false,'Evidence labels cannot be overwritten');
const args=process.argv.slice(3),cache=args.includes('--cache-upgrade'),warmBaseline=args.includes('--warm-baseline');
const target=cache?path.join(process.env.USERPROFILE,`.codex/worktrees/${warmBaseline?'p07-round3-final-ci-review':'p07-round3-red-baseline'}/thewyj.uk`):root;
const work=path.join(qa,'.wrangler','p07-r4a-driver-'+label);await fs.mkdir(work,{recursive:true});
let runner=await fs.readFile(path.join(qa,'qa/p07-d/run.mjs'),'utf8');
function replace(before,after){assert.equal(runner.split(before).length,2,'QA adapter anchor must be unique: '+before.slice(0,70));runner=runner.replace(before,after);}
replace('const PINNED_TARGETS=new Map([',`const PINNED_TARGETS=new Map([\n  ['p07-r4a-runtime','${sha}'],`);
replace('const EVIDENCE_DIR = path.join(ROOT, "docs/migration-evidence/p07-d", LABEL);',`const EVIDENCE_DIR = path.join(${JSON.stringify(root)}, 'docs/migration-evidence/${round}', LABEL);`);
replace('import { stagePages }', 'import { stagePages, isAllowedPagesFile }');
replace('const { output,files } = await stagePages({root:TARGET_ROOT});', `// Keep the existing allowlist validation, with a per-run source/output.
  const stageSource=path.join(QA_WORK_ROOT,'staging-source');await fsp.mkdir(stageSource,{recursive:true});
  const tree=spawnSync('git',['ls-tree','-rz',TARGET_SOURCE_HEAD],{cwd:TARGET_ROOT,encoding:'utf8',maxBuffer:20*1024*1024});assert.equal(tree.status,0);
  for(const row of tree.stdout.split('\\0')){if(!row)continue;const match=row.match(/^(\\d{6})\\s+blob\\s+([0-9a-f]{40})\\t(.+)$/);if(!match||!isAllowedPagesFile(match[3]))continue;
    assert.ok(['100644','100755'].includes(match[1]),'staged input must be a regular Git blob');
    const blob=spawnSync('git',['cat-file','-p',match[2]],{cwd:TARGET_ROOT,maxBuffer:30*1024*1024});assert.equal(blob.status,0);
    const destination=path.join(stageSource,match[3]);await fsp.mkdir(path.dirname(destination),{recursive:true});await fsp.writeFile(destination,blob.stdout);}
  const { output,files } = await stagePages({root:stageSource});`);
const relative=path.relative(qa,work).replaceAll('\\','/');
replace('[\'cache-upgrade\',\'qa/p07-round3/cache-upgrade.mjs\']',`['cache-upgrade','${relative}/cache-upgrade.mjs']`);
replace('const suites = ZOOM_ONLY',`const suites = process.env.P07_R4C_PROBE ? [['r4c-probe','${relative}/r4c-probe.mjs']] : process.env.P07_R4A_PWA_ONLY ? [['r4a-pwa','${relative}/pwa-browser.mjs']] : process.env.P07_R4A_RELOAD_DIAGNOSTIC ? [['r4a-reload','${relative}/reload-diagnostics.mjs']] : process.env.P07_R4A_EXTRA_ONLY ? [['r4a-runtime','${relative}/runtime-browser.mjs']] : ZOOM_ONLY`);
// Miniflare opens HTTP before serve.mjs finishes verifying the one-user seed.
// Do not create browser fixture users until that existing guard has completed.
replace('if (statusRes.ok && uiRes.ok && cdpOk) {', `if (statusRes.ok && uiRes.ok && cdpOk && (!COMPILED || (await fsp.readFile(path.join(QA_WORK_ROOT, 'pages.log'), 'utf8')).includes('READY: compiled Pages worker'))) {`);
replace('[["p07-round3-browser","qa/p07-round3/browser.mjs"],',`[["p07-round3-browser","qa/p07-round3/browser.mjs"],...(FLAG_MODE==='on'?[['r4a-runtime','${relative}/runtime-browser.mjs']]:[]),`);
await fs.writeFile(path.join(work,'runtime-browser.mjs'),`await import(${JSON.stringify(new URL('./runtime-browser.mjs',import.meta.url).href)});\n`);
await fs.writeFile(path.join(work,'reload-diagnostics.mjs'),`await import(${JSON.stringify(new URL('./reload-diagnostics.mjs',import.meta.url).href)});\n`);
await fs.writeFile(path.join(work,'pwa-browser.mjs'),`process.chdir(${JSON.stringify(root)});process.env.AERIS_P5_PWA_OUTPUT=process.env.P07_D_EVIDENCE+'/p5-pwa.json';await import(${JSON.stringify(new URL('../aeris/p5-pwa-browser.mjs',import.meta.url).href)});\n`);
await fs.writeFile(path.join(work,'r4c-probe.mjs'),`await import(${JSON.stringify(new URL('../p07-r4c/runtime-probe.mjs',import.meta.url).href)});\n`);
let upgrade=await fs.readFile(path.join(qa,'qa/p07-round3/cache-upgrade.mjs'),'utf8');
upgrade=upgrade.replace("assert.equal(process.env.P07_D_TARGET_HEAD,'21b83316cbfdeb366c587b9e818a2c64e2199215','warm the exact RED source before upgrade');",
  "assert.ok(['21b83316cbfdeb366c587b9e818a2c64e2199215','f7949f8253f51ea2621c397743208971c0cec467'].includes(process.env.P07_D_TARGET_HEAD),'warm a fixed original source');");
upgrade=upgrade.replace("const oldSha=process.env.P07_D_TARGET_HEAD,newSha=process.env.P07_D_UPGRADE_CANDIDATE_SHA||'fb936d109d0900d02d35eb3493212e4c32c39699';",`const oldSha=process.env.P07_D_TARGET_HEAD,newSha='${sha}';`);
upgrade=upgrade.replace("['fb936d109d0900d02d35eb3493212e4c32c39699','f7949f8253f51ea2621c397743208971c0cec467'].includes(newSha)",`newSha==='${sha}'`);
const files=git(root,'ls-tree','-r','--name-only',sha).split(/\r?\n/).filter(f=>isAllowedPagesFile(f)&&!f.startsWith('functions/')&&!f.startsWith('assets/')&&/\.(?:html|js|css|webmanifest|json|txt)$/.test(f));
upgrade=upgrade.replace(/^const files=\[.*\];$/m,'const files='+JSON.stringify(files)+';');
upgrade=upgrade.replace("const bytes=generation==='candidate'&&next[file]!==undefined?Buffer.from(next[file]):Buffer.from(await original.arrayBuffer());",
  "if(generation==='candidate'&&next[file]!==undefined){headers['content-type']=file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':headers['content-type'];} const bytes=generation==='candidate'&&next[file]!==undefined?Buffer.from(next[file]):Buffer.from(await original.arrayBuffer());");
upgrade=upgrade.replace('let error=null;',`const safety=await import(${JSON.stringify(new URL('./upgrade-safety.mjs',import.meta.url).href)});const observed=safety.observeRelease(page,origin,next);let resources=[];let error=null;`);
upgrade=upgrade.replace("generation='candidate';", "await safety.seedUserState(page);generation='candidate';const resourceStart=observed.start();");
upgrade=upgrade.replace("phases.push(await navigate('normal'));", "phases.push(await navigate('normal'));resources=await observed.verify(resourceStart);");
upgrade=upgrade.replace("assert.ok(phases.filter(p=>p.generation==='candidate').every(p=>p.matchesCandidate),'new HTML reused old cached app.js after same-origin upgrade');",
  "assert.ok(phases.filter(p=>p.generation==='candidate').every(p=>p.matchesCandidate),'new HTML reused old cached app.js after same-origin upgrade');await safety.verifyOfflineAndData(page,{out,release:new URL(newUrl,origin).searchParams.get('v'),resources});");
await fs.writeFile(path.join(work,'cache-upgrade.mjs'),upgrade);await fs.writeFile(path.join(work,'run.mjs'),runner);
const browser=await fs.readFile(path.join(qa,'qa/p07-round3/browser.mjs'));
const provenance={product_sha:sha,qa_sha:git(qa,'rev-parse','HEAD'),frozen_browser_sha256:createHash('sha256').update(browser).digest('hex'),
  adapter_sha256:createHash('sha256').update(await fs.readFile(import.meta.filename)).digest('hex'),assertions_weakened:false,
  transport_changes:['per-run committed allowlist staging prevents shared pages-output races',...(cache?['candidate exact-SHA allowlist text assets, including sw.js and all release-qualified modules','optional fixed f7949f8 warm source']:['new pinned product target only'])]};
await fs.mkdir(path.dirname(output),{recursive:true});
const run=spawnSync(process.execPath,[path.join(work,'run.mjs'),...args.filter(a=>a!=='--warm-baseline')],{cwd:qa,env:{...process.env,P07_D_TARGET_ROOT:target,P07_D_RUN:label},stdio:'inherit',windowsHide:true});
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'r4a-driver-provenance.json'),JSON.stringify(provenance,null,2));
process.exitCode=run.status??1;
