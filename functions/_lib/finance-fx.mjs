import { currencyDigits, convertMinor, validRateDate, MONEY_ROUNDING } from '../../js/finance/money.js';
import { sha256Hex } from './cloudflare-foundation.mjs';
import { Task16Error, requireAllowedFields } from './task16-model.mjs';

const SOURCE = 'Frankfurter v2 daily reference';
const MAX_AGE = 6 * 60 * 60 * 1000;
const inFlight = new WeakMap();
const readiness = new WeakMap();
const error = (code, message, status = 503) => new Task16Error(message, status, code, status === 503);
async function boundedProviderJson(response, signal) {
  const limit = 65536;
  const length = response.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel().catch(() => {});
    throw error('fx_response_invalid', '汇率响应过大');
  }
  if (!response.body) throw error('fx_response_invalid', '汇率响应为空');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '', complete = false;
  try {
    while (true) {
      const chunk = await new Promise((resolve, reject) => {
        const abort = () => reject(error('fx_provider_unavailable', '参考汇率读取超时'));
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
      if (chunk.done) { complete = true; text += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw error('fx_response_invalid', '汇率响应过大');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return decimalJson(text);
  } catch (cause) {
    if (cause instanceof TypeError) throw error('fx_response_invalid', '汇率响应编码无效');
    throw cause;
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function supported(value) {
  try { currencyDigits(value); return value; }
  catch (_) { throw error('currency_unsupported', '币种不受支持', 400); }
}
function dateOnly(value, now) {
  try {
    validRateDate(value);
    if (value > new Date(now).toISOString().slice(0, 10) || value < '1948-01-01') throw new Error();
    return value;
  } catch (_) { throw error('fx_date_invalid', '汇率日期无效', 400); }
}
export async function ensureFxSchema(db) {
  try {
    if (readiness.has(db)) return readiness.get(db);
    const row = await db.prepare("SELECT value FROM task16_fx_metadata WHERE key='schema_version'").first();
    if (row?.value !== '1') throw new Error();
    readiness.set(db, true); return true;
  } catch (_) { throw error('fx_schema_not_ready', '本地汇率结构需要增量迁移'); }
}

// JSON numbers are retained as decimal lexemes, including scientific notation.
// Never round a provider's published decimal through a binary floating value.
export function decimalJson(text) {
  if (text.length > 65536) throw error('fx_response_invalid', '汇率响应过大');
  let result = '', index = 0;
  while (index < text.length) {
    const c = text[index];
    if (c === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index++] === '"') break;
      }
      result += text.slice(start, index); continue;
    }
    if (c === '-' || /\d/.test(c)) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      if (!match) throw error('fx_response_invalid', '汇率响应格式无效');
      result += JSON.stringify(match[0]); index += match[0].length; continue;
    }
    result += c; index++;
  }
  try { return JSON.parse(result); }
  catch (_) { throw error('fx_response_invalid', '汇率响应格式无效'); }
}
const ratePayload = row => ({ base: row.base, quote: row.quote, requested_date: row.requested_date,
  rate_timestamp: row.rate_timestamp, rate: row.rate, source: row.source,
  fetched_at: row.fetched_at, expires_at: row.expires_at, rounding: row.rounding });
async function checkedRate(row) {
  if (!row) return null;
  const digest = await sha256Hex(JSON.stringify(ratePayload(row)));
  if (row.integrity_hash !== digest || row.id !== `fx:${digest}`) throw error('fx_integrity_failed', '汇率快照完整性校验失败');
  supported(row.base); supported(row.quote); convertMinor(1, row.base, row.quote, row.rate);
  return { ...ratePayload(row), id: row.id };
}
export async function frankfurterRate(base, quote, requestedDate, { fetcher = fetch, now = Date.now(), timeoutMs = 8000 } = {}) {
  supported(base); supported(quote); dateOnly(requestedDate, now);
  // Official OpenAPI: GET /v2/rate/{base}/{quote}?date=YYYY-MM-DD.
  const url = new URL(`https://api.frankfurter.dev/v2/rate/${base}/${quote}`);
  url.searchParams.set('date', requestedDate);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(8000, timeoutMs)));
  try {
    // workerd supports manual/follow, while browser/Node also support error.
    // Both chosen modes reject redirects: manual 3xx fails the response.ok gate.
    let redirect = 'error';
    try { new Request(url.toString(), { redirect }); } catch (_) { redirect = 'manual'; }
    const response = await fetcher(url.toString(), { headers: { Accept: 'application/json' }, redirect, signal: controller.signal });
    if (!response.ok) throw error('fx_provider_unavailable', '参考汇率暂时不可用');
    if (!String(response.headers.get('Content-Type') || '').includes('application/json')) throw error('fx_response_invalid', '汇率响应类型无效');
    const row = await boundedProviderJson(response, controller.signal);
    if (!row || Array.isArray(row) || row.base !== base || row.quote !== quote || typeof row.rate !== 'string') throw error('fx_pair_invalid', '汇率币种对不匹配');
    dateOnly(row.date, now);
    const lag = (Date.parse(requestedDate) - Date.parse(row.date)) / 86400000;
    if (lag < 0 || lag > 7) throw error('fx_date_mismatch', '参考汇率日期与交易日期不匹配');
    convertMinor(100, base, quote, row.rate);
    return { base, quote, requested_date: requestedDate, rate_timestamp: `${row.date}T00:00:00.000Z`,
      rate: row.rate, source: SOURCE, fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + MAX_AGE).toISOString(), rounding: MONEY_ROUNDING };
  } catch (failure) {
    if (failure instanceof Task16Error) throw failure;
    throw error('fx_provider_unavailable', '参考汇率暂时不可用，请稍后重试');
  } finally { clearTimeout(timer); }
}
export async function referenceRate(db, base, quote, requestedDate, options = {}) {
  await ensureFxSchema(db);
  const now = options.now ?? Date.now();
  supported(base); supported(quote); dateOnly(requestedDate, now);
  if (base === quote) return { base, quote, requested_date: requestedDate, rate: '1', same_currency: true, rounding: MONEY_ROUNDING };
  const cached = await db.prepare(`SELECT r.* FROM task16_fx_cache c JOIN task16_fx_rates r ON r.id=c.rate_id
    WHERE c.base=?1 AND c.quote=?2 AND c.requested_date=?3`).bind(base, quote, requestedDate).first();
  if (cached && Date.parse(cached.expires_at) > now) return { ...await checkedRate(cached), cache: 'hit', reference_only: true };
  let jobs = inFlight.get(db); if (!jobs) inFlight.set(db, jobs = new Map());
  const key = `${base}:${quote}:${requestedDate}`;
  if (jobs.has(key)) return jobs.get(key);
  const job = (async () => {
    const rate = await frankfurterRate(base, quote, requestedDate, { ...options, now });
    const digest = await sha256Hex(JSON.stringify(ratePayload(rate))), id = `fx:${digest}`;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO task16_fx_rates (id,base,quote,requested_date,rate_timestamp,rate,source,fetched_at,expires_at,rounding,integrity_hash)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(id, base, quote, requestedDate, rate.rate_timestamp, rate.rate, rate.source, rate.fetched_at, rate.expires_at, rate.rounding, digest),
      db.prepare(`INSERT INTO task16_fx_cache(base,quote,requested_date,rate_id,fetched_at) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(base,quote,requested_date) DO UPDATE SET rate_id=excluded.rate_id,fetched_at=excluded.fetched_at
        WHERE excluded.fetched_at >= task16_fx_cache.fetched_at`).bind(base, quote, requestedDate, id, rate.fetched_at),
    ]);
    return { ...rate, id, cache: 'miss', reference_only: true };
  })();
  jobs.set(key, job);
  try { return await job; }
  finally { jobs.delete(key); }
}
export async function currencyPreferences(db, accountId, patch) {
  await ensureFxSchema(db);
  if (patch !== undefined) {
    requireAllowedFields(patch, new Set(['account_currency', 'display_currency', 'default_currency', 'revision']));
    for (const name of ['account_currency', 'display_currency', 'default_currency']) if (patch[name] !== undefined && patch[name] !== null) supported(patch[name]);
    if (patch.account_currency === null || patch.display_currency === null) throw error('currency_unsupported', '账户和展示币种不能为空', 400);
    const existing = await currencyPreferences(db, accountId);
    if (patch.revision !== existing.revision) throw error('currency_preferences_conflict', '币种设置已更新，请重新同步', 409);
    const next = { ...existing, ...patch };
    const applied = await db.prepare(`INSERT INTO task16_currency_preferences(user_id,account_currency,display_currency,default_currency,revision,updated_at)
      VALUES(?1,?2,?3,?4,1,?5) ON CONFLICT(user_id) DO UPDATE SET account_currency=excluded.account_currency,
      display_currency=excluded.display_currency,default_currency=excluded.default_currency,revision=task16_currency_preferences.revision+1,updated_at=excluded.updated_at
      WHERE task16_currency_preferences.revision=?6`).bind(accountId, next.account_currency, next.display_currency, next.default_currency, new Date().toISOString(), existing.revision).run();
    const result = await currencyPreferences(db, accountId);
    if (applied.meta?.changes !== 1 || result.revision !== existing.revision + 1) throw error('currency_preferences_conflict', '币种设置已更新，请重新同步', 409);
    return result;
  }
  const row = await db.prepare('SELECT * FROM task16_currency_preferences WHERE user_id=?1').bind(accountId).first();
  return row ? { account_currency: row.account_currency, display_currency: row.display_currency, default_currency: row.default_currency, revision: row.revision }
    : { account_currency: 'CNY', display_currency: 'CNY', default_currency: null, revision: 0 };
}
export async function transactionReferences(db, accountId, input, options = {}) {
  await ensureFxSchema(db);
  requireAllowedFields(input, new Set(['transaction_ids', 'display_currency']));
  const quote = supported(input.display_currency);
  if (!Array.isArray(input.transaction_ids) || input.transaction_ids.length > 100 || new Set(input.transaction_ids).size !== input.transaction_ids.length
      || input.transaction_ids.some(id => !/^[A-Za-z0-9._:-]{8,80}$/.test(id))) throw error('fx_transactions_invalid', '参考折算请求无效', 400);
  const references = {}, unavailable = [];
  const deadline = Date.now() + 7000;
  for (const id of input.transaction_ids) {
    const transaction = await db.prepare('SELECT * FROM task16_finance_transactions WHERE user_id=?1 AND id=?2').bind(accountId, id).first();
    if (!transaction || transaction.status !== 'active') continue;
    if (!Object.hasOwn({ CNY: 1, USD: 1, EUR: 1, HKD: 1, GBP: 1, JPY: 1 }, transaction.currency)
        || transaction.amount_exponent !== currencyDigits(transaction.currency)) {
      unavailable.push({ id, reason: 'currency_unit_review_required' }); continue;
    }
    if (transaction.currency === quote) continue;
    const key = `${id}:${transaction.revision}:${quote}`;
    let reference = await db.prepare(`SELECT f.*,r.* FROM task16_fx_references f JOIN task16_fx_rates r ON r.id=f.rate_id
      WHERE f.user_id=?1 AND f.transaction_id=?2 AND f.transaction_revision=?3 AND f.display_currency=?4`).bind(accountId, id, transaction.revision, quote).first();
    if (!reference) {
      try {
        if (Date.now() >= deadline) throw error('fx_request_deferred', '其余参考折算将在下次同步时重试');
        const requested = new Date(transaction.occurred_at_ms).toISOString().slice(0, 10);
        const rate = await referenceRate(db, transaction.currency, quote, requested, { ...options, timeoutMs: Math.max(1, deadline - Date.now()) });
        const converted = convertMinor(transaction.amount_minor, transaction.currency, quote, rate.rate);
        await db.prepare(`INSERT OR IGNORE INTO task16_fx_references(user_id,transaction_id,transaction_revision,display_currency,rate_id,original_currency,original_minor,amount_exponent,converted_minor,created_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(accountId, id, transaction.revision, quote, rate.id, transaction.currency, transaction.amount_minor, transaction.amount_exponent, converted, new Date(options.now ?? Date.now()).toISOString()).run();
        reference = await db.prepare(`SELECT f.*,r.* FROM task16_fx_references f JOIN task16_fx_rates r ON r.id=f.rate_id
          WHERE f.user_id=?1 AND f.transaction_id=?2 AND f.transaction_revision=?3 AND f.display_currency=?4`).bind(accountId, id, transaction.revision, quote).first();
      } catch (failure) { unavailable.push({ id, reason: failure.code || 'fx_provider_unavailable' }); continue; }
    }
    const rate = await checkedRate(reference);
    if (reference.original_minor !== transaction.amount_minor || reference.original_currency !== transaction.currency
        || reference.converted_minor !== convertMinor(transaction.amount_minor, transaction.currency, quote, rate.rate)) throw error('fx_integrity_failed', '历史折算快照校验失败');
    references[key] = { ...rate, original_minor: reference.original_minor, converted_minor: reference.converted_minor,
      transaction_revision: transaction.revision, historical_reference: true, reference_only: true };
  }
  return { references, unavailable, display_currency: quote, reference_only: true };
}
