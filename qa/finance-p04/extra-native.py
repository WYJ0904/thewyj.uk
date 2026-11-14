"""Run independent QA driver repairs and a cold two-JVM backup restore serially."""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE=Path(os.environ['FINANCE_P04_EXTRA_BASE']).resolve()
assert BASE.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
manifest=BASE/'extra-native-commands.json';assert not manifest.exists()
rows=[];seed_ok=False
for name,root,output,test in [
    ('declared-native',ROOT/'docs/migration-evidence/finance-p04/local/contract-input-drivers/native',None,'*FinanceP02MatrixTest.D_parserCurrencyTarget'),
    ('backup-seed',ROOT/'docs/migration-evidence/finance-p04/local/backup-proof-source',BASE/'native-backup','*CurrencyP04BackupSeedTest'),
    ('backup-restore',ROOT/'docs/migration-evidence/finance-p04/local/backup-proof-source',BASE/'native-backup','*CurrencyP04BackupRestoreTest'),
]:
    if name=='backup-restore' and not seed_ok:
        rows.append(dict(name=name,status='NOT_TESTED',reason='Seed did not pass; preserve it and repair before restore'));continue
    env=dict(os.environ,FINANCE_P04_OUTPUT=str(BASE/name))
    command=[sys.executable,str(ROOT/'qa/finance-p04/android.py'),'--qa-root',str(root),'--tests',test]
    if output:command+=['--qa-output',str(output)]
    result=subprocess.run(command,cwd=ROOT,env=env)
    rows.append(dict(name=name,command=command,exit_code=result.returncode,status='PASS' if result.returncode==0 else 'FAIL'))
    manifest.write_text(json.dumps(rows,indent=2)+'\n')
    if name=='backup-seed':seed_ok=result.returncode==0
manifest.write_text(json.dumps(rows,indent=2)+'\n')
raise SystemExit(int(any(row['status']!='PASS' for row in rows)))
