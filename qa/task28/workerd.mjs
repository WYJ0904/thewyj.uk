import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { sessionStorageKey } from '../../functions/_lib/task12-crypto.mjs';

const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.wrangler/task28/evidence',`workerd-${crypto.randomUUID()}`);
await mkdir(out,{recursive:true});
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const bindings={...config.env.preview.vars,WYJ_ENVIRONMENT:'development',WORKERS_AI_ENABLED:'false',EMAIL_SENDING_ENABLED:'false',D1_RATE_LIMIT_ENABLED:'false',
  TASK22_TRANSFER_READS_ENABLED:'true',TASK22_TRANSFER_WRITES_ENABLED:'true',TASK12_CLOUD_ACCOUNTS_ENABLED:'true',
  WYJ_TASK14_TEMPORARY_SECRET:'task28-workerd-only-synthetic-secret-0123456789'};
const mf=new Miniflare({modules:true,scriptPath:path.join(root,'.wrangler/functions-build/index.js'),compatibilityDate:config.compatibility_date,
  d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE'],bindings,serviceBindings:{ASSETS:()=>new Response('isolated fixture',{status:404})}});
const proof={scope:'compiled Pages Worker in local workerd; isolated D1/R2; streaming synthetic bytes',checks:[],production:'NOT_TOUCHED',hosted:'NOT_TESTED',device:'NOT_TESTED'};
const token='task28-local-workerd-session';
async function call(route,body,method=body===undefined?'GET':'POST',headers={}) {
  const response=await mf.dispatchFetch('https://task28.local'+route,{method,headers:{'X-Session-Token':token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {response,body:await response.json()};
}
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
try {
  const db=await mf.getD1Database('WYJ_DB');
  for(const file of (await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())
    await db.exec((await readFile(path.join(root,'cloudflare/migrations',file),'utf8')).replace(/\r?\n/g,' '));
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at)
    VALUES('task28-runtime','task28-runtime','task28-runtime','','reset_required',0,'user',?1,?1,?1)`).bind(now).run();
  await db.prepare(`INSERT INTO task12_sessions(token_digest,user_id,session_version,created_at,last_seen_at,expires_at,client_kind)
    VALUES(?1,'task28-runtime',1,?2,?2,?3,'browser')`).bind(await sessionStorageKey(token),now,new Date(Date.now()+86400000).toISOString()).run();
  const source=Buffer.alloc(16*1024*1024+123,91);source[source.length-1]=7;
  let handle,share,download;
  await check('actual Worker uploads verified multipart bytes through the existing protocol',async()=>{
    const init=await call('/api/files/v1/uploads',{file_name:'runtime.bin',mime_type:'application/octet-stream',size_bytes:source.length});
    assert.equal(init.response.status,201,JSON.stringify(init.body));handle=init.body.upload;
    for(let n=1;n<=handle.part_count;n+=1) {
      const part=source.subarray((n-1)*handle.part_size,Math.min(n*handle.part_size,source.length));
      const response=await mf.dispatchFetch('https://task28.local'+handle.part_url.replace('{part_number}',n),{method:'PUT',
        headers:{'X-Session-Token':token,'Content-Length':String(part.length),'X-Part-Sha256':createHash('sha256').update(part).digest('hex')},body:part});
      const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));assert.equal(body.part.hash_verified,true);
    }
    const completed=await call(handle.complete_url,{});assert.equal(completed.response.status,200,JSON.stringify(completed.body));share=completed.body.share;
    assert.equal(share.access_scope,'private');assert.equal(share.files[0].integrity_status,'parts_verified');assert.equal(share.files[0].sha256_hex,'');
    assert.equal((await call(handle.complete_url,{})).body.share.id,share.id);
  });
  await check('native fixed-length stream preserves wire length and whole download SHA-256',async()=>{
    const authorized=await call(`/api/files/v1/attachments/${handle.file_id}/authorize`,{});
    assert.equal(authorized.response.status,200,JSON.stringify(authorized.body));download=authorized.body.download;
    const response=await mf.dispatchFetch('https://task28.local'+download.url);
    assert.equal(response.status,200);assert.equal(Number(response.headers.get('Content-Length')),source.length);
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Cache-Control'),/no-store/);
    const hash=createHash('sha256'),reader=response.body.getReader();let length=0,maximumChunk=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;maximumChunk=Math.max(maximumChunk,value.length);hash.update(value);}
    assert.equal(length,source.length);assert.equal(hash.digest('hex'),createHash('sha256').update(source).digest('hex'));
    proof.download={size_bytes:length,maximum_received_chunk:maximumChunk,wire_content_length:source.length,whole_sha256_compared:true};
  });
  await check('native range retry, private owner authorization and revocation work in compiled routing',async()=>{
    const response=await mf.dispatchFetch('https://task28.local'+download.url,{headers:{Range:`bytes=${handle.part_size-5}-${handle.part_size+5}`}});
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),source.subarray(handle.part_size-5,handle.part_size+6));
    const foreign=await mf.dispatchFetch(`https://task28.local/api/transfer/shares/${share.id}/authorize`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(foreign.status,404);await foreign.body.cancel();
    assert.equal((await call(`/api/files/v1/attachments/${handle.file_id}/revoke`,{})).response.status,200);
    const revoked=await mf.dispatchFetch('https://task28.local'+download.url);assert.equal(revoked.status,403);await revoked.body.cancel();
  });
  proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');await mf.dispose();console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,evidence:path.relative(root,out)}));}
