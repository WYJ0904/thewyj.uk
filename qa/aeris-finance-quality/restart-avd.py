"""Restart this task's new AVD with GLES software rendering; no old VM mutation."""
from common import *
import time

OUT=E/'avd-r2';OUT.mkdir(exist_ok=False)
previous=json.loads((E/'avd-r1/result.json').read_text())
assert previous['status']=='BLOCKED', 'Wait for the first bounded watchdog result'
env=dict(environment(),ANDROID_AVD_HOME=previous['avd_home'],ANDROID_USER_HOME=str(E/'avd-r1/user'))
query="""$owned = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('emulator.exe','qemu-system-x86_64-headless.exe') -and $_.CommandLine -match '@AerisFinanceQuality ' -and $_.CommandLine -match '-port 5586 ' -and $_.CommandLine -match '-no-window' }; $owned | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json; foreach ($process in $owned) { Stop-Process -Id $process.ProcessId -ErrorAction Stop }"""
p=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',query],capture_output=True,timeout=20)
(OUT/'stopped-owned-processes.json').write_bytes(p.stdout);assert p.returncode==0,p.stderr.decode(errors='replace')
record=dict(status='IN_PROGRESS',started_utc=utc(),previous_attempt_preserved=True,phone_operations=0,commands=[])
cmd=[str(SDK/'emulator/emulator.exe'),'@AerisFinanceQuality','-port','5586','-no-window','-no-audio',
     '-gpu','swiftshader_indirect','-feature','-Vulkan','-no-snapshot-load','-no-snapshot-save',
     '-no-boot-anim','-camera-back','none','-camera-front','none']
try:
    with (OUT/'emulator.log').open('xb') as log:
        p=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    record['commands'].append(dict(argv=cmd,pid=p.pid));record['emulator_pid']=p.pid
    write(OUT/'result.json',record)
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
        assert p.poll() is None,'Owned emulator exited '+str(p.returncode)
        try:
            subprocess.run([str(SDK/'platform-tools/adb.exe'),'-P',PORT,'connect',SERIAL],env=env,capture_output=True,timeout=8)
            if adb('shell','getprop','sys.boot_completed',timeout=6).strip()==b'1':break
        except (RuntimeError,subprocess.TimeoutExpired):pass
        time.sleep(2)
    else:raise TimeoutError('Private GLES API36 boot watchdog expired')
    emulator_guard();record.update(status='PASS',sdk=36,model=adb('shell','getprop','ro.product.model').decode().strip())
except Exception as error:record.update(status='BLOCKED',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(0 if record['status']=='PASS' else 1)
