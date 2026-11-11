import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ROOT, PRODUCT_REFERENCE_COMMIT, createConfiguration, prepare, readAllowlist, sourceFiles, validate, validateResources } from './stage-preview.mjs';

const sourceCommit = 'ce7c87ef3e23907577c0266bfcccc002bcebcd2c';
const freshResources = () => ({
  project_name: 'thewyj-finance-p04-preview', database_name: 'finance-p04-owner-preview',
  database_id: '98a7f015-2413-4ab6-8897-243c6d9ba517', account_id: '0123456789abcdef0123456789abcdef', branch: 'owner-p04-preview',
});
const allowlistText = await fs.readFile(path.join(ROOT, 'scripts/stage_pages_deploy.mjs'), 'utf8');
const allowlist = readAllowlist(allowlistText);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const resourcesRelative = 'docs/migration-evidence/finance-p04/experience-channel-current/resources.json';
async function put(root, name, contents) {
  const target = path.join(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}
async function fixture() {
  // Every test owns a fresh directory. Nothing from old QA or the normal browser is removed.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-p04-stage-contract-'));
  await put(root, 'scripts/stage_pages_deploy.mjs', allowlistText);
  for (const name of allowlist.files) await put(root, name, `fixture:${name}\n`);
  const currencies = ['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY'];
  const selectors = ['financeDisplayCurrency', 'financeAccountCurrency', 'financeDefaultCurrency']
    .map(id => `<select id="${id}">${currencies.map(currency => `<option value="${currency}">${currency}</option>`).join('')}</select>`).join('');
  await put(root, 'index.html', `<!doctype html><html><head><title>Fixture</title></head><body>${selectors}</body></html>`);
  await put(root, '_headers', '/*\n  Content-Security-Policy: default-src \'self\'\n');
  await put(root, 'assets/static.txt', 'asset');
  await put(root, 'functions/_middleware.js', 'export const onRequest = async c => c.next();');
  await put(root, 'js/module.js', 'export const answer = 42;');
  await put(root, 'vendor/vendor.txt', 'licensed fixture');
  await put(root, resourcesRelative, JSON.stringify(freshResources()));
  await put(root, 'wrangler.jsonc', JSON.stringify({ name: 'protected-root-config', d1_databases: [{ database_id: '11c288d8-c584-409f-bb1f-7e7af11793e5' }] }));
  await put(root, '.wrangler/pages-output/retained-artifact.txt', 'historical staging must survive');
  return { root, output: path.join(root, '.wrangler/finance-p04-owner-preview'), sourceCommit };
}
async function readBuild(options) {
  return JSON.parse(await fs.readFile(path.join(options.output, '__preview/build.json'), 'utf8'));
}
async function assertNotCreated(options) {
  await assert.rejects(fs.stat(options.output), { code: 'ENOENT' });
}

test('actual allowlist contains 156 product files; historical 157 includes QA config', async () => {
  const actual = await sourceFiles(ROOT);
  assert.equal(actual.files.size, 156);
  assert.equal(actual.allowlistText, allowlistText);
  for (const name of actual.files.keys()) assert(!/^(?:docs|qa|android|node_modules|\.git|_wyj-tools)\//.test(name));
  const html = actual.files.get('index.html').toString('utf8');
  for (const id of ['financeDisplayCurrency', 'financeAccountCurrency', 'financeDefaultCurrency']) assert(html.includes(`id="${id}"`));
});

test('stages the real allowlist contract with exactly two product overlays and immutable provenance', async () => {
  const options = await fixture();
  const rootConfig = await fs.readFile(path.join(options.root, 'wrangler.jsonc'));
  const source = await sourceFiles(options.root);
  const before = Object.fromEntries([...source.files].map(([name, bytes]) => [name, digest(bytes)]));
  const result = await prepare(options);
  assert.equal(result.status, 'PASS');
  assert.equal(result.staged_files, result.base_product_files + 4);
  assert.deepEqual(await fs.readFile(path.join(options.root, 'wrangler.jsonc')), rootConfig);
  assert.equal(await fs.readFile(path.join(options.root, '.wrangler/pages-output/retained-artifact.txt'), 'utf8'), 'historical staging must survive');
  assert.deepEqual(Object.fromEntries([...(await sourceFiles(options.root)).files].map(([name, bytes]) => [name, digest(bytes)])), before);
  const metadata = await readBuild(options);
  assert.equal(metadata.source_commit, sourceCommit);
  assert.equal(metadata.product_reference_commit, PRODUCT_REFERENCE_COMMIT);
  assert.equal(metadata.financial_seed_included, false);
  assert.match(metadata.database_contents, /^NOT VERIFIED BY STAGING/);
  assert.deepEqual(metadata.stage_only_product_overlays, ['index.html', '_headers']);
  assert.equal(result.database_blankness, 'NOT TESTED BY STAGING');
  const configuration = JSON.parse(await fs.readFile(path.join(options.output, 'wrangler.jsonc'), 'utf8'));
  assert.deepEqual(configuration.d1_databases, configuration.env.preview.d1_databases);
  assert.equal(configuration.d1_databases[0].database_id, freshResources().database_id);
  assert(!configuration.vars.WYJ_TASK12_PASSWORD_PEPPER);
  assert.equal(configuration.vars.WORKERS_AI_ENABLED, 'false');
  const html = await fs.readFile(path.join(options.output, 'index.html'), 'utf8');
  assert(html.includes(sourceCommit) && html.includes('独立账本，不连接正式账目') && html.includes('不是正式账户认证'));
  for (const currency of ['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'JPY']) assert(html.includes(`value="${currency}"`));
  const serialized = JSON.stringify(metadata) + html + JSON.stringify(configuration);
  assert(!serialized.includes('synthetic-p04-closure'));
});

test('a second prepare refuses to replace any existing artifact', async () => {
  const options = await fixture();
  await prepare(options);
  const bytes = await fs.readFile(path.join(options.output, '__preview/build.json'));
  await assert.rejects(prepare(options), /Existing staging is preserved/);
  assert.deepEqual(await fs.readFile(path.join(options.output, '__preview/build.json')), bytes);
});

for (const id of ['11c288d8-c584-409f-bb1f-7e7af11793e5', 'a3e6253b-689f-49f3-998b-7c5828ea255a', 'c2eb978f-9f49-4e4c-8286-f6b398fae0de', 'da1711d7-f770-4e30-b305-9d812588f8b4']) {
  test(`rejects Production/shared/historical database ${id}`, () => {
    assert.throws(() => validateResources({ ...freshResources(), database_id: id }), /must never be rebound/);
  });
}

test('requires exact owned project, account, database name and branch', () => {
  for (const change of [{ project_name: 'thewyj-uk' }, { account_id: '' }, { database_name: 'shared-preview' }, { branch: 'main' }, { database_id: 'a-name-not-an-id' }]) {
    assert.throws(() => validateResources({ ...freshResources(), ...change }));
  }
});

for (const change of [
  config => { config.r2_buckets = [{ binding: 'FORMAL', bucket_name: 'stable' }]; },
  config => { config.ai = { binding: 'AI' }; },
  config => { config.services = [{ binding: 'PRODUCTION', service: 'thewyj-uk' }]; },
  config => { config.vars.WYJ_TASK12_PASSWORD_PEPPER = 'never-an-inline-secret'; },
  config => { config.env.preview.d1_databases[0].database_id = 'a3e6253b-689f-49f3-998b-7c5828ea255a'; },
]) {
  test(`validation rejects changed configuration: ${change.toString()}`, async () => {
    const options = await fixture(); await prepare(options);
    const config = createConfiguration(freshResources()); change(config);
    await fs.writeFile(path.join(options.output, 'wrangler.jsonc'), JSON.stringify(config));
    await assert.rejects(validate(options), /Exact safe config required/);
  });
}

test('rejects unallowlisted financial seed or secret files in staging', async () => {
  const options = await fixture(); await prepare(options);
  await put(options.output, 'qa-accounts.sql', 'INSERT INTO task16_finance_transactions VALUES ("synthetic");');
  await assert.rejects(validate(options), /Unallowlisted\/seed\/secret files rejected/);
});

test('source allowlist traversal refuses secrets accidentally placed under an allowed directory', async () => {
  const options = await fixture();
  await put(options.root, 'assets/.dev.vars', 'QA_ONLY_DUMMY=not-a-real-secret');
  await assert.rejects(prepare(options), /Private asset rejected/);
  await assertNotCreated(options);
});

test('changed product JS after staging cannot pass validation', async () => {
  const options = await fixture(); await prepare(options);
  await put(options.output, 'js/module.js', 'export const answer = 100;');
  await assert.rejects(validate(options), /Unexpected product modification: js\/module.js/);
});

test('HTML and header overlays cannot be expanded silently', async () => {
  const options = await fixture(); await prepare(options);
  const html = await fs.readFile(path.join(options.output, 'index.html'), 'utf8');
  await put(options.output, 'index.html', html.replace('</head>', '<script src="https://thewyj.uk/not-allowed.js"></script></head>'));
  await assert.rejects(validate(options), /Unexpected Preview overlay: index.html/);
});

test('arbitrary provenance text and noncommit references fail before output is created', async () => {
  const options = await fixture();
  await assert.rejects(prepare({ ...options, context: '<script>private</script>' }), /Context is a non-sensitive/);
  await assert.rejects(prepare({ ...options, sourceCommit: 'main' }), /Full source commit required/);
  await assertNotCreated(options);
});

test('output outside the exact owned staging directory is rejected without writes', async () => {
  const options = await fixture();
  await assert.rejects(prepare({ ...options, output: path.join(options.root, '.wrangler/pages-output') }), /exact owned Preview staging directory/);
  assert.equal(await fs.readFile(path.join(options.root, '.wrangler/pages-output/retained-artifact.txt'), 'utf8'), 'historical staging must survive');
});

test('source directory junctions/symlinks are rejected without following them', async () => {
  const options = await fixture();
  const external = path.join(options.root, 'not-allowlisted');
  await fs.mkdir(external);
  await put(external, 'unrelated.txt', 'must not be staged');
  await fs.symlink(external, path.join(options.root, 'assets/aliased'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepare(options), /Reparse\/symlink rejected/);
  await assertNotCreated(options);
});
