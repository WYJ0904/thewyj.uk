"""Headless Samsung SDK/native/HTTP/D1/Web QA. No app switching or permissions."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,base64,hashlib,io,json,os,re,secrets,shutil,subprocess,tarfile,time,urllib.request
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');parser.add_argument('--emulator',action='store_true');parser.add_argument('--numeric-reference',action='store_true');parser.add_argument('--reinstall-after-owned-cleanup',action='store_true');parser.add_argument('--receipt');args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.attempt)
sdk_attempt='r'+str(90+int(args.attempt[1:]))
OUT=E/(('emulator-joint-' if args.emulator else 'joint-')+args.attempt);OUT.mkdir(exist_ok=False);(OUT/'private').mkdir();(OUT/'native').mkdir()
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe';SERIAL='127.0.0.1:5589' if args.emulator else 'R5CY22MEHJN';PACKAGE='uk.thewyj.app.qa.financep06';TEST=PACKAGE+'.test'
ADB_BASE=[str(ADB),*(['-P','5043'] if args.emulator else []),'-s',SERIAL]
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(SDK),ANDROID_SDK_ROOT=str(SDK),FINANCE_P06_JOINT=str(OUT),AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe')
if args.emulator:env.update(ANDROID_ADB_SERVER_PORT='5043',ADB_SERVER_SOCKET='tcp:127.0.0.1:5043',ADB_MDNS_AUTO_CONNECT='0')
for key in list(env):
 if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
 names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).split('\0')
 return {n:sha(ROOT/n) for n in sorted(set(names)) if n and (ROOT/n).is_file() and n.startswith(('android/','functions/','js/finance/','qa/finance-p06/'))}
row=dict(started_utc=datetime.now(timezone.utc).isoformat(),status='IN_PROGRESS',head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),source_before=sources(),commands=[],artifacts=[],physical_device=not args.emulator,ui_transitions=0,qa_permissions_changed=False,real_notifications_generated=False,provider='MOCK',serial=SERIAL,adb_port=5043 if args.emulator else 5037)
row['reference_fixture']='NUMERIC_REFERENCE_POSITIVE_CONTROL' if args.numeric_reference else 'ORIGINAL_ALPHA_REFERENCE'
row['original_reference_failure_not_closed_by_positive_control']=args.numeric_reference
server=None;port=None;reverse=False
def save():(OUT/'progress.json').write_text(json.dumps(row,indent=2))
def adb(*parts,input=None,timeout=30):
 cmd=ADB_BASE+list(parts);p=subprocess.run(cmd,input=input,capture_output=True,timeout=timeout);row['commands'].append({'argv':cmd,'exit_code':p.returncode});save();assert p.returncode==0,(p.stdout+p.stderr).decode(errors='replace')[:1000];return p.stdout
def guard():
 if args.emulator:
  boot=json.loads((E/'avd/result.json').read_text());assert boot['status']=='PASS' and boot['serial']==SERIAL and boot['server_port']==5043
  assert adb('shell','getprop','ro.kernel.qemu').decode().strip()=='1';assert adb('shell','getprop','ro.build.version.sdk').decode().strip()=='36'
 else:assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360' and adb('shell','getprop','ro.kernel.qemu').decode().strip()!='1'
def write_private(path,raw):
 assert re.fullmatch(r'files/p06-joint-r[0-9]+/private/[a-z0-9.-]+',path)
 adb('shell','-T','run-as',PACKAGE,'sh','-c',"'base64 -d > "+path+"'",input=base64.b64encode(raw)+b'\n')
 assert adb('exec-out','run-as',PACKAGE,'cat',path)==raw,'Private transfer must be byte-exact before any test'
def run(name,command,timeout=None):
 with (OUT/(name+'.log')).open('xb') as log:p=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 row['commands'].append({'name':name,'argv':command,'exit_code':p.returncode});save();return p.returncode
def instrument(name,klass,extra=None):
 guard();cmd=ADB_BASE+['shell','am','instrument','-w','-r','-e','class',klass,'-e','p06Attempt',args.attempt,'-e','closeoutAttempt',sdk_attempt,'-e','p06ReferenceMode','numeric-positive-control' if args.numeric_reference else 'original',TEST+'/uk.thewyj.app.qa.financep06.FinanceP06Runner']
 try:code=run(name,cmd,180)
 except subprocess.TimeoutExpired:
  pid=adb('shell','pidof',PACKAGE).decode().strip()
  if pid.isdigit():
   adb('shell','run-as',PACKAGE,'kill','-3',pid);(OUT/'private'/(name+'-qa-logcat.txt')).write_bytes(adb('logcat','-d','--pid='+pid))
  adb('shell','am','force-stop',PACKAGE);raise
 text=(OUT/(name+'.log')).read_text(errors='replace');return code==0 and 'OK (' in text and 'FAILURES!!!' not in text and 'INSTRUMENTATION_FAILED' not in text
try:
 guard();previous=OUT/'private/previous-owned.apk';installed=set(adb('shell','pm','list','packages',PACKAGE).decode().splitlines())
 if args.emulator:assert installed<=set(['package:'+PACKAGE,'package:'+TEST])
 paths=adb('shell','pm','path',PACKAGE).decode().splitlines() if 'package:'+PACKAGE in installed else []
 if paths:
  assert len(paths)==1;adb('pull',paths[0].removeprefix('package:'),str(previous))
  known={a['sha256'] for p in (E/'device').glob('*/result.json') for a in json.loads(p.read_text()).get('artifacts',[]) if a['package']==PACKAGE}
  known|={a['sha256'] for pattern in ['joint-r*/progress.json','emulator-joint-r*/progress.json'] for p in E.glob(pattern) for a in json.loads(p.read_text()).get('artifacts',[]) if a['package']==PACKAGE}
  assert sha(previous) in known,'Installed package is not proven task owned'
 else:
  assert args.emulator or (args.reinstall_after_owned_cleanup and json.loads((E/'phone-cleanup/result.json').read_text())['status']=='PASS'),'Physical fresh install requires this task owned cleanup proof'
 pixel=E/'device/slow-sdk-source'
 cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/finance-p06/device.init.gradle'),'-Dfinance.p06.root='+str(ROOT/'qa/finance-p06'),'-Dfinance.p06.pixel.root='+str(pixel),':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
 assert run('build',cmd)==0
 for relative,package in [('debug/app-debug.apk',PACKAGE),('androidTest/debug/app-debug-androidTest.apk',TEST)]:
  source=ROOT/'android/app/build/outputs/apk'/relative;dest=OUT/source.name;shutil.copy2(source,dest);badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(dest)],text=True);assert "package: name='"+package+"'" in badging
  row['artifacts'].append({'path':str(dest.relative_to(ROOT)),'package':package,'sha256':sha(dest)});save();assert 'Success' in adb('install','-r','-t',str(dest),timeout=120).decode()
 config={'account_id':'synthetic-p04-owner','device_id':'synthetic-p06-joint-device','session':secrets.token_urlsafe(32)};(OUT/'private/context.json').write_text(json.dumps(config))
 with (OUT/'server.log').open('xb') as log:server=subprocess.Popen([str(node),'qa/finance-p06/joint-server.mjs'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  assert server.poll() is None,'Owned server exited'
  if (OUT/'port.json').exists():port=json.loads((OUT/'port.json').read_text());assert port['pid']==server.pid;break
  time.sleep(.2)
 else:raise TimeoutError('Owned server readiness')
 mapping=f'tcp:{port["port"]}';assert mapping not in adb('reverse','--list').decode();adb('reverse',mapping,mapping);reverse=True
 config['base_url']='http://127.0.0.1:'+str(port['port']);(OUT/'private/context.json').write_text(json.dumps(config));remote='files/p06-joint-'+args.attempt
 adb('shell','run-as',PACKAGE,'mkdir','-p',remote+'/private');write_private(remote+'/private/context.json',json.dumps(config).encode())
 if not args.emulator:
  real=Path(args.receipt).resolve() if args.receipt else E/'device/ui/wechat-primary-detail-r1/private/screen.png';assert real.resolve().is_relative_to(E.resolve()) and real.is_file()
  assert sha(real)==json.loads((E/'joint-r7/result.json').read_text())['real_page_sha256'],'Only the original owner-authorized receipt bytes may be replayed'
  row['real_page_sha256']=sha(real);row['real_page_bytes_replayed_from_verified_archive']=bool(args.receipt);write_private(remote+'/private/real-wechat-receipt.png',real.read_bytes());row['private_transfer_exact']=True
 row['native_seed_pass']=instrument('native-seed','uk.thewyj.app.task21.payment.FinanceP06JointSeedTest')
 if row['native_seed_pass']:
  (OUT/'native/seed.json').write_bytes(adb('exec-out','run-as',PACKAGE,'cat',remote+'/seed.json'))
  row['browser_pass']=run('browser',[str(node),'qa/finance-p06/joint-browser.mjs'],120)==0
  if row['browser_pass']:
   adb('shell','am','force-stop',PACKAGE);row['native_restore_pass']=instrument('native-restore','uk.thewyj.app.task21.payment.FinanceP06JointRestoreTest')
 if not args.emulator:row['real_receipt_probe_completed']=instrument('real-receipt-probe','uk.thewyj.app.task21.payment.FinanceP06RealReceiptProbeTest')
 row['final_sdk_protection_pass']=instrument('sdk-protection',','.join('uk.thewyj.app.task21.payment.CloseoutEmulatorTest#'+n for n in ['test00_actualSdkPixelMatrix','test01_staleAccountProfileAndContentAreDiscardedWithRealSdk','test02_cancelledDelayedSdkCallbackNeverPublishes']))
 required=['native_seed_pass','browser_pass','native_restore_pass','final_sdk_protection_pass']
 if args.emulator:
  guard();adb('shell','input','keyevent','KEYCODE_WAKEUP');adb('shell','wm','dismiss-keyguard')
  row['ui_transitions']=None;row['physical_ui_transitions']=0;row['emulator_ui_transition_count_measured']=False
  row['emulator_lifecycle_pass']=instrument('emulator-lifecycle','uk.thewyj.app.qa.financep06.FinanceP06LifecycleTest');required.append('emulator_lifecycle_pass')
 else:required.append('real_receipt_probe_completed')
 row['status']='PASS' if all(row.get(k)==True for k in required) else 'FAIL'
except Exception as error:row.update(status='FAIL' if row['artifacts'] else 'BLOCKED',error=str(error))
finally:
 if port:
  try:
   config=json.loads((OUT/'private/context.json').read_text());req=urllib.request.Request('http://127.0.0.1:'+str(port['port'])+'/__qa/stop',data=b'{}',headers={'X-Session-Token':config['session']});urllib.request.urlopen(req,timeout=10).close();server.wait(timeout=30);row['server_exited']=True
  except Exception as error:row['stop_error']=str(error)
 if reverse:
  try:adb('reverse','--remove',f'tcp:{port["port"]}');row['reverse_removed']=True
  except Exception as error:row['reverse_cleanup_error']=str(error)
 try:
  for remote_name,local in [('p06-joint-'+args.attempt,'native'),('closeout-'+sdk_attempt,'sdk-final')]:
   data=adb('exec-out','run-as',PACKAGE,'tar','-cf','-','-C','files/'+remote_name,'.');(OUT/'private'/(local+'.tar')).write_bytes(data);dest=OUT/local;dest.mkdir(exist_ok=True)
   with tarfile.open(fileobj=io.BytesIO(data)) as archive:
    for item in archive.getmembers():
     name=item.name.removeprefix('./');assert not item.issym() and not item.islnk()
     if not name or item.isdir():continue
     target=(dest/name).resolve();assert target.is_relative_to(dest.resolve());target.parent.mkdir(parents=True,exist_ok=True)
     with archive.extractfile(item) as stream:target.write_bytes(stream.read())
 except Exception as error:row['artifact_error']=str(error)
 row['source_after']=sources();row['source_stable']=row['source_before']==row['source_after'];row['finished_utc']=datetime.now(timezone.utc).isoformat()
 if not row['source_stable']:row['status']='FAIL'
 (OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps({k:v for k,v in row.items() if k not in ['source_before','source_after','commands']}))
raise SystemExit(0 if row['status']=='PASS' else 1)
