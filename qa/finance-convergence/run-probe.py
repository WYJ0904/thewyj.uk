from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence';OUT=E/'ocr-probe';OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';PKG='uk.thewyj.app.qa.financep06';BASE=[str(ADB),'-P','5053','-s','127.0.0.1:5577'];steps=[]
def adb(*a,timeout=30):
 p=subprocess.run(BASE+list(a),capture_output=True,timeout=timeout);steps.append(dict(command=BASE+list(a),exit_code=p.returncode));assert p.returncode==0,p.stderr.decode(errors='replace')[:300];return p.stdout
assert json.loads((E/'avd/result.json').read_text())['status']=='PASS'
assert adb('shell','getprop','ro.kernel.qemu').strip()==b'1'
assert adb('shell','getprop','ro.build.version.sdk').strip()==b'36'
for rel,package in [('debug/app-debug.apk',PKG),('androidTest/debug/app-debug-androidTest.apk',PKG+'.test')]:
 p=ROOT/'android/app/build/outputs/apk'/rel;raw=p.read_bytes();(OUT/p.name).write_bytes(raw)
 desc=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(p)],text=True);assert "package: name='"+package+"'" in desc
 assert b'Success' in adb('install','-r','-t',str(p),timeout=120)
cmd=BASE+['shell','am','instrument','-w','-r','-e','class','uk.thewyj.app.task21.payment.ReferenceOcrProbeTest',PKG+'.test/uk.thewyj.app.qa.financep06.FinanceP06Runner']
started=datetime.now(timezone.utc).isoformat()
with (OUT/'instrument.log').open('xb') as log:p=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=150)
text=(OUT/'instrument.log').read_text();ok=p.returncode==0 and 'OK (1 test)' in text
if ok:
 raw=adb('exec-out','run-as',PKG,'cat','files/reference-probe/views.json');(OUT/'views.json').write_bytes(raw)
 for row in json.loads(raw):
  name=row['view']+'.png';remote='files/reference-probe/'+name;raw=adb('exec-out','run-as',PKG,'cat',remote);digest=adb('shell','run-as',PKG,'sha256sum',remote).decode().split()[0];assert hashlib.sha256(raw).hexdigest()==digest;(OUT/name).write_bytes(raw)
(OUT/'result.json').write_text(json.dumps(dict(status='PASS' if ok else 'FAIL',started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat(),command=cmd,steps=steps,physical_device=False,source_pixels_sha256=hashlib.sha256((E/'inputs/r1/synthetic-ai-page.png').read_bytes()).hexdigest()),indent=2))
print('Actual SDK probe:',ok)
