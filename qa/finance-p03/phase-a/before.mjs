import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});
const file=path.join(out,'before.ndjson');await fs.writeFile(file,'',{flag:'wx'});
for(const [id,method] of [['A-BEFORE-CORRECTION','applyPaymentReconciliation'],['A-BEFORE-EFFECTIVE-RECEIPT','reconciledIngestReceipt'],['A-BEFORE-AUDIT','reconciliationSnapshot']]) {
  let error;try {const module=await import('../../../functions/_lib/task21-reconciliation.mjs');assert.equal(typeof module[method],'function')}catch(e){error=e.stack}
  await fs.appendFile(file,JSON.stringify({case_id:id,status:error?'FAIL':'PASS',error:error||'',scope:'API capability absent at 09442c2; not a business pass'})+'\n');
  if(error)process.exitCode=1;
}
