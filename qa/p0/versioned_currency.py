"""Fresh original-input forwarding v2; never edits the frozen raw driver/oracle."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
base=ROOT/'docs/migration-evidence/finance-p04/p0-versioned-r1';base.mkdir(parents=True,exist_ok=False)
env=dict(os.environ);env.update(json.loads((ROOT/'docs/migration-evidence/finance-p04/p0-preparation-r1/environment.json').read_text()));env['ANDROID_SDK_ROOT']=env['ANDROID_HOME'];env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env.get('PATH','')
env.update(FINANCE_CONTRACT_ROOT=str(base/'drivers'),FINANCE_PRIMARY_DOM=str(ROOT/'docs/migration-evidence/finance-p04/p0-inherited-node-r2/p02-web/web-dom.ndjson'),WRANGLER_SEND_METRICS='false')
commands=[]
def run(name,cmd,extra={}):
 childenv={**env,**extra};start=datetime.now(timezone.utc).isoformat()
 with (base/(name+'.log')).open('xb')as log:r=subprocess.run(cmd,cwd=ROOT,env=childenv,stdout=log,stderr=subprocess.STDOUT)
 commands.append(dict(name=name,argv=cmd,started_utc=start,finished_utc=datetime.now(timezone.utc).isoformat(),exit_code=r.returncode))
 (base/'commands.json').write_text(json.dumps(commands,indent=2),encoding='utf8');print(json.dumps(commands[-1]),flush=True)
 return r.returncode
if run('prepare',[sys.executable,str(ROOT/'qa/finance-p04/prepare-contract-drivers.py')]):raise SystemExit(1)
run('native',[sys.executable,str(ROOT/'qa/finance-p04/android.py'),'--qa-root',str(base/'drivers/native'),'--qa-output',str(base/'native-output'),'--tests','*FinanceP02MatrixTest.D_parserCurrencyTarget'],dict(FINANCE_P04_OUTPUT=str(base/'native-command')))
run('dom',[env['FINANCE_NODE'],str(base/'drivers/web-dom-declared-inputs.mjs')],dict(FINANCE_P03_OUTPUT=str(base/'dom'),FINANCE_P04_OUTPUT=str(base/'dom')))
web=base/'web';web.mkdir()
run('web',[env['FINANCE_NODE'],'--import',(ROOT/'qa/finance-p04/output-redirect.mjs').as_uri(),str(ROOT/'qa/finance-p02/web-contracts.mjs')],dict(FINANCE_P03_OUTPUT=str(web),FINANCE_P04_OUTPUT=str(web)))
(base/'result.json').write_text(json.dumps(dict(commands=commands,original_oracles_modified=False,raw_frozen_608_not_replaced=True,external_model_calls=0,phone_operations=0),indent=2),encoding='utf8')
raise SystemExit(int(any(r['exit_code']for r in commands[:3])))
