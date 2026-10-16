// Task25 rejects this exact 429 before any management write. Only that explicit
// rejection is safe to retry; transport failures, 5xx and revision conflicts
// remain visible to the caller. Never disable the real server quota.
export async function featureWriteWithBudget(send,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onWait=()=>{}}={}){
  for(let attempt=0;attempt<3;attempt++){
    const result=await send();
    if(result.status!==429||result.body?.code!=='task25_rate_limited'||result.body.retryable!==true||attempt===2)return result;
    if(!/^\d+$/.test(result.retry_after||''))throw new Error('Task25 rejected a write without a valid Retry-After');
    const seconds=Number(result.retry_after);if(seconds<1||seconds>60)throw new Error('Task25 Retry-After is outside its fixed management window');
    onWait({seconds,attempt:attempt+1});
    for(let remaining=seconds*1000+250;remaining>0;){const chunk=Math.min(30000,remaining);await wait(chunk);remaining-=chunk;}
  }
}
