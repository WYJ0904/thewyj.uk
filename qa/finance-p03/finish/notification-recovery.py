"""Normal-mode background and explicit owned-process relaunch, not OS LMK."""
from pathlib import Path
import argparse,json,subprocess,sys,time,uuid
sys.dont_write_bytecode=True
import phone
s=phone.device();before=phone.state(s);assert not before['formal_nls_enabled'] and before['qa_nls_enabled']
p=argparse.ArgumentParser();p.add_argument('--name',default='notification-normal-recovery');p.add_argument('--prepare-normal',action='store_true');args=p.parse_args()
assert args.name.replace('-','').isalnum()
dest=phone.OUT/args.name;dest.mkdir(exist_ok=False)
prefix='FINANCE_P03_FINISH_'+uuid.uuid4().hex[:10].upper();rows=[]
def own(name):
    p=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=15)
    assert p.returncode==0
    return p.stdout.decode('utf8')
def logs():return [json.loads(r) for r in own('platform.ndjson').splitlines() if r.strip()]
def command(*args):
    assert not phone.state(s)['formal_nls_enabled']
    value=phone.run('-s',s,*args)
    with (dest/'commands.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps({'args':args,'output':value})+'\n')
    return value
def control(op):return command('shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op)
def await_row(predicate,seconds=10):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        matches=[r for r in logs() if predicate(r)]
        if matches:return matches[-1]
        time.sleep(.1)
    raise AssertionError('No matching actual OS callback within original 10-second deadline')
def case(key,fn):
    start=time.monotonic();r={'case_id':key,'synthetic_only':True}
    try:r.update(status='PASS',actual=fn())
    except Exception as e:r.update(status='FAIL',error=repr(e))
    r['elapsed_ms']=round((time.monotonic()-start)*1000,2);rows.append(r)
    (dest/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(r,ensure_ascii=False),flush=True)
def post(tag):
    command('shell','cmd','notification','post','-t','P03_SYNTHETIC',tag,'P03_SYNTHETIC_ONLY')
    return await_row(lambda r:r.get('event')=='posted' and r.get('tag')==tag)
if args.prepare_normal:
    command('shell','am','start','--user','0','-n',phone.PKG+'/uk.thewyj.app.MainActivity','-d','thewyj://app?route=%2Ffinance')
    control('bind')
command('shell','input','keyevent','3')
case('NR01-ACTUAL-BACKGROUND-NEW-KEY',lambda:post(prefix+'_BACKGROUND'))
def relaunch():
    connected=sum(r.get('event')=='listener_connected' for r in logs())
    command('shell','am','force-stop','--user','0',phone.PKG)
    command('shell','am','start','--user','0','-n',phone.PKG+'/uk.thewyj.app.MainActivity','-d','thewyj://app?route=%2Ffinance')
    control('bind')
    end=time.monotonic()+10
    while time.monotonic()<end:
        if sum(r.get('event')=='listener_connected' for r in logs())>connected:break
        time.sleep(.1)
    else:raise AssertionError('Explicit QA relaunch/rebind did not connect within 10 seconds')
    return {'callback':post(prefix+'_AFTER_RELAUNCH'),'explicit_app_start_and_rebind':True,'automatic_os_recovery_proven':False}
case('NR02-EXPLICIT-OWNED-RELAUNCH-NEW-KEY',relaunch)
control('snapshot');time.sleep(.3)
snapshot=json.loads(own('notification-snapshot.json'))
(dest/'snapshot.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf8')
(dest/'platform.ndjson').write_text(own('platform.ndjson'),encoding='utf8')
result={'PASS':sum(r['status']=='PASS' for r in rows),'FAIL':sum(r['status']=='FAIL' for r in rows),
    'prefix':prefix,'scope':'Own synthetic notifications; explicit normal relaunch, not automatic OS LMK or unseen backlog replay',
    'finance_unchanged':snapshot['formal_bookings']==3 and snapshot['net_expense_minor']==15000}
(dest/'summary.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result));assert result['FAIL']==0 and result['finance_unchanged']
