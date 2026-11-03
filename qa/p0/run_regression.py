"""Fresh inherited regression execution with sealed fixture paths and no devices."""
from pathlib import Path
import argparse,json,os,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('suite',choices=['node','jvm']);p.add_argument('--label',required=True);p.add_argument('--only');a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label)
out=ROOT/'docs/migration-evidence/finance-p04'/a.label;out.mkdir(parents=True,exist_ok=False)
env=dict(os.environ);env.update(json.loads((ROOT/'docs/migration-evidence/finance-p04/p0-preparation-r1/environment.json').read_text()))
env['ANDROID_SDK_ROOT']=env['ANDROID_HOME'];env['FINANCE_REGRESSION_OUTPUT']=str(out)
env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env.get('PATH','');env['WRANGLER_SEND_METRICS']='false'
for key in list(env):
 if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']) or key.upper().startswith(('CLOUDFLARE_','CF_API_','CF_ACCOUNT_','OPENAI_','ANTHROPIC_','GEMINI_')):env.pop(key)
cmd=[sys.executable,str(ROOT/('qa/finance-p04/run-regression-'+a.suite+'.py'))]
if a.only:assert a.suite=='node';cmd+=['--only',a.only]
if a.suite=='node':env['NODE_OPTIONS']='--import='+(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri()
(out/'invocation.json').write_text(json.dumps(dict(argv=cmd,fixture_preparation='p0-preparation-r1',external_model_calls=0,phone_operations=0,original_oracles_modified=False),indent=2),encoding='utf8')
with (out/'pipeline.log').open('xb') as log:r=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
print(json.dumps(dict(suite=a.suite,exit_code=r.returncode,output=out.relative_to(ROOT).as_posix())))
raise SystemExit(r.returncode)
