"""Run existing assertions unchanged, in new ignored local output directories."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import run as lab

parser=argparse.ArgumentParser()
parser.add_argument('--label',required=True)
args=parser.parse_args()
import re
assert re.fullmatch('r[1-9][0-9]*',args.label)
root=lab.ROOT
out=lab.E/('regressions-'+args.label)
out.mkdir(exist_ok=False)
before=lab.snapshot()
# Original read-only test dependencies, copied from already-hashed synthetic history.
for src,dst in [
    ('original-15/live-r5/provider-1.json','finance-p04/remediation/baseline/provider/live-r5/provider-1.json'),
    ('original-15/live-r5/provider-3.json','finance-p04/remediation/baseline/provider/live-r5/provider-3.json'),
    ('convergence-12/response-11.json','finance-p04/convergence/live-models/response-11.json'),
]:
    source=lab.E/'history'/src;target=root/'docs/migration-evidence'/dst
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():assert lab.sha(source)==lab.sha(target)
    else:shutil.copy2(source,target)
jobs=[
 ('rich','qa/finance-p06/ai-contracts.mjs','FINANCE_P06_OUTPUT','finance-p06'),
 ('roles','qa/finance-p06/ai-v2-contracts.mjs','FINANCE_P06_OUTPUT','finance-p06'),
 ('recovery','qa/finance-p06/ai-recovery-contracts.mjs','FINANCE_P06_OUTPUT','finance-p06'),
 ('migration','qa/finance-p06/migrations.mjs','FINANCE_P06_OUTPUT','finance-p06'),
 ('protocol','qa/finance-convergence/protocol.mjs','FINANCE_CONVERGENCE_OUTPUT','finance-p04/convergence'),
 ('boundary','qa/finance-convergence/model-boundary.mjs','FINANCE_CONVERGENCE_OUTPUT','finance-p04/convergence'),
 ('quality','qa/finance-remediation/ai-quality.mjs','FINANCE_REMEDIATION_OUTPUT','finance-p04/remediation'),
 ('atomic','qa/p0-ai/atomic-recovery.mjs','AERIS_P0_AI_LABEL',None),
 ('budget','qa/p0-ai/quality-and-budget.mjs','AERIS_P0_AI_LABEL',None),
 ('chrome','qa/finance-p06/web-ai.mjs','FINANCE_P06_OUTPUT','finance-p06'),
]
rows=[]
for name,source,key,prefix in jobs:
    destination=root/'docs/migration-evidence'/prefix/('p06-quality-lab-'+args.label)/name if prefix else None
    if destination:
        destination.parent.mkdir(parents=True,exist_ok=True)
        assert not destination.exists(),'Existing evidence is protected'
    env=lab.environment()
    env[key]=str(destination) if prefix else args.label
    env['AERIS_TEST_CHROME']='C:/Program Files/Google/Chrome/Application/chrome.exe'
    command=['node',source]
    row=dict(name=name,source=source,source_sha256=lab.sha(root/source),command=command,
             output=str(destination.relative_to(root)) if destination else 'docs/migration-evidence/p0-ai/'+Path(source).stem+'-'+args.label,
             real_model_calls=0)
    with (out/(name+'.log')).open('xb') as log:
        try:
            p=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
            row['exit_code']=p.returncode
        except subprocess.TimeoutExpired:
            row.update(exit_code=None,status='TIMEOUT_NOT_A_BUSINESS_PASS')
    rows.append(row)
    (out/'commands.json').write_text(json.dumps(rows,indent=2),encoding='utf8')
    print(json.dumps(row),flush=True)
after=lab.snapshot()
(out/'result.json').write_text(json.dumps(dict(rows=rows,source_before=before,source_after=after,source_stable=before==after,
    original_assertions_changed=False,real_model_calls=0),indent=2),encoding='utf8')
raise SystemExit(0 if all(r['exit_code']==0 for r in rows) and before==after else 1)
