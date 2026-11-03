"""Current real Hook/Room v2 controls, separate from original/frozen results."""
from common import *
import sys
OUT=E/'identity-contract-r1';OUT.mkdir(exist_ok=False)
source=E/'versioned-identity-source'
lock=E/'gradle.lock'
with lock.open('x') as stream:json.dump(dict(pid=os.getpid(),base=str(OUT)),stream)
cmd=[sys.executable,str(E/'drivers/android.py'),'--qa-root',str(source),'--qa-output',str(OUT/'native'),
     '--tests','*VersionedIdentityContractTest']
row=dict(command=cmd,started_utc=utc(),external_model_calls=0,phone_operations=0,source_sha256=sha(source/'kotlin/VersionedIdentityContractTest.kt'))
try:
    with (OUT/'run.log').open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=dict(environment(),FINANCE_P04_OUTPUT=str(OUT/'command')),stdout=log,stderr=subprocess.STDOUT)
    row.update(exit_code=p.returncode,finished_utc=utc());write(OUT/'result.json',row);print(json.dumps(row))
finally:
    if json.loads(lock.read_text())['pid']==os.getpid():lock.unlink()
raise SystemExit(p.returncode)
