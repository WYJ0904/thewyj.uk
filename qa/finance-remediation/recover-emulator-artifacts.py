"""Byte/hash checked recovery of this task's synthetic AVD files; no physical target."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/remediation'
OUT=E/'artifact-recovery';OUT.mkdir(exist_ok=False)
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';PKG='uk.thewyj.app.qa.financep06';BASE=[str(ADB),'-P','5051','-s','127.0.0.1:5597']
commands=[]
def adb(*parts,check=True):
    cmd=BASE+list(parts);p=subprocess.run(cmd,capture_output=True,timeout=30)
    commands.append(dict(argv=cmd,exit_code=p.returncode))
    if check:assert p.returncode==0,p.stderr.decode(errors='replace')[:400]
    return p
assert json.loads((E/'avd/result.json').read_text())['avd_name']=='FinanceRemediationIsolated'
assert adb('shell','getprop','ro.kernel.qemu').stdout.strip()==b'1'
assert adb('shell','getprop','ro.build.version.sdk').stdout.strip()==b'36'
installed=adb('shell','pm','path',PKG).stdout.decode().strip().removeprefix('package:')
expected=next(r['sha256'] for r in json.loads((E/'emulator-joint-r2/result.json').read_text())['artifacts'] if r['package']==PKG)
assert adb('shell','sha256sum',installed).stdout.decode().split()[0]==expected
rows=[]
def copy(remote,target,optional=False):
    assert re.fullmatch(r'files/(p06-joint-r[12]|closeout-r9[12])/[a-zA-Z0-9._/-]+',remote)
    first=adb('shell','run-as',PKG,'sha256sum',remote,check=not optional)
    if first.returncode:
        rows.append(dict(remote=remote,status='NOT_CREATED_OR_ABSENT',optional=True));return
    digest=first.stdout.decode().split()[0];assert re.fullmatch('[0-9a-f]{64}',digest)
    raw=adb('exec-out','run-as',PKG,'cat',remote).stdout
    assert hashlib.sha256(raw).hexdigest()==digest
    assert adb('shell','run-as',PKG,'sha256sum',remote).stdout.decode().split()[0]==digest
    target.parent.mkdir(parents=True,exist_ok=True);assert not target.exists();target.write_bytes(raw)
    rows.append(dict(remote=remote,target=str(target.relative_to(ROOT)),bytes=len(raw),sha256=digest,status='PASS'))
for label,number in [('r1',91),('r2',92)]:
    for name in ['synthetic-sdk-lines.json','synthetic-ai-page.png','progress.json','seed.json','restore.json']:
        copy('files/p06-joint-'+label+'/'+name,OUT/label/'native'/name,optional=name in ['seed.json','restore.json'])
    for name in ['results.ndjson','cases.json']:
        copy(f'files/closeout-r{number}/'+name,OUT/label/'sdk'/name)
    cases=json.loads((OUT/label/'sdk/cases.json').read_text())
    assert len(cases)==33
    for case in cases:
        assert re.fullmatch('[a-z0-9-]+',case['id'])
        copy(f'files/closeout-r{number}/'+case['id']+'.png',OUT/label/'sdk'/(case['id']+'.png'))
summary={}
for label in ['r1','r2']:
    records=[json.loads(line) for line in (OUT/label/'sdk/results.ndjson').read_text().splitlines() if line]
    pixels=[r for r in records if r.get('kind')=='SDK_PIXEL'];life=[r for r in records if r.get('id','').startswith(('MAIN-','PLAIN-'))]
    assert len(pixels)==33 and len(life)==60 and all(r['status']=='PASS' for r in records)
    summary[label]=dict(unique_pixels=33,pixel_pass=33,lifecycle_rounds=60,lifecycle_pass=60,total_rows=len(records))
(OUT/'result.json').write_text(json.dumps(dict(status='PASS',utc=datetime.now(timezone.utc).isoformat(),rows=rows,summary=summary,commands=commands,
    reason='r1 tar stream was incomplete. Original tar/FAIL retained; post-run files recovered separately by double source SHA-256 plus exact local bytes. r2 recovered with the same reader for comparison.',
    original_alpha_acceptance='FAIL, not replaced by numeric control',physical_phone_operations=False,adb_port=5051),indent=2))
print(json.dumps(dict(status='PASS',files=sum(r['status']=='PASS' for r in rows),summary=summary)))
