"""Record local delivery checks against current source; preserve every attempt."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[2]
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
p=argparse.ArgumentParser();p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label)
out=ROOT/'docs/migration-evidence/aeris-p0-closeout'/a.label;out.mkdir(parents=True,exist_ok=False)
env=dict(os.environ,WRANGLER_SEND_METRICS='false',NO_COLOR='1');env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
jobs=[('isolation-guards',[sys.executable,'-m','unittest','qa.p0.test_preview_isolation','qa.p0.test_finance_cloud','-v']),
 ('stage-boundaries',[str(NODE),'scripts/test_stage_pages_deploy.mjs']),
 ('stage-current',[str(NODE),'scripts/stage_pages_deploy.mjs']),
 ('verify-build',[str(NODE),'qa/aeris-release/ci-pages-build.mjs',out.relative_to(ROOT).as_posix()+'/build.json']),
 ('module-graph',[str(NODE),'scripts/check_js_module_graph.mjs']),('storage-contract',[str(NODE),'scripts/check_storage_contract.mjs']),
 ('whitespace',['git','diff','--check'])]
rows=[]
for name,cmd in jobs:
 t=time.monotonic()
 with (out/(name+'.log')).open('xb') as log:r=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
 rows.append(dict(name=name,argv=cmd,exit_code=r.returncode,elapsed_seconds=round(time.monotonic()-t,3)))
 (out/'result.json').write_text(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),commands=rows,phone_operations=0,external_model_calls=0),indent=2),encoding='utf8')
 print(json.dumps(rows[-1]),flush=True)
raise SystemExit(int(any(r['exit_code'] for r in rows)))
