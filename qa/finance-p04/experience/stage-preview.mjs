import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PRODUCT_REFERENCE_COMMIT = '73764f77fd02ada240e41c24734e523c5dad8805';
const DEFAULT_CONTEXT = 'owner-approved-independent-preview-login';
const OUTPUT_NAME = 'finance-p04-owner-preview';
const FORBIDDEN_DATABASES = new Set([
  '11c288d8-c584-409f-bb1f-7e7af11793e5', // Production
  'a3e6253b-689f-49f3-998b-7c5828ea255a', // shared Preview
  'c2eb978f-9f49-4e4c-8286-f6b398fae0de', // deleted historical QA
  'da1711d7-f770-4e30-b305-9d812588f8b4', // deleted historical recovery QA
]);
const OVERLAY_PATHS = ['__preview/preview-ui.js', '__preview/preview-ui.css', '__preview/build.json', 'wrangler.jsonc'];
const REPLACED_PRODUCT_FILES = ['index.html', '_headers'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.split(path.sep).join('/');
const json = value => JSON.stringify(value, null, 2) + '\n';
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;

function resourcePath(root) {
  return path.join(root, 'docs/migration-evidence/finance-p04/experience-channel-current/resources.json');
}

/** Existing ancestors and every traversed source child must be real paths. */
export async function assertNoReparse(target, allowMissing = false) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
    assert(!stat.isSymbolicLink(), `Reparse/symlink rejected: ${current}`);
    assert.equal(normalized(await fs.realpath(current)), normalized(current), `Aliased path rejected: ${current}`);
  }
}

function safeAssetName(relative) {
  assert(relative && !path.isAbsolute(relative) && !relative.includes('\\'), 'Asset must be a relative POSIX name');
  const parts = relative.split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..'), 'Unsafe asset segment');
  assert(!parts.some(part => ['.git', 'node_modules', '_wyj-tools', 'docs', 'qa', 'android', 'private'].includes(part)), 'Developer/private directory rejected');
  const name = parts.at(-1).toLowerCase();
  assert(!name.startsWith('.env') && !name.startsWith('.dev.vars') && !name.includes('访问口令'), 'Private asset rejected');
  assert(!/\.(?:jks|keystore|pem|key|sqlite|sqlite3|db|sql|tar|zip)$/i.test(name), 'Credential/database/archive asset rejected');
  assert(!/^(?:secrets?|credentials?)(?:[.-]|$)/i.test(name), 'Secret fixture rejected');
}

/** Read the existing literal allowlist without executing its destructive old-output rebuild. */
export function readAllowlist(source) {
  const read = name => {
    const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\((\\[[\\s\\S]*?\\])\\);`));
    assert(match, `Existing allowlist ${name} was not found`);
    const values = JSON.parse(match[1].replace(/,\s*\]/g, ']'));
    assert(Array.isArray(values) && values.every(value => typeof value === 'string'));
    values.forEach(safeAssetName);
    assert.equal(new Set(values).size, values.length);
    return values;
  };
  const files = read('ROOT_FILES'), directories = read('ROOT_DIRECTORIES');
  assert.deepEqual(directories, ['assets', 'functions', 'js', 'vendor'], 'Review a changed production allowlist before staging');
  assert(files.includes('index.html') && files.includes('_headers') && files.includes('sw.js'));
  return { files, directories };
}

export function validateResources(resources) {
  assert.equal(resources.project_name, 'thewyj-finance-p04-preview');
  assert.equal(resources.database_name, 'finance-p04-owner-preview');
  assert.equal(resources.branch, 'owner-p04-preview');
  assert(/^[a-f0-9]{32}$/.test(resources.account_id), 'A concrete Cloudflare account ID is required');
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(resources.database_id), 'A fresh D1 UUID is required');
  assert(!FORBIDDEN_DATABASES.has(resources.database_id), 'Production/shared/deleted database must never be rebound');
  return Object.fromEntries(['project_name', 'database_name', 'database_id', 'account_id', 'branch'].map(key => [key, resources[key]]));
}

export function createConfiguration(resources) {
  const r = validateResources(resources);
  const vars = {
    WYJ_ENVIRONMENT: 'preview', CLOUD_FOUNDATION_ENABLED: 'true', CLOUD_STATUS_MODE: 'cloud',
    CLOUD_READS_ENABLED: 'true', CLOUD_WRITES_ENABLED: 'true', CLOUD_DEEP_HEALTH_CHECKS: 'true',
    TASK12_CLOUD_ACCOUNTS_ENABLED: 'true', TASK13_CLOUD_READS_ENABLED: 'true',
    TASK15_CLOUD_ONLY_ENABLED: 'true', TASK16_CLOUD_READS_ENABLED: 'true', TASK16_CLOUD_WRITES_ENABLED: 'true',
    TASK20_ANDROID_APP_ENABLED: 'true', TASK21_NOTIFICATION_READS_ENABLED: 'true', TASK21_NOTIFICATION_WRITES_ENABLED: 'true',
    TASK25_FEATURE_FLAGS_ENABLED: 'true', WORKERS_AI_ENABLED: 'false', D1_RATE_LIMIT_ENABLED: 'true',
    CLOUD_RATE_LIMIT_REQUESTS: '120', CLOUD_RATE_LIMIT_WINDOW_SECONDS: '60',
    ANDROID_LATEST_VERSION_CODE: '50', ANDROID_LATEST_VERSION_NAME: '1.3.37', ANDROID_MINIMUM_VERSION_CODE: '50',
  };
  const binding = { binding: 'WYJ_DB', database_name: r.database_name, database_id: r.database_id };
  return {
    name: r.project_name, pages_build_output_dir: '.', compatibility_date: '2026-08-06',
    send_metrics: false, vars, d1_databases: [binding], env: { preview: { vars: { ...vars }, d1_databases: [{ ...binding }] } },
  };
}

export async function sourceFiles(root) {
  const scriptPath = path.join(root, 'scripts/stage_pages_deploy.mjs');
  await assertNoReparse(scriptPath);
  const allowlistText = await fs.readFile(scriptPath, 'utf8');
  const allowlist = readAllowlist(allowlistText), files = new Map();
  async function walk(relative) {
    safeAssetName(relative);
    const absolute = path.join(root, relative);
    await assertNoReparse(absolute);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) await walk(`${relative}/${name}`);
    } else {
      assert(stat.isFile(), `Non-regular source rejected: ${relative}`);
      files.set(relative, await fs.readFile(absolute));
    }
  }
  for (const relative of [...allowlist.files, ...allowlist.directories]) await walk(relative);
  return { files, allowlistText };
}

async function walkOutput(output) {
  const files = new Map();
  async function walk(relative = '') {
    const absolute = path.join(output, relative);
    await assertNoReparse(absolute);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) await walk(relative ? `${relative}/${name}` : name);
    } else {
      assert(stat.isFile());
      files.set(slash(relative), await fs.readFile(absolute));
    }
  }
  await walk();
  return files;
}

function artifactTree(files) {
  const entries = [...files.entries()].filter(([name]) => name !== '__preview/build.json')
    .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) }));
  return { entries, sha256: sha256(JSON.stringify(entries)) };
}

function applyProductOverlay(files, sourceCommit, context) {
  const originalHtml = files.get('index.html').toString('utf8');
  assert(!originalHtml.includes('ownerPreviewBanner'));
  for (const selector of ['financeDisplayCurrency', 'financeAccountCurrency', 'financeDefaultCurrency']) assert(originalHtml.includes(`id="${selector}"`), `P04 selector absent: ${selector}`);
  const banner = `<aside class="owner-preview-banner" id="ownerPreviewBanner" role="status" data-preview-source="${sourceCommit}">` +
    `<strong>隔离 Preview · P04 多币种体验</strong><span>独立账本，不连接正式账目；这里使用独立 Preview 账户，不是正式账户认证。</span>` +
    `<small>源码 <code>${sourceCommit}</code> · 来源 <code>${context}</code> · <a href="/__preview/build.json">构建证据</a></small></aside>`;
  let html = originalHtml.replace('</head>', '    <link rel="stylesheet" href="/__preview/preview-ui.css" />\n  </head>');
  assert.notEqual(html, originalHtml, 'HTML head closing tag required');
  html = html.replace(/<body\b[^>]*>/, match => match + '\n    ' + banner);
  assert(html.includes(banner), 'HTML body tag required');
  const finalHtml = html.replace('</body>', '    <script type="module" src="/__preview/preview-ui.js"></script>\n  </body>');
  assert.notEqual(finalHtml, html, 'HTML body closing tag required');
  files.set('index.html', Buffer.from(finalHtml));
  files.set('_headers', Buffer.from(files.get('_headers').toString('utf8') + '\n/__preview/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n'));
}

async function settings(options) {
  const root = path.resolve(options.root || ROOT);
  const output = path.resolve(options.output || path.join(root, '.wrangler', OUTPUT_NAME));
  assert([OUTPUT_NAME, OUTPUT_NAME + '-r2'].some(name => normalized(output) === normalized(path.join(root, '.wrangler', name))), 'Output must be an exact reviewed owned Preview staging directory');
  await assertNoReparse(root);
  await assertNoReparse(output, true);
  const resourcesFile = path.resolve(options.resourcesPath || resourcePath(root));
  assert.equal(normalized(resourcesFile), normalized(resourcePath(root)), 'Resources must use this task\'s explicit ownership record');
  await assertNoReparse(resourcesFile);
  const resources = validateResources(JSON.parse(await fs.readFile(resourcesFile, 'utf8')));
  return { root, output, resources };
}

export async function prepare(options = {}) {
  const { root, output, resources } = await settings(options);
  try { await fs.lstat(output); assert.fail('Existing staging is preserved; validate it or select a new reviewed output contract'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceCommit = options.sourceCommit || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'Full source commit required');
  const context = options.context || DEFAULT_CONTEXT;
  assert(/^[a-z0-9][a-z0-9-]{0,95}$/.test(context), 'Context is a non-sensitive provenance tag, not arbitrary user data');
  const { files, allowlistText } = await sourceFiles(root);
  const baseProductFileCount = files.size;
  const baseProduct = Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)]));
  applyProductOverlay(files, sourceCommit, context);
  for (const name of ['preview-ui.js', 'preview-ui.css']) {
    const template = path.join(ROOT, 'qa/finance-p04/experience', name);
    await assertNoReparse(template);
    files.set(`__preview/${name}`, await fs.readFile(template));
  }
  files.set('wrangler.jsonc', Buffer.from(json(createConfiguration(resources))));
  const tree = artifactTree(files);
  const metadata = {
    schema_version: 1, environment: 'isolated-preview', source_commit: sourceCommit,
    product_reference_commit: PRODUCT_REFERENCE_COMMIT, context,
    project_name: resources.project_name, branch: resources.branch,
    authentication: 'Independent Preview account and secret; no Production identity federation',
    ledger_scope: 'Dedicated new Preview D1 only; no formal accounts, data, or sessions copied',
    financial_seed_included: false, database_contents: 'NOT VERIFIED BY STAGING; check the fresh D1 separately before owner login',
    feature_flags_source: 'Read actual /api/features after independent Preview login; no activation asserted by staging',
    base_product_file_count: baseProductFileCount, source_allowlist_script_sha256: sha256(allowlistText),
    base_product_files: baseProduct, stage_only_product_overlays: REPLACED_PRODUCT_FILES,
    artifact_tree_algorithm: 'SHA256(JSON.stringify(sorted [{path,bytes,sha256}])); paths sorted with localeCompare en; excludes only __preview/build.json and includes deployment config',
    artifact_tree_sha256: tree.sha256,
  };
  files.set('__preview/build.json', Buffer.from(json(metadata)));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await assertNoReparse(path.dirname(output));
  await fs.mkdir(output); // Exclusive: never erase the old .wrangler/pages-output or an earlier artifact.
  for (const [name, bytes] of files) {
    const target = path.join(output, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
  }
  const verified = await validate({ ...options, root, output });
  return { ...verified, output };
}

export async function validate(options = {}) {
  const { root, output, resources } = await settings(options);
  await assertNoReparse(output);
  const files = await walkOutput(output), metadata = JSON.parse(files.get('__preview/build.json')?.toString('utf8') || '{}');
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.environment, 'isolated-preview');
  assert(/^[a-f0-9]{40}$/.test(metadata.source_commit));
  assert.equal(metadata.product_reference_commit, PRODUCT_REFERENCE_COMMIT);
  assert.equal(metadata.project_name, resources.project_name);
  assert.equal(metadata.branch, resources.branch);
  assert.equal(metadata.financial_seed_included, false);
  assert(/^[a-z0-9][a-z0-9-]{0,95}$/.test(metadata.context));
  assert.deepEqual(JSON.parse(files.get('wrangler.jsonc').toString('utf8')), createConfiguration(resources), 'Exact safe config required; unknown bindings/secret vars are rejected');
  const source = await sourceFiles(root);
  assert.equal(metadata.source_allowlist_script_sha256, sha256(source.allowlistText));
  assert.equal(metadata.base_product_file_count, source.files.size);
  assert.deepEqual(metadata.base_product_files, Object.fromEntries([...source.files].map(([name, bytes]) => [name, sha256(bytes)])));
  assert.deepEqual([...files.keys()].sort(), [...source.files.keys(), ...OVERLAY_PATHS].sort(), 'Unallowlisted/seed/secret files rejected');
  for (const [name, bytes] of source.files) {
    if (!REPLACED_PRODUCT_FILES.includes(name)) assert.equal(sha256(files.get(name)), sha256(bytes), `Unexpected product modification: ${name}`);
  }
  const overlayExpected = new Map(source.files);
  applyProductOverlay(overlayExpected, metadata.source_commit, metadata.context);
  for (const name of REPLACED_PRODUCT_FILES) assert.equal(sha256(files.get(name)), sha256(overlayExpected.get(name)), `Unexpected Preview overlay: ${name}`);
  for (const name of ['preview-ui.js', 'preview-ui.css']) assert.equal(sha256(files.get(`__preview/${name}`)), sha256(await fs.readFile(path.join(ROOT, 'qa/finance-p04/experience', name))), `Unexpected Preview template: ${name}`);
  const html = files.get('index.html').toString('utf8');
  assert(html.includes(`data-preview-source="${metadata.source_commit}"`) && html.includes('独立账本，不连接正式账目') && html.includes('不是正式账户认证'));
  for (const selector of ['financeDisplayCurrency', 'financeAccountCurrency', 'financeDefaultCurrency']) assert(html.includes(`id="${selector}"`));
  assert.equal(metadata.artifact_tree_sha256, artifactTree(files).sha256, 'Staged artifact changed after sealing');
  return { status: 'PASS', source_commit: metadata.source_commit, artifact_tree_sha256: metadata.artifact_tree_sha256,
    base_product_files: source.files.size, staged_files: files.size, database_id: resources.database_id,
    financial_seed_included: false, database_blankness: 'NOT TESTED BY STAGING' };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [action = 'prepare', ...tokens] = process.argv.slice(2);
  assert(['prepare', 'validate'].includes(action), 'Use prepare or validate');
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = { '--resources': 'resourcesPath', '--output': 'output', '--context': 'context', '--source-commit': 'sourceCommit' }[tokens[index]];
    assert(key && tokens[index + 1], 'Unknown or missing CLI option');
    options[key] = tokens[index + 1];
  }
  console.log(JSON.stringify(await (action === 'prepare' ? prepare(options) : validate(options))));
}
