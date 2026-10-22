"""Archive the required current-source Android checks; no device or install."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--tests', action='append', default=[])
args=parser.parse_args()
OUT=Path(os.environ['FINANCE_P04_OUTPUT']).resolve()
assert OUT.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
OUT.mkdir(parents=True,exist_ok=False)
launcher=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat')] if os.name=='nt' else ['bash',str(ROOT/'android/gradlew')]
command=launcher+['-p',str(ROOT/'android'),':app:testDebugUnitTest']
for pattern in args.tests: command+=['--tests',pattern]
if not args.tests: command+=[':app:lintDebug',':app:assembleDebug']
if not args.tests: command+=['--continue']
command+=['--rerun' if args.tests else '--rerun-tasks','--no-daemon','--max-workers=2','--console=plain','--stacktrace',
          '-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
environment=dict(os.environ)
for key in list(environment):
    if any(part in key.upper() for part in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):
        environment.pop(key)
started=time.time()
def source_manifest():
    names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
    files={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(set(names))
           if name and (name.startswith('android/') or name.startswith('qa/finance-p04/fixtures/')) and (ROOT/name).is_file()}
    return dict(files=files,sha256=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest())
before=source_manifest()
head_before=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
with (OUT/'android.log').open('xb') as stream:
    result=subprocess.run(command,cwd=ROOT,env=environment,stdout=stream,stderr=subprocess.STDOUT)
junit=OUT/'junit';junit.mkdir()
cases=[]
for source in (ROOT/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
    if source.stat().st_mtime<started:continue
    shutil.copy2(source,junit/source.name)
    for case in ET.parse(source).getroot().iter('testcase'):
        failure=case.find('failure')
        if failure is None: failure=case.find('error')
        cases.append(dict(classname=case.get('classname'),name=case.get('name'),status='FAIL' if failure is not None else 'SKIP' if case.find('skipped') is not None else 'PASS',failure='' if failure is None else ''.join(failure.itertext())))
artifacts=[]
for source in [ROOT/'android/app/build/reports/lint-results-debug.xml',ROOT/'android/app/build/outputs/apk/debug/app-debug.apk',ROOT/'android/app/build/outputs/apk/debug/output-metadata.json']:
    if not source.exists() or source.stat().st_mtime<started:continue
    dest=OUT/source.name;shutil.copy2(source,dest)
    artifacts.append(dict(path=str(dest.relative_to(ROOT)),bytes=dest.stat().st_size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),source_mtime_utc=datetime.fromtimestamp(source.stat().st_mtime,timezone.utc).isoformat()))
after=source_manifest()
record=dict(command=command,head_before=head_before,head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),diff_sha256=hashlib.sha256(subprocess.check_output(['git','diff','--binary'],cwd=ROOT)).hexdigest(),source_before=before,source_after=after,source_stable=before==after,started_utc=datetime.fromtimestamp(started,timezone.utc).isoformat(),finished_utc=datetime.now(timezone.utc).isoformat(),exit_code=result.returncode,cases=cases,artifacts=artifacts,scope='Synthetic local JVM/Robolectric, lint and Debug build only; no ADB, emulator, install, release signing or deployment')
(OUT/'command.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'exit_code':result.returncode,'current_cases':len(cases),'failed':sum(c['status']!='PASS' for c in cases)}),flush=True)
raise SystemExit(result.returncode or int(not cases or before!=after or any(c['status']!='PASS' for c in cases)))
