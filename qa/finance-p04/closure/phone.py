"""Narrow owned-package ADB operations and fresh per-attempt device evidence."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re
import subprocess
import time

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
DEVICE=OUT/'device-final'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
AAPT=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.0.0/aapt2.exe'
PKG='uk.thewyj.app.qa.financep04closure'
TEST=PKG+'.p03acceptance'
SERIAL='R5CY22MEHJN'
def run(*args,timeout=30):
    p=subprocess.run([str(ADB),'-s',SERIAL,*args],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=timeout)
    assert p.returncode==0,p.stderr
    return p.stdout
def installed(pkg):return ('package:'+pkg) in run('shell','pm','list','packages','--user','0',pkg).splitlines()
def state():
    a=run('shell','settings','--user','0','get','secure','enabled_accessibility_services')
    n=run('shell','settings','--user','0','get','secure','enabled_notification_listeners')
    formal=run('shell','dumpsys','package','uk.thewyj.app')
    lines=[s.strip() for s in formal.splitlines() if 'versionCode=' in s or 'versionName=' in s]
    return {'model':run('shell','getprop','ro.product.model').strip(),'sdk':run('shell','getprop','ro.build.version.sdk').strip(),
            'current_user':run('shell','am','get-current-user').strip(),'formal_version':lines,
            'formal_a11y_granted':'uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService' in a,
            'formal_nls_granted':'uk.thewyj.app/uk.thewyj.app.task21.ThewyjNotificationListenerService' in n,
            'qa_a11y_granted':PKG+'/' in a,'qa_nls_granted':PKG+'/' in n,
            'qa_installed':installed(PKG),'test_installed':installed(TEST)}
parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['audit','install','grant-notifications','run','owned-stop'])
parser.add_argument('--name',required=True)
parser.add_argument('--class-name')
parser.add_argument('--watchdog',type=int,default=180)
args=parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',args.name)
dest=OUT/(args.name+'.json');assert not dest.exists()
before=state()
assert before['model']=='SM-S9360' and before['sdk']=='36' and before['current_user']=='0'
record={'started_utc':datetime.now(timezone.utc).isoformat(),'action':args.action,'before':before,'status':'NOT_TESTED'}
try:
    if args.action=='install':
        assert not before['qa_installed'] and not before['test_installed'],'Never replace an existing unowned package'
        info=json.loads((DEVICE/'build-r2.json').read_text(encoding='utf8'))
        assert info['exit_code']==0 and info['source_stable']
        for entry in info['artifacts']:
            path=ROOT/entry['path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
            badging=subprocess.check_output([str(AAPT),'dump','badging',str(path)],text=True,encoding='utf8',errors='replace')
            match=re.search(r"package: name='([^']+)'",badging);assert match and match.group(1) in {PKG,TEST}
            assert 'Success' in run('install','--user','0','-t',str(path),timeout=120)
        run('reverse','tcp:19443','tcp:19443')
        (OUT/'owned-phone-install.json').write_text(json.dumps({'package':PKG,'test_package':TEST,'serial_sha256':hashlib.sha256(SERIAL.encode()).hexdigest(),'artifacts':info['artifacts']},indent=2),encoding='utf8')
        record['status']='PASS'
    elif args.action in {'run','owned-stop','grant-notifications'}:
        owned=json.loads((OUT/'owned-phone-install.json').read_text(encoding='utf8'))
        assert owned['package']==PKG and before['qa_installed']
        assert not before['formal_nls_granted'],'Do not feed synthetic notifications into the formal archive'
        if args.action=='owned-stop':
            run('shell','am','force-stop','--user','0',PKG);record['status']='PASS'
        elif args.action=='grant-notifications':
            run('shell','pm','grant',PKG,'android.permission.POST_NOTIFICATIONS')
            record['normal_os_command']=run('shell','cmd','notification','allow_listener',PKG+'/uk.thewyj.app.task21.ThewyjNotificationListenerService','0')
            after=state();assert after['qa_nls_granted'];record['status']='GRANTED_PENDING_BINDING_TEST'
        else:
            assert args.class_name and re.fullmatch(r'[A-Za-z0-9_.#]+',args.class_name)
            assert args.class_name.startswith(('uk.thewyj.app.qa.finance.','uk.thewyj.app.finance.CurrencyP04Backup'))
            start=time.monotonic()
            command=['shell','am','instrument','-w','-r','-e','class',args.class_name,TEST+'/uk.thewyj.app.qa.finance.FinanceDeviceRunner']
            record['command']=[str(ADB),'-s',SERIAL,*command]
            try:
                text=run(*command,timeout=args.watchdog)
                (OUT/(args.name+'.log')).write_text(text,encoding='utf8')
                codes=[int(v) for v in re.findall(r'^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$',text,re.M)]
                record['counts']={'PASS':codes.count(0),'FAIL':codes.count(-1)+codes.count(-2),'SKIP':codes.count(-3)+codes.count(-4)}
                record['status']='PASS' if re.search(r'OK \(\d+ tests?\)',text) and not record['counts']['FAIL'] and not record['counts']['SKIP'] else 'FAIL'
            except subprocess.TimeoutExpired as error:
                raw=error.stdout or b''
                (OUT/(args.name+'.log')).write_bytes(raw if isinstance(raw,bytes) else raw.encode('utf8'))
                record['status']='WATCHDOG'
                # Never terminate the formal app or other QA packages.
                run('shell','am','force-stop','--user','0',PKG)
            record['seconds']=round(time.monotonic()-start,3)
    else:record['status']='READ_ONLY_AUDIT'
except Exception as error:
    record.update(status='BLOCKED',error=str(error));raise
finally:
    record['after']=state()
    record['finished_utc']=datetime.now(timezone.utc).isoformat()
    with dest.open('x',encoding='utf8') as stream:json.dump(record,stream,ensure_ascii=False,indent=2)
    print(json.dumps(record,ensure_ascii=False))
raise SystemExit(0 if record['status'] in {'PASS','READ_ONLY_AUDIT','GRANTED_PENDING_BINDING_TEST'} else 1)
