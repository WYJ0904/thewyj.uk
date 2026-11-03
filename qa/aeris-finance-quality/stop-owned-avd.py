"""Graceful shutdown of only this task's VM/server. No file or AVD deletion."""
from common import *
import time
OUT=E/'owned-runtime-stop';OUT.mkdir(exist_ok=False)
record=dict(started_utc=utc(),status='IN_PROGRESS',phone_operations=0,default_adb_operations=0,files_deleted=0)
query="""Get-CimInstance Win32_Process | Where-Object { ($_.Name -in @('emulator.exe','qemu-system-x86_64-headless.exe') -and $_.CommandLine -match '@AerisFinanceQuality ' -and $_.CommandLine -match '-port 5586 ') -or ($_.Name -eq 'adb.exe' -and $_.CommandLine -match 'tcp:5057' -and $_.CommandLine -match 'AERIS_FINANCE_QUALITY_NO_USB') } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json"""
try:
    p=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',query],capture_output=True,timeout=20)
    assert p.returncode==0
    raw=p.stdout.decode('utf-8-sig',errors='replace');(OUT/'processes-before.json').write_text(raw,encoding='utf-8')
    rows=json.loads(raw);rows=[rows] if isinstance(rows,dict) else rows
    assert any(row['Name']=='adb.exe' for row in rows),'Do not stop a foreign/replaced private ADB server'
    assert any(row['Name']=='emulator.exe' for row in rows),'Do not guess the target VM'
    emulator_guard()
    record['emulator_console_reply']=adb('emu','kill',timeout=20).decode(errors='replace')
    cmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'kill-server']
    p=subprocess.run(cmd,env=environment(),capture_output=True,timeout=20)
    record['private_adb_command']=cmd;record['private_adb_exit_code']=p.returncode;assert p.returncode==0
    time.sleep(2)
    p=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',query],capture_output=True,timeout=20)
    (OUT/'processes-after.json').write_bytes(p.stdout)
    assert not p.stdout.strip(),'Owned process still running; preserve it without force-kill or deletion'
    record.update(status='PASS',avd_directories_preserved=True,old_avd_or_crash_mutations=0)
except Exception as error:record.update(status='PARTIAL',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record);print(json.dumps(record))
