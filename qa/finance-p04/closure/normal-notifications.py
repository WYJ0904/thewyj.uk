"""Real OS callbacks outside instrumentation; original instrumented failures remain."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib
import argparse
import json
import subprocess
import time

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
PKG='uk.thewyj.app.qa.financep04closure'
parser=argparse.ArgumentParser();parser.add_argument('--name',default='normal-notifications');args=parser.parse_args()
assert __import__('re').fullmatch('[a-z0-9-]+',args.name)
TAG='FINANCE_P04_NORMAL_'+args.name.upper().replace('-','_')
target=OUT/(args.name+'.json')
assert not target.exists()
def adb(*args):
    result=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*args],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=30)
    assert result.returncode==0,result.stderr
    return result.stdout
def broadcast(operation,variant=0):
    return adb('shell','am','broadcast','-n',PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver',
               '--es','operation',operation,'--es','tag',TAG,'--ei','variant',str(variant))
def read(name):return adb('shell','run-as',PKG,'cat','files/finance-p04-closure/'+name)
def events():return [json.loads(s) for s in read('platform.ndjson').splitlines() if s.strip()]
def snapshot():
    broadcast('snapshot')
    return json.loads(read('notification-snapshot.json'))
def wait_event(kind,count):
    start=time.monotonic()
    while time.monotonic()-start<10:
        rows=[r for r in events() if r.get('tag')==TAG and r.get('event')==kind]
        if len(rows)>=count:return round(time.monotonic()-start,3)
        time.sleep(.1)
    raise AssertionError(f'Missing actual {kind} callback {count}')
before=snapshot();result={'started_utc':datetime.now(timezone.utc).isoformat(),'before':before,'mode':'normal process, no instrumentation','status':'NOT_TESTED'}
timings=[]
try:
    assert before['own_accessibility_enabled'] and before['own_accessibility_connected']
    assert before['notifications_enabled'] and before['formal_bookings']==3
    for variant,count in [(0,1),(0,2),(1,3)]:
        broadcast('post',variant);timings.append({'action':'post','variant':variant,'callback_seconds':wait_event('posted',count)})
    broadcast('cancel');timings.append({'action':'cancel','callback_seconds':wait_event('removed',1)})
    broadcast('post');timings.append({'action':'repost','callback_seconds':wait_event('posted',4)})
    after=snapshot()
    assert after['formal_bookings']==before['formal_bookings']
    assert after['net_expense_minor']==15000
    assert any(row['tag']==TAG for row in after['archived'])
    rows=[r for r in events() if r.get('tag')==TAG]
    assert len({r['key_sha256'] for r in rows if r['event']=='posted'})==1
    assert all(r.get('notification_when',1)>1_700_000_000_000 for r in rows if r['event']=='posted')
    result.update(status='PASS',after=after,observations=rows,actions=timings,
                  actual_os_callbacks=True,actual_room_archive=True,expense_delta=0,real_wechat=False,
                  qa_accessibility_bound=True,original_instrumentation_results='2 FAIL retained separately')
except Exception as error:
    result.update(status='FAIL',error=str(error),actions=timings)
finally:
    broadcast('cancel')
    result['finished_utc']=datetime.now(timezone.utc).isoformat()
    with target.open('x',encoding='utf8') as stream:json.dump(result,stream,ensure_ascii=False,indent=2)
    print(json.dumps({'status':result['status'],'actions':timings,'error':result.get('error')},ensure_ascii=False))
raise SystemExit(int(result['status']!='PASS'))
