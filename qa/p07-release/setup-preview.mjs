import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {connectPreview,setP07,QA_ADMIN_SEED} from './preview-api.mjs';
const arg=k=>process.argv[process.argv.indexOf(k)+1];
const ctx=await connectPreview({sha:arg('--sha'),deploymentId:arg('--deployment')});
await mkdir('.wrangler/p07-closeout',{recursive:true});
const dest='.wrangler/p07-closeout/fixture-secrets.json';let saved;
try{saved=JSON.parse(await readFile(dest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;saved={task:'p07-release-closeout',nonce:randomBytes(4).toString('hex'),accounts:{}};}
const persist=()=>writeFile(dest,JSON.stringify(saved,null,2)+'\n',{mode:0o600});
for(const alias of ['admin','paid','basic','alternate']){
 let u=saved.accounts[alias];if(!u){u={username:'p07c_'+saved.nonce+'_'+alias,secret:randomBytes(24).toString('base64url')};saved.accounts[alias]=u;await persist();const reg=await ctx.api('/api/register',{username:u.username,secret:u.secret,confirm_secret:u.secret});assert.equal(reg.status,201,'QA registration failed '+reg.data.code);}
 let login=await ctx.api('/api/login',{username:u.username,secret:u.secret});assert.equal(login.status,200,'QA login failed');u.id=login.data.account.id;u.session=login.data.session;
 if(alias==='admin'&&!login.data.account.is_admin){const changed=await ctx.query(QA_ADMIN_SEED,[u.id,u.username,new Date().toISOString()]);assert.equal(changed[0].meta.changes,1,'Only the fresh owned Preview normal admin role is seeded');login=await ctx.api('/api/login',{username:u.username,secret:u.secret});assert.equal(login.status,200);assert.equal(login.data.account.is_admin,true);assert.equal(login.data.account.is_super_admin,false);u.session=login.data.session;}
 await persist();
}
for(const alias of ['paid','alternate']){const u=saved.accounts[alias];if(!u.membershipGranted){const grant=await ctx.api('/api/admin/membership/manage',{user_id:u.id,action:'grant',plan_code:'all_access_lifetime',note:'Synthetic isolated P07 release closeout fixture'},saved.accounts.admin.session);assert.equal(grant.status,200,'QA membership grant failed '+grant.data.code);u.membershipGranted=true;await persist();}}
const flag=await setP07(ctx,saved.accounts.admin,{enabled:true,kill_switch:false,channels:['stable','beta','experimental'],rollout_percentage:100});
saved.context={sha:ctx.sha,deploymentId:ctx.deploymentId,origin:ctx.origin,aliases:ctx.aliases,dbId:ctx.dbId};await persist();
const proof={source_sha:ctx.sha,origin:ctx.origin,aliases:ctx.aliases,deployment_id:ctx.deploymentId,db_id:ctx.dbId,flag,fixtures:Object.keys(saved.accounts),only_task_owned_synthetic_accounts:true,production_mutations:0,secrets_recorded_in_evidence:false};await mkdir('docs/migration-evidence/p07-closeout',{recursive:true});await writeFile('docs/migration-evidence/p07-closeout/preview-setup.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
