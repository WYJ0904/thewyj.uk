"""Local mocks and exact recorded-response replay only. No external AI binding."""
from common import *
from js_adapters import adapt_js
import argparse,re,shutil

parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');args=parser.parse_args();assert re.fullmatch('r[1-9][0-9]*',args.attempt)
OUT=E/('ai-'+args.attempt);OUT.mkdir(exist_ok=False);drivers=OUT/'drivers';drivers.mkdir()
copies=[]
for name in ['provider-1.json','provider-3.json']:
    src=OLD/'docs/migration-evidence/finance-p04/remediation/baseline/provider/live-r5'/name
    dest=OUT/'recorded-provider/live-r5'/name;dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(src,dest);assert sha(src)==sha(dest)
    copies.append(dict(source=str(src),dest=dest.relative_to(ROOT).as_posix(),sha256=sha(dest)))
jobs=[('protocol','qa/finance-convergence/protocol.mjs','FINANCE_CONVERGENCE_OUTPUT'),
      ('model-boundary','qa/finance-convergence/model-boundary.mjs','FINANCE_CONVERGENCE_OUTPUT'),
      ('quality76','qa/finance-remediation/ai-quality.mjs','FINANCE_REMEDIATION_OUTPUT'),
      ('rich','qa/finance-p06/ai-contracts.mjs','FINANCE_P06_OUTPUT'),
      ('roles','qa/finance-p06/ai-v2-contracts.mjs','FINANCE_P06_OUTPUT'),
      ('recovery','qa/finance-p06/ai-recovery-contracts.mjs','FINANCE_P06_OUTPUT'),
      ('migration','qa/finance-p06/migrations.mjs','FINANCE_P06_OUTPUT'),
      ('chrome','qa/finance-p06/web-ai.mjs','FINANCE_P06_OUTPUT')]
adapters=[];rows=[]
for name,src,key in jobs:
    original=(ROOT/src).read_text();replacements=[]
    for old in ['docs/migration-evidence/finance-p04/convergence','docs/migration-evidence/finance-p04/remediation','docs/migration-evidence/finance-p06']:
        if old in original:replacements.append((old,'docs/migration-evidence/aeris-finance-quality'))
    if "'docs','migration-evidence','finance-p06'" in original:
        replacements.append(("'docs','migration-evidence','finance-p06'","'docs','migration-evidence','aeris-finance-quality'"))
    if name=='quality76':
        # The output guard above and this source-only historical read need different locations.
        replacements.insert(0,('docs/migration-evidence/finance-p04/remediation/baseline/provider/live-r5',
            (OUT/'recorded-provider/live-r5').relative_to(ROOT).as_posix()))
    driver=drivers/(name+'.mjs');adapters.append(adapt_js(src,driver,replacements))
write(OUT/'adapters.json',dict(original_oracles_modified=False,external_model_calls=0,copies=copies,adapters=adapters))
for name,src,key in jobs:
    driver=drivers/(name+'.mjs');cmd=[str(NODE),str(driver)]
    row=dict(name=name,command=cmd,started_utc=utc(),external_model_calls=0)
    env=dict(environment(),**{key:str(OUT/name)},AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe')
    with (OUT/(name+'.log')).open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
    row.update(exit_code=p.returncode,finished_utc=utc());rows.append(row)
    write(OUT/'commands.json',rows);print(json.dumps(row),flush=True)
write(OUT/'result.json',dict(commands=rows,external_model_calls=0,phone_operations=0,production_mutations=0))
raise SystemExit(int(any(row['exit_code'] for row in rows)))
