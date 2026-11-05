import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const base=new URL(process.env.WYJ_TEST_BASE).origin;
assert.equal(new URL(base).hostname,'127.0.0.1');
async function api(route,payload=null,token='',status=200){
  const response=await fetch(base+route,{method:payload===null?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},body:payload===null?undefined:JSON.stringify(payload)});
  const data=await response.json();assert.equal(response.status,status,route);return data;
}
const admin=await api('/api/login',{username:'wyj',secret:process.env.WYJ_TEST_ADMIN_SECRET});
const username='p07audit'+randomBytes(5).toString('hex'),secret=randomBytes(20).toString('base64url');
await api('/api/register',{username,secret,confirm_secret:secret},'',201);
const user=await api('/api/login',{username,secret});
const created=await api('/api/feedback',{type:'feature_suggestion',title:'Synthetic audit regression',content:'P07-D controlled fixture.'},user.session,201);
await api('/api/admin/feedback/update',{feedback_id:created.feedback.id,action:'update',status:'accepted',admin_note:'P07-D isolated audit check'},admin.session);
const feedback=await api('/api/admin/feedback',null,admin.session);
const combined=await api('/api/admin/audit',null,admin.session);
const direct=feedback.task11_audit.find(x=>x.feedback_id===created.feedback.id&&x.action==='feedback_update');
const surfaced=combined.logs.find(x=>x.feedback_id===created.feedback.id&&x.action==='feedback_update');
const guest=await api('/api/admin/audit',null,'',401);
const denied=await api('/api/admin/audit',null,user.session,403);
assert.equal(guest.logs,undefined);assert.equal(denied.logs,undefined);
await api('/api/notification/pending-summary',null,'',401);
await api('/api/notification/pending-summary',null,user.session,403);
const own=await api('/api/notification/pending-summary',null,admin.session);
assert.equal(own.total_count,0);assert.equal(own.hint_count,0);assert.equal(own.candidate_count,0);assert.deepEqual(own.records,[]);
const result={synthetic:true,stored:!!direct,surfaced:!!surfaced,anonymous_denied:true,nonadmin_denied:true,
  notification:{anonymous_denied:true,free_denied:true,own_total:own.total_count,own_records:own.records},
  source_columns:direct?Object.keys(direct):[],combined_columns:surfaced?Object.keys(surfaced):[]};
await fs.writeFile(path.join(process.env.P07_D_EVIDENCE,'audit-regression.json'),JSON.stringify(result,null,2));
assert.ok(direct,'Feedback operation must be durably audited');
assert.ok(surfaced,'Existing admin audit view must show feedback_update');
assert.equal(surfaced.before_json,undefined);assert.equal(surfaced.after_json,undefined);
console.log(JSON.stringify(result));
