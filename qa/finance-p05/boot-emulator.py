"""Dedicated AVD, ADB port and loopback serial; never select or query a physical device."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,shutil,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='emulator-runtime-r2');args=parser.parse_args()
assert args.label.startswith('emulator-runtime-') and all(c.isalnum() or c=='-' for c in args.label)
OUT=E/args.label;OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe'
prep=json.loads((E/'emulator-preparation/result.json').read_text());assert prep['status']=='PASS' and prep['system_image_present']
HOME=ROOT/'docs/migration-evidence'/('p05-isolated-avd-'+args.label);assert not HOME.exists();HOME.mkdir()
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_SDK_ROOT=str(SDK),ANDROID_HOME=str(SDK),
         ANDROID_AVD_HOME=str(HOME),ANDROID_ADB_SERVER_PORT='5039',ADB_SERVER_SOCKET='tcp:127.0.0.1:5039',ADB_MDNS_AUTO_CONNECT='0')
record={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','avd_home':str(HOME),'real_phone_operations':False,
        'adb_server_port':5039,'serial':'127.0.0.1:5581','usb_filter':'P05_NO_USB_DEVICE','mdns_autoconnect':False}
def adb(*parts,timeout=30):
    allowed=parts[0] in {'connect','start-server','kill-server'} or parts[:2]==('-s','127.0.0.1:5581')
    assert allowed,'Only dedicated loopback emulator operations are permitted'
    p=subprocess.run([str(ADB),'-P','5039',*parts],env=env,capture_output=True,text=True,timeout=timeout)
    assert p.returncode==0,p.stderr;return p.stdout.strip()
try:
    # avdmanager locates its SDK from the containing installation, unlike the
    # sdkmanager invocation's explicit --sdk_root. Preserve the failed attempt;
    # install the already verified tools in their documented SDK layout.
    installed=SDK/'cmdline-tools/latest'
    if not installed.exists():
        shutil.copytree(Path(prep['avdmanager']).parent.parent,installed)
    avdmanager=installed/'bin/avdmanager.bat';assert avdmanager.is_file()
    record['avdmanager']=str(avdmanager)
    for port in [5039,5580,5581]:
        with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0,'Port belongs to another process'
    with (OUT/'avd-create.log').open('xb') as log:
        create=subprocess.run(['cmd.exe','/d','/c',str(avdmanager),'create','avd','--name','FinanceP05Isolated','--package','system-images;android-36;google_apis;x86_64',
                               '--device','pixel_7','--path',str(HOME/'FinanceP05Isolated.avd')],input=b'no\n',stdout=log,stderr=subprocess.STDOUT,env=env,timeout=60)
    assert create.returncode==0,'AVD creation failed; preserve log'
    p=subprocess.run([str(ADB),'-P','5039','--one-device','P05_NO_USB_DEVICE','start-server'],env=env,capture_output=True,text=True,timeout=30)
    assert p.returncode==0,p.stderr
    with (OUT/'emulator.log').open('xb') as log:
        process=subprocess.Popen([str(SDK/'emulator/emulator.exe'),'@FinanceP05Isolated','-port','5580','-no-window','-no-audio','-no-snapshot-load','-no-snapshot-save'],
            env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    record['emulator_pid']=process.pid
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        assert process.poll() is None,'Emulator exited; no alternate device will be used'
        try:
            adb('connect','127.0.0.1:5581',timeout=10)
            boot=adb('-s','127.0.0.1:5581','shell','getprop','sys.boot_completed',timeout=10)
            if boot=='1':break
        except (AssertionError,subprocess.TimeoutExpired):pass
        time.sleep(2)
    else:raise TimeoutError('Owned emulator did not boot')
    qemu=adb('-s','127.0.0.1:5581','shell','getprop','ro.kernel.qemu');assert qemu=='1'
    record.update(status='PASS',verified_emulator=qemu,model=adb('-s','127.0.0.1:5581','shell','getprop','ro.product.model'),
                  sdk=adb('-s','127.0.0.1:5581','shell','getprop','ro.build.version.sdk'),commands_target_only_dedicated_emulator=True)
except Exception as error:record.update(status='BLOCKED',error=str(error))
finally:
    record['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
