# P03–P06 safe convergence

Baseline: PR #118 `fcc499ef4b33cd13d212c19523d82cd7966e2684`.
The product delta is only three OCR candidate modules and four tests extracted
from P05 commit `2520d677ed1882f42092dd91d75fd589d958fe52`; they are also byte-identical
to final R2 `6c95d20dde951e12cf58f98d2d00ce2a51933daa`. No production service is wired
to them. No default ROI policy, identity authority, FX contract or AI activation
is added. Existing numbering normalization is not imported again.

Use a fresh independent checkout and new labels; original outputs are protected.
Node dependencies use the existing lockfile. Android uses the installed Studio
JDK / SDK and builds Debug only. No command here installs APKs or uses ADB.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
python qa/finance-safe-convergence/run.py protect --label protected-before-new
python qa/finance-safe-convergence/run.py android --label android-new
python qa/finance-safe-convergence/run.py p06 --label p06-new
python qa/finance-safe-convergence/run.py contracts --label contracts-new
python qa/finance-p04/prepare-baselines.py
python qa/finance-safe-convergence/run.py migration --label migration-new
python qa/finance-safe-convergence/run.py build --label build-new
```

The inherited P06 evaluator insists on its own ignored output namespace; the
wrapper honors it. All original assertions remain unchanged. The legacy roles
suite is intentionally separate and currently exits nonzero on two contradictory
refund/income fixtures. Do not relax role grounding to make it green.

```powershell
# Requires only the already-authorized local synthetic P06 history, no model key.
python qa/finance-safe-convergence/prepare-legacy.py
python qa/finance-safe-convergence/run.py legacy-ai --label legacy-new

# Requires the locally preserved P05 R2 Git object. Six allowlisted code/data
# blobs are extracted into this checkout's ignored folder; no private screenshot
# is copied and no new ML Kit/device invocation occurs.
python qa/finance-safe-convergence/p05-replay.py p05-replay-new
```

Run the P05 replay after the full Android command completes. It archives its own
JUnit separately; the full run's 893 cases and the replay's 11 cases must not be
added together as independent product coverage. The four imported OCR test
classes account for 37 methods already included in the full run.

`database-audit.mjs` uses actual local D1 and cold D1/SQLite restoration. It compares
the migration filenames with the immutable baseline rather than requiring an
invented contiguous sequence. The baseline contains 33 SQL files, ending at 0034
with no 0026. Do not add a placeholder or renumber old migrations to hide this.
Individual P04/P06 suites separately test additive upgrade, idempotent replay,
failed DDL rollback, old-client gates and consent preservation.

No remote D1/R2, provider calls, Production switches, signing, Stable release or
phone operation is part of these commands. `FINANCE_AI_ENABLED=true` in isolated
AI tests refers only to their explicit `@cf/synthetic/*` mock binding; uncached
provider quality is still `NOT_TESTED_QUOTA`.

The final Draft PR targets `codex/finance-p06-integration`, not main. A PR triggers
the existing Core CI; this lab never dispatches signed candidate or hosted release
workflows. Keep the exact-head CI record separate from this local result snapshot.
