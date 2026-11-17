import { isCanonicalObjectKey } from './secure-file-policy.mjs';

export function cleanupStorageBudget(storage,maximum=40) {
  let remaining=maximum;
  const take=()=>{if(remaining<=0){const error=new Error('Cleanup operation budget exhausted');error.code='cleanup_budget_exhausted';throw error;}remaining-=1;};
  return new Proxy(storage,{get(target,key){
    if(key==='cleanupRemaining')return remaining;
    if(key==='resumeMultipartUpload')return (...args)=>{const upload=target.resumeMultipartUpload(...args);return {async abort(){take();return await upload.abort();}};};
    const value=target[key];return typeof value==='function'?async(...args)=>{take();return await value.apply(target,args);}:value;
  }});
}

export async function enqueueMultipartAbort(db,sessionId,fileId,key,uploadId) {
  if(!isCanonicalObjectKey(key,'transfer')) throw new Error('Invalid multipart cleanup scope');
  await db.prepare(`INSERT INTO task28_multipart_cleanup(upload_id,session_id,file_id,object_key,created_at)
    VALUES(?1,?2,?3,?4,?5) ON CONFLICT(upload_id) DO UPDATE SET retry_at=''`).bind(uploadId,sessionId,fileId,key,new Date().toISOString()).run();
}

export async function beginMultipartAllocation(db,sessionId,fileId,key) {
  if(!isCanonicalObjectKey(key,'transfer'))throw new Error('Invalid multipart allocation scope');
  const id='intent:'+crypto.randomUUID();
  await db.prepare(`INSERT INTO task28_multipart_cleanup(upload_id,intent_kind,session_id,file_id,object_key,retry_at,created_at)
    VALUES(?1,'create_unknown',?2,?3,?4,?5,?6)`).bind(id,sessionId,fileId,key,new Date(Date.now()+600000).toISOString(),new Date().toISOString()).run();
  return id;
}

export async function retryMultipartAborts(db,storage,limit) {
  const rows=(await db.prepare(`SELECT * FROM task28_multipart_cleanup WHERE intent_kind='abort' AND (retry_at='' OR retry_at<=?1)
    ORDER BY created_at LIMIT ?2`).bind(new Date().toISOString(),limit).all()).results || [];
  let removed=0,failed=0;
  for(const row of rows) {
    if(storage.cleanupRemaining===0)break;
    try {
      if(!isCanonicalObjectKey(row.object_key,'transfer'))throw new Error('Invalid multipart cleanup scope');
      const winner=await db.prepare('SELECT 1 AS present FROM task22_upload_files WHERE upload_id=?1').bind(row.upload_id).first();
      if(!winner)try{await storage.resumeMultipartUpload(row.object_key,row.upload_id).abort();}
      catch(error){if(Number(error.status || error.statusCode)!==404 && !/NoSuchUpload|upload.*not found|upload.*does not exist/i.test(String(error.code || error.message)))throw error;}
      // Never delete the object key here: another winning MPU can use it.
      await db.prepare('DELETE FROM task28_multipart_cleanup WHERE upload_id=?1').bind(row.upload_id).run();removed+=1;
    } catch {
      failed+=1;
      await db.prepare('UPDATE task28_multipart_cleanup SET attempts=attempts+1,retry_at=?2 WHERE upload_id=?1')
        .bind(row.upload_id,new Date(Date.now()+1800000).toISOString()).run();
    }
  }
  const unknown=await db.prepare("SELECT COUNT(*) AS n FROM task28_multipart_cleanup WHERE intent_kind='create_unknown'").first();
  // No upload ID was acknowledged. The binding cannot list incomplete MPUs;
  // preserve the scoped intent for explicit reconciliation, never guess an ID.
  return {multipart_aborts_completed:removed,multipart_aborts_failed:failed,multipart_unknown_pending:Number(unknown?.n || 0)};
}

/** Bounded, resumable traversal of the two existing, exclusively-owned prefixes.
 * Unknown names, foreign environments and linked objects are always preserved. */
export async function scanFileOrphans(db, storage, { family, environment, limit }) {
  if (!storage?.list) return { orphan_inspected:0, orphan_removed:0, orphan_failed:0 };
  if (!['preview','development','production'].includes(environment)) environment='development';
  const temporary=family==='temporary', table=temporary?'task14_metadata':'task22_metadata';
  const prefixes=temporary?[`temporary/v1/${environment}/files/`]
    :[`transfers/v2/${environment}/files/`,`transfers/v2/${environment}/objects/`];
  const marker=`task28_scan_${environment}`, now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const value=await db.prepare(`SELECT value FROM ${table} WHERE key=?1`).bind(marker).first();
  let state;
  try { state=JSON.parse(value?.value || '{}'); } catch { state={}; }
  let inspected=0,removed=0,failed=0;
  const start=Number(state.turn || 0)%prefixes.length;
  for(let n=0;n<prefixes.length && inspected<limit;n+=1) {
    if(storage.cleanupRemaining===0)break;
    const index=(start+n)%prefixes.length, prefix=prefixes[index];
    const available=storage.cleanupRemaining===undefined?limit:Math.max(1,Math.floor((storage.cleanupRemaining-1)/2));
    const budget=Math.min(limit-inspected,Math.ceil(limit/prefixes.length),available);
    let page;
    try { page=await storage.list({prefix,cursor:state[prefix] || undefined,limit:budget}); }
    catch { state[prefix]='';failed+=1;continue; }
    // A page never exceeds the remaining budget, so its cursor cannot skip
    // objects that this invocation did not inspect.
    let pageFailed=false;
    for(const object of (page.objects || []).slice(0,budget)) {
      inspected+=1;
      if (!isCanonicalObjectKey(object.key,family,environment)) continue;
      const age=Date.now()-new Date(object.uploaded).getTime();
      if (!Number.isFinite(age) || age<(temporary?3600000:86400000)) continue;
      const linked=temporary
        ? await db.prepare('SELECT 1 AS present FROM task14_shares WHERE r2_object_key=?1').bind(object.key).first()
        : await db.prepare(`SELECT 1 AS present WHERE
            EXISTS(SELECT 1 FROM task22_share_files WHERE object_key=?1)
            OR EXISTS(SELECT 1 FROM task22_upload_parts WHERE object_key=?1)
            OR EXISTS(SELECT 1 FROM task22_upload_files f JOIN task22_upload_sessions s ON s.id=f.session_id
              WHERE f.object_key=?1 AND ((s.state='active' AND s.expires_at>?2) OR s.cleanup_state='pending'))`)
          .bind(object.key,now).first();
      if (linked) continue;
      try { await storage.delete(object.key);removed+=1; } catch { failed+=1;pageFailed=true; }
    }
    if(!pageFailed)state[prefix]=page.truncated?page.cursor:'';
  }
  state.turn=(start+1)%prefixes.length;
  await db.prepare(`INSERT INTO ${table}(key,value) VALUES(?1,?2)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(marker,JSON.stringify(state)).run();
  return {orphan_inspected:inspected,orphan_removed:removed,orphan_failed:failed};
}

export async function pruneFileAudit(db,limit) {
  const before=new Date(Date.now()-90*86400000).toISOString();
  const result=await db.prepare(`DELETE FROM task28_file_events WHERE id IN(
    SELECT id FROM task28_file_events WHERE created_at<?1 ORDER BY created_at LIMIT ?2)`).bind(before,limit).run();
  return Number(result?.meta?.changes || 0);
}
