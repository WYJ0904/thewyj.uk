"""Run actual SDK vectors and two Android processes on the private owned AVD only."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,io,json,os,re,shutil,subprocess,tarfile,time
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');args=parser.parse_args();assert re.fullmatch(r'r[0-9]+',args.attempt)
OUT=E/('emulator-'+args.attempt);OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5585'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(SDK),ANDROID_SDK_ROOT=str(SDK),
    ANDROID_ADB_SERVER_PORT='5041',ADB_SERVER_SOCKET='tcp:127.0.0.1:5041',ADB_MDNS_AUTO_CONNECT='0')
for key in list(env):
    if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
    names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).split('\0')
    return {name:sha(ROOT/name) for name in sorted(set(names)) if name and (ROOT/name).is_file() and
        (name.startswith('android/') or name.startswith('qa/finance-p05/closeout/emulator'))}
row={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','source_before':sources(),
    'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'commands':[],
    'real_phone_operations':False,'production_or_preview_mutations':False,'provider_proof':False,'adb_port':5041,'serial':SERIAL}
def adb(*parts,timeout=30):
    cmd=[str(ADB),'-P','5041','-s',SERIAL,*parts];p=subprocess.run(cmd,env=env,capture_output=True,timeout=timeout)
    row['commands'].append({'argv':cmd,'exit_code':p.returncode});assert p.returncode==0,(p.stdout+p.stderr).decode(errors='replace')
    return p.stdout
def guard():
    assert json.loads((E/'avd/result.json').read_text())['status']=='PASS'
    assert adb('shell','getprop','ro.kernel.qemu').decode().strip()=='1'
    assert adb('shell','getprop','ro.build.version.sdk').decode().strip()=='36'
def instrument(name,klass,limit):
    guard();cmd=[str(ADB),'-P','5041','-s',SERIAL,'shell','am','instrument','-w','-r','-e','class',klass,
        '-e','closeoutAttempt',args.attempt,'uk.thewyj.app.debug.test/androidx.test.runner.AndroidJUnitRunner']
    with (OUT/(name+'.log')).open('xb') as log:
        try:p=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=limit)
        except subprocess.TimeoutExpired:
            pid=adb('shell','pidof','uk.thewyj.app.debug').decode().strip()
            if pid.isdigit():
                adb('shell','kill','-3',pid)
                (OUT/(name+'-qa-logcat.txt')).write_bytes(adb('logcat','-d','--pid='+pid))
            raise
    row['commands'].append({'argv':cmd,'exit_code':p.returncode});return (OUT/(name+'.log')).read_text(errors='replace')
try:
    guard();installed=adb('shell','pm','list','packages','uk.thewyj.app').decode().splitlines()
    assert set(installed)<=set(['package:uk.thewyj.app.debug','package:uk.thewyj.app.debug.test'])
    assert args.attempt!='r1' or not installed
    cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/finance-p05/closeout/emulator.init.gradle'),
        '-Dfinance.closeout.emulator.source='+str(ROOT/'qa/finance-p05/closeout/emulator'),':app:assembleDebug',':app:assembleDebugAndroidTest',
        '--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
    with (OUT/'build.log').open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    row['commands'].append({'argv':cmd,'exit_code':p.returncode});assert p.returncode==0,'Build failed; no install'
    row['artifacts']=[]
    for relative,package in [('debug/app-debug.apk','uk.thewyj.app.debug'),('androidTest/debug/app-debug-androidTest.apk','uk.thewyj.app.debug.test')]:
        source=ROOT/'android/app/build/outputs/apk'/relative;copy=OUT/source.name;shutil.copy2(source,copy)
        badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(copy)],text=True)
        assert "package: name='"+package+"'" in badging
        row['artifacts'].append({'path':str(copy.relative_to(ROOT)),'sha256':sha(copy),'bytes':copy.stat().st_size,'package':package})
        guard();adb('install','-r','-t',str(copy),timeout=120)
    main=instrument('instrumentation','uk.thewyj.app.task21.payment.CloseoutEmulatorTest',240)
    row['main_junit_ok']='OK (5 tests)' in main and 'FAILURES!!!' not in main
    guard();adb('shell','am','force-stop','uk.thewyj.app.debug')
    restore=instrument('restore-instrumentation','uk.thewyj.app.task21.payment.CloseoutBudgetRestoreTest',60)
    row['restore_junit_ok']='OK (1 test)' in restore and 'FAILURES!!!' not in restore
    row['status']='PASS' if row['main_junit_ok'] and row['restore_junit_ok'] else 'FAIL'
except Exception as error:row.update(status='FAIL' if row.get('artifacts') else 'BLOCKED',error=str(error))
finally:
    try:
        guard();data=adb('exec-out','run-as','uk.thewyj.app.debug','tar','-cf','-','-C','files/closeout-'+args.attempt,'.')
        (OUT/'owned-artifacts.tar').write_bytes(data);dest=OUT/'native';dest.mkdir()
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for item in archive.getmembers():
                name=item.name.removeprefix('./');assert not item.issym() and not item.islnk()
                if not name or item.isdir():continue
                target_path=(dest/name).resolve();assert target_path.is_relative_to(dest.resolve()) and '/' not in name
                with archive.extractfile(item) as stream:target_path.write_bytes(stream.read())
        row['native_rows']=[json.loads(line) for line in (dest/'results.ndjson').read_text().splitlines() if line]
        pixels=[r for r in row['native_rows'] if r.get('kind')=='SDK_PIXEL'];row['pixel_counts']={s:sum(r['status']==s for r in pixels) for s in ['PASS','FAIL']}
        if len(pixels)!=33 or any(r['status']!='PASS' for r in row['native_rows']):row['status']='FAIL'
    except Exception as error:row['artifact_error']=str(error);row['status']='FAIL'
    row['source_after']=sources();row['source_stable']=row['source_before']==row['source_after']
    if not row['source_stable']:row['status']='FAIL'
    row['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(row,indent=2))
    print(json.dumps({k:v for k,v in row.items() if k not in ['source_before','source_after','commands','native_rows']}))
