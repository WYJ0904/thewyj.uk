"""Scoped finance convergence checks. No deploy, model, phone or remote D1 action."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-safe-convergence'
BASE='fcc499ef4b33cd13d212c19523d82cd7966e2684'
spec=importlib.util.spec_from_file_location('p06_lab',ROOT/'qa/p06-ai-quality-lab/run.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab);lab.BASE=BASE;lab.E=E
def protect(label):
    rows=[]
    for relative in ['Desktop/编程/thewyj.uk',*[f'.codex/worktrees/{x}/thewyj.uk' for x in [
        'finance-release-convergence','p06-safe-integration','p06-ai-quality-lab','p05-ocr-exactness-lab',
        'p05-ocr-exactness-r2','task26-safe-integration','aeris-p07-phase1-handover','gemini-p07-d-business-workspaces']]]:
        source=Path(os.environ['USERPROFILE'])/relative
        def git(*a):return subprocess.check_output(['git','-C',str(source),*a],text=True,encoding='utf8').strip()
        if not source.exists():rows.append({'path':relative,'status':'UNAVAILABLE'});continue
        changed=git('diff','--name-only','HEAD').splitlines()
        hashes={n:lab.sha(source/n) for n in changed if (source/n).is_file() and not any(
            word in n.lower() for word in ['访问口令','secret','credential','dev.vars','keystore'])}
        rows.append({'path':relative,'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),
                     'status':git('status','--porcelain','-uno'),'tracked_wip_sha256':hashes})
    with (E/(label+'.json')).open('x',encoding='utf8') as f:json.dump(rows,f,ensure_ascii=False,indent=2)
    print('Protected snapshots:',len(rows))
def jobs(label,definitions):
    out=E/label;out.mkdir(parents=True,exist_ok=False);rows=[]
    for name,argv,extra in definitions:
        environment=lab.environment();environment.update(extra)
        for key,value in extra.items():
            if key.endswith('_OUTPUT'):
                destination=Path(value);assert destination.resolve().is_relative_to(ROOT/'docs/migration-evidence')
                destination.parent.mkdir(parents=True,exist_ok=True)
        if os.name=='nt':
            path_key=next(k for k in environment if k.upper()=='PATH')
            environment[path_key]=str(Path(sys.executable).parent)+os.pathsep+environment[path_key]
        before=lab.snapshot()
        with (out/(name+'.log')).open('xb') as stream:
            try:p=subprocess.run(argv,cwd=ROOT,env=environment,stdout=stream,stderr=subprocess.STDOUT,timeout=480);code=p.returncode
            except subprocess.TimeoutExpired:code=124
        stable=before==lab.snapshot()
        rows.append({'name':name,'argv':argv,'exit_code':code,'status':'PASS' if code==0 and stable else 'FAIL',
            'source_stable':stable,'source_sha256':lab.sha(ROOT/argv[-1]) if (ROOT/argv[-1]).is_file() else None})
        (out/'commands.json').write_text(json.dumps(rows,indent=2),encoding='utf8');print(name,rows[-1]['status'],flush=True)
    return int(any(x['status']!='PASS' for x in rows))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['protect','android','p06','contracts','migration','build','legacy-ai'])
    p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label);E.mkdir(parents=True,exist_ok=True)
    if a.action=='protect':protect(a.label);sys.exit(0)
    if a.action=='android':sys.exit(lab.command(a.label,'android-full'))
    out=E/a.label
    if a.action=='p06':
        p06out=ROOT/'docs/migration-evidence/p06-ai-quality-lab'/('safe-convergence-'+a.label)
        p06out.mkdir(parents=True,exist_ok=False)
        for name in ['evaluation','api','replay']:(p06out/name).mkdir()
        definitions=[
            ('deterministic-87',['node','qa/p06-ai-quality-lab/evaluate.mjs','--output',str(p06out/'evaluation')],{}),
            ('api-40',['node','qa/p06-ai-quality-lab/api.mjs','--output',str(p06out/'api')],{}),
            ('scorer',['node','--test','qa/p06-ai-quality-lab/scoring.test.mjs'],{}),
            ('guards',['node','--test','local-backend/test_finance_ai_quality_guards.mjs'],{}),
            ('historical-replay',['node','qa/p06-ai-quality-lab/replay.mjs','--portable-only','--output',str(p06out/'replay')],{})]
    elif a.action=='contracts':
        definitions=[(Path(s).stem,['node',s],{}) for s in [
            'local-backend/test_task16_d1_js.mjs','local-backend/test_finance_js.mjs','local-backend/test_task17_d1_js.mjs',
            'local-backend/test_task21_payment_js.mjs','local-backend/test_task21_notification_js.mjs',
            'local-backend/test_aeris_state_consistency.mjs','local-backend/test_finance_candidates_js.mjs',
            'local-backend/test_notification_local_ledger_js.mjs','local-backend/test_finance_history_js.mjs',
            'local-backend/test_finance_disclosure_js.mjs']]
        for name,script,key,folder in [
            ('p03-provider','qa/finance-p03/final/providers.mjs','FINANCE_P03_OUTPUT','finance-p03/final'),
            ('p03-provider-identity','qa/finance-p03/finish/provider-identity.mjs','FINANCE_P03_OUTPUT','finance-p03/final'),
            ('p04-money','qa/finance-p04/money.mjs','FINANCE_P04_OUTPUT','finance-p04'),
            ('p04-fx','qa/finance-p04/fx.mjs','FINANCE_P04_OUTPUT','finance-p04'),
            ('p04-unit-review','qa/finance-p04/unit-review.mjs','FINANCE_P04_OUTPUT','finance-p04')]:
            definitions.append((name,['node',script],{key:str(ROOT/'docs/migration-evidence'/folder/('safe-convergence-'+a.label)/name)}))
    elif a.action=='legacy-ai':
        definitions=[(name,['node',script],{'FINANCE_P06_OUTPUT':str(ROOT/'docs/migration-evidence/finance-p06'/('safe-convergence-'+a.label)/name)})
          for name,script in [('rich','qa/finance-p06/ai-contracts.mjs'),('roles','qa/finance-p06/ai-v2-contracts.mjs')]]
    elif a.action=='migration':
        definitions=[('integrated-database',['node','qa/finance-safe-convergence/database-audit.mjs'],
            {'FINANCE_CONVERGENCE_DB_OUTPUT':str(out/'integrated-database')})]
        for name,script,key,folder in [
            ('p04-migrations','qa/finance-p04/migrations.mjs','FINANCE_P04_OUTPUT','finance-p04'),
            ('p04-review-migrations','qa/finance-p04/review-migrations.mjs','FINANCE_P04_OUTPUT','finance-p04'),
            ('p06-migrations','qa/finance-p06/migrations.mjs','FINANCE_P06_OUTPUT','finance-p06')]:
            definitions.append((name,['node',script],{key:str(ROOT/'docs/migration-evidence'/folder/('safe-convergence-'+a.label)/name)}))
    else:
        definitions=[('functions',['node','node_modules/wrangler/bin/wrangler.js','pages','functions','build','functions','--outdir','.wrangler/finance-convergence-functions'],{}),
          ('module-graph',['node','scripts/check_js_module_graph.mjs'],{}),('storage',['node','scripts/check_storage_contract.mjs'],{}),
          ('release-consistency',[sys.executable,'scripts/check_android_release_consistency.py'],{}),
          ('staging',['node','--test','scripts/test_stage_pages_deploy.mjs'],{})]
    sys.exit(jobs(a.label,definitions))
