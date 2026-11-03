"""One missing ignored v3 module prerequisite; repeat the original migration oracle."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation'
OUT=E/'final-r1/regression-baseline-retry';OUT.mkdir(exist_ok=False)
env=dict(os.environ,**json.loads((E/'preparation/environment.json').read_text()))
env.update(FINANCE_P03_OUTPUT=str(OUT/'closeout-d1'),FINANCE_P04_OUTPUT=str(OUT/'closeout-d1'))
cmd=[env['FINANCE_NODE'],'qa/finance-p03/final/clearing-migration.mjs']
started=datetime.now(timezone.utc).isoformat()
with (OUT/'closeout-d1.log').open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
(OUT/'command.json').write_text(json.dumps(dict(command=cmd,exit_code=p.returncode,started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat(),
    classification='QA_PREREQUISITE_MISSING_BEFORE_ANY_TEST',initial_log='final-r1/regression/closeout-d1.log',
    corrected_precondition='Exact committed v3 modules reconstructed in this new worktree; no migration oracle or fixture changed.',
    historical_failed_execution_retained=True),indent=2))
print('Original closeout D1 migration retry exit =',p.returncode)
raise SystemExit(p.returncode)
