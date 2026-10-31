import assert from 'node:assert/strict';

export const FAILURE_DIAGNOSTIC_BUDGET_MS = 3000;

// This budget applies only after a test has already failed. A stalled CDP
// evaluation/screenshot must not hide that original failure until job timeout.
export async function preserveFailureAfterDiagnostics(originalError, collect, {
  budgetMs = FAILURE_DIAGNOSTIC_BUDGET_MS, onDiagnosticError = () => {},
} = {}) {
  assert(Number.isInteger(budgetMs) && budgetMs > 0 && budgetMs <= FAILURE_DIAGNOSTIC_BUDGET_MS);
  const controller = new AbortController();
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => collect(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Failure diagnostic budget exhausted');
          error.name = 'DiagnosticBudgetExceeded';
          controller.abort(error); reject(error);
        }, budgetMs);
      }),
    ]);
  } catch (diagnosticError) {
    // Even a diagnostic reporter failure must not replace the test assertion.
    try { onDiagnosticError(diagnosticError); } catch {}
  } finally {
    clearTimeout(timer);
  }
  throw originalError;
}
