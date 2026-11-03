from pathlib import Path
import subprocess,sys
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence';OLD=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
s=(ROOT/'qa/finance-p06/collect.py').read_text()
for a,b in [
 ('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})\nORIGIN=Path({str(OLD)!r})'),
 ("HISTORY=ROOT/'docs/migration-evidence/finance-p03'","HISTORY=ORIGIN/'docs/migration-evidence/finance-p03'"),
 ('finance-p04/p06-validation/final-r3','finance-p04/convergence/final-r1'),('finance-p04/p06-validation','finance-p04/convergence'),
 ('previousP05=read(ROOT/','previousP05=read(ORIGIN/'),('beforeP05=read(ROOT/','beforeP05=read(ORIGIN/'),
 ("junit(ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')","junit(ORIGIN/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')"),
 ("source=ROOT/'docs/migration-evidence/finance-p03/final/compat-p03/kotlin/P03BridgeTest.kt'","source=ROOT/'docs/migration-evidence/finance-p04/convergence/fixtures/compat-p03/kotlin/P03BridgeTest.kt'"),
 ("expected={'prepare-backup',","expected={"),
]:assert a in s,a;s=s.replace(a,b)
p=E/'drivers/collector.py';assert not p.exists();p.write_text(s)
with (E/'collection.log').open('wb') as log:r=subprocess.run([sys.executable,str(p)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
print('Collector exit',r.returncode);raise SystemExit(r.returncode)
