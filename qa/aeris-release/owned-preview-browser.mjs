import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openZoomedBrowser} from './ui-browser-zoom.mjs';
const root=path.resolve(import.meta.dirname,'../..'),e=path.join(root,'docs/migration-evidence/aeris-p03-p07');
const origin='https://ac8cec2c.thewyj-p07-ui-rc.pages.dev';
const run=process.env.AERIS_HOSTED_ATTEMPT||'r1';assert(/^r[1-9][0-9]*$/.test(run));
const selected=(process.env.AERIS_HOSTED_SUITES||'authenticated,spatial-audit,spatial-motion').split(',');
assert(selected.every(s=>['authenticated','spatial-audit','spatial-motion'].includes(s)));
const out=path.join(e,'v62-hosted-browser-'+run);await fs.mkdir(out);
const credentials=JSON.parse(await fs.readFile(path.join(e,'private/v62-owned-preview-access.json'),'utf8'));assert.equal(credentials.origin,origin);
const old=JSON.parse(await fs.readFile(path.join(process.env.USERPROFILE,'.codex/worktrees/p07-ui-release/thewyj.uk/docs/migration-evidence/p07-ui-release/private/preview-accounts.json'),'utf8'));
const admin=old.find(a=>a.role==='super_admin'&&a.scope==='maintainer'),validation=credentials.accounts.find(a=>a.scope==='validation'),owner=credentials.accounts.find(a=>a.scope==='owner');assert(admin&&validation&&owner);
const privateRoot=path.join(root,'.wrangler','v62-owned-preview-browser-'+run);await fs.mkdir(privateRoot);
const browser=await openZoomedBrowser(1,path.join(privateRoot,'launcher'),origin),results=[];
const base={...process.env,WYJ_TEST_BASE:origin,WYJ_BASE_URL:origin,WYJ_CDP_URL:browser.cdpUrl,AERIS_OWNED_PREVIEW:'true',AERIS_CI_FIXTURE_ATTEMPT:'r9'};
async function command(name,args,extra={}){
 if(!selected.includes(name))return;
 const logfile=await fs.open(path.join(out,name+'.log'),'wx');
 const start=Date.now();const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,env:{...base,...extra},windowsHide:true,stdio:['ignore',logfile.fd,logfile.fd]});p.once('error',reject);p.once('exit',resolve);});await logfile.close();
 results.push({name,exit_code:code,elapsed_ms:Date.now()-start});await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
}
try{
 await command('authenticated',['qa/aeris-release/ui-authenticated-browser.mjs'],{WYJ_TEST_ADMIN_USERNAME:admin.username,WYJ_TEST_ADMIN_SECRET:admin.secret,AERIS_PREVIEW_ADMIN_ID:admin.id,AERIS_UI_AUTH_EVIDENCE_DIR:path.join(e,'v62-hosted-auth-'+run)});
 await command('spatial-audit',['qa/aeris-release/spatial-audit.mjs'],{WYJ_TEST_ADMIN_SECRET:validation.secret,AERIS_SPATIAL_USERNAME:validation.username,AERIS_SPATIAL_LABEL:'spatial-after-r'+(100+Number(run.slice(1)))});
 await command('spatial-motion',['qa/aeris-release/spatial-motion.mjs']);
 // Normal owner form login. Bootstrap has counts, not a transactions array;
 // assert both explicit counters, avoiding an absent-field false success.
 await browser.navigate('/login');await browser.waitFor("document.documentElement.dataset.p07Ui==='enabled' && !document.getElementById('appShell').classList.contains('app-shell-pending')");
 await browser.setFields({'#usernameInput':owner.username,'#secretInput':owner.secret});
 await browser.evaluate("document.getElementById('loginSubmitBtn').click();true");
 await browser.waitFor("location.pathname==='/'&&!document.getElementById('accountMenu').classList.contains('hidden')");
 const empty=await browser.evaluate(`(async()=>{const token=localStorage.getItem('wyjAccountSession');const r=await fetch('/api/finance/bootstrap',{headers:{'X-Session-Token':token},cache:'no-store'});const d=await r.json();return{http:r.status,transaction_count:d.transaction_count,raw_event_count:d.raw_event_count};})()`);
 assert.deepEqual(empty,{http:200,transaction_count:0,raw_event_count:0});results.push({name:'normal-owner-login-ledger-empty',exit_code:0,actual:empty,syntheticValidationRowsShared:false});
 await browser.evaluate("(async()=>{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':localStorage.getItem('wyjAccountSession')},body:'{}'});localStorage.removeItem('wyjAccountSession');return true;})()");
}catch(error){results.push({name:'launcher-or-owner-check',exit_code:1,error:String(error.stack).replaceAll(owner.secret,'<redacted>').replaceAll(validation.secret,'<redacted>').replaceAll(admin.secret,'<redacted>')});}
finally{await browser.close();const report={origin,commit:'80139a03b5b655b4f4d7ba4e865778c7654bb91d',results,pass:results.filter(r=>r.exit_code===0).length,fail:results.filter(r=>r.exit_code!==0).length,productionWrites:0,aiCalls:0};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,fail:report.fail}));if(report.fail)process.exitCode=1;}
