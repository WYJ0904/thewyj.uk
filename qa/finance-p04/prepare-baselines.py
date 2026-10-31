"""Recreate only read-only QA modules from verified local Git objects; never reset."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

ROOT=Path(__file__).resolve().parents[2]
BASE=Path(os.environ.get('FINANCE_P04_BASELINE_ROOT', ROOT/'docs/migration-evidence/finance-p04/local/baseline-modules')).resolve()
assert BASE.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
P03='dd5fc98b3ac636830a3517e2eae11fad14031b07'
P02='98ffe1d97e9cbbedbcb4faa609ed8a5db9046a67'
rows=[]
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def preserve(commit,rel,dest):
    assert (rel.startswith('functions/_lib/') or rel=='js/finance/money.js') and '..' not in Path(rel).parts
    raw=git('show',commit+':'+rel)
    if dest.exists():
        if dest.read_bytes()!=raw:raise SystemExit('Preserve conflicting baseline: '+str(dest))
    else:
        dest.parent.mkdir(parents=True,exist_ok=True)
        with dest.open('xb') as stream:stream.write(raw)
    rows.append(dict(commit=commit,path=rel,destination=str(dest),sha256=hashlib.sha256(raw).hexdigest()))
for rel in git('ls-tree','-r','--name-only',P03,'--','functions/_lib/').decode().splitlines():
    preserve(P03,rel,BASE/'p03-server-baseline'/rel)
for rel in git('ls-tree','-r','--name-only','3b710e3','--','functions/_lib/').decode().splitlines():
    preserve('3b710e3',rel,BASE/'p04-pre-review-baseline'/rel)
preserve('3b710e3','js/finance/money.js',BASE/'p04-pre-review-baseline/js/finance/money.js')
for rel in ['functions/_lib/task16-model.mjs','functions/_lib/notification-cash-evidence.mjs']:
    preserve(P02,rel,BASE/'legacy-profile/.codex/worktrees/finance-p02-tests/thewyj.uk'/rel)
out=Path(os.environ.get('FINANCE_P04_OUTPUT',ROOT/'docs/migration-evidence/finance-p04/cloud/baselines'))
out.mkdir(parents=True,exist_ok=True)
with (out/'baselines.json').open('x') as stream:json.dump(rows,stream,indent=2);stream.write('\n')
print('Verified read-only local Git baseline modules:',len(rows))
