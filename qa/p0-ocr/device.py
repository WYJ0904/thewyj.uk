"""Unique Samsung SDK-only QA package; no real page/data or global log capture."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,io,json,os,re,subprocess,tarfile,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p0-ocr'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';PKG='uk.thewyj.app.qa.aerisp0ocr'
p=argparse.ArgumentParser();p.add_argument('--serial',required=True);p.add_argument('--build',default='build-r2');p.add_argument('--label',default='samsung-r1');p.add_argument('--latin-corpus',action='store_true');a=p.parse_args()
assert re.fullmatch('[A-Za-z0-9_-]+',a.serial)and re.fullmatch('build-r[1-9][0-9]*',a.build)and re.fullmatch('samsung-r[1-9][0-9]*',a.label)
OUT=E/a.label;OUT.mkdir(parents=True,exist_ok=False)
env=dict(os.environ);env['ANDROID_SERIAL']=a.serial
def utc():return datetime.now(timezone.utc).isoformat()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def adb(*parts,timeout=40,check=True):
 r=subprocess.run([str(ADB),'-P','5057','-s',a.serial,*parts],capture_output=True,timeout=timeout,env=env)
 if check:assert r.returncode==0,'Scoped ADB command failed: '+str(parts[:3])
 return r
def present(package):
 r=adb('shell','pm','path','--user','0',package,check=False)
 assert r.returncode in [0,1]and not r.stderr.strip(),'Package status unavailable'
 return bool(r.stdout.strip())
def state():
 text=adb('shell','dumpsys','package','uk.thewyj.app').stdout.decode(errors='replace')
 return dict(formal_version_code=re.search(r'versionCode=(\d+)',text).group(1),formal_version_name=re.search(r'versionName=([^\r\n ]+)',text).group(1),
  sensitive_permission_hashes={key:sha(adb('shell','settings','get','secure',key).stdout)for key in ['enabled_accessibility_services','enabled_notification_listeners']})
def pull_tree(folder,label):
 raw=adb('exec-out','run-as',PKG,'tar','-cf','-','files/'+folder,timeout=60).stdout
 target=OUT/label;target.mkdir(exist_ok=False)
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as archive:
  for member in archive.getmembers():
   assert not member.issym()and not member.islnk()
   name=Path(member.name);assert not name.is_absolute()and'..'not in name.parts
   assert name.parts[:2]==('files',folder)
   relative=Path(*name.parts[2:]);dest=target/relative
   assert dest.resolve().is_relative_to(target.resolve())
   if member.isdir():dest.mkdir(parents=True,exist_ok=True)
   elif member.isfile():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(archive.extractfile(member).read())
def instrument(method,label,test_class='P0OcrGeometryDiagnosticTest'):
 cmd=['shell','am','instrument','--user','0','-w','-r','-e','class','uk.thewyj.app.task21.payment.'+test_class+'#'+method,PKG+'.test/androidx.test.runner.AndroidJUnitRunner']
 t=time.monotonic();r=adb(*cmd,timeout=360,check=False);raw=r.stdout+r.stderr
 (OUT/(label+'.log')).write_bytes(raw)
 result=dict(label=label,exit_code=r.returncode,elapsed_seconds=time.monotonic()-t,junit_pass=r.returncode==0 and b'OK (1 test)'in raw)
 record['runs'].append(result);save();return result
def save():(OUT/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8')
record=dict(started_utc=utc(),status='IN_PROGRESS',device_serial_sha256=sha(a.serial.encode()),runs=[],installed=[],activity_launches=0,screen_captures=0,private_pages_read=0,external_model_calls=0,ledger_writes_by_probe=0,production_operations=0)
before=None
try:
 assert adb('get-state').stdout.strip()==b'device'
 assert adb('shell','getprop','ro.product.model').stdout.strip()==b'SM-S9360'
 assert adb('shell','getprop','ro.build.version.sdk').stdout.strip()==b'36'
 assert adb('shell','getprop','ro.kernel.qemu').stdout.strip()!=b'1'
 assert adb('shell','am','get-current-user').stdout.strip()==b'0'
 assert not present(PKG)and not present(PKG+'.test'),'Existing QA installation is protected'
 for package in [PKG,PKG+'.test']:
  assert b'versionCode='not in adb('shell','dumpsys','package',package).stdout,'Existing QA package in another profile is protected'
 record.update(model='SM-S9360',api=36,physical_device=True,synthetic_images_only=True,android_user=0)
 before=state();assert before['formal_version_code']=='50'and before['formal_version_name']=='1.3.37';record['before']=before;save()
 build=json.loads((E/a.build/'result.json').read_text());assert build['status']=='PASS'
 record['build_evidence']=a.build+'/result.json';record['build_manifest_sha256']=sha((E/a.build/'result.json').read_bytes());record['head']=build['head']
 assert all(sha((ROOT/name).read_bytes())==digest for name,digest in build['source_before'].items()),'Built SDK/source mismatch'
 for artifact in build['artifacts']:
  assert artifact['package']in [PKG,PKG+'.test'];apk=ROOT/artifact['path'];assert sha(apk.read_bytes())==artifact['sha256']
  time.sleep(8);r=adb('install','--user','0','-t',str(apk),timeout=90);assert b'Success'in r.stdout
  record['installed'].append(artifact['package']);save()
 cold=instrument('coldProcessOriginalDirect','cold-direct')
 if cold['junit_pass']:pull_tree('p0-ocr-cold','cold-direct')
 adb('shell','am','force-stop',PKG);time.sleep(8)
 diagnostic=instrument('originalFrozenMethodsThenUnhintedGeometry','frozen-and-geometry')
 for folder,label in [('reference-corpus','corpus'),('reference-probe-r2','original-six'),('p0-ocr-geometry','geometry')]:
  try:pull_tree(folder,label)
  except Exception as error:record.setdefault('collection_errors',[]).append(dict(folder=folder,error=str(error)[:180]));save()
 assert cold['junit_pass']and diagnostic['junit_pass'],'Instrumentation failure retained'
 if a.latin_corpus:
  time.sleep(8)
  latin=instrument('samePixelsWithIndependentLatinRecognizer','latin-corpus','LatinReferenceDiagnosticTest')
  if latin['junit_pass']:pull_tree('latin-diagnostic','latin-corpus')
  assert latin['junit_pass'],'Latin diagnostic failure retained'
 record['status']='EXECUTED_ACCURACY_TO_BE_EVALUATED'
except Exception as error:record.update(status='FAIL_OR_BLOCKED',error_type=type(error).__name__,error=str(error)[:240])
finally:
 cleanup=[]
 for package in reversed(record['installed']):
  time.sleep(8)
  try:
   r=adb('uninstall',package,timeout=60);assert b'Success'in r.stdout;cleanup.append(dict(package=package,uninstalled=True))
  except Exception as error:cleanup.append(dict(package=package,uninstalled=False,error=str(error)[:160]))
 record['cleanup']=cleanup
 if before is not None:
  try:record['after']=state();record['formal_state_unchanged']=record['after']==before
  except Exception as error:record['formal_readback_error']=str(error)[:180]
 try:record['qa_packages_absent_after']=all(not present(package)for package in [PKG,PKG+'.test'])
 except Exception as error:record['qa_readback_error']=str(error)[:180]
 record['finished_utc']=utc();save();print(json.dumps(record))
if record['status']!='EXECUTED_ACCURACY_TO_BE_EVALUATED'or not record.get('formal_state_unchanged')or not record.get('qa_packages_absent_after')or not all(r['uninstalled']for r in record['cleanup']):raise SystemExit(1)
