"""Serial Gradle tail after the full runner releases its lock; emulator only."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation'
OUT=E/'tail';OUT.mkdir(exist_ok=False)
env=dict(os.environ,**json.loads((E/'preparation/environment.json').read_text()))
rows=[]
def run(name,command,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    with (OUT/(name+'.log')).open('xb') as log:p=subprocess.run(command,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    row=dict(name=name,command=command,exit_code=p.returncode,started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat())
    rows.append(row);(OUT/'commands.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)
    return p.returncode
deadline=time.monotonic()+3600
while (E/'gradle.lock').exists():
    if time.monotonic()>deadline:raise TimeoutError('Previous Gradle owner did not release its lock; do not compete')
    time.sleep(1)
source=OUT/'service-source';(source/'kotlin').mkdir(parents=True)
for origin,target in [(ROOT/'qa/finance-p02/test.init.gradle',source/'test.init.gradle'),(ROOT/'qa/finance-remediation/kotlin/ServiceResourceContractTest.kt',source/'kotlin/ServiceResourceContractTest.kt')]:target.write_bytes(origin.read_bytes())
run('service-resources',[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(OUT/'service-resources'),'--tests','*ServiceResourceContractTest'],{'FINANCE_P04_OUTPUT':str(OUT/'service-command')})
drivers=ROOT/'docs/migration-evidence/finance-p06/remediation/drivers'
run('emulator-original',[sys.executable,str(drivers/'joint.py'),'--emulator','--attempt','r1'])
run('emulator-numeric-control',[sys.executable,str(drivers/'joint.py'),'--emulator','--attempt','r2','--numeric-reference'])
print('Serial tail complete; every original/control outcome remains separate.',flush=True)
