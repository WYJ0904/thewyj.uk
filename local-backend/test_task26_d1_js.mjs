import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { onRequest as dispatch } from '../functions/api/[[path]].js';
import { cloudMiddleware } from '../functions/_lib/cloudflare-foundation.mjs';
import { sessionStorageKey } from '../functions/_lib/task12-crypto.mjs';
import { deterministicBucket } from '../functions/_lib/task25-model.mjs';
import { replayMastery } from '../functions/_lib/task26-mastery.mjs';
import { reconcilePoint } from '../functions/_lib/task26-service.mjs';
import { catalog, COURSE_VERSION } from '../functions/_lib/task26-catalog.mjs';

const root=path.resolve(import.meta.dirname,'..'),runtime=await mkdtemp(path.join(os.tmpdir(),'task26-'));
const mf=new Miniflare({modules:true,script:'export default{fetch(){return new Response("isolated task26 fixture")}}',compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],d1Persist:runtime});
const users={owner:{id:'t26-owner',role:'super_admin'},one:{id:'t26-one',role:'user'},two:{id:'t26-two',role:'user'},free:{id:'t26-free',role:'user'},english:{id:'t26-english',role:'user'},backlog:{id:'t26-backlog',role:'user'}};
const env={CLOUD_FOUNDATION_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK20_ANDROID_APP_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',
 TASK11_CLOUD_READS_ENABLED:'true',TASK11_CLOUD_WRITES_ENABLED:'true',TASK25_FEATURE_FLAGS_ENABLED:'true',TASK26_ADAPTIVE_LEARNING_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',WYJ_ENVIRONMENT:'preview'};
const semantic=({request_id,...rest})=>rest;
let passed=0;const check=s=>{passed++;console.log(`PASS ${passed}: ${s}`);};
try{
 const db=await mf.getD1Database('WYJ_DB');
 for(const f of (await readdir(path.join(root,'cloudflare/migrations'))).filter(f=>/^\d{4}_.+\.sql$/.test(f)&&f<'0025_').sort())await db.exec((await readFile(path.join(root,'cloudflare/migrations',f),'utf8')).replace(/\r?\n/g,' '));
 const now=new Date().toISOString();
 for(const u of Object.values(users)){
  u.token=`isolated-${u.id}-session`;
  await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
   VALUES(?1,?1,?1,'','reset_required',0,?2,?3,?3,?3,?3)`).bind(u.id,u.role,now).run();
  await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind) VALUES(?1,?2,1,?3,?3,?4,'browser')`)
   .bind(await sessionStorageKey(u.token),u.id,now,new Date(Date.now()+86400000).toISOString()).run();
 }
 for(const u of [users.one,users.two,users.english])await db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,is_lifetime,source,source_ref,metadata_json,created_at,updated_at)
  VALUES(?1,?2,?3,?4,1,'test',?1,?5,?4,?4)`).bind(`${u.id}-membership`,u.id,u===users.english?'trial_single_language':'dual_language_lifetime',now,u===users.english?'{"language":"english"}':'{}').run();
 for(const type of ['wrong_book','test_history'])await db.prepare(`INSERT INTO task11_learning_sync_records(user_id,data_type,record_id,payload_json,updated_at,client_id,client_version,created_at,server_updated_at)
  VALUES(?1,?2,?2,'{"language":"english","word":"apple","historical_correct":true}',?3,'legacy-fixture-client','1',?3,?3)`).bind(users.one.id,type,now).run();
 async function request(route,{user=users.one,method='GET',body,raw,headers={},environment={},database=db,middleware=false}={}){
  const h=new Headers(headers);if(user&&!h.has('Cookie'))h.set('X-Session-Token',user.token);
  if(body!==undefined&&!h.has('Content-Type'))h.set('Content-Type','application/json');
  const context={env:{...env,WYJ_DB:database,...environment},data:{requestId:crypto.randomUUID()},request:new Request(`https://preview.thewyj.uk${route}`,{method,headers:h,body:raw??(body===undefined?undefined:JSON.stringify(body))})};
  context.next=()=>dispatch(context);const response=await(middleware?cloudMiddleware(context):dispatch(context));
  return {status:response.status,headers:response.headers,payload:await response.json()};
 }
 const expect=async(status,route,options)=>{const r=await request(route,options);assert.equal(r.status,status,JSON.stringify(r.payload));return r.payload;};
 const post=(route,body,options={})=>request(route,{...options,method:'POST',body});
 const summary=(user=users.one,lang='english')=>expect(200,`/api/learning/mastery/summary?language=${lang}`,{user});
 const flag=async(key,patch={})=>{
  const row=await db.prepare('SELECT revision FROM task25_feature_flags WHERE flag_key=?1').bind(key).first();
  return expect(200,'/api/admin/feature-flags',{user:users.owner,method:'POST',body:{flag_key:key,expected_revision:row.revision,enabled:true,kill_switch:false,channels:['stable','beta','experimental'],rollout_percentage:100,...patch}});
 };
 await expect(503,'/api/learning/mastery/summary?language=english');check('unmigrated schema fails closed without touching legacy APIs');
 const before={};for(const {name} of (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'").all()).results)before[name]=(await db.prepare(`SELECT * FROM "${name}"`).all()).results;
 const migration=(await readFile(path.join(root,'cloudflare/migrations/0025_adaptive_learning_mastery.sql'),'utf8')).replace(/\r?\n/g,' ');
 await db.exec(migration);await db.exec(migration);
 for(const [name,records] of Object.entries(before)){
  const after=(await db.prepare(`SELECT * FROM "${name}"`).all()).results;
  if(name==='task25_feature_flags'){assert.equal(after.length,records.length+5);for(const r of records)assert.deepEqual(after.find(a=>a.flag_key===r.flag_key),r);}
  else assert.deepEqual(after,records,`migration altered ${name}`);
 }
 const seeded=(await db.prepare("SELECT * FROM task25_feature_flags WHERE flag_key IN ('adaptive_learning','mastery_score','adaptive_review','ai_error_explanation','similar_word_explanation')").all()).results;
 assert.equal(seeded.length,5);assert.ok(seeded.every(f=>!f.enabled&&!f.kill_switch&&f.rollout_basis_points===0&&f.channels_json==='["experimental"]'));
 check('full forward migration and replay preserve every legacy row/price/setting; five new flags OFF at 0%');
 await expect(401,'/api/learning/mastery/summary?language=english',{user:null});
 await expect(403,'/api/learning/mastery/summary?language=english');
 await expect(503,'/api/learning/mastery/summary?language=english',{environment:{TASK26_ADAPTIVE_LEARNING_ENABLED:'false'}});
 await expect(503,'/api/learning/mastery/summary?language=english',{environment:{TASK25_FEATURE_FLAGS_ENABLED:'false'}});
 check('auth, master switch and Task25 dependency fail safely');
 for(const key of ['adaptive_learning','mastery_score','adaptive_review','similar_word_explanation'])await flag(key);
 assert.equal((await summary()).summary.studied_count,0);assert.equal((await summary()).summary.average_mastery,0);
 await expect(403,'/api/learning/mastery/summary?language=english',{user:users.free});
 await expect(403,'/api/learning/mastery/summary?language=japanese',{user:users.english});
 await expect(200,'/api/learning/mastery/summary?language=english',{user:users.english});
 check('existing language membership is enforced server-side, empty progress bootstraps at zero');
 const next=async(input={},options={})=>{const r=await post('/api/learning/adaptive/next',{language:'english',mode:'adaptive',...input},options);assert.equal(r.status,200,JSON.stringify(r.payload));return r.payload;};
 const ticketFor=async(q)=>(await db.prepare('SELECT * FROM task26_question_tickets WHERE id=?1').bind(q.ticket_id).first());
 let q=(await next()).question;assert.ok(q.ticket_id);assert.deepEqual(Object.keys(q).sort(),['ticket_id','language','kind','prompt','instruction','knowledge_label','reason','expires_at'].sort());
 assert.ok(!JSON.stringify(q).includes('answers'));const firstTicket=await ticketFor(q);if(q.kind==='spelling')assert.ok(!q.knowledge_label.includes(JSON.parse(firstTicket.point_json).word));
 check('question ticket is opaque; answer and semantic IDs are absent before grading');
 const event=(q,answer)=>({event_id:crypto.randomUUID(),ticket_id:q.ticket_id,kind:'answer_submitted',answer,response_ms:1000});
 let answer=event(q,JSON.parse(firstTicket.question_json).answers[0]);let result=await expect(200,'/api/learning/events',{method:'POST',body:answer});
 assert.equal(result.correct,true);assert.ok(result.score_delta>0);assert.equal(result.account_id,users.one.id);assert.ok(result.correct_answer);assert.equal(result.mastery.attempt_count,1);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task26_learning_events WHERE ticket_id=?1 AND kind='answer_correct'").bind(q.ticket_id).first()).n,1);
 check('server course grading updates one point and emits authoritative correctness event');
 const repeated=await expect(200,'/api/learning/events',{method:'POST',body:answer});assert.deepEqual(semantic(repeated),semantic(result));assert.notEqual(repeated.request_id,result.request_id);
 await expect(409,'/api/learning/events',{method:'POST',body:{...answer,answer:'conflicting answer'}});
 await expect(409,'/api/learning/events',{method:'POST',body:{...answer,event_id:crypto.randomUUID()}});
 await expect(404,'/api/learning/events',{method:'POST',body:answer,user:users.two});
 assert.equal((await summary(users.two)).summary.studied_count,0);
 check('retries return original receipt, conflicting IDs and cross-user/ticket reuse are rejected');
 for(const patch of [{correct:true},{user_id:users.two.id},{score:100},{channel:'experimental'},{timing_verified:true}])await expect(400,'/api/learning/events',{method:'POST',body:{...answer,...patch}});
 await expect(400,'/api/learning/events',{method:'POST',body:{...answer,response_ms:-1}});
 await expect(400,'/api/learning/events',{method:'POST',body:{...answer,response_ms:1.5}});
 await expect(400,'/api/learning/events',{method:'POST',body:{...answer,kind:'answer_correct'}});
 await expect(400,'/api/learning/events',{method:'POST',body:[]});
 await expect(415,'/api/learning/events',{method:'POST',body:answer,headers:{'Content-Type':'text/plain'}});
 await expect(413,'/api/learning/events',{method:'POST',body:{...answer,answer:'a'.repeat(9000)}});
 await expect(400,'/api/learning/mastery/summary?language=english&language=japanese');
 await expect(405,'/api/learning/events');
 check('typed bounded inputs reject client authority, invalid methods, content type and duplicate query keys');
 await expect(403,'/api/learning/adaptive/next',{method:'POST',body:{language:'english'},headers:{Origin:'https://attacker.invalid'},middleware:true});
 const privateResponse=await request('/api/learning/mastery/summary?language=english',{middleware:true});assert.equal(privateResponse.headers.get('Cache-Control'),'private, no-store');
 check('existing CSRF middleware and private response caching protect learning state');
 q=(await next()).question;answer=event(q,'wrong');
 const double=await Promise.all([post('/api/learning/events',answer),post('/api/learning/events',answer)]);
 assert.deepEqual(double.map(r=>r.status),[200,200]);assert.deepEqual(semantic(double[0].payload),semantic(double[1].payload));
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM task26_learning_events WHERE user_id=?1 AND event_id=?2").bind(users.one.id,answer.event_id).first()).n,1);
 check('concurrent identical retries produce one durable event and identical receipts');
 q=(await next()).question;const competing=[event(q,'wrong'),event(q,'another wrong')];
 const race=await Promise.all(competing.map(a=>post('/api/learning/events',a)));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 check('one question has one accepted outcome under concurrent different submissions');
 q=(await next()).question;answer=event(q,'wrong');
 const conflict=await Promise.all([post('/api/learning/events',answer),post('/api/learning/events',{...answer,answer:'different'})]);assert.deepEqual(conflict.map(r=>r.status).sort(),[200,409]);
 check('simultaneous same event ID with different payload cannot bypass digest conflict');
 const target=firstTicket.knowledge_id;
 const parallelQuestions=await Promise.all([next({knowledge_id:target}),next({knowledge_id:target})]);
 await Promise.all(parallelQuestions.map(r=>post('/api/learning/events',event(r.question,'wrong'))));
 const events=(await db.prepare("SELECT * FROM task26_learning_events WHERE user_id=?1 AND knowledge_id=?2 AND kind='answer_submitted' ORDER BY seq").bind(users.one.id,target).all()).results;
 const projection=await db.prepare('SELECT * FROM task26_mastery_states WHERE user_id=?1 AND knowledge_id=?2').bind(users.one.id,target).first();
 assert.deepEqual(JSON.parse(projection.state_json),replayMastery(events.map(e=>({...e,correct:e.correct===1,timing_verified:e.timing_verified===1}))));
 check('concurrent point updates reconcile to exact versioned event replay, no stale overwrite');
 q=(await next()).question;answer=event(q,'wrong');let failProjection=true;
 const wrap=(stmt,sql)=>({_native:stmt,_sql:sql,bind:(...a)=>wrap(stmt.bind(...a),sql),first:(...a)=>stmt.first(...a),all:(...a)=>stmt.all(...a),run:(...a)=>stmt.run(...a)});
 const failingDb={prepare:s=>wrap(db.prepare(s),s),batch:statements=>{
  if(failProjection&&statements.some(s=>s._sql.startsWith('INSERT INTO task26_mastery_states'))){failProjection=false;throw new Error('injected projection transient failure');}return db.batch(statements.map(s=>s._native));}};
 const interrupted=await post('/api/learning/events',answer,{database:failingDb});assert.equal(interrupted.status,503);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task26_learning_events WHERE event_id=?1').bind(answer.event_id).first()).n,1);
 assert.equal((await summary()).projection_pending,true);
 result=await expect(200,'/api/learning/events',{method:'POST',body:answer});assert.equal(result.correct,false);assert.equal((await summary()).projection_pending,false);
 check('answer survives projection failure; same-ID retry repairs state without double counting');
 q=(await next()).question;await db.prepare('UPDATE task26_question_tickets SET expires_at=?1 WHERE id=?2').bind('2000-01-01T00:00:00.000Z',q.ticket_id).run();
 await expect(410,'/api/learning/events',{method:'POST',body:event(q,'wrong')});
 q=(await next()).question;await db.prepare("UPDATE task26_question_tickets SET algorithm_version='mastery-future' WHERE id=?1").bind(q.ticket_id).run();
 await expect(409,'/api/learning/events',{method:'POST',body:event(q,'wrong')});
 check('expired tickets and changed algorithm fail explicitly; old progress remains');
 const en=await summary(),ja=await summary(users.one,'japanese');assert.equal(ja.points.length,0);assert.ok(en.points.length>0);
 await expect(400,'/api/learning/adaptive/next',{method:'POST',body:{language:'japanese',knowledge_id:target}});
 const review=await expect(200,'/api/learning/review?language=english');assert.equal(review.review_count,0);assert.equal((await next({mode:'review'})).question,null);
 check('language isolation, invalid target denial and empty review completion');
 const cookie=await expect(200,'/api/learning/mastery/summary?language=english',{headers:{Cookie:`__Host-wyj_app_access=${users.one.token}`}});
 const native=await expect(200,'/api/learning/mastery/summary?language=english',{headers:{'User-Agent':'Thewyj-Android/1.3.37'}});
 assert.deepEqual(cookie.points,en.points);assert.deepEqual(native.points,en.points);assert.equal(cookie.account_id,native.account_id);
 check('browser/native/WebView transport reads the same canonical account and mastery');
 await expect(403,'/api/admin/learning/metrics');const metrics=await expect(200,'/api/admin/learning/metrics',{user:users.owner});
 assert.ok(metrics.event_counts.length>0);assert.ok(!JSON.stringify(metrics).includes(users.one.id));
 await expect(405,'/api/admin/learning/metrics',{user:users.owner,method:'POST',body:{score:100}});
 check('Admin diagnostics are aggregated and readonly, ordinary users cannot read them');
 await flag('mastery_score',{channels:['experimental']});await expect(403,'/api/learning/mastery/summary?language=english');
 await expect(200,'/api/release-channel',{method:'POST',body:{channel:'experimental',expected_revision:0}});await summary();
 await flag('mastery_score',{rollout_percentage:0});await expect(403,'/api/learning/mastery/summary?language=english');
 let rev=(await db.prepare("SELECT revision FROM task25_feature_flags WHERE flag_key='mastery_score'").first()).revision;
 await expect(200,'/api/admin/feature-flags/override',{user:users.owner,method:'POST',body:{flag_key:'mastery_score',user_id:users.one.id,enabled:true,expected_revision:rev}});await summary();
 await flag('mastery_score',{kill_switch:true});await expect(403,'/api/learning/mastery/summary?language=english');
 await flag('mastery_score');rev=(await db.prepare("SELECT revision FROM task25_feature_flags WHERE flag_key='mastery_score'").first()).revision;
 await expect(200,'/api/admin/feature-flags/override',{user:users.owner,method:'POST',body:{flag_key:'mastery_score',user_id:users.one.id,enabled:null,expected_revision:rev}});
 const bucket=await deterministicBucket('mastery_score',users.one.id);await flag('mastery_score',{rollout_percentage:bucket/100});
 await expect(403,'/api/learning/mastery/summary?language=english');await flag('mastery_score',{rollout_percentage:Math.min(100,(bucket+1)/100)});await summary();
 await flag('mastery_score');await expect(200,'/api/release-channel',{method:'POST',body:{channel:'beta',expected_revision:1}});await summary();
 await expect(200,'/api/release-channel',{method:'POST',body:{channel:'stable',expected_revision:2}});await summary();
 const audit=(await db.prepare("SELECT COUNT(*) AS n FROM task25_flag_audit WHERE flag_key='mastery_score'").first()).n;assert.ok(audit>=10);
 check('Task26 genuinely uses channel, targeted override, deterministic percentage and kill switch with Task25 audit');
 const wrongId=(await db.prepare("SELECT event_id FROM task26_learning_events WHERE user_id=?1 AND kind='answer_submitted' AND correct=0 ORDER BY seq DESC LIMIT 1").bind(users.one.id).first()).event_id;
 await expect(404,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},user:users.two});
 let explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId}});assert.equal(explanation.ai,null);assert.equal(explanation.explanation.source,'course');
 await flag('ai_error_explanation');explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId}});assert.equal(explanation.ai_status,'fallback');
 check('AI is post-answer and account scoped; unavailable AI returns deterministic course explanation');
 let calls=0;const aiEnv={WORKERS_AI_ENABLED:'true',AI:{run:async()=>{calls++;return {response:{why:'这是课程规则对应的错误。',rule:'保留已确定的规则。',example:'A reviewed example.',contrast:'区分题目类型。'}};}}};
 const beforeAi=(await summary()).points;
 explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},environment:aiEnv});assert.equal(explanation.ai_status,'generated');
 explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},environment:aiEnv});assert.equal(explanation.ai_status,'cached');assert.equal(calls,1);
 assert.deepEqual((await summary()).points,beforeAi);check('existing Workers AI cache/quota integration never changes correctness or mastery');
 await db.exec("DELETE FROM task15_ai_cache");
 for(const response of [{response:''},{response:{why:'wrong',rule:'rule',example:'',contrast:'',score:100}},{response:null}]){
  explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},environment:{WORKERS_AI_ENABLED:'true',AI:{run:async()=>response}}});assert.equal(explanation.ai_status,'fallback');
 }
 check('empty/malformed/authority-changing AI output fails to a safe course explanation');
 explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},environment:{WORKERS_AI_ENABLED:'true',AI:{run:async()=>{throw Object.assign(new Error('quota'),{status:429});}}}});assert.equal(explanation.ai_status,'fallback');
 explanation=await expect(200,'/api/learning/explanation',{method:'POST',body:{event_id:wrongId},environment:{WORKERS_AI_ENABLED:'true',AI:{run:()=>new Promise(()=>{})}}});assert.equal(explanation.fallback_code,'ai_timeout');
 check('AI provider quota and real timeout leave learning intact');
 await assert.rejects(db.prepare("UPDATE task26_learning_events SET correct=1 WHERE kind='answer_submitted'").run(),/task26_events_immutable/);
 const stored=(await db.prepare('SELECT * FROM task26_learning_events LIMIT 1').first());assert.ok(!('answer' in stored));assert.ok(!('raw_answer' in stored));
 check('event history is immutable; raw user answer content is not stored');
 // A valid authoritative ledger backlog must be recoverable within D1 query
 // limits: receipt materialization is one JSON-table update, not 120 queries.
 const pointData=catalog('english')[0],questionData=pointData.questions[0],backlogIds=[];
 for(let n=0;n<120;n++){
  const id=crypto.randomUUID(),eventId=crypto.randomUUID(),accepted=new Date(Date.now()+n*1000).toISOString();backlogIds.push(id);
  await db.batch([
   db.prepare(`INSERT INTO task26_question_tickets(id,user_id,language,knowledge_id,question_id,question_json,point_json,course_version,algorithm_version,mode,issued_at,expires_at,outcome_event_id)
    VALUES(?1,?2,'english',?3,?4,?5,?6,?7,'mastery-v1','adaptive',?8,?9,?10)`).bind(id,users.backlog.id,pointData.id,questionData.id,JSON.stringify(questionData),JSON.stringify(pointData),COURSE_VERSION,accepted,new Date(Date.parse(accepted)+86400000).toISOString(),eventId),
   db.prepare(`INSERT INTO task26_learning_events(user_id,event_id,ticket_id,language,knowledge_id,question_id,family,kind,correct,response_ms,timing_verified,difficulty,accepted_at,algorithm_version,source,platform,channel,input_digest)
    VALUES(?1,?2,?3,'english',?4,?5,?6,'answer_submitted',1,5000,1,1,?7,'mastery-v1','adaptive','browser','experimental',?8)`)
    .bind(users.backlog.id,eventId,id,pointData.id,questionData.id,questionData.family,accepted,'1'.repeat(64)),
  ]);
 }
 let prepared=0;const countedDb={prepare:sql=>{prepared++;return db.prepare(sql);},batch:stmts=>db.batch(stmts)};
 const recovered=await reconcilePoint(countedDb,users.backlog.id,'english',pointData.id);assert.equal(recovered.attempt_count,120);assert.equal(recovered.effective_attempt_count,1);assert.ok(prepared<=4);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task26_question_tickets WHERE user_id=?1 AND receipt_json IS NOT NULL').bind(users.backlog.id).first()).n,120);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task11_learning_sync_records WHERE user_id=?1').bind(users.one.id).first()).n,2);
 check('120-event recovery uses four prepared queries, restores every receipt and retains old wrong-book/history');
 const route='/api/learning/mastery/summary',window=Math.floor(Date.now()/1000/60)*60;
 const {sha256Hex}=await import('../functions/_lib/cloudflare-foundation.mjs');const key=await sha256Hex(`task26:GET:${route}\u0000${users.one.id}\u0000${window}`);
 await db.prepare('INSERT INTO cloud_rate_limit_windows(bucket_key,route,window_started_at,expires_at,request_count) VALUES(?1,?2,?3,?4,120)').bind(key,route,window,window+60).run();
 await expect(429,route+'?language=english',{environment:{D1_RATE_LIMIT_ENABLED:'true'}});check('authenticated API enforces existing D1 per-account rate limit');
 console.log(`Task26 D1/API: ${passed} acceptance groups passed`);
}finally{await mf.dispose();await rm(runtime,{recursive:true,force:true});}
