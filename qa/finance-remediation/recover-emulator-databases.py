"""Preserve the two failed/control synthetic QA databases before own-AVD cleanup."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/remediation';OUT=E/'database-recovery';OUT.mkdir(exist_ok=False)
assert json.loads((E/'artifact-recovery/result.json').read_text())['status']=='PASS'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';PKG='uk.thewyj.app.qa.financep06';BASE=[str(ADB),'-P','5051','-s','127.0.0.1:5597']
commands=[]
def adb(*args,optional=False):
    cmd=BASE+list(args);p=subprocess.run(cmd,capture_output=True,timeout=30);commands.append(dict(argv=cmd,exit_code=p.returncode))
    if not optional:assert p.returncode==0,p.stderr.decode(errors='replace')[:300]
    return p
assert adb('shell','getprop','ro.kernel.qemu').stdout.strip()==b'1'
rows=[]
for label in ['r1','r2']:
    for name in ['notification.sqlite','assistance.sqlite','notification.sqlite-wal','notification.sqlite-shm','assistance.sqlite-wal','assistance.sqlite-shm']:
        remote=f'files/p06-joint-{label}/{name}'
        before=adb('shell','run-as',PKG,'sha256sum',remote,optional=True)
        if before.returncode:rows.append(dict(label=label,name=name,status='ABSENT_SIDECAR' if name.endswith(('-wal','-shm')) else 'NOT_CREATED'));continue
        digest=before.stdout.decode().split()[0];assert re.fullmatch('[0-9a-f]{64}',digest)
        size=int(adb('shell','run-as',PKG,'stat','-c','%s',remote).stdout.strip())
        raw=adb('exec-out','run-as',PKG,'cat',remote).stdout;initial=len(raw);chunked=False
        if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=digest:
            chunked=True;raw=b''.join(adb('exec-out','run-as',PKG,'dd','if='+remote,'bs=65536','skip='+str(i),'count=1').stdout for i in range((size+65535)//65536))
        assert len(raw)==size and hashlib.sha256(raw).hexdigest()==digest
        assert adb('shell','run-as',PKG,'sha256sum',remote).stdout.decode().split()[0]==digest
        target=OUT/label/name;target.parent.mkdir(exist_ok=True);target.write_bytes(raw)
        rows.append(dict(label=label,name=name,status='PASS',bytes=size,sha256=digest,initial_cat_bytes=initial,chunked_fallback=chunked))
(OUT/'result.json').write_text(json.dumps(dict(status='PASS',utc=datetime.now(timezone.utc).isoformat(),rows=rows,commands=commands,scope='Own synthetic QA files only; not a formal-user backup or bank data.'),indent=2))
print(json.dumps(dict(status='PASS',files=sum(r['status']=='PASS' for r in rows))))
