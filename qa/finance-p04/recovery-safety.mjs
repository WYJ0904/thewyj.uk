import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { fixture, root } from './fixture.mjs';
import { outUrl } from './output.mjs';
import { importLegacyFinance, rollbackTask16Import } from '../../functions/_lib/task16-import.mjs';
import { listFinanceTransactions, syncFinance } from '../../functions/_lib/task16-service.mjs';
import { ingestNotificationEvents, listNotificationEvents, rejectNotificationCandidate } from '../../functions/_lib/task21-service.mjs';
import { currencyPreferences, referenceRate, transactionReferences } from '../../functions/_lib/finance-fx.mjs';
import { stableJson } from '../../functions/_lib/task16-model.mjs';
import { sha256Hex } from '../../functions/_lib/cloudflare-foundation.mjs';
import { snapshot, hash, seal, restoreSyntheticBundle, differences, counts, assertNoOrphans } from './recovery-support.mjs';

const datasetBytes = await readFile(new URL('fixtures/recovery-safety.json', import.meta.url));
const data = JSON.parse(datasetBytes);
const rows = [], diffs = [], runtimes = [];
async function artifact(name, value) { await writeFile(new URL(name, outUrl), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function check(id, run) {
  try { rows.push({ id, status: 'PASS', actual: await run() }); }
  catch (error) { rows.push({ id, status: 'FAIL', error: { code: error.code, message: error.message, stack: error.stack } }); }
  console.log(rows.at(-1).status, id);
}
async function emptyTarget() {
  const mf = new Miniflare({ modules: true, script: 'export default{fetch(){return new Response("synthetic recovery target")}}',
    compatibilityDate: '2026-08-06', d1Databases: ['DB'], d1Persist: false });
  runtimes.push(mf);
  return mf.getD1Database('DB');
}
function legacyRecords(prefix, currencies = data.currencies) {
  return currencies.map((item, i) => ({ id: `synthetic-${prefix}-${item.currency}`, user_id: data.account_id, direction: 'expense',
    amount_minor: item.amount_minor, currency: item.currency, merchant: 'synthetic merchant', counterparty: '', note: '',
    occurred_at_ms: data.occurred_at_ms + i, source: 'synthetic DailyPayGuard', legacy_timestamp: data.occurred_at_ms + i, legacy_type: '消费' }));
}
async function importBody(source, records, complete = true) {
  return { source_key: source, user_id: data.account_id, source_count: records.length,
    canonical_sha256: await sha256Hex(stableJson([...records].sort((a, b) => a.id.localeCompare(b.id)))),
    batch_key: `synthetic-batch-${source}`, records, complete };
}
const syncBody = operations => ({ schema_version: 1, device_id: 'synthetic-recovery-device', platform: 'web', since_version: 0, operations });
const upsert = (id, currency, amount, revision = 0, extra = {}) => ({ operation_id: `synthetic-upsert-${id}-${revision}`,
  type: 'transaction.upsert', entity_id: id, base_revision: revision,
  payload: { direction: 'expense', amount_minor: amount, currency, occurred_at_ms: data.occurred_at_ms,
    ...(currency === 'JPY' ? { amount_exponent: 0 } : {}), ...extra } });
const row = (db, id) => db.prepare('SELECT * FROM task16_finance_transactions WHERE id=?1').bind(id).first();
function financialState(s) {
  // Sync registration/last-seen timestamps are allowed to advance on retry; the ledger,
  // changes, raw events, relationships, decisions and durable receipts must not change.
  return Object.fromEntries(Object.entries(s.tables).filter(([name]) => name.startsWith('task16_') || name.startsWith('task21_'))
    .filter(([name]) => !['task16_finance_devices', 'task21_notification_devices'].includes(name)));
}
let f, upgraded, restored, importRequest, syncRequests, notificationRequest, notificationId, rejectedRequest, rejectedId, historical, finalSnapshot;
try {
  f = await fixture({ before: 31 });
  assert.equal(f.account.id, data.account_id);
  const legacy = legacyRecords('legacy-recovery');
  importRequest = await importBody('synthetic-upgrade-source', legacy);
  await importLegacyFinance(f.db, importRequest);
  const original = await snapshot(f.db);
  await artifact('before-upgrade.json', original);
  for (const name of (await readdir(path.join(root, 'cloudflare/migrations'))).filter(n => /^\d{4}_.+\.sql$/.test(n) && Number(n.slice(0, 4)) >= 31).sort()) {
    await f.db.exec((await readFile(path.join(root, 'cloudflare/migrations', name), 'utf8')).replace(/\r?\n/g, ' '));
  }
  upgraded = await snapshot(f.db);
  await artifact('after-upgrade.json', upgraded);
  diffs.push({ phase: 'upgrade', changes: differences(original, upgraded) });
  await check('legacy-upgrade-every-original-column-and-receipt', async () => {
    for (const [table, records] of Object.entries(original.tables)) {
      if (['task16_metadata', 'task21_metadata'].includes(table)) continue;
      const columns = Object.keys(records[0] || {});
      const projected = upgraded.tables[table].map(r => Object.fromEntries(columns.map(k => [k, r[k]])));
      const sortRows = values => values.map(r => stableJson(r)).sort();
      assert.deepEqual(sortRows(projected), sortRows(records), table);
    }
    for (const item of legacy) {
      const actual = await row(f.db, item.id);
      assert.equal(actual.amount_minor, item.amount_minor);
      assert.equal(actual.currency, item.currency);
      assert.equal(actual.revision, 1);
      assert.equal(actual.amount_exponent, item.currency === 'JPY' ? null : 2);
    }
    return { legacy_transactions: legacy.length, legacy_JPY_exponent: null, historical_money_rescaled: false };
  });

  // Existing migration suites cover old binaries, interrupted/repeated DDL and SQLite reopen.
  syncRequests = data.currencies.map(item => syncBody([upsert(`synthetic-current-${item.currency}`, item.currency, item.amount_minor)]));
  for (const body of syncRequests) await syncFinance(f.db, f.account, body);
  notificationRequest = { schema_version: 1, device_id: 'synthetic-recovery-device', operations: [{
    operation_id: 'synthetic-recovery-notification-operation', type: 'event.ingest', payload: {
      event_id: 'synthetic-recovery-source-event', fingerprint: 'f'.repeat(64), source_package: 'cmb.pb',
      source_type: 'notification', event_type: 'transaction', parser_version: 'bank-notification-4', parse_status: 'parsed',
      direction: 'expense', amount_minor: 10000, currency: 'USD', currency_evidence: '',
      currency_review_required: true, currency_decision_source: 'account_default',
      payment_channel: 'bank_card', provider_reference: 'SYNTH-RECOVERY-001', confidence: 950,
      occurred_at_ms: data.occurred_at_ms, received_at_ms: data.occurred_at_ms,
    } }] };
  notificationId = (await ingestNotificationEvents(f.db, f.account, notificationRequest)).operation_results[0].transaction_id;
  assert.ok(notificationId);
  rejectedRequest = structuredClone(notificationRequest);
  rejectedRequest.operations[0].operation_id = 'synthetic-rejected-notification-operation';
  Object.assign(rejectedRequest.operations[0].payload, { event_id: 'synthetic-rejected-source-event', fingerprint: 'e'.repeat(64),
    provider_reference: 'SYNTH-RECOVERY-REJECTED', parse_status: 'candidate', confidence: 500 });
  rejectedId = (await ingestNotificationEvents(f.db, f.account, rejectedRequest)).operation_results[0].candidate_id;
  assert.ok(rejectedId);
  const staleBundle = seal(await snapshot(f.db), f.account.id);
  await artifact('stale-before-human-decision.json', staleBundle);
  const edit = syncBody([upsert(notificationId, data.manual_decision.currency, data.manual_decision.amount_minor, 1,
    { currency_review_acknowledged: true, merchant: 'synthetic human correction' })]);
  await syncFinance(f.db, f.account, edit);
  await currencyPreferences(f.db, f.account.id, { default_currency: data.manual_decision.default_currency, revision: 0 });
  // A real user-confirmed delete is also retained as a tombstone and cannot be revived by stale restore.
  const deletedId = 'synthetic-current-HKD';
  const deletion = syncBody([{ operation_id: 'synthetic-confirmed-delete', type: 'transaction.delete', entity_id: deletedId, base_revision: 1 }]);
  await syncFinance(f.db, f.account, deletion);
  await rejectNotificationCandidate(f.db, f.account, { candidate_id: rejectedId });

  let providerCalls = 0;
  function provider(rate) {
    return async url => {
      providerCalls++;
      const u = new URL(url);
      assert.equal(u.pathname, '/v2/rate/USD/CNY');
      assert.equal(u.searchParams.get('date'), data.fx.date);
      return new Response(`{"base":"USD","quote":"CNY","date":"${data.fx.date}","rate":${rate}}`, { headers: { 'Content-Type': 'application/json' } });
    };
  }
  const fxInput = { transaction_ids: ['synthetic-current-USD'], display_currency: 'CNY' };
  historical = await transactionReferences(f.db, f.account.id, fxInput, { fetcher: provider(data.fx.old_rate), now: data.fx.now });
  assert.equal(Object.keys(historical.references).length, 1);
  finalSnapshot = await snapshot(f.db);
  const bundle = seal(finalSnapshot, f.account.id);
  await artifact('backup.json', bundle);

  await check('restore-all-tables-IDs-revisions-receipts-and-relations', async () => {
    restored = await emptyTarget();
    const result = await restoreSyntheticBundle(restored, bundle, f.account.id);
    const after = await snapshot(restored);
    const changes = differences(finalSnapshot, after);
    diffs.push({ phase: 'restore', changes });
    await artifact('after-restore.json', after);
    assert.deepEqual(changes, []);
    return { ...result, before: counts(finalSnapshot), after: counts(after), ...await assertNoOrphans(restored) };
  });
  await check('six-currencies-preserve-minor-units-and-exponents-after-restore', async () => {
    for (const item of data.currencies) {
      const actual = await row(restored, `synthetic-current-${item.currency}`);
      assert.equal(actual.amount_minor, item.amount_minor, item.currency);
      assert.equal(actual.currency, item.currency);
      assert.equal(actual.amount_exponent, item.amount_exponent);
    }
    const legacyJPY = await row(restored, 'synthetic-legacy-recovery-JPY');
    assert.equal(legacyJPY.amount_minor, 3725);
    assert.equal(legacyJPY.amount_exponent, null);
    return { currencies: data.currencies, legacy_JPY_still_unproven: true };
  });
  await check('confirmed-human-correction-default-decision-and-delete-survive-replay', async () => {
    const before = await snapshot(restored);
    const replay = await ingestNotificationEvents(restored, f.account, notificationRequest);
    assert.equal(replay.operation_results[0].transaction_id, notificationId);
    assert.equal(replay.operation_results[0].idempotent_replay, true);
    for (const body of [edit, deletion]) assert.equal((await syncFinance(restored, f.account, body)).operation_results[0].idempotent_replay, true);
    await ingestNotificationEvents(restored, f.account, rejectedRequest);
    assert.equal((await rejectNotificationCandidate(restored, f.account, { candidate_id: rejectedId })).no_change, true);
    assert.equal((await restored.prepare('SELECT status FROM task21_notification_candidates WHERE id=?1').bind(rejectedId).first()).status, 'rejected');
    const decisions = (await restored.prepare('SELECT event_id,decision FROM task21_payment_user_decisions WHERE user_id=?1').bind(f.account.id).all()).results;
    assert.deepEqual(decisions, [{ event_id: 'synthetic-rejected-source-event', decision: 'candidate_reject' }]);
    const actual = await row(restored, notificationId);
    assert.equal(actual.currency, 'EUR'); assert.equal(actual.amount_minor, 23456); assert.equal(actual.revision, 2);
    assert.equal(actual.currency_review_required, 0); assert.equal(actual.currency_decision_source, 'user_confirmed');
    assert.equal((await currencyPreferences(restored, f.account.id)).default_currency, 'GBP');
    assert.equal((await row(restored, deletedId)).status, 'deleted');
    const raw = await restored.prepare('SELECT currency,amount_minor FROM task16_finance_raw_events WHERE source_event_id=?1').bind('synthetic-recovery-source-event').first();
    assert.deepEqual(raw, { currency: 'USD', amount_minor: 10000 });
    assert.deepEqual(financialState(await snapshot(restored)), financialState(before));
    return { transaction_id: notificationId, revision: 2, original_source_currency: 'USD', confirmed_currency: 'EUR',
      deleted_tombstone_retained: true, rejected_candidate_decision_preserved: true };
  });
  await check('stale-snapshot-cannot-overwrite-new-human-decisions', async () => {
    const before = await snapshot(restored);
    await assert.rejects(() => restoreSyntheticBundle(restored, staleBundle, f.account.id), e => e.code === 'restore_target_not_empty');
    assert.deepEqual(await snapshot(restored), before);
    return { rejection: 'restore_target_not_empty', overwritten_rows: 0, boundary: 'QA transport to fresh target only' };
  });
  await check('historical-FX-keeps-original-rate-after-restored-cache-refresh', async () => {
    const fresh = await referenceRate(restored, 'USD', 'CNY', data.fx.date, { fetcher: provider(data.fx.new_rate), now: data.fx.now + 7 * 3600000 });
    assert.notEqual(fresh.id, Object.values(historical.references)[0].id);
    const callsBefore = providerCalls;
    const actual = await transactionReferences(restored, f.account.id, fxInput, { now: data.fx.now + 7 * 3600000, fetcher: () => { throw Error('Historical reference must not fetch'); } });
    assert.deepEqual(actual, historical);
    assert.equal(providerCalls, callsBefore);
    assert.equal((await row(restored, 'synthetic-current-USD')).amount_minor, 12345);
    return { simulated_provider_calls: providerCalls, old_reference: historical, refreshed_rate_id: fresh.id, live_provider_calls: 0 };
  });
  await check('same-import-batch-and-sync-operation-retry-remain-idempotent-after-restore', async () => {
    const before = await snapshot(restored);
    for (let i = 0; i < 3; i++) {
      assert.equal((await importLegacyFinance(restored, importRequest)).idempotent_replay, true);
      for (const body of syncRequests) assert.equal((await syncFinance(restored, f.account, body)).operation_results[0].idempotent_replay, true);
    }
    assert.deepEqual(financialState(await snapshot(restored)), financialState(before));
    await assert.rejects(() => importLegacyFinance(restored, { ...importRequest,
      records: importRequest.records.map((r, i) => i ? r : { ...r, amount_minor: r.amount_minor + 1 }) }), e => e.code === 'import_batch_conflict');
    const changed = structuredClone(syncRequests[0]); changed.operations[0].payload.amount_minor++;
    await assert.rejects(() => syncFinance(restored, f.account, changed), e => e.code === 'operation_id_conflict');
    assert.deepEqual(financialState(await snapshot(restored)), financialState(before));
    return { attempts: 3, duplicate_ledger_rows: 0, changed_payload_rejected: true, ...await assertNoOrphans(restored) };
  });
  await check('cross-account-restore-read-modify-and-transaction-restore-rejected', async () => {
    const target = await emptyTarget(), empty = await snapshot(target);
    await assert.rejects(() => restoreSyntheticBundle(target, bundle, data.other_account_id), e => e.code === 'restore_owner_mismatch');
    const forged = structuredClone(bundle); forged.account_id = data.other_account_id;
    await assert.rejects(() => restoreSyntheticBundle(target, forged, data.other_account_id), e => e.code === 'restore_row_owner_mismatch');
    assert.deepEqual(await snapshot(target), empty);
    // Account middleware is exercised by the unchanged Task16 HTTP regression as well.
    await restored.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at)
      VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)`).bind(data.other_account_id, '2026-10-21T12:00:00.000Z').run();
    const other = { ...f.account, id: data.other_account_id, entitlements: ['finance_access', 'notification_archive_access'] };
    const before = await snapshot(restored);
    assert.deepEqual((await listFinanceTransactions(restored, other, { include_deleted: 'true' })).transactions, []);
    assert.deepEqual((await transactionReferences(restored, other.id, fxInput, { fetcher: () => { throw Error('must not fetch'); } })).references, {});
    assert.deepEqual((await listNotificationEvents(restored, other)).events, []);
    for (const operation of [upsert(notificationId, 'USD', 1, 2),
      { operation_id: 'synthetic-other-restore', type: 'transaction.restore', entity_id: deletedId, base_revision: 2 }]) {
      await assert.rejects(() => syncFinance(restored, other, syncBody([operation])), e => e.code === 'transaction_not_found');
    }
    const after = await snapshot(restored);
    // A refused request may register the attacker's own device/version, never the owner's data.
    for (const [table, records] of Object.entries(before.tables)) {
      const owned = records.filter(r => r.user_id === f.account.id);
      assert.deepEqual(after.tables[table].filter(r => r.user_id === f.account.id), owned, table);
    }
    return { restore_rejected: true, forged_manifest_rejected: true, reads_empty: true, modifications_rejected: 2, owner_rows_changed: 0 };
  });
  await check('bad-hash-missing-component-and-unsupported-schema-rejected-before-write', async () => {
    const target = await emptyTarget(), before = await snapshot(target);
    const cases = [
      ['restore_hash_mismatch', b => { b.snapshot.tables.task16_finance_transactions[0].amount_minor++; }],
      ['restore_component_set_mismatch', b => { delete b.snapshot.tables.task16_import_receipts; b.snapshot_sha256 = hash(b.snapshot); }],
      ['restore_schema_unsupported', b => { b.snapshot.tables.task16_metadata.find(r => r.key === 'schema_version').value = '999'; b.snapshot_sha256 = hash(b.snapshot); }],
    ];
    for (const [code, mutate] of cases) {
      const changed = structuredClone(bundle); mutate(changed);
      await assert.rejects(() => restoreSyntheticBundle(target, changed, f.account.id), e => e.code === code);
      assert.deepEqual(await snapshot(target), before);
    }
    return { rejected: cases.map(([code]) => code), target_unchanged: true };
  });
  await check('restore-constraint-failure-is-atomic-and-preserves-the-backup', async () => {
    const target = await emptyTarget(), before = await snapshot(target), backupHash = hash(bundle);
    const broken = structuredClone(bundle);
    broken.snapshot.tables.task16_finance_transaction_events[0].raw_event_id = 'synthetic-nonexistent-event';
    broken.snapshot_sha256 = hash(broken.snapshot);
    await assert.rejects(() => restoreSyntheticBundle(target, broken, f.account.id), /FOREIGN KEY constraint failed/);
    assert.deepEqual(await snapshot(target), before);
    assert.equal(hash(bundle), backupHash);
    return { rollback: 'entire D1 restore batch', remaining_target_tables: 0, original_backup_unchanged: true };
  });

  for (const [label, committed] of [['first-record', 0], ['second-record', 1], ['third-record', 2], ['batch-receipt', 3]]) {
    await check(`failed-import-${label}-rollback-keeps-audit-without-active-prefix-or-orphan-receipts`, async () => {
      const isolated = await fixture();
      try {
        const records = legacyRecords('failure', data.currencies.slice(0, 3));
        const input = await importBody(`synthetic-failure-${label}`, records);
        let batchCalls = 0, faults = 0;
        const faultDb = { prepare: (...args) => isolated.db.prepare(...args), batch: statements => {
          batchCalls++;
          if (batchCalls > committed) { faults++; return isolated.db.batch([...statements, isolated.db.prepare('INSERT INTO synthetic_injected_missing_table VALUES(1)')]); }
          return isolated.db.batch(statements);
        } };
        await assert.rejects(() => importLegacyFinance(faultDb, input), /synthetic_injected_missing_table/);
        const failed = await snapshot(isolated.db);
        assert.equal(counts(failed).transactions, committed);
        assert.equal(counts(failed).import_record_receipts, committed);
        assert.equal(counts(failed).import_batch_receipts, 0);
        await assertNoOrphans(isolated.db);
        const rollback = await rollbackTask16Import(isolated.db, { source_key: input.source_key });
        assert.equal(rollback.rolled_back, committed);
        const after = await snapshot(isolated.db);
        assert.equal(counts(after).active_transactions, 0);
        assert.equal(counts(after).transactions, committed); // tombstones, never delete evidence
        assert.equal(counts(after).raw_events, committed);
        assert.equal(counts(after).relations, committed);
        assert.equal(counts(after).import_record_receipts, committed);
        assert.equal(counts(after).import_batch_receipts, 0);
        for (const t of after.tables.task16_finance_transactions) { assert.equal(t.status, 'deleted'); assert.equal(t.revision, 2); }
        assert.equal(after.tables.task16_import_batches[0].status, 'rolled_back');
        assert.equal((await rollbackTask16Import(isolated.db, { source_key: input.source_key })).no_change, true);
        assert.deepEqual(await snapshot(isolated.db), after);
        await assert.rejects(() => importLegacyFinance(isolated.db, input), e => e.code === 'import_already_rolled_back');
        const changes = differences(failed, after);
        await artifact(`import-failure-${label}.json`, { injected_faults: faults, failed, after, changes });
        return { injected_faults: faults, committed_before_failure: committed, after_rollback: counts(after), ...await assertNoOrphans(isolated.db) };
      } finally { await isolated.dispose(); }
    });
  }
  await check('rollback-refuses-to-erase-later-human-corrections', async () => {
    const isolated = await fixture();
    try {
      const records = legacyRecords('corrected-import', data.currencies.slice(0, 2));
      const input = await importBody('synthetic-corrected-import', records);
      await importLegacyFinance(isolated.db, input);
      await syncFinance(isolated.db, isolated.account, syncBody([upsert(records[1].id, 'USD', 98765, 1)]));
      const before = await snapshot(isolated.db);
      await assert.rejects(() => rollbackTask16Import(isolated.db, { source_key: input.source_key }), e => e.code === 'rollback_conflict');
      assert.deepEqual(await snapshot(isolated.db), before);
      return { rejection: 'rollback_conflict', protected_revision: 2, changed_rows: 0 };
    } finally { await isolated.dispose(); }
  });
} catch (error) {
  rows.push({ id: 'fixture-or-workflow', status: 'FAIL', error: { code: error.code, message: error.message, stack: error.stack } });
} finally {
  if (f) await f.dispose();
  for (const mf of runtimes) await mf.dispose();
  const report = { status: rows.length && rows.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', synthetic_only: true,
    dataset_sha256: hash(datasetBytes), checklist_sha256: hash(data.checks), rows, differences: diffs,
    before_restore: finalSnapshot ? counts(finalSnapshot) : null,
    limitations: ['QA logical restore into an empty Miniflare D1 target only', 'Production/personal backup, native Android restoration and Time Travel NOT_TESTED'] };
  await artifact('recovery.json', report);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
  console.log(JSON.stringify({ status: report.status, PASS: rows.filter(r => r.status === 'PASS').length, FAIL: rows.filter(r => r.status === 'FAIL').length }));
}
