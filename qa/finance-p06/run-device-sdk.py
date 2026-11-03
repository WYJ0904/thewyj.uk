"""Real Samsung, isolated new package; unchanged P05 SDK inputs and assertions."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,io,json,os,re,shutil,subprocess,sys,tarfile
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='p03-p05-r1');parser.add_argument('--attempt',default='r1');parser.add_argument('--owned-update',action='store_true');parser.add_argument('--probe-only',action='store_true');parser.add_argument('--lifecycle-only',action='store_true');args=parser.parse_args();assert re.fullmatch(r'[a-z0-9-]+',args.label) and re.fullmatch(r'r[0-9]+',args.attempt);assert not(args.probe_only and args.lifecycle_only)
assert not args.lifecycle_only,'Rapid physical UI matrix is disabled by the owner comfort instruction; use an emulator for stress loops'
PIXELS=E/'device/slow-sdk-source';assert (PIXELS/'CloseoutEmulatorTest.kt').is_file(),'Prepare owner-requested UI pacing first'
OUT=E/'device'/args.label;OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='R5CY22MEHJN'
PACKAGE='uk.thewyj.app.qa.financep06';TEST=PACKAGE+'.test'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(SDK),ANDROID_SDK_ROOT=str(SDK))
for key in list(env):
    if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
    names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).split('\0')
    result={n:sha(ROOT/n) for n in sorted(set(names)) if n and (ROOT/n).is_file() and (n.startswith('android/') or n.startswith('qa/finance-p06/device') or n.startswith('qa/finance-p05/closeout/emulator'))}
    result.update({str(p.relative_to(ROOT)):sha(p) for p in PIXELS.rglob('*') if p.is_file()})
    return result
row=dict(started_utc=datetime.now(timezone.utc).isoformat(),status='IN_PROGRESS',head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    source_before=sources(),serial=SERIAL,package=PACKAGE,commands=[],physical_device=True,synthetic_pixels=True,real_wechat_proof=False,formal_data_or_permissions_modified=False)
def checkpoint():
    (OUT/'progress.json').write_text(json.dumps(row,indent=2))
checkpoint()
def adb(*parts,timeout=30):
    command=[str(ADB),'-s',SERIAL,*parts];p=subprocess.run(command,env=env,capture_output=True,timeout=timeout)
    row['commands'].append(dict(argv=command,exit_code=p.returncode));checkpoint();assert p.returncode==0,(p.stdout+p.stderr).decode(errors='replace');return p.stdout
def guard():
    assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
    assert adb('shell','getprop','ro.build.version.sdk').decode().strip()=='36'
    assert adb('shell','getprop','ro.kernel.qemu').decode().strip()!='1'
def instrument(name,klass,timeout):
    guard();command=[str(ADB),'-s',SERIAL,'shell','am','instrument','-w','-r','-e','class',klass,'-e','closeoutAttempt',args.attempt,TEST+'/uk.thewyj.app.qa.financep06.FinanceP06Runner']
    with (OUT/(name+'.log')).open('xb') as log:
        try:p=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
        except subprocess.TimeoutExpired:
            pid=adb('shell','pidof',PACKAGE).decode().strip()
            if pid.isdigit():
                # Read/sample only this task's package. Never terminate formal App.
                subprocess.run([str(ADB),'-s',SERIAL,'shell','run-as',PACKAGE,'kill','-3',pid],capture_output=True,timeout=15)
                (OUT/(name+'-qa-logcat.txt')).write_bytes(adb('logcat','-d','--pid='+pid))
            adb('shell','am','force-stop',PACKAGE);raise
    row['commands'].append(dict(argv=command,exit_code=p.returncode));return (OUT/(name+'.log')).read_text(errors='replace')
try:
    guard();before=adb('shell','pm','list','packages',PACKAGE).decode().strip()
    if before:
        assert args.owned_update,'Existing package must be explicitly verified as this task owned'
        paths=adb('shell','pm','path',PACKAGE).decode().strip().splitlines();assert len(paths)==1 and paths[0].startswith('package:/data/app/')
        private=OUT/'private';private.mkdir();previous=private/'owned-previous-base.apk';adb('pull',paths[0].removeprefix('package:'),str(previous),timeout=60)
        known={a['sha256'] for pattern in ['*/result.json','*/progress.json','*/interruption.json'] for p in (E/'device').glob(pattern) for a in json.loads(p.read_text()).get('artifacts',[]) if a['package']==PACKAGE}
        assert sha(previous) in known,'Installed QA byte identity differs from this task evidence'
        row['previous_owned_apk_sha256']=sha(previous)
    row['formal_version_before']=adb('shell','dumpsys','package','uk.thewyj.app').decode(errors='replace')
    command=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/finance-p06/device.init.gradle'),
        '-Dfinance.p06.root='+str(ROOT/'qa/finance-p06'),'-Dfinance.p06.pixel.root='+str(PIXELS),':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
    with (OUT/'build.log').open('xb') as log:p=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    row['commands'].append(dict(argv=command,exit_code=p.returncode));assert p.returncode==0,'Build failed; no install'
    row['artifacts']=[]
    for relative,package in [('debug/app-debug.apk',PACKAGE),('androidTest/debug/app-debug-androidTest.apk',TEST)]:
        source=ROOT/'android/app/build/outputs/apk'/relative;dest=OUT/source.name;shutil.copy2(source,dest)
        badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(dest)],text=True)
        assert "package: name='"+package+"'" in badging
        row['artifacts'].append(dict(path=str(dest.relative_to(ROOT)),package=package,bytes=dest.stat().st_size,sha256=sha(dest)))
        checkpoint()
        guard();result=adb('install','-r','-t',str(dest),timeout=120).decode();assert 'Success' in result
    klass='uk.thewyj.app.qa.financep06.FinanceP06LifecycleTest' if args.lifecycle_only else 'uk.thewyj.app.task21.payment.FinanceP06SdkProbeTest' if args.probe_only else 'uk.thewyj.app.task21.payment.CloseoutEmulatorTest'
    main=instrument('instrumentation',klass,240)
    expected='OK (2 tests)' if args.lifecycle_only else 'OK (1 test)' if args.probe_only else 'OK (5 tests)'
    row['main_junit_ok']=expected in main and 'FAILURES!!!' not in main
    row['diagnostic_only']=args.probe_only
    row['lifecycle_only']=args.lifecycle_only
    if not(args.probe_only or args.lifecycle_only):
        guard();adb('shell','am','force-stop',PACKAGE)
        restore=instrument('restore-instrumentation','uk.thewyj.app.task21.payment.CloseoutBudgetRestoreTest',60)
        row['restore_junit_ok']='OK (1 test)' in restore and 'FAILURES!!!' not in restore
    else:row['restore_junit_ok']=True
    row['status']='PASS' if row['main_junit_ok'] and row['restore_junit_ok'] else 'FAIL'
except Exception as error:row.update(status='FAIL' if row.get('artifacts') else 'BLOCKED',error=str(error))
finally:
    try:
        guard();data=adb('exec-out','run-as',PACKAGE,'tar','-cf','-','-C','files/closeout-'+args.attempt,'.');(OUT/'owned-artifacts.tar').write_bytes(data)
        dest=OUT/'native';dest.mkdir()
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for item in archive.getmembers():
                name=item.name.removeprefix('./');assert not item.issym() and not item.islnk()
                if not name or item.isdir():continue
                assert '/' not in name and '\\' not in name
                target=(dest/name).resolve();assert target.is_relative_to(dest.resolve())
                with archive.extractfile(item) as stream:target.write_bytes(stream.read())
        name='sdk-probe.ndjson' if args.probe_only else 'results.ndjson'
        native=[json.loads(line) for line in (dest/name).read_text().splitlines() if line]
        row['native_rows']=native;pixels=[r for r in native if r.get('kind')=='SDK_PIXEL']
        row['pixel_counts']={s:sum(r['status']==s for r in pixels) for s in ['PASS','FAIL']}
        if not(args.probe_only or args.lifecycle_only) and (len(pixels)!=33 or any(r['status']!='PASS' for r in native)):row['status']='FAIL'
        if args.lifecycle_only and (len(native)!=60 or any(r['status']!='PASS' for r in native)):row['status']='FAIL'
    except Exception as error:row['artifact_error']=str(error)
    row['source_after']=sources();row['source_stable']=row['source_before']==row['source_after']
    if not row['source_stable']:row['status']='FAIL'
    # Full package dump stays private: only version/code/permissions metadata is needed publicly.
    formal=row.pop('formal_version_before',None)
    if formal:
        private=OUT/'private';private.mkdir(exist_ok=True);(private/'formal-package-before.txt').write_text(formal)
    row['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(row,indent=2))
    print(json.dumps({k:v for k,v in row.items() if k not in ['source_before','source_after','commands','native_rows']}))
sys.exit(0 if row['status']=='PASS' else 1)
