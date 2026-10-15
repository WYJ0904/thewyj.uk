import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {createHash} from 'node:crypto';
import {onRequest as dispatch} from '../../functions/api/[[path]].js';
import {sessionStorageKey} from '../../functions/_lib/task12-crypto.mjs';
import {wrongRecordPrefix,reconcileWrongReview,ensureWrongReviewSchema} from '../../functions/_lib/task26-wrong-review.mjs';
import {sanitizeWrongBook,wrongEntryKey} from '../../js/language/wrong-book.js';
import {wrongReviewSource} from '../../js/language/wrong-review.js';

const root=path.resolve(import.meta.dirname,'../..'),directory=await mkdtemp(path.join(os.tmpdir(),'wrong-review-'));
const mf=new Miniflare({modules:true,script:'export default{fetch(){return new Response("isolated wrong review")}}',compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],d1Persist:directory});
let groups=0;const check=label=>console.log(`PASS ${++groups}: ${label}`);
try{
  const db=await mf.getD1Database('WYJ_DB');
  for(const name of (await readdir(path.join(root,'cloudflare/migrations'))).filter(name=>/^\d{4}_.+\.sql$/.test(name)&&name<'0026_').sort())await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
  const migration=await readFile(path.join(root,'cloudflare/migrations/0026_wrong_book_review.sql'),'utf8');
  const now=new Date().toISOString(),users={one:{id:'wr-one',role:'user'},two:{id:'wr-two',role:'user'},admin:{id:'wr-admin',role:'user'},free:{id:'wr-free',role:'user'}};
  for(const user of Object.values(users)){
    user.token=`fixture-${user.id}`;
    await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
      VALUES(?1,?1,?1,'','reset_required',0,?2,?3,?3,?3,?3)`).bind(user.id,user.role,now).run();
    await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')`)
      .bind(await sessionStorageKey(user.token),user.id,now,new Date(Date.now()+86400000).toISOString()).run();
  }
  await db.prepare("INSERT INTO task18_admin_roles(user_id,role,granted_by_user_id,granted_by_username,granted_at,updated_at) VALUES(?1,'admin',?1,?1,?2,?2)").bind(users.admin.id,now).run();
  for(const user of [users.one,users.two])await db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,is_lifetime,source,source_ref,metadata_json,created_at,updated_at)
    VALUES(?1,?2,'dual_language_lifetime',?3,1,'test',?1,'{}',?3,?3)`).bind(`${user.id}-membership`,user.id,now).run();
  const env={WYJ_DB:db,CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',
    TASK11_CLOUD_READS_ENABLED:'true',TASK11_CLOUD_WRITES_ENABLED:'true',TASK25_FEATURE_FLAGS_ENABLED:'true',TASK26_ADAPTIVE_LEARNING_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',WYJ_ENVIRONMENT:'preview'};
  async function request(input,{user=users.one,method='POST',environment={}}={}){
    const headers={'Content-Type':'application/json'};if(user)headers['X-Session-Token']=user.token;
    const response=await dispatch({env:{...env,...environment},data:{requestId:crypto.randomUUID()},request:new Request(`https://preview.thewyj.uk/api/learning/wrong-review${method==='GET'?'?'+new URLSearchParams(input):''}`,{method,headers,body:method==='POST'?JSON.stringify(input):undefined})});
    return {status:response.status,body:await response.json()};
  }
  const range={profile:'我',scope:'history',language:'english'};
  const record=(word,language='english',kind='meaning',profile='我',scope='history')=>{
    const info=Object.values(sanitizeWrongBook({[word]:{word,language,question_type:kind,wrong_count:7,correct_answer:language==='english'?'苹果':'学校',rubric:{reading:'がっこう'}}}))[0];
    return {info,profile,scope,language,key:wrongEntryKey(word,language,kind),id:wrongRecordPrefix(profile,scope)+Buffer.from(wrongEntryKey(word,language,kind)).toString('base64url')};
  };
  async function save(source,user=users.one){
    await db.prepare(`INSERT INTO task11_learning_sync_records(user_id,data_type,record_id,payload_json,updated_at,client_id,client_version,created_at,server_updated_at)
      VALUES(?1,'wrong_book',?2,?3,?4,'wrong-review-fixture','1',?4,?4) ON CONFLICT(user_id,data_type,record_id) DO UPDATE SET payload_json=excluded.payload_json,deleted=0`)
      .bind(user.id,source.id,JSON.stringify(source.info),now).run();
  }
  const source=record('apple');await save(source);
  assert.equal(await ensureWrongReviewSchema(db),false);
  const protectedTables=['task12_users','task12_sessions','task13_membership_plans','task13_user_memberships','task11_learning_sync_records','task25_feature_flags','task26_question_tickets','task26_learning_events','task26_mastery_states'];
  const baseline=new Map();for(const table of protectedTables)baseline.set(table,(await db.prepare(`SELECT * FROM ${table}`).all()).results);
  await db.exec(migration.replace(/\r?\n/g,' '));await db.exec(migration.replace(/\r?\n/g,' '));
  assert.equal(await ensureWrongReviewSchema(db),true);
  for(const table of protectedTables)assert.deepEqual((await db.prepare(`SELECT * FROM ${table}`).all()).results,baseline.get(table),`0026 modified ${table}`);
  check('0026 migration and replay preserve every existing account, price, membership, wrong record and old Task26 row');
  const input=(source,answer='苹果',patch={})=>({event_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),profile:source.profile,scope:source.scope,language:source.language,record_id:source.id,review_id:source.info.review_id,source_digest:createHash('sha256').update(JSON.stringify(wrongReviewSource(source.info))).digest('hex'),kind:'answer',answer,...patch});
  assert.equal((await request(range,{method:'GET',user:null})).status,401);
  assert.equal((await request(range,{method:'GET'})).status,403);
  await db.prepare("UPDATE task25_feature_flags SET enabled=1,kill_switch=0,channels_json='[\"stable\",\"beta\",\"experimental\"]',rollout_basis_points=10000 WHERE flag_key IN ('adaptive_learning','mastery_score','adaptive_review')").run();
  for(const user of [users.free,users.admin])assert.equal((await request(range,{method:'GET',user})).status,403,'Admin role alone is no learning entitlement');
  assert.equal((await request(range,{method:'GET',environment:{TASK26_ADAPTIVE_LEARNING_ENABLED:'false'}})).status,503);
  check('auth, existing flags, master switch and effective entitlements protect wrong-review APIs');
  const first=input(source);let result=await request(first);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.correct,true);assert.equal(result.body.state.score,20);assert.equal(result.body.state.mastered,false);
  const original=JSON.parse((await db.prepare('SELECT payload_json FROM task11_learning_sync_records WHERE user_id=?1 AND record_id=?2').bind(users.one.id,source.id).first()).payload_json);
  assert.equal(original.wrong_count,7);assert.equal((await request(range,{method:'GET'})).body.states.length,1);
  check('real saved wrong records are graded deterministically, scheduled and retained unchanged');
  const retry=await request(first);assert.deepEqual(retry.body.state,result.body.state);assert.equal(retry.body.event_seq,result.body.event_seq);
  await db.prepare(`INSERT INTO task11_learning_sync_changes(user_id,user_version,data_type,record_id,payload_json,updated_at,deleted,client_id,client_version,mutation_id,created_at)
    SELECT user_id,900001,data_type,record_id,payload_json,updated_at,0,client_id,client_version,'original-rubric-fixture',created_at
    FROM task11_learning_sync_records WHERE user_id=?1 AND record_id=?2`).bind(users.one.id,source.id).run();
  await save({...source,info:{...source.info,correct_answer:'新释义'}});
  const oldGrading=await request(input(source));assert.equal(oldGrading.status,200,JSON.stringify(oldGrading.body));assert.equal(oldGrading.body.correct,true,'Queued old answers must use their original confirmed rubric');
  assert.equal((await request(input(source,'苹果',{source_digest:'f'.repeat(64)}))).body.code,'wrong_review_rubric_pending');
  await save(source);
  check('offline answers bind to the original Task11 rubric and never silently use later device edits');
  assert.equal((await request({...first,answer:'不同答案'})).status,409);
  assert.equal((await request({...first,event_id:crypto.randomUUID()})).status,409);
  const same=await Promise.all([request(input(source)),request(input(source))]);assert.ok(same.every(row=>row.status===200));assert.ok(same.every(row=>row.body.state.score===20));
  const another=input(source);const simultaneous=await Promise.all([request(another),request(another)]);assert.ok(simultaneous.every(row=>row.status===200));assert.equal(simultaneous[0].body.event_seq,simultaneous[1].body.event_seq);
  check('stable attempt/event IDs, concurrent retries and daily cooling prevent duplicate mastery');
  assert.equal((await request(input(source),{user:users.two})).status,409);
  assert.equal((await request(input(source,'苹果',{profile:'另一个人'}))).status,400);
  assert.equal((await request(input(source,'苹果',{language:'japanese'}))).status,409);
  assert.equal((await request(input(source,'苹果',{scope:'current'}))).status,400);
  for(const field of ['score','correct','accepted_at','state'])assert.equal((await request({...input(source),[field]:100})).status,400);
  check('account, profile, language and scope stay separate; clients cannot submit authoritative scores or dates');
  const failed=await request(input(source,'错误'));assert.equal(failed.body.state.incorrect,1);assert.equal(failed.body.state.mastered,false);
  const correction=input(source,'苹果',{kind:'correction',corrects:failed.body.event_id});result=await request(correction);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state.incorrect,0);assert.equal(result.body.state.effective,1);
  const corrected=await request(correction);assert.equal(corrected.body.state.corrected,1);assert.equal(corrected.body.state.attempts,result.body.state.attempts);
  check('manual correction removes the mistaken result exactly once without awarding new evidence');
  for(const language of ['english','japanese'])for(const kind of ['meaning','dictation']){
    const source=record(language==='english'?'apple':'学校',language,kind);await save(source);
    const answer=kind==='meaning'?(language==='english'?'苹果':'学校'):(language==='english'?'apple':'学校 / がっこう');
    const result=await request(input(source,answer));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.correct,true);
  }
  check('English and Japanese meaning/dictation share the original deterministic grading rules');
  await db.prepare("UPDATE task11_learning_sync_records SET deleted=1,payload_json='{}' WHERE user_id=?1 AND record_id=?2").bind(users.one.id,source.id).run();
  assert.equal((await request(input(source))).status,410);assert.equal((await request(range,{method:'GET'})).body.states.some(row=>row.record_id===source.id),false);
  assert.equal((await request(first)).status,200,'An acknowledged event remains idempotent after deletion but never restores the item');
  await save(source);const replacement={...source,info:{...source.info,review_id:source.info.review_id.replace(/legacy$/,'replacement')}};await save(replacement);
  assert.equal((await request(input(source))).status,409);
  const returned=await request(range,{method:'GET'});assert.ok(returned.body.states.every(row=>row.review_id!==replacement.info.review_id));
  check('explicit delete/clear and new entry generations resist stale event resurrection');
  const projected=await reconcileWrongReview(db,users.one.id,'我','english',source.info.review_id);
  await db.prepare('DELETE FROM task26_wrong_review_states WHERE user_id=?1').bind(users.one.id).run();
  const rebuilt=await reconcileWrongReview(db,users.one.id,'我','english',source.info.review_id);assert.deepEqual(projected,rebuilt);
  check('ledger reconstruction is deterministic and preserves corrected history');
  await db.prepare("UPDATE task25_feature_flags SET kill_switch=1 WHERE flag_key='adaptive_review'").run();assert.equal((await request(input(replacement))).status,403);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task11_learning_sync_records WHERE user_id=?1 AND deleted=0").bind(users.one.id).first()).n,4);
  check('kill switch fails closed for smart evidence and retains all original wrong-book data');
  console.log(`Wrong-review D1: ${groups} groups passed`);
}finally{
  await mf.dispose();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('wrong-review-'));
  await rm(directory,{recursive:true,force:true});
}
