"""Unchanged native screen test; normal swipe only when extended unlock allows it.

No PIN, password, credential input, security setting, or lockscreen capture.
The original 20-second native assertions are unchanged.
"""
from pathlib import Path
import datetime,json,re,subprocess,sys,time
sys.dont_write_bytecode=True
import phone
dest=phone.OUT/'screen-normal-ui.json';assert not dest.exists()
s=phone.device();assert not phone.state(s)['formal_nls_enabled']
size=phone.run('-s',s,'shell','wm','size');m=re.search(r'(?:Override|Physical) size: (\d+)x(\d+)',size);assert m
w,h=map(int,m.groups());start=time.monotonic();observations=[];swipes=0
p=subprocess.Popen([sys.executable,str(Path(__file__).with_name('phone.py')),'instrument','--name','phone-screen-final',
    '--class-name','uk.thewyj.app.qa.finance.FinanceDeviceScreenTest','--watchdog','100'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
while p.poll() is None:
    # Read public booleans only, not the active-window hierarchy or its text.
    policy=phone.run('-s',s,'shell','dumpsys','window','policy')
    def boolean(name):
        match=re.search(r'^\s*'+name+r'=(true|false)\s*$',policy,re.M)
        return match[1]=='true' if match else None
    showing=boolean('showing');restricted=boolean('inputRestricted')
    interactive='interactiveState=INTERACTIVE_STATE_AWAKE' in policy
    row={'at_ms':round((time.monotonic()-start)*1000),'showing':showing,'input_restricted':restricted,'interactive':interactive}
    observations.append(row)
    if interactive and showing is True and restricted is False and swipes<2:
        assert not phone.state(s)['formal_nls_enabled']
        # Ordinary lockscreen gesture; credential-required keyguards are left alone.
        phone.run('-s',s,'shell','input','swipe',str(w//2),str(h*4//5),str(w//2),str(h//4),'350')
        row['normal_extended_unlock_swipe']=True;swipes+=1
    time.sleep(.3)
stdout,stderr=p.communicate(timeout=10)
result={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'QA screen and public keyguard booleans only',
    'normal_swipes':swipes,'no_credentials_entered':True,'no_security_policy_changes':True,'observations':observations,
    'driver_exit':p.returncode,'native_result':'phone-screen-final.json'}
dest.write_text(json.dumps(result,indent=2),encoding='utf8')
print(stdout.decode('utf8',errors='replace'));print(stderr.decode('utf8',errors='replace'))
if p.returncode:raise SystemExit(p.returncode)
