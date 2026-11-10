"""Remove exactly this run's four owned APKs after verifying the cold evidence seal."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, re, subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
PKG='uk.thewyj.app.qa.financep04closure'
HELPER='uk.thewyj.app.qa.financep04navigator'
PACKAGES=[PKG+'.p03acceptance',HELPER+'.test',PKG,HELPER]
target=OUT/'phone-cleanup-r1.json';assert not target.exists()
seal=json.loads((OUT/'phone-final-data-seal.json').read_text());assert seal['status']=='PASS'
archive=OUT/'private/phone-final-cold.tar'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==seal['archive_sha256']
assert len(seal['receipt_cipher_recovery'])>=8
assert (OUT/'owned-phone-install.json').exists() and (OUT/'navigator-owned.json').exists()
def adb(*parts):
    p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*parts],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=60)
    assert p.returncode==0,p.stderr
    return p.stdout.strip()
def packages():return set(adb('shell','pm','list','packages','--user','0').splitlines())
def permissions():return {'a11y':adb('shell','settings','--user','0','get','secure','enabled_accessibility_services'),'nls':adb('shell','settings','--user','0','get','secure','enabled_notification_listeners')}
record={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','owned_packages':PACKAGES,'formal_data_operation':False,'steps':[]}
try:
    assert adb('shell','getprop','ro.product.model')=='SM-S9360'
    assert adb('shell','am','get-current-user')=='0'
    before=packages();record['before_permissions']=permissions()
    assert all('package:'+p in before for p in PACKAGES)
    formal_before=adb('shell','dumpsys','package','uk.thewyj.app')
    record['formal_before']=[s.strip() for s in formal_before.splitlines() if 'versionCode=' in s or 'versionName=' in s or 'userId=' in s]
    assert any('versionName=1.3.37' in s for s in record['formal_before'])
    assert 'uk.thewyj.app/' not in record['before_permissions']['nls']
    apk=adb('shell','pm','path',PKG).removeprefix('package:')
    assert re.fullmatch('/data/app/[A-Za-z0-9_+=./~-]+/base.apk',apk)
    assert adb('shell','sha256sum',apk).split()[0]==seal['product_apk_sha256']
    record['steps'].append({'disallow_owned_listener':adb('shell','cmd','notification','disallow_listener',PKG+'/uk.thewyj.app.task21.ThewyjNotificationListenerService','0')})
    record['steps'].append({'revoke_owned_post_notifications':adb('shell','pm','revoke',PKG,'android.permission.POST_NOTIFICATIONS')})
    for p in PACKAGES:
        result=adb('uninstall',p);assert result=='Success',result
        record['steps'].append({'uninstalled':p,'result':result})
    after=packages();assert before-after=={'package:'+p for p in PACKAGES};assert after-before==set()
    record['only_owned_packages_removed']=True
    record['after_permissions']=permissions()
    assert all(p not in json.dumps(record['after_permissions']) for p in [PKG,HELPER])
    formal_after=adb('shell','dumpsys','package','uk.thewyj.app')
    record['formal_after']=[s.strip() for s in formal_after.splitlines() if 'versionCode=' in s or 'versionName=' in s or 'userId=' in s]
    assert record['formal_after']==record['formal_before']
    reverses=adb('reverse','--list');record['reverse_before']=reverses
    if any('tcp:19443 tcp:19443' in s for s in reverses.splitlines()):
        adb('reverse','--remove','tcp:19443')
    record['reverse_after']=adb('reverse','--list')
    paths=set()
    for line in (OUT/'execution.ndjson').read_text(encoding='utf8').splitlines():
        row=json.loads(line)
        if row.get('phone_temp'):paths.add(row['phone_temp'])
    for p in sorted(paths):
        assert re.fullmatch('/data/local/tmp/finance-p04-[a-z0-9-]+\\.xml',p)
        adb('shell','rm','-f',p)
    record.update(status='PASS',owned_phone_temp_files=len(paths),formal_a11y_restore='PENDING_NORMAL_SETTINGS',formal_nls_remains_disabled=True)
except Exception as error:
    record.update(status='FAIL',error=str(error));raise
finally:
    record['finished_utc']=datetime.now(timezone.utc).isoformat()
    target.write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in record.items() if k not in {'before_permissions','after_permissions','reverse_before','reverse_after'}}))
