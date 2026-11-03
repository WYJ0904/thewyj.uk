"""Uninstall only hash-proven QA APKs from the owned virtual device, then stop it."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/remediation'
OUT=E/'emulator-cleanup.json';assert not OUT.exists()
for name in ['artifact-recovery','database-recovery']:assert json.loads((E/name/'result.json').read_text())['status']=='PASS'
boot=json.loads((E/'avd/result.json').read_text());assert boot['status']=='PASS' and boot['server_port']==5051
home=Path(boot['avd_home']).resolve();assert home== (E/'avd/home').resolve() and home.is_relative_to(E.resolve())
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';PKG='uk.thewyj.app.qa.financep06';SERIAL='127.0.0.1:5597';steps=[]
def adb(*args):
    assert args==('kill-server',) or args[:2] in [('-s',SERIAL),('-s','emulator-5596')]
    cmd=[str(ADB),'-P','5051',*args];p=subprocess.run(cmd,capture_output=True,timeout=30);steps.append(dict(command=cmd,exit_code=p.returncode));assert p.returncode==0,p.stderr.decode(errors='replace')[:300];return p.stdout.decode().strip()
assert adb('-s',SERIAL,'shell','getprop','ro.kernel.qemu')=='1'
assert adb('-s','emulator-5596','emu','avd','name').splitlines()[0]=='FinanceRemediationIsolated'
assert set(adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app').splitlines())=={'package:'+PKG,'package:'+PKG+'.test'}
artifacts={r['package']:r['sha256'] for r in json.loads((E/'emulator-joint-r2/result.json').read_text())['artifacts']}
for package in [PKG+'.test',PKG]:
    installed=adb('-s',SERIAL,'shell','pm','path',package).removeprefix('package:');assert re.fullmatch(r'/data/app/[A-Za-z0-9_+=./~-]+/base[.]apk',installed)
    assert adb('-s',SERIAL,'shell','sha256sum',installed).split()[0]==artifacts[package]
    assert adb('-s',SERIAL,'uninstall',package)=='Success'
assert not adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app')
assert not adb('-s',SERIAL,'reverse','--list')
archive=E/'avd/configuration-archive';archive.mkdir(exist_ok=False)
for source in [home/'FinanceRemediationIsolated.ini',home/'FinanceRemediationIsolated.avd/config.ini']:
    assert source.resolve().is_relative_to(home);(archive/source.name).write_bytes(source.read_bytes())
adb('-s','emulator-5596','emu','kill');deadline=time.monotonic()+30
while time.monotonic()<deadline:
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',5597))!=0:break
    time.sleep(.2)
else:raise TimeoutError('Own virtual device did not exit')
adb('kill-server')
OUT.write_text(json.dumps(dict(status='PASS',utc=datetime.now(timezone.utc).isoformat(),steps=steps,removed_packages=[PKG+'.test',PKG],
    owned_avd_home=str(home),configuration_archived=True,private_adb_port=5051,default_adb_5037_touched=False,
    physical_phone_operations=False,reverse_ports_remaining=0,artifact_and_database_recovery_passed=True,avd_disk_removal='PENDING_NATIVE_POWERSHELL'),indent=2))
print('Removed two verified virtual-device QA packages; emulator and private ADB stopped. Disk target:',home)
