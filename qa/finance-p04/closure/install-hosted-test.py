"""Install only the owned test APK; pass generated QA credentials through stdin into private storage."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe'
PKG='uk.thewyj.app.qa.financep04closure';TEST=PKG+'.p03acceptance'
parser=argparse.ArgumentParser();parser.add_argument('--repair-fixture',action='store_true');parser.add_argument('--reuse-fixture',action='store_true');parser.add_argument('--build-name',default='device-hosted-test');parser.add_argument('--build-attempt',choices=['r1','r2','r3'],default='r1');args=parser.parse_args()
assert re.fullmatch('device-hosted-test(?:-r[0-9]+)?|device-final-backup',args.build_name)
assert json.loads((OUT/'hosted-bindings-final/result.json').read_text())['database_ids']==['c2eb978f-9f49-4e4c-8286-f6b398fae0de']
assert (OUT/'owned-phone-install.json').exists()
build=json.loads((OUT/args.build_name/('build-'+args.build_attempt+'.json')).read_text());assert build['exit_code']==0 and build['source_stable'] and len(build['artifacts'])==1
entry=build['artifacts'][0];apk=ROOT/entry['path'];assert hashlib.sha256(apk.read_bytes()).hexdigest()==entry['sha256']
badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(apk)],text=True,encoding='utf8',errors='replace')
assert re.search(r"package: name='([^']+)'",badging)[1]==TEST
def adb(*parts,data=None):
    p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*parts],input=data,capture_output=True,timeout=120);assert p.returncode==0,p.stderr.decode(errors='replace');return p.stdout
assert ('package:'+PKG) in adb('shell','pm','list','packages','--user','0',PKG).decode().splitlines()
if not args.repair_fixture:assert b'Success' in adb('install','--user','0','-r','-t',str(apk))
else:assert ('package:'+TEST) in adb('shell','pm','list','packages','--user','0',TEST).decode().splitlines()
fixture=(OUT/'private/qa-accounts.json').read_bytes()
remote='files/finance-p04-closure/hosted-fixture.json'
existing=adb('shell','run-as',PKG,'find','files/finance-p04-closure','-name','hosted-fixture.json').strip()
if args.repair_fixture:assert existing and adb('exec-out','run-as',PKG,'cat',remote) in (b'',fixture)
elif args.reuse_fixture:assert existing and adb('exec-out','run-as',PKG,'cat',remote)==fixture
else:assert not existing
assert json.loads((OUT/'adb-stdin-canary.json').read_text())['exact']
if not args.reuse_fixture:adb('shell','-T','run-as',PKG,'dd','of='+remote,data=fixture)
assert adb('exec-out','run-as',PKG,'cat',remote)==fixture
target=OUT/('hosted-test-install-r2.json' if args.repair_fixture else 'hosted-test-install-'+args.build_name+'.json');assert not target.exists();target.write_text(json.dumps({'status':'PASS','test_apk_sha256':entry['sha256'],'product_apk_reinstalled':False,'credentials_logged':False,'stdin_protocol':'normal adb shell -T verified by exact nonsecret canary','scope':'Existing owned QA target and generated QA credentials only'},indent=2));print(target)
