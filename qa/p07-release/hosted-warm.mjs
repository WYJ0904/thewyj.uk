import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ownedBrowser,openPage,pointer,ready} from './owned-browser.mjs';
import {connectPreview} from './preview-api.mjs';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
import {observeRelease,seedUserState,verifyOfflineAndData} from '../p07-r4a/upgrade-safety.mjs';
const saved=JSON.parse(await readFile('.wrangler/p07-closeout/fixture-secrets.json','utf8')),i=process.argv.indexOf('--old-deployment'),old=i<0?saved.context:{sha:'e4844a5304709263a2810332eca5d2a87b069d3d',deploymentId:process.argv[i+1],branch:'codex/p07-release-upgrade-lab'};
const ctx=await connectPreview(old),origin=ctx.aliases[0];assert.ok(origin,'audited stable branch alias required');
const out='docs/migration-evidence/p07-closeout',proof={old_sha:old.sha,origin,kind:'actual stable Hosted alias old->new deployment; owned profile, legal synthetic login',production_operations:0,configuration_mutations:0};
const browser=await ownedBrowser('hosted-warm'),p=await openPage({cdpUrl:browser.cdpUrl,baseUrl:origin,width:1440,height:960,mobile:false});
await p.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__p07UpgradeDoc=performance.timeOrigin+Math.random()'});
try{
 await p.send('Page.navigate',{url:origin+'/login'});await ready(p,'authPanel');await p.setFields({'#usernameInput':saved.accounts.paid.username,'#secretInput':saved.accounts.paid.secret});await pointer(p,'#loginSubmitBtn');await ready(p,'publicHome');await p.evaluate('navigator.serviceWorker.ready.then(()=>true)');await p.waitFor("navigator.serviceWorker.controller?.scriptURL.includes('20261108-aeris-p07-release-rc6')",30000,'old RC6 worker controls');
 await p.send('Page.navigate',{url:origin+'/account'});await ready(p,'accountModal');assert.equal(await p.evaluate("document.getElementById('accountProfileUsername').textContent"),saved.accounts.paid.username);
 await seedUserState(p);proof.old_controller=await p.evaluate('navigator.serviceWorker.controller.scriptURL');
 await writeFile('.wrangler/p07-closeout/warm-ready.json',JSON.stringify({state:'READY',old_sha:old.sha,origin})+'\n');console.log('HOSTED_WARM_READY '+old.sha+' '+origin);
 let target;const deadline=Date.now()+30*60000;while(!target&&Date.now()<deadline){try{target=JSON.parse(await readFile('.wrangler/p07-closeout/warm-target.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}if(!target)await new Promise(r=>setTimeout(r,200));}assert.ok(target,'new deployment handoff must arrive within 30 minutes');
 const next=await connectPreview(target);assert.ok(next.aliases.includes(origin));proof.new_sha=target.sha;proof.new_deployment_id=target.deploymentId;
 const list=execFileSync('git',['ls-tree','-r','--name-only',target.sha],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>isAllowedPagesFile(f)&&!f.startsWith('functions/')&&!f.startsWith('assets/')&&/\.(?:html|js|css|webmanifest)$/.test(f));const sources=Object.fromEntries(list.map(f=>[f,execFileSync('git',['show',target.sha+':'+f],{encoding:'utf8'})]));
 const release=sources['js/core/config.js'].match(/ASSET_RELEASE = "([^"]+)"/)[1],observed=observeRelease(p,origin,sources),start=observed.start(),doc=await p.evaluate('__p07UpgradeDoc');await p.send('Page.reload',{ignoreCache:false});await p.waitFor(`__p07UpgradeDoc!==${JSON.stringify(doc)}`,30000,'ordinary new document');await ready(p,'accountModal');assert.equal(await p.evaluate("document.getElementById('accountProfileUsername').textContent"),saved.accounts.paid.username);proof.account_session_preserved=true;proof.responses=await observed.verify(start);
 await p.waitFor(`navigator.serviceWorker.controller?.scriptURL.includes(${JSON.stringify(release)})`,30000,'new Hosted worker controls');
 const path='/js/core/api.js?release=20261108-aeris-p07-release-rc6';const oldBody=await p.evaluate(`fetch(${JSON.stringify(path)}).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);assert.equal(oldBody,createHash('sha256').update(execFileSync('git',['show',old.sha+':js/core/api.js'])).digest('hex'));proof.old_client_bytes_retained=true;
 // The real logged-in upgrade above is separate from the helper's public
 // offline fallback assertions; explicitly logout only this synthetic session.
 await pointer(p,'#accountMenu > summary');await pointer(p,'#logoutBtn');await ready(p,'authPanel');assert.equal(await p.evaluate("!!localStorage.getItem('wyjAccountSession')"),false);proof.real_logout_completed=true;await p.send('Page.navigate',{url:origin+'/'});await ready(p,'publicHome');proof.offline_and_data=await verifyOfflineAndData(p,{out,release,resources:proof.responses});proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;}
finally{await writeFile(out+'/hosted-warm-upgrade.json',JSON.stringify(proof,null,2)+'\n');await p.close();await browser.close();console.log(JSON.stringify({status:proof.status,error:proof.error,old_sha:proof.old_sha,new_sha:proof.new_sha,responses:proof.responses?.length}));}
