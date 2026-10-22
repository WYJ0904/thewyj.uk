import { currencyDigits } from '../../js/finance/money.js';
import { Task21Error } from './task21-model.mjs';
const ready = new WeakSet();
async function sourceUnitsReady(db) {
  if (ready.has(db)) return true;
  const row = await db.prepare("SELECT value FROM task21_metadata WHERE key='schema_version'").first();
  if (['8','9'].includes(row?.value)) { ready.add(db); return true; }
  return false;
}
export async function sourceExponent(db, owner, event, currency) {
  if (currency !== 'JPY') { try { return currencyDigits(currency); } catch (_) { return null; } }
  if (!await sourceUnitsReady(db)) return null;
  const row = await db.prepare('SELECT currency,amount_exponent FROM task21_currency_units WHERE user_id=?1 AND event_id=?2').bind(owner,event).first();
  return row?.currency === currency && row.amount_exponent === 0 ? 0 : null;
}
export async function sourceUnitStatement(db, owner, event, currency, exponent) {
  let digits; try { digits = currencyDigits(currency); } catch (_) { return null; }
  if (exponent !== undefined && exponent !== digits) throw new Task21Error('来源金额单位冲突',409,'currency_unit_review_required');
  if (currency === 'JPY' && exponent !== 0) throw new Task21Error('日元原币金额需要明确零位单位',409,'currency_unit_review_required');
  if (!await sourceUnitsReady(db)) {
    if (currency === 'JPY') throw new Task21Error('日元来源单位需要增量迁移',503,'currency_unit_schema_required');
    return null;
  }
  return db.prepare(`INSERT OR IGNORE INTO task21_currency_units(user_id,event_id,currency,amount_exponent) VALUES(?1,?2,?3,?4)`)
    .bind(owner,event,currency,digits);
}
export async function assertSourceUnit(db, owner, event, currency, exponent) {
  if (currency === 'JPY' && exponent !== 0 && await sourceExponent(db,owner,event,currency) !== 0)
    throw new Task21Error('旧日元来源单位待核实，请重新确认原币金额',409,'currency_unit_review_required');
}
export async function projectSourceUnits(db, owner, payload) {
  const pending=[];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    // Source markers belong to events/hints. Ledger snapshots already carry
    // their independently verified transaction unit; a missing event key must
    // never erase that unit or reinterpret a nested currency role.
    if (value.currency === 'JPY' && (value.event_id || value.source_event_id)) pending.push(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(payload);
  for (const row of pending) {
    const event = row.event_id || row.source_event_id || '';
    row.amount_exponent = await sourceExponent(db,owner,event,'JPY');
    row.money_unit_status = row.amount_exponent === 0 ? 'verified' : 'review_required';
  }
  return payload;
}
