import { currencyDigits } from '../../js/finance/money.js';
import { Task16Error } from './task16-model.mjs';
const ready = new WeakSet();
const decisionsReady = new WeakSet();
export async function hasCurrencyDecisions(db) {
  if (decisionsReady.has(db)) return true;
  const metadata = await db.prepare("SELECT value FROM task16_metadata WHERE key='schema_version'").first();
  if (metadata?.value === '5') { decisionsReady.add(db); return true; }
  return false;
}
export async function hasMoneyUnits(db) {
  if (ready.has(db)) return true;
  const metadata = await db.prepare("SELECT value FROM task16_metadata WHERE key='schema_version'").first();
  if (!['4','5'].includes(metadata?.value)) return false;
  const result = await db.prepare('PRAGMA table_info(task16_finance_transactions)').all();
  const found = result.results?.some(row => row.name === 'amount_exponent');
  if (found) ready.add(db);
  return Boolean(found);
}

/** Optional provenance is never inferred while importing an old operation. */
export async function currencyDecisionStamp(db, accountId, id, decision, kind = 'transaction') {
  const manual=kind==='transaction'&&Boolean(decision.manual_currency_source);
  if (decision.currency_review_required !== true && !manual) return [];
  if (!await hasCurrencyDecisions(db)) throw new Task16Error('币种核实状态需要增量迁移',503,'currency_decision_schema_required',true);
  const targets = { transaction: ['task16_finance_transactions','id'], event: ['task21_notification_events','event_id'], hint: ['task21_notification_pending_hints','id'] };
  const target = targets[kind];
  if (!target) throw new Error('Invalid currency provenance target');
  return [db.prepare(`UPDATE ${target[0]} SET currency_review_required=?3,currency_decision_source=?4 WHERE ${target[1]}=?1 AND user_id=?2`).bind(id,accountId,manual?0:1,manual?'user_confirmed':'account_default')];
}
export async function unitStamp(db, transactionId, currency, exponent, kind = 'transaction') {
  let digits;
  try { digits = currencyDigits(currency); }
  catch (_) { throw new Task16Error('币种不受支持', 400, 'currency_unsupported'); }
  const available = await hasMoneyUnits(db);
  if (currency === 'JPY' && (!available || exponent !== 0)) throw new Task16Error('日元金额单位需要新版协议和增量迁移', 409, 'currency_unit_capability_required');
  const table = kind === 'budget' ? 'task16_finance_budgets' : 'task16_finance_transactions';
  return available ? [db.prepare(`UPDATE ${table} SET amount_exponent=?2 WHERE id=?1`).bind(transactionId, digits)] : [];
}
