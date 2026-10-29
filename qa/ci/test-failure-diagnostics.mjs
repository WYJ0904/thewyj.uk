import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FAILURE_DIAGNOSTIC_BUDGET_MS, preserveFailureAfterDiagnostics } from './failure-diagnostics.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aeris-ci-diagnostic-'));
const saved = path.join(directory, 'failure.json');
const original = new Error('Original recipient initialization deadline');
const rethrowsOriginal = error => error === original;
try {
  assert.equal(FAILURE_DIAGNOSTIC_BUDGET_MS, 3000);
  await assert.rejects(preserveFailureAfterDiagnostics(original, async signal => {
    signal.throwIfAborted(); await fs.writeFile(saved, JSON.stringify({ originalFailurePreserved: true }), { flag: 'wx' });
  }), rethrowsOriginal);
  assert.deepEqual(JSON.parse(await fs.readFile(saved, 'utf8')), { originalFailurePreserved: true });

  const errors = [], start = performance.now(); let signal;
  await assert.rejects(preserveFailureAfterDiagnostics(original, value => {
    signal = value; return new Promise(() => {}); // CDP never replies.
  }, { budgetMs: 25, onDiagnosticError: error => errors.push(error.name) }), rethrowsOriginal);
  const elapsed = performance.now() - start;
  assert(elapsed >= 20 && elapsed < 1000, `Stalled diagnostic returned after ${elapsed}ms`);
  assert.deepEqual(errors, ['DiagnosticBudgetExceeded']); assert(signal.aborted);

  let release, lateWrites = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await assert.rejects(preserveFailureAfterDiagnostics(original, async value => {
    await pending; value.throwIfAborted(); lateWrites++;
  }, { budgetMs: 25 }), rethrowsOriginal);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateWrites, 0, 'A reply arriving after the budget cannot save a late diagnostic');

  await assert.rejects(preserveFailureAfterDiagnostics(original, () => { throw new Error('Diagnostic failed'); }, {
    onDiagnosticError: () => { throw new Error('Reporter failed'); },
  }), rethrowsOriginal);
  console.log('Failure diagnostic regression passed: normal evidence saved; stalled/late/error paths preserve the original failure within the independent budget.');
} finally {
  await fs.unlink(saved).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(directory);
}
