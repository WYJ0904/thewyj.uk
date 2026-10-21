"""Delete only proved task-owned user0 QA traces, after bounded evidence export."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,time
sys.dont_write_bytecode=True
import phone
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
s=phone.device();assert not phone.state(s)['formal_nls_enabled']
owned=read(phone.OUT/'owned-install.json');assert owned['device_sha256']==hashlib.sha256(s.encode()).hexdigest()
assert read(phone.OUT/'accessibility-ordinary-settings-final.json')['own_accessibility_connected']
assert (phone.OUT/'phone-evidence-before-cleanup/manifest.json').is_file()
dest=phone.OUT/'phone-cleanup';dest.mkdir(exist_ok=False)
commands=[]
def execute(*args):
    assert not phone.state(s)['formal_nls_enabled']
    text=phone.run('-s',s,*args,timeout=45)
    commands.append({'args':args,'output':text})
    (dest/'commands.json').write_text(json.dumps(commands,ensure_ascii=False,indent=2),encoding='utf8')
    return text
def own(name):return phone.run('-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name)
def logs():return [json.loads(line) for line in own('platform.ndjson').splitlines() if line.strip()]
def control(op,tag=None):
    args=['shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op]
    if tag:args+=['--es','tag',tag]
    return execute(*args)
def public_hash(pkg):
    rows=phone.run('-s',s,'shell','pm','path','--user','0',pkg).strip().splitlines()
    assert len(rows)==1 and rows[0].startswith('package:/data/app/')
    path=rows[0][8:];assert re.fullmatch(r'/data/app/[A-Za-z0-9/_.~=+\-]+/base\.apk',path)
    return phone.run('-s',s,'shell','sha256sum',path).split()[0]
before=logs();shell_tags={r['tag'] for r in before if r.get('event')=='posted' and r.get('package')=='com.android.shell'}
# These exact failed sends are documented even though the privacy gate never
# saw their keys. Repost only those known slots to register their cancellation.
for name in ['notification-os-final','notification-os-normal-start','notification-os-after-harness-fix']:
    d=read(phone.OUT/name/'summary.json');shell_tags.add(d['prefix']+'_SHELL')
for name in ['notification-normal-recovery','notification-recovery-after-normal-start']:
    d=read(phone.OUT/name/'summary.json');shell_tags|={d['prefix']+'_BACKGROUND',d['prefix']+'_AFTER_RELAUNCH'}
for row in read(phone.OUT/'nls-instrumentation-boundary/runs.json'):
    shell_tags.add(row['callback_after_instrumentation']['tag'])
assert all(re.fullmatch(r'FINANCE_P03_[A-Za-z0-9_]+',tag) for tag in shell_tags)
known={r['tag'] for r in before if r.get('event')=='posted' and r.get('package')=='com.android.shell'}
reposted=[]
for tag in sorted(shell_tags-known):
    execute('shell','cmd','notification','post','-t','P03_SYNTHETIC',tag,'P03_SYNTHETIC_ONLY')
    end=time.monotonic()+10
    while time.monotonic()<end:
        if any(r.get('tag')==tag and r.get('event')=='posted' for r in logs()):break
        time.sleep(.1)
    else:raise AssertionError('Known owned shell slot could not be registered for cleanup')
    reposted.append(tag)
all_tags=shell_tags|{r['tag'] for r in logs() if r.get('tag','').startswith('FINANCE_P03_')}
for tag in sorted(all_tags):control('cancel',tag)
end=time.monotonic()+10
while True:
    after=logs();last={}
    for r in after:
        if r.get('package')=='com.android.shell' and r.get('tag') in shell_tags and r.get('event') in ['posted','removed']:last[r['tag']]=r['event']
    remaining=[t for t in shell_tags if last.get(t)!='removed']
    if not remaining or time.monotonic()>=end:break
    time.sleep(.1)
assert not remaining,remaining
control('snapshot');time.sleep(.3);snapshot=json.loads(own('notification-snapshot.json'))
(dest/'platform-after.ndjson').write_text(own('platform.ndjson'),encoding='utf8')
(dest/'snapshot-before-uninstall.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf8')
remaining_own=snapshot['own_active'] # Unobserved app slots are removed atomically by uninstall below.
formal=read(phone.OUT/'formal-live-before.json');assert public_hash('uk.thewyj.app')==formal['formal_public_apk_sha256']
packages_before=phone.run('-s',s,'shell','pm','list','packages','-U','--user','0','uk.thewyj.app').splitlines()
current=read(phone.OUT/'phone-maintenance2-artifacts.json')['artifacts']
remove=[]
for row in current:
    assert row['package'] in [phone.PKG,phone.TEST] and public_hash(row['package'])==row['sha256']
    remove.append({'package':row['package'],'sha256':row['sha256'],'ownership':'installed by this run; exact final APK hash'})
old=read(phone.ROOT/'docs/migration-evidence/finance-p03/device/apk-final12.json')['artifacts'][1]
oldpkg='uk.thewyj.app.debug.p03acceptance'
old_present=any(re.match('package:'+re.escape(oldpkg)+r' uid:',r) for r in packages_before)
if old_present:
    assert public_hash(oldpkg)==old['sha256'],'Preserve a prior QA package unless exact P03 ownership is proved'
    remove.append({'package':oldpkg,'sha256':old['sha256'],'ownership':'prior P03 test APK matches sealed artifact; owner now requests task trace removal'})
for row in remove:
    assert row['package']!='uk.thewyj.app'
    assert 'Success' in execute('shell','pm','uninstall','--user','0',row['package'])
reverse=phone.run('-s',s,'reverse','--list')
if 'tcp:19443 tcp:19443' in reverse:execute('reverse','--remove','tcp:19443')
packages_after=phone.run('-s',s,'shell','pm','list','packages','-U','--user','0','uk.thewyj.app').splitlines()
removed={r['package'] for r in remove}
protected_before={r for r in packages_before if not any(re.match('package:'+re.escape(pkg)+r' uid:',r) for pkg in removed)}
assert protected_before==set(packages_after),'All unrelated packages and UIDs must stay intact'
assert public_hash('uk.thewyj.app')==formal['formal_public_apk_sha256']
meta=phone.run('-s',s,'shell','dumpsys','package','uk.thewyj.app')
def field(p):
    m=re.search(p,meta);assert m;return m[1].strip()
assert field(r'versionCode=(\d+)')==formal['version_code'] and field(r'versionName=([^\r\n]+)')==formal['version_name'] and field(r'lastUpdateTime=([^\r\n]+)')==formal['last_update']
post=phone.state(s);assert not post['qa_installed'] and not post['unique_test_installed'] and not post['qa_nls_enabled'] and not post['qa_a11y_enabled']
execute('shell','input','keyevent','3')
result={'status':'CLEANED_OWNED_QA_USER0_ONLY','utc':phone.now(),'uninstalled':remove,
    'shell_tags_cancelled_and_actual_removed':len(shell_tags),'reposted_exact_owned_slots':reposted,
    'unobserved_own_active_before_uninstall':remaining_own,'all_target_app_notifications_removed_by_uninstall':True,
    'unrelated_packages_and_uids_unchanged':True,'remaining_packages':packages_after,
    'formal_public_apk_sha256':formal['formal_public_apk_sha256'],'formal_public_version_last_update_unchanged':True,
    'formal_private_data_read':False,'formal_private_content_unchanged':'NOT TESTED; never opened',
    'state':post,'formal_nls_left_at_owner_paused_state':True,'work_profile_created':False,
    'temporary_ui_xml_files_removed_by_settings_driver':True,'adb_reverse_19443_removed':True,
    'pc_evidence_preserved':True,'uninstall_business_acceptance_counted':False}
file=phone.OUT/'phone-cleanup-final.json';assert not file.exists();file.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False))
