"""Remove only this run's two apps on the verified owned AVD, then stop its private ADB server."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',type=int,default=1);args=parser.parse_args();assert args.attempt in [1,2]
OUT=E/('emulator-cleanup.json' if args.attempt==1 else 'emulator-cleanup-r2.json');assert not OUT.exists()
boot=json.loads((E/'emulator-runtime-r2/result.json').read_text());assert boot['status']=='PASS'
test=json.loads((E/'emulator-validation-r2/result.json').read_text());assert test['status']=='PASS'
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5581'
env=dict(os.environ,ANDROID_ADB_SERVER_PORT='5039',ADB_SERVER_SOCKET='tcp:127.0.0.1:5039',ADB_MDNS_AUTO_CONNECT='0')
row={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','real_phone_operations':False,'commands':[],
    'kept_avd_for_reproduction':boot['avd_home'],'kept_logs_and_apks':True,'owner_preview_kept':True}
def adb(*parts):
    assert parts==('kill-server',) or parts[:2]==('-s',SERIAL) or parts==('-s','emulator-5580','emu','kill')
    command=[str(ADB),'-P','5039',*parts]
    p=subprocess.run(command,env=env,capture_output=True,text=True,timeout=30)
    row['commands'].append({'argv':command,'exit_code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()})
    assert p.returncode==0,p.stderr
    return p.stdout.strip()
try:
    assert adb('-s',SERIAL,'shell','getprop','ro.kernel.qemu')=='1'
    installed=set(adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app').splitlines())
    assert installed<=set(['package:uk.thewyj.app.debug','package:uk.thewyj.app.debug.test'])
    for package in ['uk.thewyj.app.debug.test','uk.thewyj.app.debug']:
        if 'package:'+package in installed:assert adb('-s',SERIAL,'uninstall',package)=='Success'
    assert not adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app')
    # The adb emu command needs the emulator-console transport to derive its
    # port; a manually connected TCP alias cannot represent that console.
    adb('-s','emulator-5580','emu','kill')
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        with socket.socket() as stream:
            if stream.connect_ex(('127.0.0.1',5581))!=0:break
        time.sleep(.5)
    else:raise TimeoutError('Owned AVD port remains open')
    adb('kill-server')
    with socket.socket() as stream:assert stream.connect_ex(('127.0.0.1',5039))!=0
    row['status']='PASS'
except Exception as error:row.update(status='FAIL',error=str(error))
finally:
    row['finished_utc']=datetime.now(timezone.utc).isoformat();OUT.write_text(json.dumps(row,indent=2));print(json.dumps(row))
