import { currencyDigits } from '../../js/finance/money.js';
import { Task16Error } from './task16-model.mjs';
const ready = new WeakSet();
export async function hasMoneyUnits(db) {
  if (ready.has(db)) return true;
  const metadata = await db.prepare("SELECT value FROM task16_metadata WHERE key='schema_version'").first();
  if (metadata?.value !== '4') return false;
  const result = await db.prepare('PRAGMA table_info(task16_finance_transactions)').all();
  const found = result.results?.some(row => row.name === 'amount_exponent');
  if (found) ready.add(db);
  return Boolean(found);
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
