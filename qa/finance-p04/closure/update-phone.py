"""Cold-back up and update only the two packages installed by this closure run."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,io,json,re,subprocess,tarfile

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
SDK=Path.home()/'AppData/Local/Android/Sdk'
ADB=SDK/'platform-tools/adb.exe'
PKG='uk.thewyj.app.qa.financep04closure'
parser=argparse.ArgumentParser();parser.add_argument('--device-name',required=True);parser.add_argument('--attempt',default='r1');args=parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',args.device_name) and re.fullmatch('r[0-9]+',args.attempt)
dest=OUT/('phone-update-'+args.device_name+'.json');assert not dest.exists()
owned=json.loads((OUT/'owned-phone-install.json').read_text());assert owned['package']==PKG
build=json.loads((OUT/args.device_name/('build-'+args.attempt+'.json')).read_text());assert build['exit_code']==0 and build['source_stable']
def adb(*parts,binary=False):
    p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*parts],capture_output=True,timeout=120)
    assert p.returncode==0,p.stderr.decode(errors='replace')
    return p.stdout if binary else p.stdout.decode('utf8',errors='replace')
assert adb('shell','getprop','ro.product.model').strip()=='SM-S9360'
assert ('package:'+PKG) in adb('shell','pm','list','packages','--user','0',PKG).splitlines()
assert not any('uk.thewyj.app/' in adb('shell','settings','--user','0','get','secure',key)
               for key in ['enabled_notification_listeners','enabled_accessibility_services'])
record={'started':datetime.now(timezone.utc).isoformat(),'scope':'Owned QA package update only','formal_app_modified':False}
def files(raw):
    with tarfile.open(fileobj=io.BytesIO(raw)) as stream:
        return {member.name:hashlib.sha256(stream.extractfile(member).read()).hexdigest() for member in stream.getmembers() if member.isfile()}
try:
    # Stop this owned synthetic process before taking a consistent cold copy.
    adb('shell','am','force-stop','--user','0',PKG)
    before=adb('exec-out','run-as',PKG,'tar','-cf','-','files','databases','shared_prefs',binary=True)
    backup=OUT/'private'/('phone-before-'+args.device_name+'.tar')
    with backup.open('xb') as stream:stream.write(before)
    prior=files(before)
    for entry in build['artifacts']:
        path=ROOT/entry['path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
        badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(path)],text=True,encoding='utf8',errors='replace')
        assert re.search(r"package: name='([^']+)'",badging)[1] in {PKG,PKG+'.p03acceptance'}
        assert 'Success' in adb('install','--user','0','-r','-t',str(path))
    after=files(adb('exec-out','run-as',PKG,'tar','-cf','-','files','databases','shared_prefs',binary=True))
    changed=[name for name,sha in prior.items() if after.get(name)!=sha]
    record.update(backup_sha256=hashlib.sha256(before).hexdigest(),files_preserved=len(prior)-len(changed),changed_files=changed,
                  artifacts=build['artifacts'],source=json.loads((OUT/args.device_name/'source-overlay.json').read_text())['source_commit'])
    assert not changed,'QA data changed across update; preserve backup and inspect'
    record['status']='PASS'
except Exception as error:record.update(status='FAIL',error=str(error));raise
finally:
    record['finished']=datetime.now(timezone.utc).isoformat()
    with dest.open('x',encoding='utf8') as stream:json.dump(record,stream,indent=2)
    print(json.dumps(record))
