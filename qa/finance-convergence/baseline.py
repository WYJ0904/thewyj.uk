from pathlib import Path
from datetime import datetime,timezone
import hashlib,importlib.util,json,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence';E.mkdir(parents=True,exist_ok=False)
OLD=Path.home()/'.codex/worktrees/finance-p03-p06-remediation/thewyj.uk';PREVIOUS=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
proof=[]
for origin,folder,expected in [(OLD,'finance-p06/remediation',1935),(PREVIOUS,'finance-p06',2588)]:
 manifest=origin/'docs/migration-evidence'/folder/'FINAL_EVIDENCE_MANIFEST.json';files=json.loads(manifest.read_text())['files'];assert len(files)==expected
 bad=[n for n,r in files.items() if not (origin/n).is_file() or (origin/n).stat().st_size!=r['bytes'] or sha(origin/n)!=r['sha256']];assert not bad
 proof.append(dict(root=str(origin),files=len(files),manifest_sha256=sha(manifest),differences=bad))
for label in ['r1','r2']:
 for name in ['synthetic-ai-page.png','synthetic-sdk-lines.json']:
  src=OLD/f'docs/migration-evidence/finance-p06/remediation/artifact-recovery/{label}/native/{name}';dst=E/'inputs'/label/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst);assert sha(src)==sha(dst)
for name in ['compat-p03','explicit-currency-bridge']:
 shutil.copytree(OLD/'docs/migration-evidence/finance-p04/remediation/fixtures'/name,E/'fixtures'/name)
spec=importlib.util.spec_from_file_location('protection',ROOT/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.TREES.update(finance_origin=PREVIOUS,finance_remediation=OLD,finance_p03=Path.home()/'.codex/worktrees/finance-p03-identity-preauth/thewyj.uk')
protected=m.snapshot();(E/'protected-before.json').write_text(json.dumps(protected,ensure_ascii=False,indent=2))
(E/'baseline.json').write_text(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),status='PASS',seals=proof,protected_groups=len(protected),physical_phone_operations=False),indent=2))
print('Baseline PASS, old seals 1935+2588 verified; protected groups:',len(protected))
