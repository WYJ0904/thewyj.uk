"""Archive the required current-source Android checks; no device or install."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ['FINANCE_P04_OUTPUT']).resolve()
assert OUT.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
OUT.mkdir(parents=True,exist_ok=False)
command=['bash','android/gradlew','-p','android',':app:testDebugUnitTest',':app:lintDebug',':app:assembleDebug',
         '--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
started=time.time()
with (OUT/'android.log').open('x') as stream:
    result=subprocess.run(command,cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT)
junit=OUT/'junit';junit.mkdir()
cases=[]
for source in (ROOT/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
    if source.stat().st_mtime<started:continue
    shutil.copy2(source,junit/source.name)
    for case in ET.parse(source).getroot().iter('testcase'):
        cases.append(dict(classname=case.get('classname'),name=case.get('name'),status='FAIL' if case.find('failure') is not None or case.find('error') is not None else 'SKIP' if case.find('skipped') is not None else 'PASS'))
artifacts=[]
for source in [ROOT/'android/app/build/reports/lint-results-debug.xml',ROOT/'android/app/build/outputs/apk/debug/app-debug.apk',ROOT/'android/app/build/outputs/apk/debug/output-metadata.json']:
    if not source.exists():continue
    dest=OUT/source.name;shutil.copy2(source,dest)
    artifacts.append(dict(path=str(dest.relative_to(ROOT)),bytes=dest.stat().st_size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),source_mtime_utc=datetime.fromtimestamp(source.stat().st_mtime,timezone.utc).isoformat()))
record=dict(command=command,started_utc=datetime.fromtimestamp(started,timezone.utc).isoformat(),finished_utc=datetime.now(timezone.utc).isoformat(),exit_code=result.returncode,cases=cases,artifacts=artifacts,scope='Synthetic local JVM/Robolectric, lint and Debug build only; no ADB, emulator, install, release signing or deployment')
(OUT/'command.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'exit_code':result.returncode,'current_cases':len(cases),'failed':sum(c['status']!='PASS' for c in cases)}),flush=True)
raise SystemExit(result.returncode or int(not cases or any(c['status']!='PASS' for c in cases)))
