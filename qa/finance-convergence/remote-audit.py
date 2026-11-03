"""Read-only release metadata. Credentials and downloaded configs remain private."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,subprocess,urllib.request
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence';OUT=E/'remote';OUT.mkdir(exist_ok=False);(OUT/'private').mkdir()
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false',GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='never')
env['PATH']=str(NODE.parent)+os.pathsep+env['PATH'];rows=[]
def run(name,args,parse=False):
 cmd=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*args,'--cwd',str(OUT/'private')]
 p=subprocess.run(cmd,cwd=OUT/'private',env=env,capture_output=True,timeout=60);raw=p.stdout+b'\n'+p.stderr
 (OUT/'private'/(name+'.log')).write_bytes(raw);row=dict(name=name,argv=cmd,exit_code=p.returncode,sha256=hashlib.sha256(raw).hexdigest());rows.append(row)
 if p.returncode:return None
 if parse:
  try:return json.loads(p.stdout.decode('utf-8-sig'))
  except ValueError:return None
 return True
run('whoami',['whoami'])
data={}
for name,args in [('projects',['pages','project','list','--json']),('production-deployments',['pages','deployment','list','--project-name','thewyj-uk','--environment','production','--json']),('databases',['d1','list','--json'])]:data[name]=run(name,args,True)
data['schema-flags']=run('schema-flags',['d1','execute','11c288d8-c584-409f-bb1f-7e7af11793e5','--remote','--command',"SELECT flag_key,enabled,kill_switch,channels_json,rollout_basis_points,revision FROM task25_feature_flags ORDER BY flag_key; SELECT key,value FROM task16_metadata WHERE key='schema_version'; SELECT key,value FROM task21_metadata WHERE key='schema_version'; SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'finance_%' OR name LIKE '%migration%'); PRAGMA table_info(task16_finance_transactions);",'--json'],True)
data['time-travel']=run('time-travel',['d1','time-travel','info','11c288d8-c584-409f-bb1f-7e7af11793e5','--json'],True)
run('production-config',['pages','download','config','thewyj-uk'])
for name,url in [('repo','https://api.github.com/repos/WYJ0904/thewyj.uk'),('pulls','https://api.github.com/repos/WYJ0904/thewyj.uk/pulls?state=open&per_page=30'),('main','https://api.github.com/repos/WYJ0904/thewyj.uk/branches/main')]:
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'finance-isolated-release-audit','Accept':'application/vnd.github+json'})
  value=json.load(urllib.request.urlopen(req,timeout=30));(OUT/(name+'.json')).write_text(json.dumps(value,indent=2))
 except Exception as e:rows.append(dict(name='github-'+name,status='BLOCKED',error_type=type(e).__name__))
(OUT/'result.json').write_text(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),scope='Read-only metadata, flags and schema; no user rows, backup export, migration, deploy or mutations.',commands=rows,data=data),indent=2))
print(json.dumps(dict(commands=[(r['name'],r.get('exit_code')) for r in rows],mutations=False)))
