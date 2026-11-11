"""Build the owned current-source QA package, never a release/install task."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import argparse

ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser()
parser.add_argument('--attempt',choices=['r1','r2','r3'],default='r1')
parser.add_argument('--device-name',default='device-final')
parser.add_argument('--without-lint',action='store_true')
parser.add_argument('--only-test',action='store_true')
parser.add_argument('--fresh-tasks',action='store_true')
args=parser.parse_args()
assert __import__('re').fullmatch('[a-z0-9-]+',args.device_name)
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'/args.device_name
log=OUT/('build-'+args.attempt+'.log')
assert not log.exists()
env=dict(os.environ)
env['JAVA_HOME']='C:/Program Files/Android/Android Studio/jbr'
env['ANDROID_HOME']=str(Path.home()/'AppData/Local/Android/Sdk')
for key in list(env):
    if any(part in key.upper() for part in ('SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS')): env.pop(key)
command=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(OUT/'qa/qa.init.gradle'),
         '-Dfinance.device.source='+str(OUT/'qa'),'-Dfinance.device.output='+str(OUT),
         '-PTHEWYJ_BASE_URL=https://localhost:19443',':app:assembleDebug',':app:assembleDebugAndroidTest',':app:lintDebug',
         '--no-daemon','--console=plain','--max-workers=2','--stacktrace']
if args.without_lint:command.remove(':app:lintDebug')
if args.only_test:command.remove(':app:assembleDebug')
if args.fresh_tasks:command+=['--rerun-tasks','--no-build-cache']
def sources():
    names=[p for directory in ('qa','build-sources') for p in (OUT/directory).rglob('*') if p.is_file()]
    return {p.relative_to(OUT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(names)}
before=sources();start=datetime.now(timezone.utc).isoformat()
with log.open('xb') as output:result=subprocess.run(command,cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT)
after=sources();artifacts=[]
for path in (OUT/'build/app/outputs/apk').rglob('*.apk'):
    artifacts.append({'path':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
record={'command':command,'started_utc':start,'finished_utc':datetime.now(timezone.utc).isoformat(),
        'exit_code':result.returncode,'source_before':before,'source_after':after,'source_stable':before==after,
        'artifacts':artifacts,'release_signing':False,'formal_application_id':'unchanged','install':'NOT PERFORMED by build'}
(OUT/('build-'+args.attempt+'.json')).write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps({k:record[k] for k in ('exit_code','source_stable','artifacts')}))
if result.returncode:print('\n'.join(log.read_text(encoding='utf8',errors='replace').splitlines()[-22:]))
raise SystemExit(result.returncode or int(before!=after or len(artifacts)!=(1 if args.only_test else 2)))
