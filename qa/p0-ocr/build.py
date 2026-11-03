"""Pinned SDK probes in a unique Debug package, without device/network models."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p0-ocr'
assert ROOT.name=='thewyj.uk'and ROOT.parent.name=='aeris-p0-ocr'
p=argparse.ArgumentParser();p.add_argument('--label',default='build-r1');a=p.parse_args();assert a.label.startswith('build-r')and a.label[7:].isdigit()
out=E/a.label;out.mkdir(parents=True,exist_ok=False)
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'))
env['ANDROID_SDK_ROOT']=env['ANDROID_HOME'];env['WRANGLER_SEND_METRICS']='false'
for key in list(env):
 if any(v in key.upper()for v in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS'])or key.upper().startswith(('CLOUDFLARE_','CF_API_','CF_ACCOUNT_','OPENAI_','ANTHROPIC_','GEMINI_')):env.pop(key)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=[ROOT/'android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt',ROOT/'android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentOcrTaskLifetime.kt']
paths+=list((ROOT/'qa/p0-ocr').rglob('*'))+list((ROOT/'qa/aeris-finance-quality/sdk').rglob('*'))
before={p.relative_to(ROOT).as_posix():sha(p)for p in paths if p.is_file()}
assert sha(ROOT/'qa/aeris-finance-quality/sdk/assets/reference-original.png')=='46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f'
cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/p0-ocr/sdk.init.gradle'),'-Daeris.p0.ocr.root='+str(ROOT/'qa/p0-ocr'),
 ':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
record=dict(started_utc=datetime.now(timezone.utc).isoformat(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),source_before=before,command=cmd,phone_operations=0,external_model_calls=0)
with (out/'build.log').open('xb')as log:r=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
record.update(exit_code=r.returncode,source_stable=all(sha(ROOT/n)==v for n,v in before.items()),artifacts=[])
if r.returncode==0:
 for rel,package in [('debug/app-debug.apk','uk.thewyj.app.qa.aerisp0ocr'),('androidTest/debug/app-debug-androidTest.apk','uk.thewyj.app.qa.aerisp0ocr.test')]:
  f=ROOT/'android/app/build/outputs/apk'/rel
  badging=subprocess.check_output([str(Path(env['ANDROID_HOME'])/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(f)],text=True)
  assert "package: name='"+package+"'"in badging
  dest=out/f.name;dest.write_bytes(f.read_bytes());record['artifacts'].append(dict(package=package,path=dest.relative_to(ROOT).as_posix(),sha256=sha(dest),bytes=dest.stat().st_size))
record['status']='PASS'if r.returncode==0 and record['source_stable']else'FAIL'
(out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record));raise SystemExit(r.returncode or int(not record['source_stable']))
