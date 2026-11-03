"""Public installed APK only. Never open formal app storage or signing inputs."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/finance-p06/device/formal-apk';OUT.mkdir(exist_ok=False);private=OUT/'private';private.mkdir()
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='R5CY22MEHJN'
def adb(*parts):return subprocess.check_output([str(ADB),'-s',SERIAL,*parts],timeout=60)
assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
paths=adb('shell','pm','path','uk.thewyj.app').decode().strip().splitlines();assert len(paths)==1 and paths[0].startswith('package:/data/app/') and paths[0].endswith('/base.apk')
dest=private/'formal-base.apk';adb('pull',paths[0].removeprefix('package:'),str(dest))
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr')
p=subprocess.run(['cmd.exe','/d','/c',str(SDK/'build-tools/36.0.0/apksigner.bat'),'verify','--print-certs',str(dest)],env=env,capture_output=True,text=True)
(private/'signature.txt').write_text(p.stdout+p.stderr);assert p.returncode==0
cert=re.findall(r'certificate SHA-256 digest: ([0-9a-f]+)',p.stdout);assert cert
row=dict(checked_utc=datetime.now(timezone.utc).isoformat(),package='uk.thewyj.app',apk_bytes=dest.stat().st_size,apk_sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),certificate_sha256=cert,signature_verification='PASS',formal_storage_or_permissions_modified=False,public_apk_only=True)
(OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
