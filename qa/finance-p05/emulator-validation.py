"""Synthetic pixel + Activity tests on the owned loopback AVD, never a physical target."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,shutil,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');args=parser.parse_args()
assert re.fullmatch(r'r[0-9]+',args.attempt)
OUT=E/('emulator-validation-'+args.attempt);OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5581'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_SDK_ROOT=str(SDK),ANDROID_HOME=str(SDK),
    ANDROID_ADB_SERVER_PORT='5039',ADB_SERVER_SOCKET='tcp:127.0.0.1:5039',ADB_MDNS_AUTO_CONNECT='0')
for key in list(env):
    if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def source():
    names=subprocess.check_output(['git','ls-files','-z','android'],cwd=ROOT,text=True).split('\0')
    return {n:sha(ROOT/n) for n in names if n and (ROOT/n).is_file()}
before=source();row={'status':'IN_PROGRESS','started_utc':datetime.now(timezone.utc).isoformat(),'serial':SERIAL,'adb_port':5039,
    'real_phone_operations':False,'provider_proof':False,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'source_before':before,'commands':[],'instrumentation_cases':5}
def adb(*parts,timeout=30,binary=False):
    command=[str(ADB),'-P','5039','-s',SERIAL,*parts]
    p=subprocess.run(command,env=env,capture_output=True,timeout=timeout)
    row['commands'].append({'argv':command,'exit_code':p.returncode})
    assert p.returncode==0,(p.stdout+p.stderr).decode(errors='replace')
    return p.stdout if binary else p.stdout.decode(errors='replace').strip()
try:
    boot=json.loads((E/'emulator-runtime-r2/result.json').read_text());assert boot['status']=='PASS','AVD boot is not verified'
    assert adb('shell','getprop','ro.kernel.qemu')=='1','Only the owned emulator is allowed'
    assert adb('shell','getprop','ro.boot.qemu.avd_name') in {'FinanceP05Isolated',''},'Different AVD'
    assert adb('shell','getprop','ro.build.version.sdk')=='36'
    row['installed_before']=adb('shell','pm','list','packages','uk.thewyj.app')
    installed=set(row['installed_before'].splitlines())-set([''])
    assert installed<=set(['package:uk.thewyj.app.debug','package:uk.thewyj.app.debug.test']),'AVD contains an unrelated task app'
    assert args.attempt!='r1' or not installed,'First test requires a fresh AVD'
    command=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/finance-p05/emulator.init.gradle'),
        '-Dfinance.p05.emulator.source='+str(ROOT/'qa/finance-p05/emulator'),':app:assembleDebug',':app:assembleDebugAndroidTest',
        '--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
    with (OUT/'build.log').open('xb') as log:p=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    row['commands'].append({'argv':command,'exit_code':p.returncode});assert p.returncode==0,'Build failed; preserve log'
    apks=[ROOT/'android/app/build/outputs/apk/debug/app-debug.apk',ROOT/'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']
    aapt=SDK/'build-tools/36.0.0/aapt2.exe';assert aapt.is_file()
    row['artifacts']=[]
    for apk,expected in zip(apks,['uk.thewyj.app.debug','uk.thewyj.app.debug.test']):
        assert apk.is_file();copy=OUT/apk.name;shutil.copy2(apk,copy)
        metadata=subprocess.check_output([str(aapt),'dump','badging',str(copy)],text=True)
        assert "package: name='"+expected+"'" in metadata,'Unapproved APK identity'
        (OUT/(apk.name+'.badging.txt')).write_text(metadata)
        row['artifacts'].append({'path':str(copy.relative_to(ROOT)),'bytes':copy.stat().st_size,'sha256':sha(copy),'package':expected})
        adb('install','-r','-t',str(copy),timeout=120)
    started=time.monotonic()
    command=[str(ADB),'-P','5039','-s',SERIAL,'shell','am','instrument','-w','-r','-e','class',
        'uk.thewyj.app.task21.payment.P05EmulatorTest','-e','p05Run',args.attempt,'uk.thewyj.app.debug.test/androidx.test.runner.AndroidJUnitRunner']
    with (OUT/'instrumentation.log').open('xb') as log:
        try:
            p=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
            row['commands'].append({'argv':command,'exit_code':p.returncode})
        except subprocess.TimeoutExpired:
            row['watchdog']='240 seconds instrumentation deadline exceeded'
            pid=adb('shell','pidof','uk.thewyj.app.debug')
            if pid and pid.isdigit():
                # SIGQUIT requests this isolated test process' diagnostic stack, not termination.
                adb('shell','kill','-3',pid)
                (OUT/'qa-logcat.txt').write_text(adb('logcat','-d','--pid='+pid,timeout=30))
            raise
    row['duration_ms']=round((time.monotonic()-started)*1000)
    text=(OUT/'instrumentation.log').read_text(errors='replace')
    row['junit_ok']='OK (5 tests)' in text and 'FAILURES!!!' not in text and 'INSTRUMENTATION_FAILED' not in text
    native=adb('exec-out','run-as','uk.thewyj.app.debug','cat','files/p05-'+args.attempt+'-emulator.ndjson')
    (OUT/'native.ndjson').write_text(native+'\n')
    row['cases']=[json.loads(line) for line in native.splitlines() if line.strip()]
    for key in ['cold-cent','split-cent','jpy','roles']:
        image=adb('exec-out','run-as','uk.thewyj.app.debug','cat','files/p05-'+args.attempt+'-'+key+'.png',binary=True)
        (OUT/(key+'.png')).write_bytes(image)
    row['status']='PASS' if row['junit_ok'] and len(row['cases'])==5 and all(r['status']=='PASS' for r in row['cases']) else 'FAIL'
except Exception as error:
    row.update(status='FAIL' if row.get('artifacts') else 'BLOCKED',error=str(error))
finally:
    row.update(source_after=source(),finished_utc=datetime.now(timezone.utc).isoformat())
    row['source_stable']=row['source_before']==row['source_after']
    if not row['source_stable']:row['status']='FAIL'
    (OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps({k:v for k,v in row.items() if k not in ['source_before','source_after','commands','cases']}))
