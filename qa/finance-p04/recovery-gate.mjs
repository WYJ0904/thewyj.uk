// Single-command, offline P04 recovery acceptance gate. No remote configuration is loaded.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verifyEvidence, gateVerdict, exitCodeFor } from './recovery-support.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const evidence = path.join(root, 'docs/migration-evidence/finance-p04');
const scripts = [
  ['p04-recovery-controls', process.execPath, ['--test', 'qa/finance-p04/recovery-support.test.mjs']],
  ['task16-d1', process.execPath, ['local-backend/test_task16_d1_js.mjs']],
  ['task16-migrator', 'python', ['-m', 'unittest', 'scripts.test_migrate_dailypayguard_finance', '-v']],
  ['task17-d1', process.execPath, ['local-backend/test_task17_d1_js.mjs']],
  ['p04-migrations', process.execPath, ['qa/finance-p04/migrations.mjs'], 'migrations.json', 12],
  ['p04-review-migrations', process.execPath, ['qa/finance-p04/review-migrations.mjs'], 'review-migrations.json', 8],
  ['p04-fx-history', process.execPath, ['qa/finance-p04/fx.mjs']],
  ['p04-recovery-safety', process.execPath, ['qa/finance-p04/recovery-safety.mjs'], 'recovery.json', 15],
];
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const report = { status: 'BLOCKED', synthetic_only: true, production_restore: 'NOT_TESTED', suites: [],
  execution_code_sha: null, source_manifest_sha256: null, dataset_sha256: null, checklist_sha256: null,
  differences: null, counts: null, idempotency: null, cross_account_protection: null };
let runDir, createdRun = false;
async function save(name, value) { await writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function run(id, command, args) {
  const started = performance.now();
  const output = path.join(runDir, id);
  await mkdir(output);
  const env = { ...process.env, FINANCE_P04_OUTPUT: output, FINANCE_P04_BASELINE_ROOT: path.join(runDir, 'baselines'),
    WRANGLER_SEND_METRICS: 'false', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
  let log = '', timedOut = false, startupError;
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = chunk => { const text = chunk.toString(); log += text; process.stdout.write(text); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
  const code = await new Promise(resolve => {
    child.on('error', error => { startupError = error.message; });
    child.on('close', resolve);
  });
  clearTimeout(timer);
  const logPath = path.join(output, 'execution.log');
  await writeFile(logPath, log, { flag: 'wx' });
  const result = { id, status: code === 0 && !timedOut && !startupError ? 'PASS' : 'FAIL',
    command: [command === process.execPath ? 'node' : command, ...args], exit_code: code,
    timed_out: timedOut, startup_error: startupError, duration_ms: Math.round(performance.now() - started),
    log: path.relative(runDir, logPath).replaceAll('\\', '/'), log_sha256: hash(log) };
  return result;
}
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--run-id' || !/^[a-z][a-z0-9-]{0,39}$/.test(args[1]))) throw Error('Usage: npm run test:p04-recovery -- [--run-id short-name]');
  report.execution_code_sha = git(['rev-parse', 'HEAD']);
  report.worktree_status = git(['status', '--porcelain']);
  report.clean_worktree = !report.worktree_status;
  runDir = path.join(evidence, args[1] || `rg-${Date.now().toString(36)}-${process.pid}`);
  await mkdir(evidence, { recursive: true });
  await mkdir(runDir, { recursive: false }); // Earlier PASS/FAIL evidence is never overwritten.
  createdRun = true;
  const datasetBytes = await readFile(path.join(root, 'qa/finance-p04/fixtures/recovery-safety.json'));
  const dataset = JSON.parse(datasetBytes);
  report.dataset_sha256 = hash(datasetBytes);
  report.checklist_sha256 = hash(dataset.checks);
  report.checklist = dataset.checks;
  const sourcePaths = ['package.json', 'package-lock.json', 'functions/_lib', 'js/finance/money.js', 'cloudflare/migrations',
    'local-backend/test_task16_d1_js.mjs', 'local-backend/test_task17_d1_js.mjs',
    'scripts/migrate_dailypayguard_finance.py', 'scripts/test_migrate_dailypayguard_finance.py',
    'qa/finance-p03/phase-a/d1-snapshot.mjs', 'qa/finance-p04/fixture.mjs', 'qa/finance-p04/output.mjs',
    'qa/finance-p04/prepare-baselines.py', 'qa/finance-p04/migrations.mjs', 'qa/finance-p04/review-migrations.mjs',
    'qa/finance-p04/fx.mjs', 'qa/finance-p04/recovery-gate.mjs', 'qa/finance-p04/recovery-safety.mjs',
    'qa/finance-p04/recovery-support.mjs', 'qa/finance-p04/recovery-support.test.mjs', 'qa/finance-p04/fixtures/recovery-safety.json'];
  const tracked = git(['ls-files', '-z', '--', ...sourcePaths]).split('\0').filter(Boolean);
  const sources = [...new Set([...tracked, ...sourcePaths.filter(p => !['functions/_lib', 'cloudflare/migrations'].includes(p))])].sort();
  const manifest = [];
  for (const name of sources) manifest.push({ path: name, sha256: hash(await readFile(path.join(root, name))) });
  report.source_manifest_sha256 = hash(manifest);
  await save('source-manifest.json', manifest);
  // Infrastructure prerequisites are BLOCKED, never an empty green test run.
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node >=24 with node:sqlite is required');
  createRequire(import.meta.url).resolve('miniflare');
  execFileSync('python', ['--version'], { cwd: root, windowsHide: true });
  for (const commit of ['dd5fc98b3ac636830a3517e2eae11fad14031b07', '3b710e3', '98ffe1d97e9cbbedbcb4faa609ed8a5db9046a67']) git(['cat-file', '-e', `${commit}^{commit}`]);
  report.status = 'FAIL';
  report.suites.push(await run('prepare-baselines', 'python', ['qa/finance-p04/prepare-baselines.py']));
  for (const [id, command, argv, resultFile, minimumChecks] of scripts) {
    const result = await run(id, command, argv);
    if (resultFile) {
      try {
        const detail = JSON.parse(await readFile(path.join(runDir, id, resultFile), 'utf8'));
        verifyEvidence(detail, minimumChecks, id === 'p04-recovery-safety' ? dataset.checks : undefined);
        result.checks = detail.rows.length;
        result.evidence = `${id}/${resultFile}`;
        if (id === 'p04-recovery-safety') {
          if (detail.dataset_sha256 !== report.dataset_sha256 || detail.checklist_sha256 !== report.checklist_sha256) throw Error('dataset/checklist changed during execution');
          report.differences = detail.differences;
          report.counts = detail.rows.find(r => r.id === 'restore-all-tables-IDs-revisions-receipts-and-relations')?.actual;
          report.idempotency = detail.rows.filter(r => /retry-remain|survive-replay/.test(r.id));
          report.cross_account_protection = detail.rows.filter(r => r.id.startsWith('cross-account-'));
        }
      } catch (error) { result.status = 'FAIL'; result.evidence_error = error.message; }
    }
    report.suites.push(result);
  }
  // Fail closed if executable inputs changed during the run.
  for (const item of manifest) if (hash(await readFile(path.join(root, item.path))) !== item.sha256) throw Error(`Source changed during execution: ${item.path}`);
  if (git(['rev-parse', 'HEAD']) !== report.execution_code_sha) throw Error('Git HEAD changed during execution');
  report.status = gateVerdict(report.suites, ['prepare-baselines', ...scripts.map(([id]) => id)]);
} catch (error) {
  report.error = { code: error.code, message: error.message, stack: error.stack };
} finally {
  if (createdRun) {
    try { await save('result.json', report); }
    catch (error) { report.status = 'BLOCKED'; report.output_error = error.message; }
  }
  console.log(JSON.stringify({ status: report.status, execution_code_sha: report.execution_code_sha, clean_worktree: report.clean_worktree,
    dataset_sha256: report.dataset_sha256, checklist_sha256: report.checklist_sha256,
    suites: report.suites.map(s => ({ id: s.id, status: s.status, checks: s.checks, error: s.evidence_error || s.startup_error })),
    result: createdRun ? path.relative(root, path.join(runDir, 'result.json')).replaceAll('\\', '/') : null,
    preserved_existing_directory: runDir && !createdRun ? path.relative(root, runDir).replaceAll('\\', '/') : undefined,
    error: report.error || report.output_error }, null, 2));
  process.exitCode = exitCodeFor(report.status);
}
