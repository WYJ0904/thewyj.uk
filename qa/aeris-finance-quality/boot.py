"""Create a fresh private API36 AVD; preserve every previous crash and AVD."""
from common import *
import socket, time

OUT=E/'avd-r1'
OUT.mkdir(exist_ok=False)
home=OUT/'home'; home.mkdir()
user=OUT/'user'; user.mkdir()
env=dict(environment(),ANDROID_AVD_HOME=str(home),ANDROID_USER_HOME=str(user))
name='AerisFinanceQuality'
record=dict(status='IN_PROGRESS',started_utc=utc(),adb_port=int(PORT),console_port=5586,
    serial=SERIAL,avd_home=str(home),avd_name=name,phone_operations=0,commands=[])
write(OUT/'result.json',record)
try:
    for port in [int(PORT),5586,5587]:
        with socket.socket() as sock:
            assert sock.connect_ex(('127.0.0.1',port))!=0, 'Reserved port already occupied'
    cmd=['cmd.exe','/d','/c',str(SDK/'cmdline-tools/latest/bin/avdmanager.bat'),
         'create','avd','--name',name,'--package','system-images;android-36;google_apis;x86_64',
         '--device','pixel_7','--path',str(home/(name+'.avd'))]
    with (OUT/'create.log').open('xb') as log:
        p=subprocess.run(cmd,input=b'no\n',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
    record['commands'].append(dict(argv=cmd,exit_code=p.returncode));assert p.returncode==0
    cmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'--one-device','AERIS_FINANCE_QUALITY_NO_USB','start-server']
    p=subprocess.run(cmd,env=env,capture_output=True,timeout=30)
    (OUT/'adb-start.log').write_bytes(p.stdout+p.stderr)
    record['commands'].append(dict(argv=cmd,exit_code=p.returncode));assert p.returncode==0
    # Explicit software graphics and a cold boot avoid importing the crashed VM state.
    cmd=[str(SDK/'emulator/emulator.exe'),'@'+name,'-port','5586','-no-window','-no-audio',
         '-gpu','swiftshader','-no-snapshot-load','-no-snapshot-save','-no-boot-anim']
    with (OUT/'emulator.log').open('xb') as log:
        p=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    record['commands'].append(dict(argv=cmd,pid=p.pid));record['emulator_pid']=p.pid
    write(OUT/'result.json',record)
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        assert p.poll() is None, 'Owned emulator exited: '+str(p.returncode)
        try:
            subprocess.run([str(SDK/'platform-tools/adb.exe'),'-P',PORT,'connect',SERIAL],env=env,capture_output=True,timeout=8)
            if adb('shell','getprop','sys.boot_completed',timeout=6).strip()==b'1':break
        except (RuntimeError,subprocess.TimeoutExpired):pass
        time.sleep(2)
    else:raise TimeoutError('Private API36 boot watchdog expired')
    emulator_guard()
    record.update(status='PASS',sdk=36,model=adb('shell','getprop','ro.product.model').decode().strip())
except Exception as error:
    record.update(status='BLOCKED',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record)
    print(json.dumps(record))
raise SystemExit(0 if record['status']=='PASS' else 1)
