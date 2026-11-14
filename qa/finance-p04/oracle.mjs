import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertMinor, referenceValue } from '../../js/finance/money.js';
const input=JSON.parse(await readFile(new URL('fixtures/exact-oracle.json',import.meta.url),'utf8'));
for(const row of input.cases){
  if(row.overflow)assert.throws(()=>convertMinor(row.minor,row.base,row.quote,row.rate),e=>e.code==='amount_overflow',row.id);
  else assert.equal(convertMinor(row.minor,row.base,row.quote,row.rate),row.expected,row.id);
}
assert.throws(()=>convertMinor(10000,'USD','CNY'),e=>e.code==='fx_rate_invalid');
assert.equal(referenceValue({id:'synthetic-missing-rate',currency:'USD',amount_minor:10000,occurred_at_ms:Date.UTC(2026,9,19),fx_snapshot:{quote:'CNY',requested_date:'2026-10-19'}},'CNY').status,'fx_rate_invalid');
assert.equal(referenceValue({id:'synthetic-expired-rate',currency:'USD',amount_minor:10000,occurred_at_ms:Date.UTC(2026,9,19),fx_snapshot:{quote:'CNY',requested_date:'2026-10-19',rate:'7',expires_at:'2026-10-19T00:00:00Z'}},'CNY').status,'fx_rate_expired');
console.log(JSON.stringify({suite:'Independent Decimal vs JS rational arithmetic',PASS:input.cases.length+3,oracle:input.oracle}));
