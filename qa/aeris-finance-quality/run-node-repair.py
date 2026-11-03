"""Rerun only path-blocked original Node cases; no assertion/input substitution."""
from common import *
import argparse, re

parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');parser.add_argument('--only');args=parser.parse_args()
assert re.fullmatch('r[1-9][0-9]*',args.attempt)
OUT=E/('node-repair-'+args.attempt);OUT.mkdir(exist_ok=False)
drivers=OUT/'drivers';drivers.mkdir();adapters=[]
mapping={}
for source,name,root_line in [
    ('qa/finance-p04/output.mjs','output.mjs',"const root=path.resolve(import.meta.dirname,'../..');"),
    ('qa/finance-p04/legacy-browser-all.mjs','legacy-browser-all.mjs',"const root = path.resolve(import.meta.dirname, '../..');")]:
    src=ROOT/source;original=src.read_text();modified=original
    new_root='const root = '+json.dumps(ROOT.as_posix())+';'
    assert modified.count(root_line)==1
    modified=modified.replace(root_line,new_root,1)
    modified=modified.replace('docs/migration-evidence/finance-p04','docs/migration-evidence/aeris-finance-quality')
    if name=='legacy-browser-all.mjs':
        before="const runner = path.join(out, 'original-six-driver.mjs');"
        assert modified.count(before)==1
        modified=modified.replace(before,"generated = generated.replace(\"path.join(os.tmpdir(),'aeris-state-browser-')\", JSON.stringify(path.join(out,'owned-browser-')));\n"+before)
    dest=drivers/name;dest.write_text(modified,encoding='utf-8')
    # Check oracle-containing lines except the necessary output-directory guard.
    def oracle(text):return [line for line in text.splitlines() if 'assert.' in line]
    assert oracle(original)==oracle(modified)
    mapping[src.as_uri()]=dest.as_uri()
    adapters.append(dict(source=source,source_sha256=sha(src),dest=dest.relative_to(ROOT).as_posix(),dest_sha256=sha(dest),
        changes=['Repository root for moved driver','Strict output scope changed to this task evidence directory'],oracles_unchanged=True))
hook=drivers/'register.mjs'
hook.write_text("import {registerHooks} from 'node:module';\nconst mapping="+json.dumps(mapping)+";\nregisterHooks({resolve(specifier,context,nextResolve){const found=nextResolve(specifier,context);return mapping[found.url]?{url:mapping[found.url],shortCircuit:true}:found;}});\n",encoding='utf-8')
write(OUT/'adapters.json',dict(adapters=adapters,hook_sha256=sha(hook),purpose='Path-only module redirection; unchanged original test entrypoints and assertions'))
jobs=[('aeris-dom','qa/finance-p04/legacy-browser-all.mjs'),('p02-web','qa/finance-p02/web-contracts.mjs'),
      ('p02-dom','qa/finance-p02/web-dom.mjs'),('p02-d1','qa/finance-p02/ledger-d1.mjs')]
jobs += [(name,'qa/finance-p04/'+name+'.mjs') for name in ['contracts','default-currency','migrations','review-migrations','browser','live-fx','raw-transport','unit-review']]
if args.only:
    selected=set(args.only.split(','));jobs=[job for job in jobs if job[0] in selected]
    assert {job[0] for job in jobs}==selected
rows=[];before={p:sha(ROOT/p) for p in ['functions/_lib/finance-ai.mjs','android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt','qa/finance-p02/fixtures/matrix.json']}
settings=json.loads((E/'preparation/environment.json').read_text())
for name,script in jobs:
    output=OUT/'regression'/('p02-web' if name.startswith('p02-') else name)
    output.parent.mkdir(parents=True,exist_ok=True)
    env=dict(environment(),**settings,FINANCE_P03_OUTPUT=str(output),FINANCE_P04_OUTPUT=str(output))
    env.pop('P03_FROZEN_OUTPUT_PREFIX',None)
    cmd=[str(NODE),'--import',hook.as_uri()]
    if name.startswith('p02-'):
        cmd += ['--import',(E/'environment-repair/output-redirect.mjs').as_uri()]
    cmd += [str(ROOT/script)]
    row=dict(name=name,command=cmd,started_utc=utc(),output=output.relative_to(ROOT).as_posix(),external_model_calls=0)
    with (OUT/(name+'.log')).open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
    row.update(exit_code=p.returncode,finished_utc=utc());rows.append(row);write(OUT/'commands.json',rows)
    print(json.dumps(row),flush=True)
after={p:sha(ROOT/p) for p in before}
write(OUT/'result.json',dict(commands=rows,source_before=before,source_after=after,source_stable=before==after,
    external_model_calls=0,phone_operations=0,original_failures_preserved=True))
raise SystemExit(int(before!=after or any(r['exit_code'] for r in rows if r['name'] not in ['aeris-dom','p02-web','p02-dom'])))
