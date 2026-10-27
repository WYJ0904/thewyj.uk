"""Restart only the owned, headless FinanceConvergence AVD; preserve userdata."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence/avd'
OUT=E/'restart-r1';OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe'
record=dict(started=datetime.now(timezone.utc).isoformat(),status='IN_PROGRESS',physical_phone_operations=False,userdata_cleared=False,operations=[])
try:
    # Use a single PowerShell with verified process identities, no broad kill.
    code="""$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('emulator.exe','qemu-system-x86_64-headless.exe') -and $_.CommandLine -match '@FinanceConvergence ' -and $_.CommandLine -match '-port 5576 ' -and $_.CommandLine -match '-no-window' }; $targets | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json; foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -ErrorAction SilentlyContinue }"""
    r=subprocess.run(['powershell','-NoProfile','-Command',code],capture_output=True,timeout=20)
    (OUT/'stopped-owned-processes.json').write_bytes(r.stdout);assert r.returncode==0
    record['operations'].append('Stopped exact FinanceConvergence launcher/QEMU processes after SDKCtl fatal assertion; no other emulator/ADB process killed')
    time.sleep(3)
    env=dict(os.environ,ANDROID_AVD_HOME=str(E/'home'),ANDROID_ADB_SERVER_PORT='5053',ADB_SERVER_PORT='5053',ANDROID_SERIAL='emulator-5576')
    cmd=[str(SDK/'emulator/emulator.exe'),'@FinanceConvergence','-port','5576','-no-window','-no-audio','-no-snapshot-load','-no-snapshot-save']
    with (OUT/'emulator.log').open('xb') as log:
        p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW)
    record.update(command=cmd,pid=p.pid)
    observations=[]
    for _ in range(18):
        try:
            r=subprocess.run([str(ADB),'-P','5053','-s','emulator-5576','shell','getprop','sys.boot_completed'],capture_output=True,timeout=6)
            observations.append(dict(code=r.returncode,boot=r.stdout.decode(errors='replace').strip()))
            if r.returncode==0 and r.stdout.strip()==b'1':break
        except subprocess.TimeoutExpired:observations.append(dict(status='timeout'))
        if p.poll() is not None:raise RuntimeError('Owned emulator exited: '+str(p.returncode))
        time.sleep(3)
    else:raise RuntimeError('Owned emulator did not boot within bounded checks; no phone fallback')
    record.update(status='PASS',observations=observations)
except Exception as error:record.update(status='FAIL',error=str(error));raise
finally:
    record['finished']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
