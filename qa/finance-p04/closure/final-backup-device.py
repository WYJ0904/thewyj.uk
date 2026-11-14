"""Repeat the four-component fixture while preserving the live QA currency preference byte-for-byte."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
PKG='uk.thewyj.app.qa.financep04closure'
target=OUT/'samsung-final-backup-guard.json';assert not target.exists()
assert json.loads((OUT/'owned-phone-install.json').read_text())['package']==PKG
def adb(*parts,data=None):
    p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*parts],input=data,capture_output=True,timeout=30)
    assert p.returncode==0,p.stderr.decode(errors='replace');return p.stdout
pref='shared_prefs/wyj-currency-context.xml'
adb('shell','am','force-stop','--user','0',PKG)
before=adb('exec-out','run-as',PKG,'cat',pref)
preferences=ET.fromstring(before)
assert preferences.tag=='map' and len(preferences)>0
assert all(node.tag=='string' and node.get('name') in {'synthetic-p03-device-owner:default','synthetic-backup-owner:default'}
           and node.text in {'CNY','USD','EUR','HKD','GBP','JPY'} for node in preferences),'Only the known synthetic QA currency preferences may be temporarily isolated'
backup=OUT/'private/currency-context-before-final-backup.xml';assert not backup.exists();backup.write_bytes(before)
record={'started':datetime.now(timezone.utc).isoformat(),'scope':'Only the newly owned QA app currency preference; no formal app data or permission change',
        'original_preference_sha256':hashlib.sha256(before).hexdigest(),'rows':[],'status':'NOT_TESTED'}
try:
    # The original backup fixture requires its own preference namespace to be empty.
    # A verified copy above is restored in finally; all Room/outbox data is retained.
    adb('shell','run-as',PKG,'rm',pref)
    for step,klass in [('seed','CurrencyP04BackupSeedTest'),('restore','CurrencyP04BackupRestoreTest')]:
        name='samsung-final-backup-'+step+'-r1'
        result=subprocess.run([sys.executable,str(ROOT/'qa/finance-p04/closure/phone.py'),'run','--name',name,'--class-name','uk.thewyj.app.finance.'+klass],cwd=ROOT,capture_output=True,text=True)
        detail=json.loads((OUT/(name+'.json')).read_text());record['rows'].append({'step':step,'status':detail['status'],'counts':detail.get('counts',{}),'evidence':name+'.json'})
        if result.returncode:break
    record['status']='PASS' if len(record['rows'])==2 and all(row['status']=='PASS' for row in record['rows']) else 'FAIL'
finally:
    adb('shell','am','force-stop','--user','0',PKG)
    adb('shell','-T','run-as',PKG,'dd','of='+pref,data=before)
    actual=adb('exec-out','run-as',PKG,'cat',pref)
    record['original_preference_restored']=actual==before
    record['finished']=datetime.now(timezone.utc).isoformat()
    target.write_text(json.dumps(record,indent=2));print(json.dumps(record))
    assert actual==before,'Retain original preference backup; restoration did not match'
assert record['status']=='PASS'
