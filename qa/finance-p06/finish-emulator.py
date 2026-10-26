"""Only this task's private API36 AVD/server, never the physical ADB server."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,re,socket,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06';OUT=E/'emulator-cleanup.json';assert not OUT.exists()
boot=json.loads((E/'avd/result.json').read_text());test=json.loads((E/'emulator-joint-r2/result.json').read_text());assert boot['status']==test['status']=='PASS' and boot['server_port']==5043
home=Path(boot['avd_home']).resolve();assert home.is_relative_to((E/'avd').resolve()) and home.name=='home'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';SERIAL='127.0.0.1:5589';PKG='uk.thewyj.app.qa.financep06';steps=[]
def adb(*parts):
 cmd=[str(ADB),'-P','5043',*parts];p=subprocess.run(cmd,capture_output=True,text=True,timeout=30);steps.append({'argv':cmd,'exit_code':p.returncode});assert p.returncode==0,p.stderr;return p.stdout.strip()
assert adb('-s',SERIAL,'shell','getprop','ro.kernel.qemu')=='1'
assert adb('-s','emulator-5588','emu','avd','name').splitlines()[0]=='FinanceP06Isolated'
packages=set(adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app').splitlines());assert packages=={'package:'+PKG,'package:'+PKG+'.test'}
expected={a['package']:a['sha256'] for a in test['artifacts']}
for package in [PKG+'.test',PKG]:
 path=adb('-s',SERIAL,'shell','pm','path',package).removeprefix('package:');assert re.fullmatch(r'/data/app/[A-Za-z0-9_+=./~-]+/base[.]apk',path)
 assert adb('-s',SERIAL,'shell','sha256sum',path).split()[0]==expected[package]
 assert adb('-s',SERIAL,'uninstall',package)=='Success'
assert not adb('-s',SERIAL,'shell','pm','list','packages','uk.thewyj.app')
assert not adb('-s',SERIAL,'reverse','--list')
archive=E/'avd/archived-configuration';archive.mkdir(exist_ok=False)
for source in [home/'FinanceP06Isolated.ini',home/'FinanceP06Isolated.avd/config.ini']:
 assert source.resolve().is_relative_to(home);(archive/source.name).write_bytes(source.read_bytes())
adb('-s','emulator-5588','emu','kill');deadline=time.monotonic()+30
while time.monotonic()<deadline:
 with socket.socket() as stream:
  if stream.connect_ex(('127.0.0.1',5589))!=0:break
 time.sleep(.2)
else:raise TimeoutError('Owned emulator remains open')
adb('kill-server')
record={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','scope':'Own virtual-device packages,process and private ADB server only; Windows AVD files removed separately','owned_avd_home':str(home),'private_adb_port':5043,'default_adb_5037_touched':False,'physical_phone_operations':False,'removed_packages':[PKG+'.test',PKG],'avd_name':'FinanceP06Isolated','configuration_archived':True,'avd_disk_still_present_at_this_step':home.exists(),'steps':steps}
OUT.write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k!='steps'}))
