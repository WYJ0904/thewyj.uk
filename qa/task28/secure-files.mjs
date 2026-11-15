import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { onRequest } from '../../functions/api/[[path]].js';
import { sessionStorageKey,hashSecret } from '../../functions/_lib/task12-crypto.mjs';
import { sha256Hex } from '../../functions/_lib/cloudflare-foundation.mjs';
import { securityState, activeUser } from '../../functions/_lib/task27-store.mjs';
import { createChallenge } from '../../functions/_lib/task27-auth.mjs';
import { secureFilesV1 } from '../../functions/_lib/secure-file-service.mjs';
import * as transfer from '../../functions/_lib/task22-service.mjs';
import * as temporary from '../../functions/_lib/task14-service.mjs';
import { fileSha256Hex, readBoundedBytes, MAX_BUFFER_BYTES, inspectFileBytes } from '../../functions/_lib/secure-file-policy.mjs';
import { scanFileOrphans } from '../../functions/_lib/secure-file-cleanup.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'.wrangler/task28/evidence',crypto.randomUUID());
await mkdir(out,{recursive:true});
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('isolated fixture')}}",
  compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE']});
const db=await mf.getD1Database('WYJ_DB'),storage=await mf.getR2Bucket('WYJ_STORAGE');
const env={WYJ_DB:db,WYJ_STORAGE:storage,WYJ_ENVIRONMENT:'preview',
  TASK12_CLOUD_ACCOUNTS_ENABLED:'true',TASK13_CLOUD_READS_ENABLED:'true',
  TASK14_CLOUD_READS_ENABLED:'true',TASK14_CLOUD_WRITES_ENABLED:'true',TASK14_TEMPORARY_PRIMARY_ENABLED:'true',TASK14_IMPORT_ENABLED:'true',
  TASK22_TRANSFER_READS_ENABLED:'true',TASK22_TRANSFER_WRITES_ENABLED:'true',D1_RATE_LIMIT_ENABLED:'false',
  WYJ_TASK14_TEMPORARY_SECRET:'task28-only-synthetic-share-secret-0123456789',
  WYJ_TASK12_PASSWORD_PEPPER:'task28-only-synthetic-password-pepper-0123456789'};
const users={a:{id:'task28-user-a',token:'task28-synthetic-token-a'},b:{id:'task28-user-b',token:'task28-synthetic-token-b'},
  admin:{id:'task28-admin',token:'task28-synthetic-admin-token',is_super_admin:true}};
const proof={scope:'local isolated Miniflare D1/R2; synthetic files and accounts only',checks:[],
  hosted:'NOT_TESTED',production:'NOT_TOUCHED',android_device:'NOT_TESTED',maximum_buffer_bytes:MAX_BUFFER_BYTES};
const one=async(sql,...args)=>db.prepare(sql).bind(...args).first();
const bytes=value=>new TextEncoder().encode(value);
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(key in overrides)return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
function context(request=new Request('https://task28.test/api/files/v1/uploads'),overrides={}) {
  return {request,env:{...env,...overrides},data:{requestId:crypto.randomUUID()},waitUntil(p){void p.catch(()=>undefined);}};
}
async function call(route,{token=users.a.token,body,raw,method=body===undefined&&raw===undefined?'GET':raw?'PUT':'POST',headers={},overrides={}}={}) {
  const h=new Headers(headers);if(token)h.set('X-Session-Token',token);
  if(raw){h.set('Content-Length',String(raw.byteLength));h.set('Content-Type','application/octet-stream');}
  else if(body!==undefined)h.set('Content-Type','application/json');
  const response=await onRequest(context(new Request('https://task28.test'+route,{method,headers:h,
    body:raw || (body===undefined?undefined:JSON.stringify(body))}),overrides));
  const payload=response.headers.get('Content-Type')?.startsWith('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
  return {status:response.status,headers:response.headers,payload};
}
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function open({name='fixture.bin',mime='application/octet-stream',data=bytes('synthetic file bytes'),account=users.a,scope='share',count=1,total=data.length,guest_id,password=''}={}) {
  const session=await transfer.createUploadSession(db,account,env,{file_count:count,total_bytes:total,access_scope:scope,guest_id,password});
  const file=await transfer.allocateUploadFile(db,account,{...env,WYJ_STORAGE:storage},{session_id:session.id,guest_id,
    file_id:'file-'+crypto.randomUUID().replaceAll('-',''),relative_path:name,file_name:name,mime_type:mime,size_bytes:data.length});
  return {session_id:session.id,file_id:file.id,file,data,account,guest_id};
}
async function put(handle,data=handle.data,number=1,bucket=storage,hash=null) {
  const request=new Request('https://task28.test/api/transfer/uploads/parts',{method:'PUT',headers:{'Content-Length':String(data.length),
    ...(hash===null?{}:{'X-Part-Sha256':hash})},body:data});
  return await transfer.uploadPart(db,bucket,handle.account,request,handle.session_id,handle.file_id,number,'preview',handle.guest_id);
}
const complete=(h,bucket=storage,database=db)=>transfer.completeUploadSession(database,bucket,h.account,env,{session_id:h.session_id,guest_id:h.guest_id});
const abort=h=>transfer.abortUploadSession(db,storage,h.account,{session_id:h.session_id,guest_id:h.guest_id});
let privateHandle,privateShare,legacyKey,legacyBytes;
try {
  const migrations=(await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
  for(const file of migrations.filter(n=>n<'0038')) await db.exec((await readFile(path.join(root,'cloudflare/migrations',file),'utf8')).replace(/\r?\n/g,' '));
  const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
  for(const user of Object.values(users)) {
    await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
      VALUES(?1,?1,?1,'','reset_required',0,?2,?3,?3,?3)`).bind(user.id,user.is_super_admin?'super_admin':'user',now).run();
    await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind)
      VALUES(?1,?2,1,?3,?3,?4,'browser')`).bind(await sessionStorageKey(user.token),user.id,now,expires).run();
  }
  legacyBytes=bytes('historical object survives additive migration');
  legacyKey='transfers/v2/preview/objects/legacy-file-000001/file';
  await storage.put(legacyKey,legacyBytes);
  await db.prepare(`INSERT INTO task22_shares(id,owner_kind,owner_ref,total_bytes,file_count,max_downloads,created_at,updated_at,expires_at)
    VALUES('legacy-share-000001','user',?1,?2,1,20,?3,?3,?4)`).bind(users.a.id,legacyBytes.length,now,expires).run();
  await db.prepare(`INSERT INTO task22_share_files(share_id,file_id,relative_path,file_name,mime_type,size_bytes,part_size,part_count,preview_policy,object_key,sha256_hex)
    VALUES('legacy-share-000001','legacy-file-000001','legacy.txt','legacy.txt','text/plain',?1,5242880,1,'preview',?2,?3)`)
    .bind(legacyBytes.length,legacyKey,'b'.repeat(64)).run();
  const snapshot=JSON.stringify((await db.prepare('SELECT id,owner_ref,total_bytes,created_at FROM task22_shares ORDER BY id').all()).results);
  await db.exec((await readFile(path.join(root,'cloudflare/migrations/0038_task28_secure_files.sql'),'utf8')).replace(/\r?\n/g,' '));

  await check('additive migration preserves existing users, share rows, R2 bytes and unverified hash semantics',async()=>{
    assert.equal(JSON.stringify((await db.prepare('SELECT id,owner_ref,total_bytes,created_at FROM task22_shares ORDER BY id').all()).results),snapshot);
    assert.equal((await one('SELECT COUNT(*) AS n FROM task12_users')).n,3);
    assert.equal((await one("SELECT access_scope FROM task22_shares WHERE id='legacy-share-000001'")).access_scope,'share');
    assert.equal((await one("SELECT integrity_status FROM task22_share_files WHERE file_id='legacy-file-000001'")).integrity_status,'legacy_unverified');
    assert.deepEqual(new Uint8Array(await (await storage.get(legacyKey)).arrayBuffer()),legacyBytes);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  });
  await check('concurrent initialization reuses one owner-scoped request, file and daily quota entry',async()=>{
    const input={file_name:'repeat.bin',mime_type:'application/octet-stream',size_bytes:64,idempotency_key:crypto.randomUUID()};
    const before=Number((await one('SELECT create_count FROM task22_usage_daily WHERE owner_ref=?1',users.a.id))?.create_count || 0);
    const handles=await Promise.all([1,2].map(()=>secureFilesV1.initializeAttachment(context(),users.a,input)));
    assert.equal(handles[0].session_id,handles[1].session_id);assert.equal(handles[0].file_id,handles[1].file_id);
    assert.equal((await one('SELECT create_count FROM task22_usage_daily WHERE owner_ref=?1',users.a.id)).create_count,before+1);
    await assert.rejects(secureFilesV1.initializeAttachment(context(),users.a,{...input,file_name:'changed.bin'}),{code:'file_idempotency_conflict'});
    assert.equal((await one('SELECT state FROM task22_upload_sessions WHERE id=?1',handles[0].session_id)).state,'active');
    const foreign=await secureFilesV1.initializeAttachment(context(),users.b,input);assert.notEqual(foreign.session_id,handles[0].session_id);
    await transfer.abortUploadSession(db,storage,users.a,{session_id:handles[0].session_id});
    await transfer.abortUploadSession(db,storage,users.b,{session_id:foreign.session_id});
  });
  await check('private attachment initializes through v1, reuses transfer parts and publishes once',async()=>{
    const data=bytes('private synthetic attachment 中文');
    const init=await call('/api/files/v1/uploads',{body:{file_name:'attachment.txt',mime_type:'text/plain',size_bytes:data.length}});
    assert.equal(init.status,201,JSON.stringify(init.payload));privateHandle={...init.payload.upload,data,account:users.a};
    assert.ok(!JSON.stringify(init.payload).includes('object_key'));
    await put(privateHandle,data,1,storage,await fileSha256Hex(data));
    const resume=await secureFilesV1.resume(context(),users.a,privateHandle);
    assert.deepEqual(resume.files[0].uploaded_parts,[1]);
    privateShare=await complete(privateHandle);
    assert.equal(privateShare.access_scope,'private');
    assert.equal(privateShare.files[0].sha256_hex,await fileSha256Hex(data));
    assert.equal(privateShare.files[0].integrity_status,'full_sha256_verified');
    assert.equal((await complete(privateHandle)).id,privateShare.id);
  });
  await check('private metadata, grants, deletion and upload sessions deny other accounts, guests and administrators',async()=>{
    for(const token of [users.b.token,users.admin.token,'']) {
      assert.ok((await call(`/api/files/v1/attachments/${privateHandle.file_id}`,{token})).status>=400);
      assert.ok((await call(`/api/files/v1/attachments/${privateHandle.file_id}/authorize`,{token,body:{}})).status>=400);
      assert.ok((await call(`/api/files/v1/attachments/${privateHandle.file_id}/revoke`,{token,body:{}})).status>=400);
      assert.equal((await call(`/api/transfer/shares/${privateShare.id}`,{token})).status,404);
      assert.equal((await call(`/api/transfer/shares/${privateShare.id}/authorize`,{token,body:{file_id:privateHandle.file_id}})).status,404);
    }
    const h=await open();
    assert.equal((await call(`/api/transfer/uploads/${h.session_id}`,{token:users.b.token})).status,404);
    assert.equal((await call(`/api/transfer/uploads/${h.session_id}/abort`,{token:users.admin.token,body:{}})).status,404);
    assert.equal((await call(h.file?`/api/transfer/uploads/${h.session_id}/files/${h.file_id}/parts/1`:'',{token:users.b.token,raw:h.data})).status,404);
    await abort(h);
  });
  await check('file-scoped grants reject forgery, cross-file replay and expiry while preserving range retry',async()=>{
    const authorized=await call(`/api/files/v1/attachments/${privateHandle.file_id}/authorize`,{body:{}});
    assert.equal(authorized.status,200,JSON.stringify(authorized.payload));
    const url=authorized.payload.download.url;
    const read=await call(url,{token:''});assert.equal(read.status,200);assert.deepEqual(read.payload,privateHandle.data);
    const range=await call(url,{token:'',headers:{Range:'bytes=1-4'}});assert.equal(range.status,206);assert.deepEqual(range.payload,privateHandle.data.subarray(1,5));
    assert.equal((await call(url.replace(privateHandle.file_id,'another-file-000001'),{token:''})).status,403);
    assert.equal((await call(url.replace(/grant=.*/,`grant=${'x'.repeat(43)}`),{token:''})).status,403);
    const expired=await db.prepare("UPDATE task22_download_grants SET expires_at='2000-01-01T00:00:00Z' WHERE token_digest=?1")
      .bind(await sha256Hex(authorized.payload.download.token)).run();assert.equal(expired.meta.changes,1);
    assert.equal((await call(url,{token:''})).status,403);
  });
  await check('known-type spoofing and forged hashes fail before committing; correct retry succeeds',async()=>{
    const data=new Uint8Array(64);data.set([137,80,78,71,13,10,26,10]);
    const h=await open({name:'image.png',mime:'image/png',data});
    await assert.rejects(put(h,new Uint8Array(64)),{code:'file_signature_invalid'});
    await assert.rejects(put(h,data,1,storage,'0'.repeat(64)),{code:'transfer_part_hash_mismatch'});
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_upload_parts WHERE file_id=?1',h.file_id)).n,0);
    await put(h,data,1,storage,await fileSha256Hex(data));
    const other=data.slice();other[63]=1;
    await assert.rejects(put(h,other),{code:'transfer_part_hash_conflict'});
    await complete(h);
  });
  await check('HTML SVG and unsupported ordinary binaries download with sandbox, attachment, nosniff and no-store',async()=>{
    for(const name of ['active.html','active.svg','payload.unknown']) {
      const h=await open({name,mime:'text/html',data:bytes('<script>throw new Error("must not execute")</script>')});
      await put(h);const share=await complete(h);
      const grant=await transfer.authorizeShareDownload(db,storage,env,{id:share.id});
      const result=await call(`/api/transfer/shares/${share.id}/download?file=${h.file_id}&grant=${grant.token}`,{token:''});
      assert.equal(result.headers.get('Content-Type'),'application/octet-stream');
      assert.match(result.headers.get('Content-Disposition'),/^attachment;/);
      assert.match(result.headers.get('Content-Security-Policy'),/sandbox/);
      assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');assert.match(result.headers.get('Cache-Control'),/no-store/);
      assert.deepEqual(result.payload,h.data);
    }
    assert.throws(()=>inspectFileBytes('photo.png','text/html',new Uint8Array([137,80,78,71,13,10,26,10])),{code:'file_signature_invalid'});
  });
  await check('path traversal, encoded paths, arbitrary storage fields and cross-origin writes fail closed',async()=>{
    for(const name of ['../secret.txt','%2e%2e%2fsecret.txt','a\\..\\secret.txt','bad\r\nname.txt']) {
      assert.equal((await call('/api/files/v1/uploads',{body:{file_name:name,mime_type:'text/plain',size_bytes:64}})).status,400);
    }
    assert.equal((await call('/api/files/v1/uploads',{body:{file_name:'normal.bin',size_bytes:64,object_key:legacyKey}})).status,400);
    assert.equal((await call('/api/files/v1/uploads',{body:{file_name:'normal.bin',size_bytes:64},headers:{Origin:'https://foreign.test'}})).status,403);
    assert.equal((await call('/api/transfer/uploads',{body:{file_count:1,total_bytes:64},headers:{Origin:'https://foreign.test'}})).status,403);
  });
  await check('untrusted bodies and fractional sizes stay within a bounded buffer and cancel oversized streams',async()=>{
    let cancelled=false;
    const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}});
    const request=new Request('https://task28.test/api/upload',{method:'PUT',headers:{'Content-Length':'64'},body:stream,duplex:'half'});
    await assert.rejects(readBoundedBytes(request,64,64),{code:'request_too_large'});assert.equal(cancelled,true);
    await assert.rejects(readBoundedBytes(new Request('https://task28.test'),MAX_BUFFER_BYTES+1),RangeError);
    const largeJson=bytes('['+'0,'.repeat(600000)+'0]');
    const jsonPolicy=inspectFileBytes('large.json','application/json',largeJson,{complete:true});
    assert.equal(jsonPolicy.validation_status,'download_only');assert.equal(jsonPolicy.detected_mime,'application/octet-stream');
    const h=await open();await assert.rejects(put(h,h.data.subarray(1)),{code:'transfer_part_size_mismatch'});await abort(h);
    assert.equal((await call('/api/files/v1/uploads',{body:{file_name:'fraction.bin',size_bytes:1.5}})).status,400);
  });
  await check('concurrent quota reservations cannot exceed the existing guest allowance and cancel releases it',async()=>{
    const guest_id='guest:'+crypto.randomUUID(),total=50*1024*1024;
    const base=await transfer.createUploadSession(db,null,env,{guest_id,file_count:1,total_bytes:total-10});
    const race=await Promise.allSettled([1,2].map(()=>transfer.createUploadSession(db,null,env,{guest_id,file_count:1,total_bytes:10})));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.code,'transfer_storage_quota_exceeded');
    assert.equal((await transfer.transferCapabilities(db,null,{guest_id})).used_bytes,total);
    await transfer.abortUploadSession(db,storage,null,{guest_id,session_id:base.id});
    assert.equal((await transfer.abortUploadSession(db,storage,null,{guest_id,session_id:base.id})).no_change,true);
    assert.equal((await transfer.transferCapabilities(db,null,{guest_id})).used_bytes,10);
  });
  await check('concurrent last daily quota slot is charged once atomically with its reservation',async()=>{
    const guest_id='guest:'+crypto.randomUUID(),ref=await transfer.__testing.guestOwnerRef(guest_id),when=new Date().toISOString();
    await db.prepare('INSERT INTO task22_usage_daily(owner_ref,usage_date,create_count,updated_at) VALUES(?1,?2,19,?3)').bind(ref,when.slice(0,10),when).run();
    const race=await Promise.allSettled([1,2].map(()=>transfer.createUploadSession(db,null,env,{guest_id,total_bytes:64,file_count:1})));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.code,'transfer_daily_quota_exceeded');
    assert.equal((await one('SELECT create_count FROM task22_usage_daily WHERE owner_ref=?1',ref)).create_count,20);
    assert.equal((await transfer.transferCapabilities(db,null,{guest_id})).used_bytes,64);
  });
  await check('concurrent file allocations respect declared count and size',async()=>{
    const s=await transfer.createUploadSession(db,users.b,env,{file_count:1,total_bytes:64});
    const race=await Promise.allSettled([1,2].map(n=>transfer.allocateUploadFile(db,users.b,env,{session_id:s.id,file_id:'file-'+crypto.randomUUID().replaceAll('-',''),
      relative_path:`f${n}.bin`,file_name:`f${n}.bin`,mime_type:'application/octet-stream',size_bytes:64})));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_upload_files WHERE session_id=?1',s.id)).n,1);
    await transfer.abortUploadSession(db,storage,users.b,{session_id:s.id});
  });
  await check('R2 part failure retains a resumable verified intent and never publishes a missing part',async()=>{
    const h=await open();
    const broken=proxy(storage,{resumeMultipartUpload(){return {async uploadPart(){throw new Error('synthetic R2 write fault');}};}});
    await assert.rejects(put(h,h.data,1,broken),/synthetic R2/);
    await assert.rejects(complete(h),{code:'transfer_part_missing'});
    await put(h);assert.ok((await complete(h)).id);
  });
  await check('D1 publication failure after R2 complete recovers without completing the MPU twice',async()=>{
    const h=await open();await put(h);let completed=0;
    const observed=proxy(storage,{resumeMultipartUpload(key,id){const upload=storage.resumeMultipartUpload(key,id);return proxy(upload,{async complete(parts){completed+=1;return await upload.complete(parts);}});}});
    const broken=proxy(db,{async batch(){throw new Error('synthetic D1 commit fault');}});
    await assert.rejects(complete(h,observed,broken),/synthetic D1/);
    assert.ok(await storage.head(h.file.object_key));
    assert.equal((await one('SELECT state FROM task22_upload_sessions WHERE id=?1',h.session_id)).state,'active');
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_shares WHERE id=(SELECT share_id FROM task22_upload_sessions WHERE id=?1)',h.session_id)).n,0);
    assert.ok((await complete(h,observed)).id);assert.equal(completed,1);
  });
  await check('complete versus cancel is fenced; a losing cancel cannot delete a published object',async()=>{
    const h=await open();await put(h);let enter,release;
    const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
    const blocked=proxy(storage,{resumeMultipartUpload(key,id){const upload=storage.resumeMultipartUpload(key,id);return proxy(upload,{async complete(parts){enter();await gate;return await upload.complete(parts);}});}});
    const finishing=complete(h,blocked);await entered;
    try {await assert.rejects(abort(h),{code:'transfer_finalize_in_progress'});}finally{release();}
    const share=await finishing;assert.ok(share.id);assert.ok(await storage.head(h.file.object_key));
    await assert.rejects(abort(h),{code:'transfer_session_published'});
    assert.ok(await storage.head(h.file.object_key));
  });
  await check('parallel complete requests create one share and retries return the same ID',async()=>{
    const h=await open();await put(h);
    const results=await Promise.allSettled([complete(h),complete(h)]);
    const success=results.find(r=>r.status==='fulfilled');assert.ok(success);
    for(const r of results.filter(r=>r.status==='rejected')) assert.equal(r.reason.code,'transfer_finalize_in_progress');
    assert.equal((await complete(h)).id,success.value.id);
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_shares s JOIN task22_upload_sessions u ON u.share_id=s.id WHERE u.id=?1',h.session_id)).n,1);
  });
  await check('multi-part content, resume and cross-boundary ranges preserve bytes without claiming a full-file hash',async()=>{
    const data=new Uint8Array(16*1024*1024+123);data.fill(71);data[data.length-1]=9;
    const h=await open({data});const split=Number(h.file.part_size);
    await put(h,data.subarray(0,split),1,storage,await fileSha256Hex(data.subarray(0,split)));
    await assert.rejects(complete(h),{code:'transfer_incomplete_upload'});
    assert.deepEqual((await transfer.uploadSessionState(db,users.a,{session_id:h.session_id})).files[0].uploaded_parts,[1]);
    await put(h,data.subarray(split),2,storage,await fileSha256Hex(data.subarray(split)));
    const share=await complete(h);assert.equal(share.files[0].integrity_status,'parts_verified');assert.equal(share.files[0].sha256_hex,'');
    const grant=await transfer.authorizeShareDownload(db,storage,env,{id:share.id});
    const result=await call(`/api/transfer/shares/${share.id}/download?file=${h.file_id}&grant=${grant.token}`,{token:'',headers:{Range:`bytes=${split-4}-${split+4}`}});
    assert.equal(result.status,206);assert.deepEqual(result.payload,data.subarray(split-4,split+5));
  });
  await check('guest sharing keeps its password contract and concurrent last-download authorization has one winner',async()=>{
    const guest_id='guest:'+crypto.randomUUID(),h=await open({account:null,guest_id,password:'Synthetic password'});await put(h);const share=await complete(h);
    await db.prepare('UPDATE task22_shares SET max_downloads=1 WHERE id=?1').bind(share.id).run();
    await assert.rejects(transfer.authorizeShareDownload(db,storage,env,{id:share.id,password:'wrong'}),{code:'share_password_invalid'});
    const results=await Promise.allSettled([1,2,3].map(()=>transfer.authorizeShareDownload(db,storage,env,{id:share.id,password:'Synthetic password'})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await one('SELECT download_count FROM task22_shares WHERE id=?1',share.id)).download_count,1);
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_download_grants WHERE share_id=?1',share.id)).n,1);
    assert.equal((await call(`/api/transfer/shares/${share.id}/revoke`,{body:{guest_id}})).status,403);
    assert.equal((await call('/api/transfer/uploads',{token:'',headers:{'X-Transfer-Guest-Id':guest_id},body:{guest_id,access_scope:'private',total_bytes:64,file_count:1}})).status,403);
    assert.equal((await call('/api/transfer/uploads',{token:'revoked-or-forged-session',headers:{'X-Transfer-Guest-Id':guest_id},body:{guest_id,total_bytes:64,file_count:1}})).status,401);
  });
  await check('revoke immediately denies existing/new grants, failed physical deletion retries, and quota is not duplicated',async()=>{
    const grant=await call(`/api/files/v1/attachments/${privateHandle.file_id}/authorize`,{body:{}});assert.equal(grant.status,200);
    const failed=proxy(storage,{async delete(){throw new Error('synthetic R2 delete fault');}});
    const before=await transfer.transferCapabilities(db,users.a);
    const result=await transfer.revokeShare(db,failed,users.a,{id:privateShare.id});assert.equal(result.cleanup_pending,true);
    assert.equal((await call(grant.payload.download.url,{token:''})).status,403);
    assert.equal((await call(`/api/files/v1/attachments/${privateHandle.file_id}/authorize`,{body:{}})).status,404);
    const after=await transfer.transferCapabilities(db,users.a);assert.equal(before.used_bytes-after.used_bytes,privateHandle.data.length);
    await db.prepare("UPDATE task22_shares SET cleanup_retry_at='' WHERE id=?1").bind(privateShare.id).run();
    await transfer.cleanupExpiredTransfers(db,storage,{limit:100,environment:'preview'});
    assert.equal(await storage.head(`transfers/v2/preview/objects/${privateHandle.file_id}/file`),null);
    assert.equal((await secureFilesV1.revoke(context(),users.a,{file_id:privateHandle.file_id})).no_change,true);
  });
  await check('orphan scan paginates, preserves foreign/malformed keys and protects historical references',async()=>{
    const keys=['transfers/v2/preview/objects/orphan-object-000001/file','transfers/v2/production/objects/orphan-object-000002/file',
      'transfers/v2/preview/objects/not-owned/anything','unrelated/object'];
    const deleted=[],old=new Date(Date.now()-3*86400000);
    const fake=proxy(storage,{async list({prefix,cursor,limit}){const list=[{key:legacyKey,uploaded:old},...keys.map(key=>({key,uploaded:old}))].filter(x=>x.key.startsWith(prefix));
      const offset=Number(cursor || 0),objects=list.slice(offset,offset+limit);return {objects,truncated:offset+objects.length<list.length,cursor:String(offset+objects.length)};},
      async delete(key){deleted.push(key);}});
    for(let i=0;i<12;i++){const result=await scanFileOrphans(db,fake,{family:'transfer',environment:'preview',limit:1});assert.ok(result.orphan_inspected<=1);}
    assert.ok(deleted.includes(keys[0]));assert.ok(!deleted.includes(legacyKey));
    for(const key of keys.slice(1))assert.ok(!deleted.includes(key));
  });
  await check('legacy objects remain readable and declared historical hashes never become verified whole-file hashes',async()=>{
    const grant=await transfer.authorizeShareDownload(db,storage,env,{id:'legacy-share-000001'});
    assert.equal(grant.share.files[0].integrity_status,'legacy_unverified');assert.equal(grant.share.files[0].sha256_hex,'');
    const result=await call(`/api/transfer/shares/legacy-share-000001/download?file=legacy-file-000001&grant=${grant.token}`,{token:''});
    assert.equal(result.status,200);assert.deepEqual(result.payload,legacyBytes);
  });
  await check('expired shares deny both existing bearer grants and new authorizations',async()=>{
    const h=await open();await put(h);const share=await complete(h);
    const grant=await transfer.authorizeShareDownload(db,storage,env,{id:share.id});
    await db.prepare("UPDATE task22_shares SET expires_at='2000-01-01T00:00:00Z' WHERE id=?1").bind(share.id).run();
    assert.equal((await call(`/api/transfer/shares/${share.id}/download?file=${h.file_id}&grant=${grant.token}`,{token:''})).status,403);
    await assert.rejects(transfer.authorizeShareDownload(db,storage,env,{id:share.id}),{code:'share_not_found'});
  });
  await check('R2 cleanup plus D1 release failure retains its retry evidence and releases logical quota once',async()=>{
    const h=await open();await put(h);
    const before=await transfer.transferCapabilities(db,users.a);
    const broken=proxy(db,{async batch(){throw new Error('synthetic cleanup D1 commit fault');}});
    const result=await transfer.abortUploadSession(broken,storage,users.a,{session_id:h.session_id});assert.equal(result.cleanup_pending,true);
    const pending=await one('SELECT * FROM task22_upload_sessions WHERE id=?1',h.session_id);assert.equal(pending.cleanup_state,'pending');
    assert.equal((await one('SELECT COUNT(*) AS n FROM task22_upload_parts WHERE session_id=?1',h.session_id)).n,1);
    const after=await transfer.transferCapabilities(db,users.a);assert.equal(before.used_bytes-after.used_bytes,h.data.length);
    await db.prepare("UPDATE task22_upload_sessions SET cleanup_retry_at='' WHERE id=?1").bind(h.session_id).run();
    await transfer.cleanupExpiredTransfers(db,storage,{limit:100,environment:'preview'});
    assert.equal((await one('SELECT cleanup_state FROM task22_upload_sessions WHERE id=?1',h.session_id)).cleanup_state,'complete');
    assert.equal((await transfer.transferCapabilities(db,users.a)).used_bytes,after.used_bytes);
  });
  await check('failed allocation rollback journals the losing MPU and retry never deletes the winning object',async()=>{
    const s=await transfer.createUploadSession(db,users.b,env,{file_count:1,total_bytes:64});
    let loserId='',aborts=0;
    const wrapped=proxy(storage,{async createMultipartUpload(...args){const upload=await storage.createMultipartUpload(...args);loserId=upload.uploadId;
      return proxy(upload,{async abort(){aborts+=1;throw new Error('synthetic allocation rollback R2 fault');}});}});
    const broken=proxy(db,{prepare(sql){const statement=db.prepare(sql);if(sql.includes('INSERT INTO task22_upload_files'))return {bind(){return {async first(){throw new Error('synthetic file allocation D1 fault');}};}};return statement;}});
    await assert.rejects(transfer.allocateUploadFile(broken,users.b,{...env,WYJ_STORAGE:wrapped},{session_id:s.id,file_id:'journal-file-000001',
      relative_path:'journal.bin',file_name:'journal.bin',mime_type:'application/octet-stream',size_bytes:64}),/synthetic file allocation D1 fault/);
    assert.equal(aborts,1);assert.ok(await one('SELECT upload_id FROM task28_multipart_cleanup WHERE upload_id=?1',loserId));
    const file=await transfer.allocateUploadFile(db,users.b,env,{session_id:s.id,file_id:'journal-file-000001',relative_path:'journal.bin',file_name:'journal.bin',mime_type:'application/octet-stream',size_bytes:64});
    const h={session_id:s.id,file_id:file.id,file,data:new Uint8Array(64),account:users.b};await put(h);await complete(h);
    await transfer.cleanupExpiredTransfers(db,storage,{limit:100,environment:'preview'});
    assert.equal(await one('SELECT upload_id FROM task28_multipart_cleanup WHERE upload_id=?1',loserId),null);
    assert.ok(await storage.head(file.object_key));
  });
  await check('multi-batch cleanup resumes beyond its object budget and preserves unrelated objects',async()=>{
    const shareId='budget-share-000001',count=45,created=new Date().toISOString();
    await db.prepare(`INSERT INTO task22_shares(id,owner_kind,owner_ref,total_bytes,file_count,created_at,updated_at,expires_at)
      VALUES(?1,'user',?2,?3,?4,?5,?5,?6)`).bind(shareId,users.b.id,count*16,count,created,new Date(Date.now()+86400000).toISOString()).run();
    const keys=Array.from({length:count},(_,i)=>`transfers/v2/preview/objects/budget-file-${String(i).padStart(8,'0')}/file`);
    await Promise.all(keys.map(key=>storage.put(key,new Uint8Array(16))));
    await db.batch(keys.map((key,i)=>db.prepare(`INSERT INTO task22_share_files(share_id,file_id,relative_path,file_name,mime_type,size_bytes,part_size,part_count,preview_policy,object_key)
      VALUES(?1,?2,?3,?3,'application/octet-stream',16,5242880,1,'download_only',?4)`).bind(shareId,`budget-file-${String(i).padStart(8,'0')}`,`file-${i}.bin`,key)));
    let heads=0;
    const bounded=proxy(storage,{async head(...args){heads+=1;assert.ok(heads<=1,'whole-share grant must not fan out per file');return await storage.head(...args);}});
    assert.ok((await transfer.authorizeShareDownload(db,bounded,env,{id:shareId})).token);assert.equal(heads,0);
    assert.equal((await transfer.revokeShare(db,storage,users.b,{id:shareId})).cleanup_pending,true);
    assert.equal((await one('SELECT state FROM task22_shares WHERE id=?1',shareId)).state,'revoked');
    let complete=false;
    for(let i=0;i<4&&!complete;i++) {
      await db.prepare("UPDATE task22_shares SET cleanup_retry_at='' WHERE id=?1").bind(shareId).run();
      const result=await transfer.cleanupExpiredTransfers(db,storage,{limit:100,objectBudget:2,environment:'preview'});assert.ok(result.object_operations<=2);
      complete=(await one('SELECT state FROM task22_shares WHERE id=?1',shareId)).state==='deleted';
    }
    assert.equal(complete,true);for(const key of keys)assert.equal(await storage.head(key),null);assert.ok(await storage.head(legacyKey));
  });
  await check('Task14 file ownership denies administrator override and an uncertain successful D1 commit keeps published bytes',async()=>{
    const when=new Date().toISOString();
    await db.prepare(`INSERT INTO task13_user_memberships(id,user_id,plan_code,starts_at,expires_at,is_lifetime,status,source,source_ref,created_by,metadata_json,created_at,updated_at)
      VALUES('task28-fixture-membership',?1,'all_access_lifetime',?2,'',1,'active','test','task28-fixture',?3,'{}',?2,?2)`).bind(users.a.id,when,users.admin.id).run();
    const data=bytes('temporary synthetic content');
    const reservation=await temporary.createFileReservation(db,users.a,env,{file_name:'temporary.txt',mime_type:'text/plain',size_bytes:data.length});
    const request=new Request('https://task28.test/api/temporary/file/upload',{method:'PUT',headers:{'Content-Type':'text/plain','Content-Length':String(data.length)},body:data});
    const uncertain=proxy(db,{async batch(statements){await db.batch(statements);throw new Error('synthetic lost D1 acknowledgement');}});
    const file=await temporary.uploadFileObject(uncertain,storage,users.a,request,reservation.id);assert.equal(file.integrity_status,'full_sha256_verified');
    const row=await one('SELECT * FROM task14_shares WHERE id=?1',reservation.id);assert.equal(row.state,'active');assert.ok(await storage.head(row.r2_object_key));
    await assert.rejects(temporary.cancelFileReservation(db,storage,users.admin,reservation.id),{code:'temporary_upload_not_found'});
    const download=await temporary.authorizeFileDownload(db,storage,env,{id:reservation.id});
    await db.prepare("UPDATE task14_shares SET expires_at='2000-01-01T00:00:00Z' WHERE id=?1").bind(reservation.id).run();
    await assert.rejects(temporary.streamFileDownload(context(new Request('https://task28.test'+download.url)),reservation.id,download.token),{code:'temporary_download_grant_invalid'});
    const json=bytes('['+'0,'.repeat(600000)+'0]');
    const jsonReservation=await temporary.createFileReservation(db,users.a,env,{file_name:'large.json',mime_type:'application/json',size_bytes:json.length});
    const jsonFile=await temporary.uploadFileObject(db,storage,users.a,new Request('https://task28.test/api/temporary/file/upload',{method:'PUT',
      headers:{'Content-Type':'application/json','Content-Length':String(json.length)},body:json}),jsonReservation.id);
    assert.equal(jsonFile.validation_status,'download_only');
    const jsonGrant=await temporary.authorizeFileDownload(db,storage,env,{id:jsonReservation.id});
    const response=await temporary.streamFileDownload(context(new Request('https://task28.test'+jsonGrant.url)),jsonReservation.id,jsonGrant.token);
    assert.equal(response.headers.get('Content-Type'),'application/octet-stream');assert.equal((await response.arrayBuffer()).byteLength,json.length);
  });
  await check('Task14 cancellation during R2 put cannot publish an orphan or delete another file',async()=>{
    const data=bytes('cancel synthetic content');
    const reservation=await temporary.createFileReservation(db,users.a,env,{file_name:'cancel.txt',mime_type:'text/plain',size_bytes:data.length});
    let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
    const blocked=proxy(storage,{async put(...args){enter();await gate;return await storage.put(...args);}});
    const uploading=temporary.uploadFileObject(db,blocked,users.a,new Request('https://task28.test/api/temporary/file/upload',{method:'PUT',
      headers:{'Content-Type':'text/plain','Content-Length':String(data.length)},body:data}),reservation.id);
    await entered;await temporary.cancelFileReservation(db,storage,users.a,reservation.id);release();
    await assert.rejects(uploading,{code:'temporary_upload_state_conflict'});
    assert.equal(await one('SELECT id FROM task14_shares WHERE id=?1',reservation.id),null);
    assert.equal((await storage.list({prefix:`temporary/v1/preview/files/${reservation.id}`})).objects.length,0);assert.ok(await storage.head(legacyKey));
    assert.equal((await temporary.cancelFileReservation(db,storage,users.a,reservation.id)).no_change,true);
  });
  await check('unacknowledged MPU creation retains a scoped recovery intent instead of claiming cleanup success',async()=>{
    const s=await transfer.createUploadSession(db,users.b,env,{file_count:1,total_bytes:64});
    const uncertain=proxy(storage,{async createMultipartUpload(){throw new Error('synthetic R2 create acknowledgement lost');}});
    await assert.rejects(transfer.allocateUploadFile(db,users.b,{...env,WYJ_STORAGE:uncertain},{session_id:s.id,file_id:'unknown-mpu-000001',
      relative_path:'unknown.bin',file_name:'unknown.bin',mime_type:'application/octet-stream',size_bytes:64}),/synthetic R2/);
    const intent=await one("SELECT * FROM task28_multipart_cleanup WHERE session_id=?1 AND intent_kind='create_unknown'",s.id);assert.ok(intent);
    const result=await transfer.cleanupExpiredTransfers(db,storage,{limit:100,environment:'preview'});assert.ok(result.multipart_unknown_pending>=1);
    assert.ok(await one('SELECT upload_id FROM task28_multipart_cleanup WHERE upload_id=?1',intent.upload_id));assert.ok(await storage.head(legacyKey));
  });
  await check('interactive cleanup requires a session-bound single-use Task27 step-up and keeps administrative audit',async()=>{
    assert.ok((await call('/api/admin/task22/cleanup',{token:users.admin.token,body:{limit:1}})).status>=400);
    const password='Synthetic-Task28-Admin-Password!';
    await db.prepare("UPDATE task12_users SET password_hash=?2,password_scheme='pbkdf2_sha256',password_iterations=310000 WHERE id=?1")
      .bind(users.admin.id,await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER)).run();
    const issued=await call('/api/security/stepup',{token:users.admin.token,body:{password,scope:'files_cleanup'}});
    assert.equal(issued.status,200,JSON.stringify(issued.payload));assert.ok(issued.payload.grant);
    const options={token:users.admin.token,body:{limit:1},headers:{'X-Aeris-Stepup':issued.payload.grant}};
    assert.equal((await call('/api/admin/task22/cleanup',options)).status,200);
    assert.ok((await call('/api/admin/task22/cleanup',options)).status>=400);
    assert.ok((await one("SELECT COUNT(*) AS n FROM task18_admin_action_audit WHERE action='task22_cleanup' AND success=1")).n>=1);
    assert.ok((await one('SELECT COUNT(*) AS n FROM task28_file_events')).n>0);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  });
  await check('oversized chunked administrative bodies reject promptly even when the router tees them for audit',async()=>{
    const user=await activeUser(db,users.admin.id),state=await securityState(db,user.id);
    const grant=await createChallenge(db,{user,state,kind:'grant',sessionDigest:await sessionStorageKey(users.admin.token),scope:'files_cleanup'});
    let chunks=0,timer;
    const stream=new ReadableStream({pull(controller){if(chunks++<1024)controller.enqueue(new Uint8Array(1024));else controller.close();}});
    const request=new Request('https://task28.test/api/admin/task22/cleanup',{method:'POST',headers:{'Content-Type':'application/json',
      'X-Session-Token':users.admin.token,'X-Aeris-Stepup':grant.token},body:stream,duplex:'half'});
    try {
      const response=await Promise.race([onRequest(context(request)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('oversized audited request did not settle')),10000);})]);
      assert.equal(response.status,413);assert.equal((await response.json()).code,'request_too_large');assert.ok(chunks<1024);
    } finally {clearTimeout(timer);}
  });
  proof.status='PASS';
} catch(error) {proof.status='FAIL';proof.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally {await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');await mf.dispose();console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,evidence:path.relative(root,out)}));}
