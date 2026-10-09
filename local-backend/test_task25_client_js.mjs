import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFeatureSnapshot, snapshotFeatureEnabled } from '../js/core/feature-flags.js';
import { featureFlags } from '../functions/_lib/cloudflare-foundation.mjs';

const contract = JSON.parse(await readFile(new URL('../qa/task25/feature-contract-vectors.json', import.meta.url), 'utf8'));
for (const test of contract.cases) {
  const snapshot = parseFeatureSnapshot(test.snapshot, test.account_id, contract.now_ms);
  assert.equal(snapshot !== null, test.valid, test.name);
  assert.equal(snapshotFeatureEnabled(snapshot, 'aeris_experimental_badge', test.account_id, contract.now_ms), test.expected_enabled, test.name);
  assert.equal(snapshotFeatureEnabled(snapshot, 'unknown_flag', test.account_id, contract.now_ms), false);
  assert.equal(snapshotFeatureEnabled(snapshot, 'aeris_experimental_badge', 'other-account', contract.now_ms), false);
  assert.equal(snapshotFeatureEnabled(snapshot, 'aeris_experimental_badge', test.account_id, contract.now_ms + 30000), false);
}
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
// Post-migration activation must survive subsequent Pages Git deployments.
assert.equal(config.vars.TASK25_FEATURE_FLAGS_ENABLED, 'true');
assert.equal(config.env.production.vars.TASK25_FEATURE_FLAGS_ENABLED, 'true');
// Unconfigured clients/environments still fail closed; this is separate from
// the deployed service switch and the default OFF feature definitions.
assert.equal(featureFlags({}).task25FeatureFlags, false);
assert.notEqual(config.env.preview.d1_databases[0].database_id, config.env.production.d1_databases[0].database_id);
assert.notEqual(config.env.preview.r2_buckets[0].bucket_name, config.env.production.r2_buckets[0].bucket_name);
console.log(`Task 25 shared Web/native contracts: ${contract.cases.length} vectors and infrastructure boundary passed`);
