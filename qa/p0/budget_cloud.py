"""Temporary QA Worker: actual owned D1 binding, zero external model calls."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,secrets,subprocess,urllib.request,urllib.error
from cloud_guard import Cloud,ROOT,E,ACCOUNT,NODE
from finance_cloud import validate_resource,DBNAME
NAME='aeris-p0-ai-d1-qa';BASE=E/'cloud';CONTEXT=ROOT/'.wrangler/p0-budget-worker'
p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','deploy','run','cleanup']);p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label)
out=BASE/a.label;out.mkdir(parents=True,exist_ok=False);private=BASE/'private'
env=dict(os.environ,CI='true',NO_COLOR='1',CLOUDFLARE_ACCOUNT_ID=ACCOUNT,WRANGLER_SEND_METRICS='false')
env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
r=validate_resource(json.loads((BASE/'resources.json').read_text()));record=dict(action=a.action,utc=datetime.now(timezone.utc).isoformat(),worker=NAME,database_id=r['database_id'],production_operations=0,external_model_calls=0,commands=[])
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2),encoding='utf8')
def run(name,args,parse=False):
 argv=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*args,'--config',str(CONTEXT/'wrangler.jsonc')]
 with (out/(name+'.log')).open('xb')as log:q=subprocess.run(argv,cwd=CONTEXT,env=env,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,timeout=180)
 record['commands'].append(dict(argv=argv,exit_code=q.returncode));assert q.returncode==0,name+' failed; preserve output'
 value=(out/(name+'.log')).read_text(encoding='utf8-sig');return json.loads(value)if parse else value
try:
 c=Cloud();dbs=c.request('/d1/database?per_page=100');assert any(d['uuid']==r['database_id']and d['name']==DBNAME for d in dbs)
 if a.action=='prepare':
  assert not (BASE/'budget-worker.json').exists()
  assert not any(v['id']==NAME for v in c.request('/workers/scripts')),'Existing Worker is protected'
  CONTEXT.mkdir(parents=True,exist_ok=False);write(CONTEXT/'package.json',dict(private=True))
  cfg=dict(name=NAME,main=str(ROOT/'qa/p0-ai/remote-worker.mjs'),compatibility_date='2026-08-06',send_metrics=False,
   vars=dict(P0_AI_QA_MODE='isolated-synthetic-only',P0_AI_QA_DATABASE_ID=r['database_id']),
   d1_databases=[dict(binding='QA_DB',database_name=DBNAME,database_id=r['database_id'])])
  write(CONTEXT/'wrangler.jsonc',cfg);write(private/'budget-worker-secret.json',dict(P0_AI_QA_TOKEN=secrets.token_urlsafe(32)))
  write(BASE/'budget-worker.json',dict(name=NAME,database_id=r['database_id'],created_by_this_run=False,source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()))
  # This extra table is a QA safety marker, never a product migration.
  sql="CREATE TABLE p0_ai_qa_environment(environment_key TEXT PRIMARY KEY,database_id TEXT NOT NULL);INSERT INTO p0_ai_qa_environment VALUES('aeris-p0-ai-isolated-only','"+r['database_id']+"');"
  run('marker',['d1','execute',r['database_id'],'--remote','--command',sql,'--json'])
 elif a.action=='deploy':
  saved=json.loads((BASE/'budget-worker.json').read_text());assert saved['name']==NAME and saved['database_id']==r['database_id']and saved['created_by_this_run']is False
  text=run('deploy',['deploy']);saved['created_by_this_run']=True;write(BASE/'budget-worker.json',saved)
  urls=re.findall(r'https://'+NAME+r'\.[a-z0-9-]+\.workers\.dev',text);assert len(set(urls))==1
  saved['origin']=urls[0];write(BASE/'budget-worker.json',saved)
  run('secret',['secret','bulk',str(private/'budget-worker-secret.json')])
  settings=c.request('/workers/scripts/'+NAME+'/settings');bindings=settings['bindings']
  assert {b['id']for b in bindings if b['type']=='d1'}=={r['database_id']}
  assert {b['name']for b in bindings if b['type']=='d1'}=={'QA_DB'}
  assert all(b['type']in ['d1','plain_text','secret_text']for b in bindings)
  assert {b['name']for b in bindings if b['type']=='secret_text'}=={'P0_AI_QA_TOKEN'}
  saved['binding_verified']=True;write(BASE/'budget-worker.json',saved);record['origin']=saved['origin']
 elif a.action=='run':
  saved=json.loads((BASE/'budget-worker.json').read_text());assert saved['name']==NAME and saved['database_id']==r['database_id']and saved['created_by_this_run']and saved['binding_verified']
  secret=json.loads((private/'budget-worker-secret.json').read_text())['P0_AI_QA_TOKEN'];origin=saved['origin'];assert re.fullmatch('https://'+NAME+r'\.[a-z0-9-]+\.workers\.dev',origin)
  rows=[]
  for case in ['unauthorized','quota','concurrent-month','event-cap','late-storage-fault','retry-lease']:
   req=urllib.request.Request(origin+'/run/'+('quota'if case=='unauthorized'else case),data=b'',method='POST',headers={'Authorization':'Bearer '+('wrong'if case=='unauthorized'else secret),'User-Agent':'Aeris-P0-QA/1.0 (+https://thewyj.uk)'})
   try:
    with urllib.request.urlopen(req,timeout=60)as response:http=response.status;result=json.load(response)
   except urllib.error.HTTPError as error:http=error.code;result=json.load(error)
   row=dict(case=case,http=http,response=result,status='PASS'if http==401 and case=='unauthorized'else'PASS'if http==200 and result.get('status')=='PASS'and result.get('external_model_calls')==0 and result.get('cleanup_complete')is True else'FAIL')
   rows.append(row);write(out/'cases.json',rows)
  record['cases']=rows;assert all(v['status']=='PASS'for v in rows),'Remote failures retained; no automatic scenario replay'
 elif a.action=='cleanup':
  saved=json.loads((BASE/'budget-worker.json').read_text());assert saved['created_by_this_run']and saved['name']==NAME and saved['database_id']==r['database_id']
  run('delete-worker',['delete','--name',NAME,'--force'])
  assert not any(v['id']==NAME for v in c.request('/workers/scripts'))
  run('remove-marker',['d1','execute',r['database_id'],'--remote','--command','DROP TABLE p0_ai_qa_environment;','--json'])
  record['worker_absent']=True;record['marker_removed']=True
 record['status']='PASS'
except Exception as error:record.update(status='FAIL_OR_BLOCKED',error_type=type(error).__name__,error=str(error)[:250])
record['finished_utc']=datetime.now(timezone.utc).isoformat();write(out/'result.json',record);print(json.dumps({k:v for k,v in record.items()if k!='commands'}))
if record['status']!='PASS':raise SystemExit(1)
