"""Copy three verified synthetic response fixtures, never credentials or bindings."""
from pathlib import Path
import hashlib, json, os
ROOT=Path(__file__).resolve().parents[2]
source=Path(os.environ['USERPROFILE'])/'.codex/worktrees/p06-ai-quality-lab/thewyj.uk/docs/migration-evidence/p06-ai-quality-lab/history'
fixture=json.loads((ROOT/'qa/p06-ai-quality-lab/fixtures/recorded-12.json').read_text())
assert fixture['synthetic_only'] is True
items=[('original-15/live-r5/provider-1.json','finance-p04/remediation/baseline/provider/live-r5/provider-1.json'),
 ('original-15/live-r5/provider-3.json','finance-p04/remediation/baseline/provider/live-r5/provider-3.json'),
 ('convergence-12/response-11.json','finance-p04/convergence/live-models/response-11.json')]
rows=[]
for src,dst in items:
    data=(source/src).read_bytes();record=json.loads(data);digest=hashlib.sha256(data).hexdigest()
    if src.startswith('convergence-12/'):
        assert json.loads((source/'convergence-12/budget.json').read_text())['synthetic_only'] is True
        assert any(x['original_envelope_sha256']==digest for x in fixture['cases'])
    else:assert record.get('synthetic_only') is True
    target=ROOT/'docs/migration-evidence'/dst
    if target.exists():assert target.read_bytes()==data
    else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    rows.append({'source':src,'destination':dst,'sha256':digest,'synthetic_only':True})
out=ROOT/'docs/migration-evidence/finance-safe-convergence';out.mkdir(parents=True,exist_ok=True)
target=out/'historical-fixture-manifest.json'
if target.exists():assert json.loads(target.read_text())==rows
else:
    with target.open('x',encoding='utf8') as f:json.dump(rows,f,indent=2)
print('Verified exactly three synthetic history inputs; no model calls')
