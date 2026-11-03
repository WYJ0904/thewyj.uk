"""Read public package metadata and QA-owned diagnostics, never formal app data."""
from pathlib import Path
import argparse,hashlib,json,re,subprocess,sys
sys.dont_write_bytecode=True
import phone
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
p=argparse.ArgumentParser();p.add_argument('--name',required=True);p.add_argument('--export-own',action='store_true');args=p.parse_args();assert re.fullmatch('[a-z0-9-]+',args.name)
dest=OUT/(args.name+'.json');assert not dest.exists();serial=phone.device()
owned=json.loads((OUT/'owned-install.json').read_text(encoding='utf8'));assert owned['device_sha256']==hashlib.sha256(serial.encode()).hexdigest()
paths=phone.run('-s',serial,'shell','pm','path','--user','0','uk.thewyj.app').splitlines();assert len(paths)==1 and paths[0].startswith('package:/data/app/') and paths[0].endswith('/base.apk')
apk=paths[0][8:];assert re.fullmatch(r'/data/app/[A-Za-z0-9/_.~=+\-]+/base\.apk',apk)
digest=phone.run('-s',serial,'shell','sha256sum',apk).split()[0]
assert digest==hashlib.sha256((OUT/'public-installed-formal.apk').read_bytes()).hexdigest()
rows=phone.run('-s',serial,'shell','pm','list','packages','-U','--user','0','uk.thewyj.app').splitlines();uids={}
for pkg in ['uk.thewyj.app',phone.PKG,phone.TEST]:
    match=[re.fullmatch(r'package:'+re.escape(pkg)+r' uid:(\d+)',line) for line in rows];match=[m for m in match if m];assert len(match)==1
    uids[pkg]=int(match[0].group(1))
assert len(set(uids.values()))==3
metadata=phone.run('-s',serial,'shell','dumpsys','package','uk.thewyj.app')
def field(pattern):
    m=re.search(pattern,metadata);assert m;return m.group(1).strip()
result={'device_alias':'Samsung-P03','formal_public_apk_sha256_unchanged':digest,'formal_version_code':field(r'versionCode=(\d+)'),'formal_version_name':field(r'versionName=([^\r\n]+)'),'formal_last_update':field(r'lastUpdateTime=([^\r\n]+)'),'distinct_user0_uids':uids,'state':phone.state(serial),'formal_private_data_read':False,'formal_database_content_unchanged':'NOT TESTED; private content was not opened','commands_can_mutate_only_owned_packages':[phone.PKG,phone.TEST]}
if args.export_own:
    folder=OUT/(args.name+'-own');folder.mkdir(exist_ok=False);files={}
    for name in ['tests.ndjson','platform.ndjson','ledger-before-restart.json']:
        proc=subprocess.run([str(phone.ADB),'-s',serial,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=15)
        if proc.returncode:files[name]={'status':'ABSENT','reason':'No such owned diagnostic or unavailable; no private fallback'};continue
        assert len(proc.stdout)<262144;target=folder/name;target.write_bytes(proc.stdout)
        files[name]={'status':'EXPORTED_OWN_SYNTHETIC_DIAGNOSTIC','bytes':len(proc.stdout),'sha256':hashlib.sha256(proc.stdout).hexdigest()}
    result['owned_diagnostics']=files
dest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False))
