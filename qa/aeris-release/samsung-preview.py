"""One owned Samsung QA package; no formal-app writes or global log capture."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,subprocess,time,xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/aeris-p03-p07/v62-samsung-preview-r1'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
AAPT=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.0.0/aapt2.exe'
PKG='uk.thewyj.app.v62spatialqa';XML='/data/local/tmp/aeris-v62spatial-r1.xml'
ORIGIN='https://ac8cec2c.thewyj-p07-ui-rc.pages.dev'
apk=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','launch','snapshot','tap','input','selectall','language-switch','back','home','restart','instrument-input','close-shade','cleanup']);p.add_argument('--serial',default=os.environ.get('AERIS_QA_SERIAL'));p.add_argument('--label',default='qa');p.add_argument('--x',type=int);p.add_argument('--y',type=int);p.add_argument('--field',choices=['username','secret']);p.add_argument('--no-image',action='store_true');p.add_argument('--attempt',default='r3');a=p.parse_args()
SERIAL=a.serial;assert SERIAL and re.fullmatch('[A-Za-z0-9_-]+',SERIAL),'Explicit QA device required'
assert re.fullmatch('[a-z0-9-]+',a.label)
assert re.fullmatch('r[1-9][0-9]*',a.attempt)
accounts=json.loads((ROOT/'docs/migration-evidence/aeris-p03-p07/private/v62-owned-preview-access.json').read_text())
assert accounts['origin']==ORIGIN
account=next(x for x in accounts['accounts']if x['scope']=='validation');secret=account['secret']
def adb(*args,timeout=30,check=True):
 result=subprocess.run([str(ADB),'-P','5057','-s',SERIAL,*args],capture_output=True,timeout=timeout)
 if check:assert result.returncode==0,'ADB command failed: '+str(args[:3])
 return result.stdout
def now():return datetime.now(timezone.utc).isoformat()
def event(kind,**data):
 with (OUT/'events.jsonl').open('a',encoding='utf-8')as f:f.write(json.dumps(dict(utc=now(),kind=kind,**data))+'\n')
def installed(package):return bool(adb('shell','pm','path',package,check=False).strip())
def baseline():
 dump=adb('shell','dumpsys','package','uk.thewyj.app').decode('utf-8','replace')
 return dict(formal_app=dict(version_code=re.search(r'versionCode=(\d+)',dump).group(1),version_name=re.search(r'versionName=([^\r\n]+)',dump).group(1).strip()),
  sensitive_settings_sha256={key:hashlib.sha256(adb('shell','settings','get','secure',key)).hexdigest()for key in ['enabled_accessibility_services','enabled_notification_listeners']})
def foreground():
 text=adb('shell','dumpsys','window').decode('utf-8','replace')
 focused=[line.strip()for line in text.splitlines()if 'mCurrentFocus='in line]
 assert len(focused)==1 and PKG+'/'in focused[0], 'Capture/input requires the verified QA foreground'
 return focused[0]
def quiet():
 file=OUT/'last-ui-action.json'
 if file.exists():time.sleep(max(0,8-(time.time()-json.loads(file.read_text())['at'])))
 file.write_text(json.dumps(dict(at=time.time())))
def snapshot():
 foreground();started=time.monotonic()
 adb('shell','uiautomator','dump','--compressed',XML,timeout=25)
 raw=adb('exec-out','cat',XML).decode('utf8','replace');foreground()
 raw=raw.replace(secret,'<redacted-QA-secret>');root=ET.fromstring(raw)
 nodes=[dict(text=n.get('text'),description=n.get('content-desc'),class_name=n.get('class'),bounds=n.get('bounds'),clickable=n.get('clickable'),password=n.get('password'))for n in root.iter('node')]
 (OUT/(a.label+'.xml')).write_text(raw,encoding='utf-8')
 image=None
 if not a.no_image:
  image=adb('exec-out','screencap','-p');foreground();assert image.startswith(b'\x89PNG')
  (OUT/(a.label+'.png')).write_bytes(image)
 activity=adb('shell','dumpsys','activity','activities').decode('utf8','replace')
 lifecycle=[line.strip()for line in activity.splitlines()if PKG in line and any(k in line for k in ['ActivityRecord','mResumedActivity','topResumedActivity'])]
 data=dict(label=a.label,elapsed_seconds=time.monotonic()-started,nodes=nodes,lifecycle=lifecycle,png_sha256=hashlib.sha256(image).hexdigest()if image else None)
 (OUT/(a.label+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');event('snapshot',label=a.label,elapsed_seconds=data['elapsed_seconds'])
 print(json.dumps(dict(label=a.label,nodes=nodes,lifecycle=lifecycle),ensure_ascii=False))
if a.action=='prepare':
 OUT.mkdir(exist_ok=False)
 assert not installed(PKG),'Existing QA package must not be replaced/cleared'
 assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
 assert adb('shell','getprop','ro.build.version.sdk').decode().strip()=='36'
 assert adb('shell','getprop','ro.kernel.qemu').decode().strip()!='1'
 badging=subprocess.check_output([str(AAPT),'dump','badging',str(apk)]).decode();assert "package: name='"+PKG+"'"in badging
 config=(ROOT/'android/app/build/generated/source/buildConfig/debug/uk/thewyj/app/BuildConfig.java').read_text()
 assert f'APPLICATION_ID = "{PKG}"'in config and f'THEWYJ_BASE_URL = "{ORIGIN}"'in config
 assert 'PAYMENT_DEVICE_TEST = false'in config and 'PAYMENT_DIAGNOSTICS = false'in config
 before=baseline();(OUT/'before.json').write_text(json.dumps(before,indent=2))
 (OUT/'BuildConfig.java.txt').write_text(config)
 raw=apk.read_bytes();(OUT/'candidate.apk').write_bytes(raw)
 (OUT/'candidate.json').write_text(json.dumps(dict(package=PKG,apk_sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),origin=ORIGIN,source_head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),aapt_badging_first_line=badging.splitlines()[0]),indent=2))
 installed_result=adb('install',str(OUT/'candidate.apk'),timeout=60).decode();assert 'Success'in installed_result
 (OUT/'new-install.json').write_text(json.dumps(dict(package=PKG,new_install=True,installed_at=now())))
 event('install',package=PKG,result='Success',formal_app_changes=0,sensitive_permission_grants=0);print('New isolated QA package installed')
elif a.action=='launch':
 assert (OUT/'new-install.json').exists()and installed(PKG);quiet();start=time.monotonic()
 result=adb('shell','am','start','-W','-n',PKG+'/uk.thewyj.app.MainActivity').decode()
 event('launch',elapsed_seconds=time.monotonic()-start,output=result);print(result)
elif a.action=='snapshot':snapshot()
elif a.action=='tap':
 assert a.x is not None and a.y is not None;foreground();quiet();adb('shell','input','tap',str(a.x),str(a.y));event('tap',label=a.label,x=a.x,y=a.y)
elif a.action=='input':
 assert a.field;foreground();quiet();value=account[a.field];assert re.fullmatch('[A-Za-z0-9_-]+',value)
 adb('shell','input','text',value);event('input',field=a.field,contents_logged=False)
elif a.action=='back':foreground();quiet();adb('shell','input','keyevent','4');event('back')
elif a.action=='selectall':foreground();quiet();adb('shell','input','keycombination','113','29');event('selectall',label=a.label)
elif a.action=='language-switch':foreground();quiet();adb('shell','input','keyevent','204');event('normal-ime-language-switch',label=a.label)
elif a.action=='close-shade':
 window=adb('shell','dumpsys','window').decode();policy=adb('shell','dumpsys','window','policy').decode()
 assert any('mCurrentFocus='in line and 'NotificationShade'in line for line in window.splitlines())
 assert re.search(r'(?m)^\s+showing=false\s*$',policy)and re.search(r'(?m)^\s+inputRestricted=false\s*$',policy)
 quiet();adb('shell','input','keyevent','4');event('close-already-open-notification-shade',keyguard_showing=False)
elif a.action=='home':foreground();quiet();adb('shell','input','keyevent','3');event('home')
elif a.action=='restart':
 assert (OUT/'new-install.json').exists();quiet();adb('shell','am','force-stop',PKG);event('qa-force-stop');time.sleep(8)
 start=time.monotonic();result=adb('shell','am','start','-W','-n',PKG+'/uk.thewyj.app.MainActivity').decode();event('qa-restart',elapsed_seconds=time.monotonic()-start,output=result);print(result)
elif a.action=='instrument-input':
 assert (OUT/'new-install.json').exists()and installed(PKG)
 test_package=PKG+'.test';assert not installed(test_package)
 test_apk=ROOT/'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
 badging=subprocess.check_output([str(AAPT),'dump','badging',str(test_apk)]).decode();assert "package: name='"+test_package+"'"in badging
 copy=OUT/('input-test-'+a.attempt+'.apk');assert not copy.exists()
 raw=test_apk.read_bytes();copy.write_bytes(raw)
 (OUT/('input-test-candidate-'+a.attempt+'.json')).write_text(json.dumps(dict(package=test_package,apk_sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw)),indent=2))
 assert 'Success'in adb('install',str(copy),timeout=60).decode()
 (OUT/'input-test-install.json').write_text(json.dumps(dict(package=test_package,new_install=True,installed_at=now())))
 data=json.dumps(dict(username=account['username'],secret=secret,scope='validation')).encode()
 written=subprocess.run([str(ADB),'-P','5057','-s',SERIAL,'exec-in','run-as',PKG,'tee','files/v62-native-qa-credentials.json'],input=data,capture_output=True,timeout=20)
 assert written.returncode==0 and adb('exec-out','run-as',PKG,'cat','files/v62-native-qa-credentials.json')==data
 quiet();start=time.monotonic()
 try:
  instrument=adb('shell','am','instrument','-w','-r','-e','class','uk.thewyj.app.qa.v62.NativePreviewLoginTest',test_package+'/androidx.test.runner.AndroidJUnitRunner',timeout=100,check=False).decode('utf-8','replace')
  instrument=instrument.replace(secret,'<redacted-QA-secret>');(OUT/('input-test-'+a.attempt+'.log')).write_text(instrument,encoding='utf-8')
  result=adb('exec-out','run-as',PKG,'cat','files/v62-native-login-result.json',check=False)
  if result.strip().startswith(b'{'):(OUT/('native-login-result-'+a.attempt+'.json')).write_bytes(result)
 finally:adb('shell','run-as',PKG,'rm','-f','files/v62-native-qa-credentials.json')
 event('isolated-ui-input-instrumentation',elapsed_seconds=time.monotonic()-start,passed='OK (1 test)'in instrument)
 print(instrument[-2000:])
elif a.action=='cleanup':
 installed_record=json.loads((OUT/'new-install.json').read_text());assert installed_record['package']==PKG and installed_record['new_install']is True
 test_record=OUT/'input-test-install.json'
 if test_record.exists():
  test_data=json.loads(test_record.read_text());assert test_data['new_install']is True and test_data['package']==PKG+'.test'
  if installed(test_data['package']):assert 'Success'in adb('uninstall',test_data['package'],timeout=60).decode()
 if installed(PKG):quiet();result=adb('uninstall',PKG,timeout=60).decode();assert 'Success'in result
 adb('shell','rm',XML,check=False)
 after=baseline();before=json.loads((OUT/'before.json').read_text());assert not installed(PKG)
 result=dict(status='PASS'if after==before else 'FAIL',before=before,after=after,qa_package_absent=True,formal_data_writes=0,sensitive_permissions_changed=False,system_settings_writes=0)
 (OUT/'cleanup.json').write_text(json.dumps(result,indent=2));event('cleanup',status=result['status']);print(json.dumps(result));assert result['status']=='PASS'
