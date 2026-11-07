const state=()=>globalThis.__task25Diagnostic;
const statementInfo=new WeakMap();
function record(event){state()?.events.push(event);}
function shape(sql){return String(sql).replace(/\s+/g,' ').slice(0,130);}
function statement(target,sql){
  const proxy=new Proxy(target,{get(object,key){
    if(key==='bind')return(...values)=>statement(object.bind(...values),sql);
    const value=Reflect.get(object,key,object);if(typeof value!=='function')return value;
    return async(...args)=>{if(state()?.cohortActive)record({type:'d1_call',operation:String(key),sql:shape(sql)});try{const result=await value.apply(object,args);if(state()?.cohortActive&&String(sql).includes('INSERT INTO cloud_rate_limit_windows'))record({type:'rate_result',count:result?.request_count});return result;}catch(error){record({type:'d1_error',operation:String(key),sql:shape(sql),name:error?.name,message:error?.message,cause:error?.cause?.message});throw error;}};
  }});statementInfo.set(proxy,{target,sql});return proxy;
}
export function traceD1(target){let arrivals=0,release;const gate=new Promise(r=>release=r);return new Proxy(target,{get(object,key){
  if(key==='prepare')return sql=>statement(object.prepare(sql),sql);
  if(key==='batch')return async inputs=>{
    const parts=inputs.map(p=>statementInfo.get(p)||{target:p,sql:'unknown'});
    if(state()?.cohortActive){record({type:'d1_call',operation:'batch',sql:parts.map(p=>shape(p.sql))});
      if(process.env.TASK25_DIAGNOSTIC_BARRIER==='snapshot'&&parts[0]?.sql.includes('SELECT * FROM task25_feature_flags')&&arrivals<30){arrivals++;if(arrivals===30)release();await Promise.race([gate,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('diagnostic snapshot barrier did not reach 30')),7000);timer.unref();})]);}}
    try{return await object.batch(parts.map(p=>p.target));}catch(error){record({type:'d1_error',operation:'batch',sql:parts.map(p=>shape(p.sql)),name:error?.name,message:error?.message,cause:error?.cause?.message});throw error;}
  };
  const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
}});}
