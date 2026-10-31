"""Seal this task's QA files, then remove only its hash-verified two packages."""
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone
import argparse,hashlib,io,json,re,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='R5CY22MEHJN';PKG='uk.thewyj.app.qa.financep06';PACKAGES=[PKG+'.test',PKG]
FORMAL='uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService'
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','remove']);parser.add_argument('--label',default='r1');parser.add_argument('--joint',default='joint-r7');parser.add_argument('--privacy-label',default='r1');args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.label) and re.fullmatch('joint-r[0-9]+',args.joint) and re.fullmatch('r[0-9]+',args.privacy_label)
OUT=E/('phone-cleanup' if args.label=='r1' else 'phone-cleanup-'+args.label)
commands=[]
def adb(*parts,timeout=60):
 argv=[str(ADB),'-s',SERIAL,*parts];p=subprocess.run(argv,capture_output=True,timeout=timeout);commands.append({'argv':argv,'exit_code':p.returncode});assert p.returncode==0,p.stderr.decode(errors='replace')[:500];return p.stdout
def shell(*parts):return adb('shell',*parts).decode(errors='replace').strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def package_set():return set(shell('pm','list','packages','uk.thewyj.app').splitlines())
def permissions():return {k:shell('settings','get','secure',k) for k in ['enabled_accessibility_services','enabled_notification_listeners']}
def apk_hash(package):
 paths=shell('pm','path',package).splitlines();assert len(paths)==1
 p=paths[0].removeprefix('package:');assert re.fullmatch(r'/data/app/[A-Za-z0-9_+=./~-]+/base[.]apk',p)
 return shell('sha256sum',p).split()[0]
def formal_state():
 text=shell('dumpsys','package','uk.thewyj.app');return {'version_name':re.search(r'versionName=(\S+)',text)[1],'version_code':re.search(r'versionCode=(\d+)',text)[1],'apk_sha256':apk_hash('uk.thewyj.app')}
assert shell('getprop','ro.product.model')=='SM-S9360' and shell('am','get-current-user')=='0'
expected={a['package']:a['sha256'] for a in json.loads((E/args.joint/'result.json').read_text())['artifacts']}
baseline=json.loads((E/'device/baseline/result.json').read_text());formal_apk=json.loads((E/'device/formal-apk/result.json').read_text())
formal=formal_state();assert formal=={'version_name':'1.3.37','version_code':'50','apk_sha256':formal_apk['apk_sha256']}
assert json.loads((E/'device/privacy-lease/restore.json').read_text())['original_list_exact']
if args.action=='prepare':
 OUT.mkdir(exist_ok=False);private=OUT/'private';private.mkdir()
 before=package_set();assert all('package:'+p in before for p in PACKAGES)
 for p in PACKAGES:assert apk_hash(p)==expected[p],p
 perms=permissions();assert FORMAL in perms['enabled_accessibility_services'] and 'uk.thewyj.app/' not in perms['enabled_notification_listeners']
 (private/'finance-packages-before.json').write_text(json.dumps(sorted(before)));(private/'permissions-before.json').write_text(json.dumps(perms))
 available=set(shell('run-as',PKG,'ls').split());dirs=[name for name in ['files','databases','shared_prefs'] if name in available];assert 'files' in dirs
 data=adb('exec-out','run-as',PKG,'tar','-cf','-',*dirs)
 members=[]
 with tarfile.open(fileobj=io.BytesIO(data)) as archive:
  for item in archive.getmembers():
   p=PurePosixPath(item.name);assert not p.is_absolute() and '..' not in p.parts and p.parts[0] in dirs and not item.issym() and not item.islnk()
   if item.isfile():members.append({'path':item.name,'bytes':item.size})
 assert any('assistance.sqlite' in r['path'] for r in members)
 cold=private/'cold-owned.tar';cold.write_bytes(data)
 row={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','owned_packages':PACKAGES,'apk_hashes':expected,'formal_before':formal,'cold_archive_sha256':sha(cold),'cold_archive_bytes':len(data),'cold_members':members,'formal_storage_read':False,'formal_storage_write':False,'sensitive_permissions_granted_by_this_task':False,'commands':commands}
 (OUT/'prepare.json').write_text(json.dumps(row,indent=2));print(json.dumps({k:v for k,v in row.items() if k not in ['commands','cold_members']}))
else:
 prepare=json.loads((OUT/'prepare.json').read_text());assert prepare['status']=='PASS';assert prepare['formal_before']==formal
 seal=json.loads((E/('privacy-seal-'+args.privacy_label)/'manifest.json').read_text());assert seal['status']=='PASS'
 assert any(r['source']==str((OUT/'private/cold-owned.tar').relative_to(ROOT).as_posix()) and r['source_sha256']==prepare['cold_archive_sha256'] for r in seal['files'])
 before=set(json.loads((OUT/'private/finance-packages-before.json').read_text()));assert package_set()==before
 for p in PACKAGES:assert apk_hash(p)==expected[p]
 adb('shell','am','force-stop',PKG)
 for p in PACKAGES:assert adb('uninstall',p).decode().strip()=='Success',p
 after=package_set();assert before-after=={'package:'+p for p in PACKAGES} and not after-before
 after_formal=formal_state();assert after_formal==formal
 perms=permissions();assert all(p not in json.dumps(perms) for p in PACKAGES);assert FORMAL in perms['enabled_accessibility_services'] and 'uk.thewyj.app/' not in perms['enabled_notification_listeners']
 before_perms=json.loads((OUT/'private/permissions-before.json').read_text());assert perms==before_perms
 users=shell('pm','list','users');assert re.findall(r'UserInfo\{(\d+):',users)==baseline['profile_ids']
 wechat={uid:shell('pm','list','packages','--user',uid,'-U','com.tencent.mm') for uid in baseline['profile_ids']};assert wechat==baseline['wechat']
 result={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','removed_only_owned_packages':PACKAGES,'formal_after':after_formal,'formal_permissions_exact':True,'formal_listener_remains_disabled':True,'qa_sensitive_permissions_revoked_by_uninstall':True,'wechat_package_uids_unchanged':True,'profiles_unchanged':True,'formal_storage_read':False,'formal_storage_write':False,'formal_database_byte_hash':'NOT_TESTED: protected non-debuggable storage was never opened','reverse_mappings':adb('reverse','--list').decode(),'commands':commands}
 path=OUT/'result.json';assert not path.exists();path.write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ['commands','reverse_mappings']}))
