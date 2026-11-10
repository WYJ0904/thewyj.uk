// QA-only transport. No endpoint, credential, filesystem backup input or live DB configuration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export function verifyEvidence(detail, minimum, requiredIds) {
  assert.ok(Array.isArray(detail.rows) && detail.rows.length >= minimum, `Missing checks: expected >=${minimum}`);
  const ids = detail.rows.map(r => r.id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length), 'Missing check identifier');
  assert.equal(new Set(ids).size, ids.length, 'Duplicate checks cannot replace a missing check');
  assert.ok(detail.rows.every(r => r.status === 'PASS'), 'Executable evidence contains failed/blocked checks');
  if (requiredIds) assert.deepEqual([...ids].sort(), [...requiredIds].sort(), 'Required checklist differs from executed checks');
  if (detail.status) assert.equal(detail.status, 'PASS');
}
export function gateVerdict(suites, requiredIds) {
  if (!suites.length || suites.length !== requiredIds.length || new Set(suites.map(s => s.id)).size !== suites.length) return 'FAIL';
  if (requiredIds.some(id => !suites.some(s => s.id === id))) return 'FAIL';
  return suites.every(s => s.status === 'PASS' && s.exit_code === 0) ? 'PASS' : 'FAIL';
}
export const exitCodeFor = status => status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1;
const sorted = rows => rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
export function normalized(snapshot) {
  return canonical({ ...snapshot, schema: sorted(snapshot.schema), sequence: sorted(snapshot.sequence),
    tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, sorted(rows)])) });
}
export async function snapshot(db) {
  const { dumpD1 } = await import('../finance-p03/phase-a/d1-snapshot.mjs');
  return normalized(await dumpD1(db));
}

export function differences(before, after) {
  const changes = [];
  for (const table of [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort()) {
    const a = sorted(before.tables[table] || []), b = sorted(after.tables[table] || []);
    if (hash(a) === hash(b) && Object.hasOwn(before.tables, table) === Object.hasOwn(after.tables, table)) continue;
    const aSet = new Set(a.map(r => JSON.stringify(r))), bSet = new Set(b.map(r => JSON.stringify(r)));
    changes.push({ table, before_count: a.length, after_count: b.length, before_sha256: hash(a), after_sha256: hash(b),
      removed: a.filter(r => !bSet.has(JSON.stringify(r))), added: b.filter(r => !aSet.has(JSON.stringify(r))) });
  }
  if (hash(before.schema) !== hash(after.schema)) changes.push({ component: 'schema', before: before.schema, after: after.schema });
  if (hash(before.sequence) !== hash(after.sequence)) changes.push({ component: 'sequence', before: before.sequence, after: after.sequence });
  return changes;
}

export function seal(data, owner) {
  return { format: 'p04-synthetic-logical-d1-v1', account_id: owner, snapshot_sha256: hash(data), snapshot: data };
}
function reject(code) { const error = new Error(code); error.code = code; throw error; }

export function validateBundle(bundle, owner) {
  if (!owner.startsWith('synthetic-') || bundle.account_id !== owner) reject('restore_owner_mismatch');
  if (bundle.format !== 'p04-synthetic-logical-d1-v1') reject('restore_format_unsupported');
  if (hash(bundle.snapshot) !== bundle.snapshot_sha256) reject('restore_hash_mismatch');
  const data = bundle.snapshot;
  const tables = data.schema.filter(r => r.type === 'table').map(r => r.name).sort();
  if (JSON.stringify(tables) !== JSON.stringify(Object.keys(data.tables).sort())) reject('restore_component_set_mismatch');
  for (const [name, rows] of Object.entries(data.tables)) {
    for (const row of rows) {
      if ((Object.hasOwn(row, 'user_id') && row.user_id !== owner) || (name === 'task12_users' && row.id !== owner)) reject('restore_row_owner_mismatch');
    }
  }
  for (const [name, version] of [['task16_metadata', '5'], ['task21_metadata', '9'], ['task16_fx_metadata', '1']]) {
    if (data.tables[name]?.find(r => r.key === 'schema_version')?.value !== version) reject('restore_schema_unsupported');
  }
}

export async function restoreSyntheticBundle(db, bundle, owner) {
  const { restoreD1 } = await import('../finance-p03/phase-a/d1-snapshot.mjs');
  validateBundle(bundle, owner);
  const current = await snapshot(db);
  // A historical snapshot must never replace newer edits, decisions, receipts or queues.
  // The QA transport only restores to a fresh, unbound target; it has no overwrite mode.
  if (current.schema.length || Object.keys(current.tables).length) reject('restore_target_not_empty');
  await restoreD1(db, bundle.snapshot);
  assert.deepEqual(await snapshot(db), normalized(bundle.snapshot));
  return { snapshot_sha256: hash(bundle.snapshot), target_sha256: hash(await snapshot(db)) };
}

export function counts(data) {
  const t = data.tables;
  return { transactions: t.task16_finance_transactions?.length || 0,
    active_transactions: t.task16_finance_transactions?.filter(r => r.status === 'active').length || 0,
    raw_events: t.task16_finance_raw_events?.length || 0,
    relations: t.task16_finance_transaction_events?.length || 0,
    import_batches: t.task16_import_batches?.length || 0,
    import_batch_receipts: t.task16_import_receipts?.length || 0,
    import_record_receipts: t.task16_import_record_receipts?.length || 0,
    sync_receipts: t.task16_finance_sync_operations?.length || 0,
    notification_receipts: t.task21_notification_sync_operations?.length || 0 };
}

export async function assertNoOrphans(db) {
  const foreignKeys = (await db.prepare('PRAGMA foreign_key_check').all()).results;
  assert.deepEqual(foreignKeys, []);
  for (const sql of [
    `SELECT r.* FROM task16_finance_transaction_events r LEFT JOIN task16_finance_transactions t ON t.id=r.transaction_id
      LEFT JOIN task16_finance_raw_events e ON e.id=r.raw_event_id WHERE t.id IS NULL OR e.id IS NULL OR t.user_id!=e.user_id`,
    `SELECT r.* FROM task16_import_record_receipts r LEFT JOIN task16_finance_transactions t ON t.id=r.record_id
      LEFT JOIN task16_import_batches b ON b.source_key=r.source_key WHERE t.id IS NULL OR b.source_key IS NULL
      OR t.import_source_key!=r.source_key OR t.user_id!=b.user_id`,
    `SELECT r.* FROM task16_import_receipts r LEFT JOIN task16_import_batches b ON b.source_key=r.source_key WHERE b.source_key IS NULL`,
    `SELECT e.* FROM task21_notification_events e LEFT JOIN task16_finance_transactions t ON t.id=e.finance_transaction_id
      WHERE e.finance_transaction_id!='' AND (t.id IS NULL OR t.user_id!=e.user_id)`,
  ]) assert.deepEqual((await db.prepare(sql).all()).results, [], sql);
  const data = await snapshot(db);
  const tx = new Map(data.tables.task16_finance_transactions.map(r => [r.id, r]));
  for (const name of ['task16_finance_sync_operations', 'task21_notification_sync_operations']) {
    for (const receipt of data.tables[name]) {
      const result = JSON.parse(receipt.result_json);
      const id = result.transaction_id || result.transaction?.id;
      if (id) assert.equal(tx.get(id)?.user_id, receipt.user_id, `${name}: ${receipt.operation_id}`);
    }
  }
  return { foreign_key_violations: 0, orphan_relations_and_receipts: 0 };
}
