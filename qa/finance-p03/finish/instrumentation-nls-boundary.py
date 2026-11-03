"""Three controlled ordinary-mode / instrumentation / ordinary-relaunch sequences.

Records the Android stopped bit and actual callbacks. This experiment never
changes notification grants and does not count expected diagnostic absences as
business passes or as proof of automatic OS recovery.
"""
from pathlib import Path
import json,re,subprocess,sys,time,uuid
sys.dont_write_bytecode=True
import phone
s=phone.device();assert not phone.state(s)['formal_nls_enabled']
dest=phone.OUT/'nls-instrumentation-boundary';dest.mkdir(exist_ok=False)
prefix='FINANCE_P03_BOUNDARY_'+uuid.uuid4().hex[:10].upper();rows=[]
def execute(*args):
    assert not phone.state(s)['formal_nls_enabled']
    return phone.run('-s',s,*args)
def state():
    text=phone.run('-s',s,'shell','dumpsys','package',phone.PKG)
    line=next(t for t in text.splitlines() if re.match(r'\s*User 0:.*installed=',t))
    return {k:re.search(r'\b'+k+r'=(true|false)',line)[1]=='true' for k in ['installed','stopped','notLaunched']}
def logs():
    r=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/platform.ndjson'],capture_output=True,timeout=15)
    assert r.returncode==0
    return [json.loads(line) for line in r.stdout.decode('utf8').splitlines() if line.strip()]
def post(tag):
    execute('shell','cmd','notification','post','-t','P03_SYNTHETIC',tag,'P03_SYNTHETIC_ONLY')
    start=time.monotonic();end=start+10
    while time.monotonic()<end:
        found=[r for r in logs() if r.get('event')=='posted' and r.get('tag')==tag]
        if found:return {'observed':True,'elapsed_ms':round((time.monotonic()-start)*1000,2),'callback':found[-1]}
        time.sleep(.1)
    return {'observed':False,'elapsed_ms':round((time.monotonic()-start)*1000,2),'deadline_seconds':10,'tag':tag}
def start():
    execute('shell','am','start','--user','0','-n',phone.PKG+'/uk.thewyj.app.MainActivity','-d','thewyj://app?route=%2Ffinance')
    execute('shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation','bind')
for n in range(1,4):
    start();before=state();normal=post(prefix+f'_{n}_BEFORE')
    name=f'phone-nls-boundary-{n}'
    p=subprocess.run([sys.executable,str(Path(__file__).with_name('phone.py')),'instrument','--name',name,
        '--class-name','uk.thewyj.app.qa.finance.FinanceDeviceRestoreTest','--watchdog','60'],capture_output=True,encoding='utf8')
    (dest/(name+'-driver.log')).write_text(p.stdout+p.stderr,encoding='utf8')
    after_instrument=state()
    execute('shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation','bind')
    after_receiver=state();during=post(prefix+f'_{n}_AFTER_INSTRUMENT')
    start();after_start=state();recovered=post(prefix+f'_{n}_AFTER_NORMAL_START')
    row={'round':n,'before':before,'normal_before':normal,'instrumentation_exit':p.returncode,
        'after_instrumentation':after_instrument,'after_include_stopped_receiver':after_receiver,
        'callback_after_instrumentation':during,'after_normal_start':after_start,'normal_recovered':recovered}
    rows.append(row);(dest/'runs.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(row,ensure_ascii=False),flush=True)
(dest/'platform.ndjson').write_text('\n'.join(json.dumps(r) for r in logs())+'\n',encoding='utf8')
stopped_proof=all(r['after_instrumentation']['stopped'] and r['after_include_stopped_receiver']['stopped'] and not r['after_normal_start']['stopped'] for r in rows)
pattern=all(r['normal_before']['observed'] and not r['callback_after_instrumentation']['observed'] and r['normal_recovered']['observed'] for r in rows)
result={'rounds':3,'pattern_reproduced_in_all_three':pattern,'stopped_bit_causal_chain_confirmed':stopped_proof,
    'ordinary_relaunch_new_key_passes':sum(r['normal_recovered']['observed'] for r in rows),
    'automatic_os_lmk_or_unseen_backlog':'NOT TESTED','historical_activity_stopped_failure':'UNRESOLVED',
    'conclusion':'QA instrumentation boundary requires explicit normal app launch before ordinary-mode acceptance; no product fix justified' if stopped_proof and pattern else 'INCONCLUSIVE; inspect each controlled transition'}
(dest/'summary.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result),flush=True)
