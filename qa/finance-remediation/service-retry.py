"""Fix only access to a protected lifecycle hook in the new QA test host."""
from pathlib import Path
import json,os,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation'
deadline=time.monotonic()+1200
while True:
    manifest=E/'tail/commands.json'
    if manifest.exists() and len(json.loads(manifest.read_text()))==3:break
    if time.monotonic()>deadline:raise TimeoutError('Preserve the current Gradle owner; retry not started')
    time.sleep(1)
source=E/'tail/service-r2-source';(source/'kotlin').mkdir(parents=True,exist_ok=False)
for origin,target in [(ROOT/'qa/finance-p02/test.init.gradle',source/'test.init.gradle'),(ROOT/'qa/finance-remediation/kotlin/ServiceResourceContractTest.kt',source/'kotlin/ServiceResourceContractTest.kt')]:target.write_bytes(origin.read_bytes())
env=dict(os.environ,**json.loads((E/'preparation/environment.json').read_text()),FINANCE_P04_OUTPUT=str(E/'tail/service-r2-command'))
cmd=[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(E/'tail/service-r2'),'--tests','*ServiceResourceContractTest']
with (E/'tail/service-r2.log').open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
(E/'tail/service-r2-retry.json').write_text(json.dumps(dict(command=cmd,exit_code=p.returncode,initial='service-command: compilation failed, zero JUnit cases',
    change='Invoke the protected onServiceConnected lifecycle hook via Robolectric ReflectionHelpers. All three assertions/event counts/gateway behavior retained.',product_changes=False),indent=2))
print('Service resource regression retry exit =',p.returncode)
raise SystemExit(p.returncode)
