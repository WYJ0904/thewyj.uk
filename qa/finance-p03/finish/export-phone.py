"""Export a fixed allowlist from this task's owned QA only, before trace cleanup."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys
sys.dont_write_bytecode=True
import phone
p=argparse.ArgumentParser();p.add_argument('--name',required=True);args=p.parse_args()
assert args.name.replace('-','').isalnum()
dest=phone.OUT/args.name;dest.mkdir(exist_ok=False)
s=phone.device();owned=json.loads((phone.OUT/'owned-install.json').read_text())
assert owned['package']==phone.PKG and owned['device_sha256']==hashlib.sha256(s.encode()).hexdigest()
entries=[]
for name in ['tests.ndjson','platform.ndjson','finish-probe.ndjson','notification-snapshot.json']:
    r=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=30)
    assert r.returncode==0,(name,r.stderr.decode(errors='replace'))
    assert len(r.stdout)<=16*1024*1024,'Bounded owned-QA export only'
    if name.endswith('.ndjson'):
        rows=[json.loads(line) for line in r.stdout.decode('utf8').splitlines() if line.strip()]
        assert rows
    else:
        rows=[json.loads(r.stdout)]
        assert rows[0]['synthetic_only'] is True
    (dest/name).write_bytes(r.stdout)
    entries.append({'name':name,'bytes':len(r.stdout),'rows':len(rows),'sha256':hashlib.sha256(r.stdout).hexdigest()})
(dest/'manifest.json').write_text(json.dumps({'utc':phone.now(),'package':phone.PKG,'synthetic_only':True,'files':entries,'formal_app_private_read':False},indent=2),encoding='utf8')
print(json.dumps(entries))
