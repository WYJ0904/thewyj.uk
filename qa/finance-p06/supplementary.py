"""Final current-code local AI suites and Functions bundle, all evidence fresh."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='supplementary-r1');args=parser.parse_args();assert args.label.startswith('supplementary-r') and args.label[15:].isdigit()
OUT=E/args.label;OUT.mkdir(exist_ok=False)
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
def sources():
 names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).split('\0')
 return {n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in sorted(set(names)) if n and (ROOT/n).is_file() and n.endswith(('.js','.mjs','.sql','.json')) and n.startswith(('functions/','js/','cloudflare/migrations/','qa/finance-p06/'))}
before=sources();rows=[];head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
env=dict(os.environ,WRANGLER_SEND_METRICS='false');env['PATH']=str(NODE.parent)+os.pathsep+env['PATH'];env.pop('FINANCE_P06_DIAGNOSTIC_SAVE_FIRST',None)
jobs=[('module-graph',[str(NODE),'scripts/check_js_module_graph.mjs']),('storage-contract',[str(NODE),'scripts/check_storage_contract.mjs']),
 ('functions-build',[str(NODE),'node_modules/wrangler/bin/wrangler.js','pages','functions','build','functions','--outdir',str(OUT/'functions')])]
jobs += [(name,[str(NODE),'qa/finance-p06/'+script+'.mjs']) for name,script in [('ai-contracts','ai-contracts'),('roles','ai-v2-contracts'),('recovery','ai-recovery-contracts'),('migration','migrations'),('chrome','web-ai')]]
for name,cmd in jobs:
 started=datetime.now(timezone.utc).isoformat();record={'name':name,'argv':cmd,'started_utc':started,'output':str((OUT/name).relative_to(ROOT))}
 with (OUT/(name+'.log')).open('xb') as log:
  child=subprocess.Popen(cmd,cwd=ROOT,env=dict(env,FINANCE_P06_OUTPUT=str(OUT/name)),stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  try:code=child.wait(timeout=180)
  except subprocess.TimeoutExpired:
   subprocess.run(['taskkill.exe','/PID',str(child.pid),'/T','/F'],capture_output=True,timeout=20);child.wait(timeout=10);code=124;record['watchdog']='180s; no retry and no changed test deadline'
 record.update(exit_code=code,finished_utc=datetime.now(timezone.utc).isoformat(),status='PASS' if code==0 else 'FAIL');rows.append(record);(OUT/'commands.json').write_text(json.dumps(rows,indent=2));print(json.dumps(record),flush=True)
after=sources();result={'head':head,'source_before':before,'source_after':after,'source_stable':before==after,'commands':rows,'external_model_calls':0,'production_or_preview_mutations':False}
(OUT/'result.json').write_text(json.dumps(result,indent=2));raise SystemExit(int(before!=after or any(r['exit_code'] for r in rows)))
