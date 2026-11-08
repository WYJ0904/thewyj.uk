// A bounded adversarial schedule for Miniflare's Node proxy, never product code.
export function installRpcSchedule(mf){
  if(process.env.TASK25_DIAGNOSTIC_RPC!=='gc-before-batch')return;
  if(typeof globalThis.gc!=='function')throw Error('GC diagnostic requires --expose-gc');
  const dispatch=mf.dispatchFetch;let held=0;
  mf.dispatchFetch=async(input,init)=>{
    const headers=new Headers(init?.headers),op=headers.get('MF-Op');
    const s=globalThis.__task25Diagnostic;
    if(s?.cohortActive&&op==='FREE')s.events.push({type:'proxy_free',addresses:headers.get('MF-Op-Target'),t:performance.now()});
    if(s?.cohortActive&&op==='CALL'&&headers.get('MF-Op-Key')==='batch'&&held<7){
      const index=++held;s.events.push({type:'proxy_batch_held',index,t:performance.now()});
      // Allow the real FinalizationRegistry FREE batch (100ms in this pinned SDK)
      // to overtake seven pending requests. Do not inject a database exception.
      await new Promise(resolve=>setTimeout(resolve,450));
      s.events.push({type:'proxy_batch_released',index,t:performance.now()});
    }
    return dispatch(input,init);
  };
}
