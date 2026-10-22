// Separate P04 replay: original six identity assertions, explicit synthetic CNY.
// The unmodified legacy driver's missing-currency failure is retained separately.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const original=await readFile(path.join(root,'qa/aeris/state-consistency-browser.mjs'),'utf8');
let source=original.replace("from '../../local-backend/browser_harness.mjs'",`from '${new URL('../../local-backend/browser_harness.mjs',import.meta.url).href}'`)
  .replace("path.resolve(import.meta.dirname,'../..')",JSON.stringify(root));
source=source.replace('window.getSummary=async()=>', "records.forEach(row=>row.currency='CNY');window.WYJLocalPaymentLedger.reviews.forEach(row=>row.currency='CNY');\nwindow.getSummary=async()=>")
  .replace("{id:'txn:synthetic-merchant',amount_minor:123", "{id:'txn:synthetic-merchant',currency:'CNY',amount_minor:123");
console.log(JSON.stringify({kind:'P04_EXPLICIT_CURRENCY_FIXTURE_REPLAY',frozen_source_sha256:createHash('sha256').update(original).digest('hex'),
  adaptation:'Only synthetic currency omissions filled with CNY; assertions unchanged. Does not relabel the original replay PASS.'}));
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
