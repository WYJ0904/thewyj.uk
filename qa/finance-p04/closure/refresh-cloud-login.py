"""Normal Wrangler OAuth refresh; no credential extraction or scope workaround."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
private=OUT/'private'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',choices=['r1','r2','r3','r4'],default='r1');args=parser.parse_args()
log=private/('wrangler-login.log' if args.attempt=='r1' else 'wrangler-login-'+args.attempt+'.log');assert not log.exists()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
cmd=[str(node),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'login','--use-keyring=true']
if args.attempt!='r1':cmd+=['--browser=false']
env=dict(os.environ,WRANGLER_SEND_METRICS='false')
start=datetime.now(timezone.utc).isoformat()
with log.open('xb') as stream:
 p=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
 print(json.dumps({'oauth_refresh_pid':p.pid,'same_official_wrangler':True,'private_log':True}),flush=True)
 try:code=p.wait(timeout=240);status='PASS' if code==0 else 'FAIL'
 except subprocess.TimeoutExpired:p.kill();p.wait();code=-1;status='TIMEOUT'
record={'started_utc':start,'finished_utc':datetime.now(timezone.utc).isoformat(),'status':status,'exit_code':code,
 'credentials':'Official Wrangler OS keyring only; no tokens printed/copied','production_data_mutated':False}
(OUT/('cloud-login-refresh.json' if args.attempt=='r1' else 'cloud-login-refresh-'+args.attempt+'.json')).write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
