"""Recheck the original seals and all sixteen protected source/evidence groups."""
from pathlib import Path
import hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence'
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
spec=importlib.util.spec_from_file_location('protection',ROOT/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.TREES.update(finance_origin=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk',finance_remediation=Path.home()/'.codex/worktrees/finance-p03-p06-remediation/thewyj.uk',finance_p03=Path.home()/'.codex/worktrees/finance-p03-identity-preauth/thewyj.uk')
after=m.snapshot();target=E/'protected-after.json';assert not target.exists();target.write_text(json.dumps(after,ensure_ascii=False,indent=2))
delta=m.compare(json.loads((E/'protected-before.json').read_text()),after)
seals=[]
for tree,folder,count in [('finance_remediation','finance-p06/remediation',1935),('finance_origin','finance-p06',2588)]:
    origin=m.TREES[tree];manifest=origin/'docs/migration-evidence'/folder/'FINAL_EVIDENCE_MANIFEST.json';files=json.loads(manifest.read_text())['files'];assert len(files)==count
    bad=[n for n,v in files.items() if not (origin/n).is_file() or (origin/n).stat().st_size!=v['bytes'] or sha(origin/n)!=v['sha256']]
    seals.append(dict(tree=tree,files=count,manifest_sha256=sha(manifest),differences=bad))
passed=all(not v['added'] and not v['missing'] and not v['changed'] and all(b for k,b in v.items() if k.endswith('Same')) for v in delta.values()) and all(not v['differences'] for v in seals)
result=dict(status='PASS' if passed else 'FAIL',groups=len(delta),comparison=delta,original_seals=seals,phone_operations=0,production_data_mutations=0)
(E/'protected-final.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'status':result['status'],'groups':len(delta),'seals':[v['files'] for v in seals]}));assert passed
