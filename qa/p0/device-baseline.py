"""Read only formal APK/public signing identity and device protection metadata."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[2];SDK=Path.home()/'AppData/Local/Android/Sdk'
p=argparse.ArgumentParser();p.add_argument('--serial',required=True);p.add_argument('--label',required=True);a=p.parse_args()
assert re.fullmatch('[A-Za-z0-9_-]+',a.serial)and re.fullmatch('[a-z0-9-]+',a.label)
OUT=ROOT/'docs/migration-evidence/aeris-p0-closeout'/a.label;OUT.mkdir(parents=True,exist_ok=False)
private=OUT/'private';private.mkdir()
def adb(*args):return subprocess.check_output([str(SDK/'platform-tools/adb.exe'),'-P','5057','-s',a.serial,*args],timeout=50)
record=dict(utc=datetime.now(timezone.utc).isoformat(),serial_sha256=hashlib.sha256(a.serial.encode()).hexdigest(),
 formal_data_contents_read=False,formal_app_mutations=0,sensitive_permission_changes=0,screen_captures=0)
try:
 assert adb('get-state').strip()==b'device'
 model=adb('shell','getprop','ro.product.model').decode().strip();api=adb('shell','getprop','ro.build.version.sdk').decode().strip()
 assert model=='SM-S9360'and api=='36'and adb('shell','getprop','ro.kernel.qemu').strip()!=b'1'
 record.update(model=model,android_api=api)
 pkg=adb('shell','dumpsys','package','uk.thewyj.app').decode('utf8','replace')
 record['formal_package']=dict(name='uk.thewyj.app',version_code=re.search(r'versionCode=(\d+)',pkg).group(1),version_name=re.search(r'versionName=([^\r\n ]+)',pkg).group(1))
 secure={}
 for key in ['enabled_accessibility_services','enabled_notification_listeners']:
  raw=adb('shell','settings','get','secure',key)
  secure[key]=dict(sha256=hashlib.sha256(raw).hexdigest(),formal_component_present=any(c.split('/')[0]=='uk.thewyj.app'for c in raw.decode().strip().split(':')))
 record['sensitive_settings']=secure
 battery=adb('shell','dumpsys','battery').decode();record['battery']={k:re.search(r'(?m)^\s*'+re.escape(k)+r':\s*([^\r\n]+)',battery).group(1).strip()for k in ['level','status','USB powered','AC powered']}
 policy=adb('shell','dumpsys','window','policy').decode('utf8','replace')
 record['lock_metadata']=dict(keyguard_showing=bool(re.search(r'(?m)^\s+showing=true\s*$',policy)),input_restricted=bool(re.search(r'(?m)^\s+inputRestricted=true\s*$',policy)))
 paths=[line.removeprefix('package:').strip()for line in adb('shell','pm','path','uk.thewyj.app').decode().splitlines()if line.startswith('package:')]
 assert len(paths)==1 and paths[0].endswith('/base.apk'),'Split/package ambiguity; no data access attempted'
 apk=private/'formal-base.apk';apk.write_bytes(adb('exec-out','cat',paths[0]))
 record['formal_apk']=dict(bytes=apk.stat().st_size,sha256=hashlib.sha256(apk.read_bytes()).hexdigest())
 env={**os.environ,'JAVA_HOME':'C:/Program Files/Android/Android Studio/jbr'}
 s=subprocess.run([str(SDK/'build-tools/36.0.0/apksigner.bat'),'verify','--print-certs',str(apk)],capture_output=True,timeout=35,env=env)
 assert s.returncode==0,'APK signature verification failed'
 text=s.stdout.decode('utf8','replace');cert=re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)',text);assert cert
 record['formal_apk']['signer_certificate_sha256']=cert.group(1).lower()
 record['formal_apk']['signature_verified']=True
 record['status']='PASS_METADATA_ONLY'
except Exception as error:record.update(status='BLOCKED_OR_FAILED',error_type=type(error).__name__,error=str(error)[:200])
(OUT/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
if record['status']!='PASS_METADATA_ONLY':raise SystemExit(1)
