"""Single coordinated Gradle build, isolated application ID and offline target URL."""
from common import *
import argparse, shutil

parser=argparse.ArgumentParser();parser.add_argument('--label',default='sdk-build-r1');args=parser.parse_args()
assert args.label.startswith('sdk-build-r') and args.label[11:].isdigit()
OUT=E/args.label;OUT.mkdir(exist_ok=False)
cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),
     '-I',str(ROOT/'qa/aeris-finance-quality/sdk.init.gradle'),
     '-Daeris.finance.quality.root='+str(ROOT/'qa/aeris-finance-quality'),
     ':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2',
     '--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
source_names=['android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt',
    'android/app/build.gradle.kts','qa/aeris-finance-quality/sdk.init.gradle']
source_names += [path.relative_to(ROOT).as_posix() for path in (ROOT/'qa/aeris-finance-quality/sdk').rglob('*') if path.is_file()]
before={name:sha(ROOT/name) for name in source_names}
record=dict(started_utc=utc(),command=cmd,head=git('rev-parse','HEAD'),phone_operations=0,source_before=before)
lock=E/'gradle.lock'
with lock.open('x') as stream:json.dump(dict(pid=os.getpid(),base=str(OUT)),stream)
try:
    with (OUT/'build.log').open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=environment(),stdout=log,stderr=subprocess.STDOUT)
finally:
    if json.loads(lock.read_text())['pid']==os.getpid():lock.unlink()
after={name:sha(ROOT/name) for name in source_names}
record.update(source_after=after,source_stable=before==after)
record['exit_code']=p.returncode;record['artifacts']=[]
if p.returncode==0:
    for rel,package in [('debug/app-debug.apk',PKG),('androidTest/debug/app-debug-androidTest.apk',PKG+'.test')]:
        src=ROOT/'android/app/build/outputs/apk'/rel
        desc=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(src)],text=True,timeout=30)
        assert "package: name='"+package+"'" in desc
        dest=OUT/src.name;shutil.copy2(src,dest)
        record['artifacts'].append(dict(path=str(dest.relative_to(ROOT)),package=package,sha256=sha(dest),bytes=dest.stat().st_size))
record.update(status='PASS' if p.returncode==0 and before==after else 'FAIL',finished_utc=utc())
write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(p.returncode or int(before!=after))
