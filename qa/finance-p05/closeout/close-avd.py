"""Only this task's private AVD and two debug packages; no physical target or default ADB server."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout';OUT=E/'avd-cleanup.json';assert not OUT.exists()
boot=json.loads((E/'avd/result.json').read_text());assert boot['status']=='PASS' and boot['server_port']==5041
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5585'
env=dict(os.environ,ANDROID_AVD_HOME=boot['avd_home'],ANDROID_ADB_SERVER_PORT='5041',ADB_SERVER_SOCKET='tcp:127.0.0.1:5041',ADB_MDNS_AUTO_CONNECT='0')
row={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','real_phone_operations':False,'commands':[],
    'retained_avd':boot['avd_home'],'retained_evidence':True}
def adb(*parts):
    assert parts[:2]==('-s',SERIAL) or parts in [('-s','emulator-5584','emu','kill'),('-s','emulator-5584','emu','avd','name'),('kill-server',),('connect',SERIAL),('--one-device','CLOSEOUT_NO_USB','start-server')]
    cmd=[str(ADB),'-P','5041',*parts];p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=30)
    row['commands'].append({'argv':cmd,'exit_code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()});assert p.returncode==0,p.stderr;return p.stdout.strip()
try:
    def listening(port):
        with socket.socket() as stream:return stream.connect_ex(('127.0.0.1',port))==0
    if not listening(5585):
        # The host interrupted the earlier processes. Reopen only the same
        # isolated disk to uninstall its packages normally, never wipe an AVD.
        assert all(not listening(port) for port in [5041,5584,5585]),'Reserved port has an unverified owner'
        home=Path(boot['avd_home']).resolve();assert home.is_relative_to(E.resolve())
        assert (home/'FinanceCloseoutIsolated.ini').is_file()
        adb('--one-device','CLOSEOUT_NO_USB','start-server')
        command=[str(SDK/'emulator/emulator.exe'),'@FinanceCloseoutIsolated','-port','5584','-no-window','-no-audio','-no-snapshot-load','-no-snapshot-save']
        with (E/'avd/cleanup-reopen.log').open('xb') as log:
            process=subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        row.update(reopened_owned_avd_for_uninstall=True,reopened_pid=process.pid)
        deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            assert process.poll() is None,'Owned cleanup AVD exited'
            try:
                adb('connect',SERIAL)
                if adb('-s',SERIAL,'shell','getprop','sys.boot_completed')=='1':break
            except (AssertionError,subprocess.TimeoutExpired):pass
            time.sleep(2)
        else:raise TimeoutError('Owned cleanup AVD boot watchdog expired')
    assert adb('-s','emulator-5584','emu','avd','name').splitlines()[0]=='FinanceCloseoutIsolated'
    assert adb('-s',SERIAL,'shell','getprop','ro.kernel.qemu')=='1'
    packages=set(adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app').splitlines())
    assert packages<=set(['package:uk.thewyj.app.debug','package:uk.thewyj.app.debug.test'])
    for package in ['uk.thewyj.app.debug.test','uk.thewyj.app.debug']:
        if 'package:'+package in packages:assert adb('-s',SERIAL,'uninstall',package)=='Success'
    assert not adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app')
    adb('-s','emulator-5584','emu','kill');deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        with socket.socket() as stream:
            if stream.connect_ex(('127.0.0.1',5585))!=0:break
        time.sleep(.3)
    else:raise TimeoutError('Owned AVD remains open')
    adb('kill-server');row['status']='PASS'
except Exception as error:row.update(status='FAIL',error=str(error))
finally:
    row['finished_utc']=datetime.now(timezone.utc).isoformat();OUT.write_text(json.dumps(row,indent=2));print(json.dumps(row))
