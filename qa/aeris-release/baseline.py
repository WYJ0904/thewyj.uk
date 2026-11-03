"""Read-only protection and inherited evidence audit for the current Aeris round."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,importlib.util,json,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/aeris-p03-p07/baseline';OUT.mkdir(exist_ok=False)
WORKTREES=Path.home()/'.codex/worktrees';F=WORKTREES/'finance-release-convergence/thewyj.uk'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
spec=importlib.util.spec_from_file_location('protected',F/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.TREES.update(finance_origin=WORKTREES/'finance-p04-multicurrency/thewyj.uk',finance_remediation=WORKTREES/'finance-p03-p06-remediation/thewyj.uk',finance_p03=WORKTREES/'finance-p03-identity-preauth/thewyj.uk',prior_convergence=F,prior_design=WORKTREES/'p07-design-optimization/thewyj.uk',prior_ui=WORKTREES/'p07-ui-release/thewyj.uk')
protected=m.snapshot();(OUT/'protected-before.json').write_text(json.dumps(protected,ensure_ascii=False,indent=2))
seals=[]
for folder,relative,count in [
 ('finance-p03-p06-remediation','finance-p06/remediation',1935),('finance-p04-multicurrency','finance-p06',2588),
 ('finance-release-convergence','finance-p04/convergence',1186),('p07-design-optimization','p07',183),('p07-ui-release','p07-ui-release',243)]:
 origin=WORKTREES/folder/'thewyj.uk';p=origin/'docs/migration-evidence'/relative/'FINAL_EVIDENCE_MANIFEST.json';data=json.loads(p.read_text());files=data['files'];assert len(files)==count
 bad=[]
 for n,v in files.items():
  target=origin/n
  if not target.is_file() or target.stat().st_size!=v['bytes'] or sha(target)!=v['sha256']:bad.append(n)
 seals.append(dict(tree=folder,manifest_sha256=sha(p),files=len(files),differences=bad))
result=dict(status='PASS' if all(not x['differences'] for x in seals) else 'INHERITED_EVIDENCE_DRIFT',utc=datetime.now(timezone.utc).isoformat(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),protected_groups=len(protected),original_groups=16,additional_prior_round_trees=3,seals=seals,phone_operations=0,production_mutations=0)
(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result))
assert result['status']=='PASS','Preserve originals; investigate the reported drift without overwriting a seal'
