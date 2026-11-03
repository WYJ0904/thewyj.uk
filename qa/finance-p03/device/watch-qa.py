"""Bounded read-only QA PID/kernel/helper sampling; no signals or policy edits."""
from pathlib import Path
import datetime,json,subprocess,time
import phone
OUT=Path(__file__).resolve().parents[3]/'docs/migration-evidence/finance-p03/device'
dest=OUT/'lifecycle-watch1.ndjson';assert not dest.exists();s=phone.device()
def call(*args):
    r=subprocess.run([str(phone.ADB),'-s',s,*args],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=8)
    return r.returncode,r.stdout,r.stderr
for i in range(22):
    t=time.monotonic();_,pid,_=call('shell','pidof','-s',phone.PKG);pid=pid.strip();r={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sample':i,'qa_pid':int(pid) if pid.isdigit() else None}
    if pid.isdigit():
        code,wchan,err=call('shell','run-as',phone.PKG,'cat',f'/proc/{pid}/task/{pid}/wchan');r.update(main_wchan=wchan.strip(),wchan_exit=code)
        _,raw,_=call('shell','dumpsys','activity','activities');r['activity_dump_bytes']=len(raw);r['owned_helper_lines']=[x.strip() for x in raw.splitlines() if phone.PKG in x and 'InstrumentationActivityInvoker' in x][:8]
        _,raw,_=call('shell','dumpsys','window','policy');r['policy_dump_bytes']=len(raw);r['keyguard_boolean_lines']=[x.strip() for x in raw.splitlines() if any(k in x for k in ['isKeyguardShowing=','mShowingLockscreen=','mKeyguardShowing=','mScreenOnFully=']) and not any(k in x for k in ['title','package','owner'])][:8]
        _,raw,_=call('exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/platform.ndjson')
        events=[]
        for line in raw.splitlines():
            try:v=json.loads(line)
            except ValueError:continue
            if v.get('event')=='main_lifecycle':events.append(v)
        r['main_lifecycle_tail']=events[-5:]
    with dest.open('a',encoding='utf8') as f:f.write(json.dumps(r)+'\n')
    if i%5==0:print(json.dumps({'sample':i,'qa_pid':r['qa_pid'],'main_wchan':r.get('main_wchan')}),flush=True)
    time.sleep(max(0,2-(time.monotonic()-t)))
