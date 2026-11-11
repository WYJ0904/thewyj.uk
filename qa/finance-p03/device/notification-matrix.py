"""Real OS callbacks driven outside instrumentation. Synthetic sources only."""
from pathlib import Path
import argparse,datetime,json,subprocess,time,uuid
import phone
OUT=Path(__file__).resolve().parents[3]/'docs/migration-evidence/finance-p03/device'
def main():
    p=argparse.ArgumentParser();p.add_argument('--name',required=True);a=p.parse_args();dest=OUT/a.name;dest.mkdir(exist_ok=False)
    s=phone.device();state=phone.state(s);assert not state['formal_nls_enabled'] and state['qa_nls_enabled']
    prefix='FINANCE_P03_'+uuid.uuid4().hex[:12].upper();results=[];started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    def own(name):
        proc=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=10)
        return proc.stdout.decode('utf8') if proc.returncode==0 else ''
    def observations(tag):
        return [v for line in own('platform.ndjson').splitlines() if line.strip() for v in [json.loads(line)] if v.get('tag')==tag and v.get('event') in ['posted','removed']]
    def wait(tag,event,n):
        end=time.monotonic()+10
        while time.monotonic()<end:
            rows=observations(tag)
            if sum(r['event']==event for r in rows)>=n:return rows
            time.sleep(.1)
        raise AssertionError(f'Actual OS callback missing: {tag} {event} #{n}')
    def control(op,tag='',variant=0):
        output=phone.run('-s',s,'shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op,'--es','tag',tag,'--ei','variant',str(variant))
        with (dest/'commands.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps({'operation':op,'tag':tag,'variant':variant,'output':output})+'\n')
        return output
    def case(key,fn):
        begin=time.monotonic();row={'case_id':key,'synthetic_only':True}
        try:row.update(status='PASS',actual=fn())
        except Exception as e:row.update(status='FAIL',error=repr(e))
        row['elapsed_ms']=round((time.monotonic()-begin)*1000,2);results.append(row)
        with (dest/'results.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(json.dumps(row,ensure_ascii=False),flush=True)
    control('bind')
    tag=prefix+'_OWN'
    case('OS01-OWN-SOURCE-OUTSIDE-INSTRUMENTATION',lambda:(control('post',tag),wait(tag,'posted',1))[1])
    case('OS02-SAME-SLOT-MONEY-UPDATE',lambda:(control('post',tag,1),wait(tag,'posted',2))[1])
    case('OS03-OWNED-REMOVAL',lambda:(control('cancel',tag),wait(tag,'removed',1))[1])
    case('OS04-REMOVED-SLOT-REPOST',lambda:(control('post',tag),wait(tag,'posted',3))[1])
    case('OS05-IDENTICAL-SLOT-REDRIVE',lambda:(control('post',tag),wait(tag,'posted',4))[1])
    pair=prefix+'_PAIR'
    def independent():
        control('post-pair',pair);first=wait(pair,'posted',1);second=wait(pair+'_SECOND','posted',1)
        assert first[-1]['key_sha256']!=second[-1]['key_sha256']
        return {'first':first,'second':second,'actual_post_time_gap_ms':abs(first[-1]['post_time']-second[-1]['post_time']),'financial_independence_proven':False}
    case('OS06-SAME-AMOUNT-IMMEDIATE-PAIR',independent)
    shell=prefix+'_SHELL'
    case('OS07-OTHER-UID-SOURCE',lambda:(phone.run('-s',s,'shell','cmd','notification','post','-t','P03_SYNTHETIC',shell,'P03_SYNTHETIC_ONLY'),wait(shell,'posted',1))[1])
    def snapshot():
        control('snapshot');end=time.monotonic()+10;data=None
        while time.monotonic()<end:
            try:data=json.loads(own('notification-snapshot.json'))
            except ValueError:time.sleep(.1);continue
            if any(r['tag'].startswith(prefix) for r in data['archived']):break
            time.sleep(.1)
        assert data and data['formal_bookings']==3 and data['net_expense_minor']==15000,data
        assert any(r['tag'].startswith(prefix) for r in data['archived']),data
        return data
    case('OS08-REAL-ROOM-ARCHIVE-AND-NO-UNPROVEN-FORMAL-EXPENSE',snapshot)
    (dest/'platform.ndjson').write_text(own('platform.ndjson'),encoding='utf8')
    summary={'started_utc':started,'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'prefix':prefix,'device_alias':'Samsung-P03','PASS':sum(r['status']=='PASS' for r in results),'FAIL':sum(r['status']=='FAIL' for r in results),'scope':'Actual Samsung NLS/Room, own QA and adb shell notifications. No WeChat/Alipay business proof','product_changes':0,'instrumentation_sender_failure_preserved':'device-notification1.log','callback_watchdog_seconds':10}
    (dest/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8');print(json.dumps(summary),flush=True)
    if summary['FAIL']:raise SystemExit(1)
if __name__=='__main__':main()
