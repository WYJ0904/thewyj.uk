"""Drive the independent, signed QA navigator; never expose arbitrary UI text."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess,time
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
AAPT=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.0.0/aapt2.exe'
PKG='uk.thewyj.app.qa.financep04navigator'
def adb(*args,timeout=30):
 p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*args],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=timeout)
 assert p.returncode==0,p.stderr
 return p.stdout
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['install','update','inspect','menu','click','receipt','qa-screen','qa-lifecycle','qa-ocr-money','qa-ocr-safety']);parser.add_argument('--name',required=True);parser.add_argument('--label');parser.add_argument('--build-name',default='navigator-final');args=parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',args.name)
assert re.fullmatch('navigator-[a-z0-9-]+',args.build_name)
target=OUT/(args.name+'.json');assert not target.exists()
record={'started_utc':datetime.now(timezone.utc).isoformat(),'action':args.action,'status':'NOT_TESTED'}
try:
 if args.action in {'install','update'}:
  present=('package:'+PKG) in adb('shell','pm','list','packages','--user','0',PKG).splitlines()
  if args.action=='install':assert not present
  else:
   assert present and (OUT/'navigator-owned.json').exists()
   backup=json.loads((OUT/'navigator-before-ocr-manifest.json').read_text())
   assert hashlib.sha256((OUT/'navigator-before-ocr.tar').read_bytes()).hexdigest()==backup['archive_sha256']
  build=json.loads((OUT/args.build_name/'build.json').read_text())
  assert build['exit_code']==0 and len(build['artifacts'])==2
  for entry in build['artifacts']:
   p=ROOT/entry['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==entry['sha256']
   metadata=subprocess.check_output([str(AAPT),'dump','badging',str(p)],text=True,encoding='utf8',errors='replace')
   assert re.search(r"package: name='([^']+)'",metadata).group(1) in {PKG,PKG+'.test'}
   assert 'Success' in adb('install','--user','0',*(['-r'] if args.action=='update' else []),'-t',str(p),timeout=120)
  ownership=OUT/('navigator-owned-update-'+args.name+'.json' if args.action=='update' else 'navigator-owned.json');assert not ownership.exists()
  ownership.write_text(json.dumps(build,indent=2),encoding='utf8')
  if args.action=='update':
   for name,sha in backup['files'].items():
    raw=subprocess.check_output([str(ADB),'-s','R5CY22MEHJN','exec-out','run-as',PKG,'cat',name]);assert hashlib.sha256(raw).hexdigest()==sha
   record['backup_metadata_preserved']=len(backup['files'])
  record['status']='PASS'
 else:
  assert (OUT/'navigator-owned.json').exists()
  n=adb('shell','settings','--user','0','get','secure','enabled_notification_listeners')
  a=adb('shell','settings','--user','0','get','secure','enabled_accessibility_services')
  assert 'uk.thewyj.app/' not in n and 'uk.thewyj.app/' not in a,'Formal capture must remain normally paused'
  command=['shell','am','instrument','-w','-r','-e','class',PKG+'.NavigatorTest','-e','operation',args.action,'-e','proof_name',args.name]
  if args.label:
   assert args.label in {'我','服务','钱包','账单','搜索','筛选','按金额','全部账单','取消','返回'}
   command+=['-e','label',args.label]
  command+=[PKG+'.test/'+PKG+'.NavigatorRunner'];record['command']=[str(ADB),'-s','R5CY22MEHJN',*command]
  started=time.monotonic()
  text=adb(*command,timeout=180)
  (OUT/(args.name+'.log')).write_text(text,encoding='utf8')
  record['seconds']=round(time.monotonic()-started,3)
  record['status']='PASS' if 'OK (1 test)' in text and 'FAILURES!!!' not in text else 'FAIL'
  if record['status']=='PASS' or args.action in {'qa-ocr-money','qa-ocr-safety'}:
   proof=json.loads(adb('shell','run-as',PKG,'cat','files/closure-proof/'+args.name+'.json'))
   record['proof']=proof
   record['business_completion']='NOT CLAIMED by navigation or observation success'
except Exception as error:record.update(status='BLOCKED',error=str(error));raise
finally:
 record['finished_utc']=datetime.now(timezone.utc).isoformat()
 with target.open('x',encoding='utf8') as f:json.dump(record,f,ensure_ascii=False,indent=2)
 print(json.dumps(record,ensure_ascii=False))
raise SystemExit(int(record['status']!='PASS'))
