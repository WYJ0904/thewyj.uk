// Read only synthetic QA event disposition; no change to the original native queue.
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve(import.meta.dirname,'../../../docs/migration-evidence/finance-p04/closure-current');
const target=path.join(out,'native-hosted-server-diagnostic.json');
await fs.access(target).then(()=>{throw Error('Preserve prior result');},()=>{});
const origin='https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev';
const account=JSON.parse(await fs.readFile(path.join(out,'private/qa-accounts.json'),'utf8'))[0];
const login=await fetch(origin+'/api/login',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:account.username,secret:account.secret})});
const auth=await login.json();if(login.status!==200||auth.account?.id!==account.id)throw Error('QA authentication failed');
const response=await fetch(origin+'/api/notification/events?limit=200',{signal:AbortSignal.timeout(15000),headers:{'X-Session-Token':auth.session,'X-Finance-Money-Version':'3'}});
const data=await response.json();
const keys=['event_id','parse_status','direction','currency','amount_minor','financial_phase','lifecycle_operation','lifecycle_reference','identity_review_reason','finance_entry_id','finance_transaction_id','candidate_id','finance_status','review_reason'];
const rows=(data.events||[]).filter(row=>row.event_id?.startsWith('synthetic-native-hosted-')).map(row=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])));
const result={checked:new Date().toISOString(),status:response.status,code:data.code||'',rows,scope:'Only generated synthetic native QA events; no queue/body rewrite or Production access'};
await fs.writeFile(target,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
