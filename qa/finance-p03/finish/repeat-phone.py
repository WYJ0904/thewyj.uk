"""Repeat the unchanged original six-method continuous matrix, preserving every run."""
from pathlib import Path
import datetime,json,subprocess,sys,time
sys.dont_write_bytecode=True
import phone

def main():
    dest=phone.OUT/'continuous-thirty'
    dest.mkdir(exist_ok=False)
    rows=[]
    classes=','.join('uk.thewyj.app.qa.finance.'+n for n in [
        'FinanceDeviceMigrationTest','FinanceDeviceNotificationTest',
        'FinanceDeviceMainTest','FinanceDeviceRestoreTest'])
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    for index in range(1,31):
        name=f'continuous-final-{index:02d}'
        start=time.monotonic()
        proc=subprocess.run([sys.executable,str(Path(__file__).with_name('phone.py')),
            'instrument','--name',name,'--class-name',classes,'--watchdog','180'],
            capture_output=True,text=True,encoding='utf8',errors='replace')
        (dest/(name+'-driver.log')).write_text(proc.stdout+proc.stderr,encoding='utf8')
        file=phone.OUT/(name+'.json')
        row=json.loads(file.read_text()) if file.exists() else {'status':'BLOCKED','reason':'driver produced no result'}
        row.update(group=index,driver_exit=proc.returncode,total_seconds=round(time.monotonic()-start,3))
        rows.append(row)
        (dest/'runs.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'group':index,'status':row['status'],'counts':row.get('counts'),
            'elapsed_seconds':row.get('elapsed_seconds'),'driver_exit':proc.returncode}),flush=True)
        if row['status'] in ['BLOCKED','WATCHDOG']:
            # A disconnected/unsafe device must never be replaced by a different target.
            break
    summary={'started_utc':started,'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'requested_groups':30,'executed_groups':len(rows),'six_methods_per_group':True,
        'groups_by_status':{s:sum(r['status']==s for r in rows) for s in ['PASS','FAIL','SKIP','WATCHDOG','BLOCKED']},
        'methods':{s:sum(r.get('counts',{}).get(s,0) for r in rows) for s in ['PASS','FAIL','SKIP']},
        'original_assertions_and_timeouts_unchanged':True,
        'three_main_stop_resume_recreate_rounds_per_passed_group':True,
        'historical_failure_retained':'../device/device-final-native-suite.log',
        'historical_failure_causal_conclusion':'UNRESOLVED; repeats alone cannot establish a root cause'}
    (dest/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    if len(rows)!=30 or summary['groups_by_status']['PASS']!=30:raise SystemExit(1)
if __name__=='__main__':main()
