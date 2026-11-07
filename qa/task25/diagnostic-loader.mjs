// No product/test file is changed on disk; only this diagnostic process gets logs.
import {pathToFileURL} from 'node:url';
export async function resolve(specifier,context,next){
  if(specifier==='miniflare'&&process.env.TASK25_MINIFLARE_ENTRY){
    return next(pathToFileURL(process.env.TASK25_MINIFLARE_ENTRY).href,context);
  }
  return next(specifier,context);
}
export async function load(url,context,next){
  const result=await next(url,context);
  if(url.endsWith('/functions/_lib/task25-api.mjs')){
    let source=result.source.toString();
    const anchor="console.error(JSON.stringify({ event: 'task25_error', request_id: id, kind: classifyCloudError(error) }));";
    if(!source.includes(anchor))throw Error('Diagnostic API anchor changed');
    source=source.replace(anchor,`globalThis.__task25Diagnostic?.events.push({type:'api_error',requestId:id,name:error?.name,message:error?.message,cause:error?.cause?.message,chain:globalThis.__task25Diagnostic.exception(error),stack:error?.stack});${anchor}`);
    return{...result,source};
  }
  if(url.endsWith('/local-backend/test_task25_d1_js.mjs')){
    let source=result.source.toString();
    const traceUrl=new URL('./diagnostic-trace.mjs',import.meta.url).href;
    const rpcUrl=new URL('./diagnostic-rpc.mjs',import.meta.url).href;
    source=`import {traceD1} from ${JSON.stringify(traceUrl)};\nimport {installRpcSchedule} from ${JSON.stringify(rpcUrl)};\n`+source;
    source=source.replace('const users = {','installRpcSchedule(mf);\nconst users = {');
    source=source.replace("const db = await mf.getD1Database('WYJ_DB');","const db = process.env.TASK25_DIAGNOSTIC_SQL==='off' ? await mf.getD1Database('WYJ_DB') : traceD1(await mf.getD1Database('WYJ_DB'));");
    source=source.replace("const windowStart = Math.floor(realNow() / 60000) * 60000;","const windowStart = process.env.TASK25_DIAGNOSTIC_WINDOW ? Number(process.env.TASK25_DIAGNOSTIC_WINDOW) : Math.floor(realNow() / 60000) * 60000;");
    source=source.replace("const limited = await Promise.all(Array.from({ length: 31 }, limitedRequest));",`const auditBefore=(await db.prepare('SELECT COUNT(*) AS count FROM task25_flag_audit').first()).count;globalThis.__task25Diagnostic.cohortActive=true;globalThis.__task25Diagnostic.events.push({type:'cohort_start',requests:31,windowStart,barrier:process.env.TASK25_DIAGNOSTIC_BARRIER||null});const gcTimer=process.env.TASK25_DIAGNOSTIC_RPC==='gc-before-batch'?setInterval(()=>globalThis.gc(),15):null;let limited;try{limited = await Promise.all(Array.from({ length: 31 }, limitedRequest));}finally{if(gcTimer)clearInterval(gcTimer);}globalThis.__task25Diagnostic.events.push({type:'cohort_result',statuses:limited.map(r=>r.status),codes:limited.map(r=>r.payload.code||null)});try{globalThis.__task25Diagnostic.events.push({type:'cohort_database',windows:(await db.prepare('SELECT route,window_started_at,request_count FROM cloud_rate_limit_windows ORDER BY window_started_at').all()).results,auditBefore,auditAfter:(await db.prepare('SELECT COUNT(*) AS count FROM task25_flag_audit').first()).count});}catch(error){globalThis.__task25Diagnostic.events.push({type:'diagnostic_read_error',chain:globalThis.__task25Diagnostic.exception(error)});}`);
    source=source.replace("assert.deepEqual(windows.results.map(row => row.request_count), [31, 1]);","assert.deepEqual(windows.results.map(row => row.request_count), [31, 1]);globalThis.__task25Diagnostic.events.push({type:'recovery_verified',windowCounts:windows.results.map(row=>row.request_count)});");
    return{...result,source};
  }
  return result;
}
