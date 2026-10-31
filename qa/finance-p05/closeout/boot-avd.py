"""One new AVD and private ADB server. Never enumerate or select physical devices."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
OUT=E/'avd';OUT.mkdir(exist_ok=False);HOME=OUT/'home';HOME.mkdir()
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5585'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(SDK),ANDROID_SDK_ROOT=str(SDK),
    ANDROID_AVD_HOME=str(HOME),ANDROID_ADB_SERVER_PORT='5041',ADB_SERVER_SOCKET='tcp:127.0.0.1:5041',ADB_MDNS_AUTO_CONNECT='0')
row={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','real_phone_operations':False,
     'server_port':5041,'console_port':5584,'serial':SERIAL,'avd_home':str(HOME),'avd_name':'FinanceCloseoutIsolated','commands':[]}
def adb(*parts):
    assert parts==('connect',SERIAL) or parts[:2]==('-s',SERIAL)
    cmd=[str(ADB),'-P','5041',*parts];p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=10)
    assert p.returncode==0,p.stderr;return p.stdout.strip()
try:
    assert (SDK/'system-images/android-36/google_apis/x86_64/package.xml').is_file()
    for port in [5041,5584,5585]:
        with socket.socket() as stream:assert stream.connect_ex(('127.0.0.1',port))!=0,'Foreign process uses reserved port'
    cmd=['cmd.exe','/d','/c',str(SDK/'cmdline-tools/latest/bin/avdmanager.bat'),'create','avd','--name','FinanceCloseoutIsolated',
         '--package','system-images;android-36;google_apis;x86_64','--device','pixel_7','--path',str(HOME/'FinanceCloseoutIsolated.avd')]
    with (OUT/'create.log').open('xb') as log:p=subprocess.run(cmd,input=b'no\n',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
    row['commands'].append({'argv':cmd,'exit_code':p.returncode});assert p.returncode==0
    cmd=[str(ADB),'-P','5041','--one-device','CLOSEOUT_NO_USB','start-server']
    p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=30);assert p.returncode==0,p.stderr
    row['commands'].append({'argv':cmd,'exit_code':p.returncode})
    cmd=[str(SDK/'emulator/emulator.exe'),'@FinanceCloseoutIsolated','-port','5584','-no-window','-no-audio','-no-snapshot-load','-no-snapshot-save']
    with (OUT/'emulator.log').open('xb') as log:p=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    row['commands'].append({'argv':cmd,'pid':p.pid});row['emulator_pid']=p.pid
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        assert p.poll() is None,'Owned emulator exited'
        try:
            adb('connect',SERIAL)
            if adb('-s',SERIAL,'shell','getprop','sys.boot_completed')=='1':break
        except (AssertionError,subprocess.TimeoutExpired):pass
        time.sleep(2)
    else:raise TimeoutError('Owned AVD boot watchdog expired')
    assert adb('-s',SERIAL,'shell','getprop','ro.kernel.qemu')=='1'
    row.update(status='PASS',sdk=adb('-s',SERIAL,'shell','getprop','ro.build.version.sdk'),model=adb('-s',SERIAL,'shell','getprop','ro.product.model'))
except Exception as error:row.update(status='BLOCKED',error=str(error))
finally:
    row['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
