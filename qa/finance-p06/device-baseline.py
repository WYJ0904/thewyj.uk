"""Read-only target and package metadata. No notification text or private app DB."""
from pathlib import Path
from datetime import datetime, timezone
import json, os, re, subprocess

ROOT=Path(__file__).resolve().parents[2]; E=ROOT/'docs/migration-evidence/finance-p06'
OUT=E/'device/baseline'; OUT.mkdir(parents=True,exist_ok=False)
PRIVATE=OUT/'private';PRIVATE.mkdir()
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
SERIAL='R5CY22MEHJN';commands=[]
def run(name, parts, private=False):
    argv=[str(ADB),*parts];p=subprocess.run(argv,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
    target=(PRIVATE if private else OUT)/(name+'.txt');target.write_text(p.stdout+'\n'+p.stderr,encoding='utf8')
    commands.append(dict(name=name,argv=argv,exit_code=p.returncode,private=private))
    assert p.returncode==0,(name,p.stderr)
    return p.stdout.strip()
def shell(name,*parts,private=False):return run(name,['-s',SERIAL,'shell',*parts],private)
inventory=run('devices',['devices','-l'])
rows=[line.split() for line in inventory.splitlines() if re.match(r'^\S+\s+device\s',line)]
assert len(rows)==1 and rows[0][0]==SERIAL,'Select only the confirmed Samsung'
model=shell('model','getprop','ro.product.model');sdk=shell('sdk','getprop','ro.build.version.sdk')
assert model=='SM-S9360' and sdk=='36'
system=shell('system-build','getprop','ro.build.fingerprint')
user=shell('current-user','am','get-current-user')
users=shell('users','pm','list','users',private=True)
userids=re.findall(r'UserInfo\{(\d+):',users)
wechat={}
for uid in userids:
    wechat[uid]=shell('wechat-user-'+uid,'pm','list','packages','--user',uid,'-U','com.tencent.mm')
formal=shell('formal-package','dumpsys','package','uk.thewyj.app',private=True)
qa=shell('existing-qa-packages','pm','list','packages','-U','uk.thewyj.app')
services={key:shell(key,'settings','get','secure',key) for key in ['enabled_accessibility_services','enabled_notification_listeners','accessibility_enabled']}
lock=shell('lock-policy','dumpsys','window','policy',private=True)
result=dict(checked_utc=datetime.now(timezone.utc).isoformat(),status='READ_ONLY_BASELINE_PASS',
    serial=SERIAL,model=model,sdk=int(sdk),system_build=system,current_user=user,profile_ids=userids,wechat=wechat,
    formal_version_name=(re.search(r'versionName=([^\s]+)',formal)or[None,None])[1],
    formal_version_code=(re.search(r'versionCode=(\d+)',formal)or[None,None])[1],
    formal_debuggable='DEBUGGABLE' in formal,existing_qa=qa,services=services,
    keyguard_showing=bool(re.search(r'(?:mKeyguardShowing|showing)=true',lock)),commands=commands,
    financial_or_chat_content_read=False,formal_data_or_permissions_modified=False)
(OUT/'result.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='commands'}))
