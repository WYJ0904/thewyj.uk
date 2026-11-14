import assert from 'node:assert/strict';
import { referenceRate, transactionReferences, currencyPreferences, frankfurterRate, decimalJson } from '../../functions/_lib/finance-fx.mjs';
import { fixture } from './fixture.mjs';

const f = await fixture();
let count = 0, calls = 0, currentRate = '7.000000000000000001';
const now = Date.UTC(2026, 9, 21, 12);
const fetcher = async (url, options) => {
  calls++;
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.frankfurter.dev');
  assert.equal(parsed.pathname, '/v2/rate/USD/CNY');
  assert.equal(parsed.searchParams.get('date'), '2026-10-19');
  assert.equal(options.redirect, 'error');
  return new Response(`{"base":"USD","quote":"CNY","date":"2026-10-19","rate":${currentRate}}`, { headers: { 'Content-Type': 'application/json' } });
};
async function check(name, run) { await run(); count++; console.log(`PASS ${name}`); }
try {
  await check('provider decimals retain their published digits', async () => {
    assert.equal(decimalJson('{"rate":7.123456789012345678,"text":"123"}').rate, '7.123456789012345678');
    assert.equal((await frankfurterRate('USD', 'CNY', '2026-10-19', { fetcher, now })).rate, currentRate);
  });
  calls = 0;
  await check('concurrent lookups share one verified provider request', async () => {
    const rates = await Promise.all(Array.from({ length: 20 }, () => referenceRate(f.db, 'USD', 'CNY', '2026-10-19', { fetcher, now })));
    assert.equal(calls, 1); assert.equal(new Set(rates.map(rate => rate.id)).size, 1);
  });
  await check('cache hit avoids the network', async () => {
    assert.equal((await referenceRate(f.db, 'USD', 'CNY', '2026-10-19', { fetcher, now: now + 1000 })).cache, 'hit');
    assert.equal(calls, 1);
  });
  const tx = await f.transaction('USD', 10000);
  let firstReference;
  await check('historical reference binds original ID/revision/amount', async () => {
    const data = await transactionReferences(f.db, f.account.id, { transaction_ids: [tx.id], display_currency: 'CNY' }, { fetcher, now });
    firstReference = data.references[`${tx.id}:1:CNY`];
    assert.equal(firstReference.converted_minor, 70000); assert.equal(firstReference.original_minor, 10000);
    assert.equal((await f.db.prepare('SELECT amount_minor,currency,revision FROM task16_finance_transactions WHERE id=?1').bind(tx.id).first()).amount_minor, 10000);
  });
  await check('expiry refresh keeps old rate rows and historical references', async () => {
    currentRate = '7.2';
    const fresh = await referenceRate(f.db, 'USD', 'CNY', '2026-10-19', { fetcher, now: now + 7 * 3600000 });
    assert.notEqual(fresh.id, firstReference.id);
    const old = await transactionReferences(f.db, f.account.id, { transaction_ids: [tx.id], display_currency: 'CNY' }, { fetcher, now: now + 7 * 3600000 });
    assert.equal(old.references[`${tx.id}:1:CNY`].converted_minor, 70000);
    assert.equal(old.references[`${tx.id}:1:CNY`].id, firstReference.id);
  });
  await check('manual edit creates a new reference without overwriting the old fact', async () => {
    const edited = await f.transaction('USD', 20000, { id: tx.id, revision: 1 });
    assert.equal(edited.revision, 2);
    const data = await transactionReferences(f.db, f.account.id, { transaction_ids: [tx.id], display_currency: 'CNY' }, { fetcher, now: now + 7 * 3600000 });
    assert.equal(data.references[`${tx.id}:2:CNY`].converted_minor, 144000);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM task16_fx_references WHERE transaction_id=?1').bind(tx.id).first()).n, 2);
  });
  await check('another account cannot read transaction references', async () => {
    const data = await transactionReferences(f.db, 'synthetic-other-account', { transaction_ids: [tx.id], display_currency: 'CNY' }, { fetcher, now });
    assert.deepEqual(data.references, {});
  });
  await check('same currency works offline without inventing a market rate', async () => {
    const value = await referenceRate(f.db, 'JPY', 'JPY', '2026-10-19', { fetcher: () => { throw new Error('must not fetch'); }, now });
    assert.equal(value.rate, '1'); assert.equal(value.same_currency, true);
  });
  await check('missing or expired rate stays unavailable offline', async () => {
    await assert.rejects(() => referenceRate(f.db, 'USD', 'CNY', '2026-10-19', { fetcher: async () => { throw new Error('offline'); }, now: now + 24 * 3600000 }), error => error.code === 'fx_provider_unavailable');
  });
  for (const [name, body] of [
    ['wrong pair', '{"base":"EUR","quote":"CNY","date":"2026-10-19","rate":7}'],
    ['future date', '{"base":"USD","quote":"CNY","date":"2026-10-22","rate":7}'],
    ['obsolete observation', '{"base":"USD","quote":"CNY","date":"2026-10-01","rate":7}'],
    ['negative rate', '{"base":"USD","quote":"CNY","date":"2026-10-19","rate":-7}'],
    ['zero rate', '{"base":"USD","quote":"CNY","date":"2026-10-19","rate":0}'],
    ['missing rate', '{"base":"USD","quote":"CNY","date":"2026-10-19"}'],
    ['invalid JSON', '{"rate":NaN}'],
  ]) await check(`reject ${name}`, async () => assert.rejects(() => frankfurterRate('USD', 'CNY', '2026-10-19', { now, fetcher: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) })));
  await check('tampered cache fails integrity verification', async () => {
    const selected = await f.db.prepare("SELECT rate_id FROM task16_fx_cache WHERE base='USD' AND quote='CNY'").first();
    await f.db.prepare('UPDATE task16_fx_rates SET rate=?2 WHERE id=?1').bind(selected.rate_id, '1').run();
    await assert.rejects(() => referenceRate(f.db, 'USD', 'CNY', '2026-10-19', { fetcher, now: now + 8 * 3600000 }), error => error.code === 'fx_integrity_failed');
  });
  await check('currency preferences distinguish account/display/default and use revisions', async () => {
    const initial = await currencyPreferences(f.db, f.account.id);
    assert.equal(initial.default_currency, null);
    const saved = await currencyPreferences(f.db, f.account.id, { account_currency: 'HKD', display_currency: 'JPY', default_currency: 'USD', revision: 0 });
    assert.equal(saved.display_currency, 'JPY'); assert.equal(saved.account_currency, 'HKD'); assert.equal(saved.default_currency, 'USD');
    await assert.rejects(() => currencyPreferences(f.db, f.account.id, { display_currency: 'GBP', revision: 0 }), error => error.code === 'currency_preferences_conflict');
    await assert.rejects(() => currencyPreferences(f.db, f.account.id, { default_currency: 'AUD', revision: 1 }), error => error.code === 'currency_unsupported');
  });
  await check('streaming provider response is bounded before JSON allocation',async()=>{
    let cancelled=false;
    const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(40000).fill(32))},cancel(){cancelled=true}});
    await assert.rejects(()=>frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async()=>new Response(body,{headers:{'Content-Type':'application/json'}})}),e=>e.code==='fx_response_invalid');
    assert.equal(cancelled,true);
  });
  await check('declared oversized provider response is rejected without reading',async()=>{
    await assert.rejects(()=>frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'999999999'}})}),e=>e.code==='fx_response_invalid');
  });
  await check('invalid UTF-8 cannot silently change provider decimals',async()=>{
    await assert.rejects(()=>frankfurterRate('USD','CNY','2026-10-19',{now,fetcher:async()=>new Response(new Uint8Array([123,34,255,34,125]),{headers:{'Content-Type':'application/json'}})}),e=>e.code==='fx_response_invalid');
  });
  await check('stalled provider body obeys the existing request watchdog',async()=>{
    let cancelled=false;const body=new ReadableStream({start(){},cancel(){cancelled=true}});const started=Date.now();
    await assert.rejects(()=>frankfurterRate('USD','CNY','2026-10-19',{now,timeoutMs:25,fetcher:async()=>new Response(body,{headers:{'Content-Type':'application/json'}})}),e=>e.code==='fx_provider_unavailable');
    assert.equal(cancelled,true);assert.ok(Date.now()-started<2000);
  });
  console.log(JSON.stringify({ suite: 'P04 D1 reference cache, provider contract and history', PASS: count, live_provider: 'NOT EXERCISED by this simulated suite; see separate live-fx evidence' }));
} finally { await f.dispose(); }
