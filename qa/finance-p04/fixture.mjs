import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { syncFinance } from '../../functions/_lib/task16-service.mjs';
export const root = path.resolve(import.meta.dirname, '../..');
export async function fixture({ before = 9999 } = {}) {
  const mf = new Miniflare({ modules: true, script: 'export default{fetch(){return new Response("synthetic P04 fixture")}}', compatibilityDate: '2026-08-06', d1Databases: ['DB'], d1Persist: false });
  const db = await mf.getD1Database('DB');
  if (process.env.P04_TRACE_FIXTURE) console.log('D1 binding ready');
  for (const file of (await readdir(path.join(root, 'cloudflare/migrations'))).filter(name => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) < before).sort()) {
    if (process.env.P04_TRACE_FIXTURE) console.log('Apply', file);
    await db.exec((await readFile(path.join(root, 'cloudflare/migrations', file), 'utf8')).replace(/\r?\n/g, ' '));
  }
  const now = new Date().toISOString();
  const account = { id: 'synthetic-p04-owner', role: 'user', entitlements: ['finance_access'] };
  await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
    VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(account.id, now).run();
  let sequence = 0;
  async function transaction(currency, amount, options = {}) {
    const id = options.id || `synthetic-p04-transaction-${++sequence}`;
    const result = await syncFinance(db, account, { schema_version: 1, device_id: 'synthetic-p04-browser', platform: 'web', since_version: 0,
      operations: [{ operation_id: `synthetic-p04-operation-${++sequence}`, type: 'transaction.upsert', entity_id: id, base_revision: options.revision || 0,
        payload: { currency, amount_minor: amount, direction: options.direction || 'expense', merchant: 'synthetic merchant', occurred_at_ms: Date.UTC(2026, 9, 19, 12),
          ...(currency === 'JPY' ? { amount_exponent: 0 } : {}), ...options.payload } }] });
    return result.operation_results[0].transaction;
  }
  return { mf, db, account, transaction, dispose: () => mf.dispose() };
}
