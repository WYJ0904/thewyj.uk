"""Maintenance only: cancel this run's known synthetic notifications.

Reads only the installed QA's own metadata log. Never enumerates private active
notifications or changes permissions. Capture disabling is a separate compiled
maintenance method after this ordinary-mode cleanup has completed.
"""
from pathlib import Path
import argparse,hashlib,json,re,subprocess,sys,time
sys.dont_write_bytecode=True
import phone

parser=argparse.ArgumentParser();parser.add_argument('--name',default='phone-notification-cleanup');args=parser.parse_args()
assert re.fullmatch(r'[a-z0-9-]+',args.name)
out=phone.OUT;dest=out/args.name;dest.mkdir(exist_ok=False)
s=phone.device();state=phone.state(s)
assert not state['formal_nls_enabled'] and state['qa_nls_enabled']
owned=json.loads((out/'owned-install.json').read_text())
assert owned['package']==phone.PKG and owned['device_sha256']==hashlib.sha256(s.encode()).hexdigest()
assert (out/'accessibility-normal-owner-confirmed.json').is_file(), 'Finish ordinary binding verification before cleanup'

def own(name):
    r=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=10)
    assert r.returncode==0
    return r.stdout.decode('utf8')

def rows():return [json.loads(line) for line in own('platform.ndjson').splitlines() if line.strip()]

def control(op,tag=''):
    assert not phone.state(s)['formal_nls_enabled']
    assert not tag or re.fullmatch(r'FINANCE_P03_[A-Za-z0-9_]+',tag)
    command=['-s',s,'shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op]
    if tag:command+=['--es','tag',tag]
    text=phone.run(*command)
    with (dest/'commands.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps({'operation':op,'tag':tag,'output':text})+'\n')

before=rows();(dest/'platform-before.ndjson').write_text('\n'.join(json.dumps(r) for r in before)+'\n',encoding='utf8')
tags={r['tag'] for r in before if r.get('tag','').startswith('FINANCE_P03_')}
assert all(re.fullmatch(r'FINANCE_P03_[A-Za-z0-9_]+',tag) for tag in tags)
# The failed recovery sender posted a second, fixed shell tag after force-stop.
# It was not observed by NLS. Repost only that exact self-generated slot to make
# its key known to the privacy gate before cancelling it; no unrelated source.
missed={tag[:-len('_BACKGROUND')]+'_RESTART' for tag in tags if re.fullmatch(r'FINANCE_P03_AB_[A-F0-9]{10}_BACKGROUND',tag)}
control('bind')
replays=[]
for tag in sorted(missed):
    assert not phone.state(s)['formal_nls_enabled']
    output=phone.run('-s',s,'shell','cmd','notification','post','-t','P03_SYNTHETIC',tag,'P03_SYNTHETIC_ONLY')
    with (dest/'commands.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps({'operation':'repost-exact-owned-shell-slot-for-cleanup','tag':tag,'output':output})+'\n')
    limit=time.monotonic()+10
    while time.monotonic()<limit:
        if any(r.get('tag')==tag and r.get('event')=='posted' for r in rows()):break
        time.sleep(.1)
    else:raise AssertionError('Unable to register exact owned shell slot for cleanup')
    replays.append(tag)
tags|=missed
for tag in sorted(tags):control('cancel',tag)
limit=time.monotonic()+10
while True:
    after=rows();last={}
    for r in after:
        if r.get('tag') in tags and r.get('event') in ['posted','removed']:last[(r['package'],r['tag'])]=r['event']
    unmatched=[{'package':pkg,'tag':tag} for (pkg,tag),event in last.items() if event=='posted']
    # Old process/update callback gaps cannot prove an app notification remains
    # active. Its own NotificationManager supplies the current app state below.
    remaining=[r for r in unmatched if r['package']=='com.android.shell']
    if not remaining or time.monotonic()>=limit:break
    time.sleep(.1)
control('snapshot');time.sleep(.2);snapshot=json.loads(own('notification-snapshot.json'))
(dest/'platform-after.ndjson').write_text('\n'.join(json.dumps(r) for r in after)+'\n',encoding='utf8')
(dest/'owned-snapshot.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf8')
result={'status':'CLEANED' if not remaining and not snapshot['own_active'] else 'INCOMPLETE','kind':'maintenance, excluded from business test counts','utc':phone.now(),'tags':sorted(tags),'reposted_exact_owned_shell_slots':replays,'unmatched_historical_posts':unmatched,'remaining_owned_shell_posts':remaining,'own_active_count':len(snapshot['own_active']),'qa_ledger_rows':snapshot['formal_bookings'],'net_expense_minor':snapshot['net_expense_minor'],'private_notifications_enumerated':False,'permissions_changed':False,'app_data_cleared':False}
(dest/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False));assert result['status']=='CLEANED'
