// Explicitly restricted to the existing non-production Git Preview resources.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
export const PREVIEW_DB='a3e6253b-689f-49f3-998b-7c5828ea255a';
export const QA_ADMIN_SEED="INSERT INTO task18_admin_roles(user_id,role,granted_by_user_id,granted_by_username,granted_at,updated_at) SELECT u.id,'admin',o.id,o.username,?3,?3 FROM task12_users u CROSS JOIN task12_users o WHERE u.id=?1 AND u.username=?2 AND u.role='user' AND u.banned=0 AND u.deleted=0 AND o.role='super_admin' AND o.banned=0 AND o.deleted=0 ON CONFLICT(user_id) DO NOTHING";
export async function connectPreview({sha,deploymentId,branch='codex/p07-production-release-preflight'}){
 assert.match(sha,/^[a-f0-9]{40}$/);assert.match(deploymentId,/^[a-f0-9-]{36}$/);
 assert.ok(['codex/p07-production-release-preflight','codex/p07-release-upgrade-lab'].includes(branch),'Only the release Preview or its explicitly owned upgrade lab');
 const auth=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(auth.status,0,'Cloudflare metadata authentication unavailable');
 const a=JSON.parse(auth.stdout),token=a.token||a.oauth_token||a.api_token;assert.ok(token);
 const root='https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614';
 async function cf(route,body){const r=await fetch(root+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)}),x=await r.json();assert.equal(x.success,true,'Cloudflare request failed: '+r.status+' '+x.errors?.map(e=>e.code));return x.result;}
 const [project,d]=await Promise.all([cf('/pages/projects/thewyj-uk'),cf('/pages/projects/thewyj-uk/deployments/'+deploymentId)]);
 assert.equal(project.production_branch,'main');assert.equal(d.environment,'preview');assert.equal(d.deployment_trigger.metadata.branch,branch);assert.equal(d.deployment_trigger.metadata.commit_hash,sha);
 for(const cfg of [project.deployment_configs.preview,d]){assert.equal(cfg.d1_databases.WYJ_DB.id,PREVIEW_DB);assert.equal(cfg.r2_buckets.WYJ_STORAGE.name,'wyj-cloud-preview');}
 assert.notEqual(project.deployment_configs.production.d1_databases.WYJ_DB.id,PREVIEW_DB);
 const origin=new URL(d.url).origin;assert.ok(new URL(origin).hostname.endsWith('.thewyj-uk.pages.dev'));
 const aliases=(d.aliases||[]).filter(u=>new URL(u).hostname.endsWith('.thewyj-uk.pages.dev'));
 return{sha,deploymentId,origin,aliases,dbId:PREVIEW_DB,async query(sql,params=[]){
  assert.equal(project.deployment_configs.preview.d1_databases.WYJ_DB.id,PREVIEW_DB);
  assert.ok(/^SELECT\s/i.test(sql)||sql===QA_ADMIN_SEED,'Only read metadata or seed a normal admin role for this task-owned QA account');
  if(!/^SELECT\s/i.test(sql)){assert.match(params[0],/^[a-zA-Z0-9_-]{8,80}$/);assert.match(params[1],/^p07c_[a-f0-9]{8}_admin$/);}
  return cf('/d1/database/'+PREVIEW_DB+'/query',{sql,params});
 },async api(route,body=null,session='',base=origin){assert.ok([origin,...aliases].includes(base),'Only audited Preview URLs');const r=await fetch(base+route,{method:body===null?'GET':'POST',headers:{'Content-Type':'application/json',Origin:base,...(session?{'X-Session-Token':session}:{})},...(body===null?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});return{status:r.status,data:await r.json(),retry_after:r.headers.get('Retry-After')};}};
}
export async function setP07(ctx,admin,changes){const before=await ctx.api('/api/admin/feature-flags',null,admin.session);assert.equal(before.status,200);const row=before.data.flags.find(f=>f.flag_key==='p07_accessibility');const definition={flag_key:'p07_accessibility',description:row?.description||'Isolated P07 closeout acceptance only',enabled:row?.enabled??false,kill_switch:row?.kill_switch??false,channels:row?.channels||['stable','beta','experimental'],rollout_percentage:row?.rollout_percentage??100,expected_revision:row?.revision||0,...changes};const r=await ctx.api('/api/admin/feature-flags',definition,admin.session);assert.equal(r.status,200,'Preview P07 CAS update failed '+r.data.code);return r.data.flag;}
