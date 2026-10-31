"""Task-owned finance QA resources only; no Production/shared data operations."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, re, secrets, shutil, subprocess, time
try:
 from .cloud_guard import Cloud, ACCOUNT, NODE, ROOT, E, protected, plan
except ImportError:
 from cloud_guard import Cloud, ACCOUNT, NODE, ROOT, E, protected, plan

PROJECT='aeris-p0-finance-rc'
DBNAME='aeris-p0-finance-rc'
RESTORE='aeris-p0-finance-restore-rc'
PROTECTED={'11c288d8-c584-409f-bb1f-7e7af11793e5','a3e6253b-689f-49f3-998b-7c5828ea255a',
 'ee869f78-b54a-4018-bc99-871089ecb8cd','c2eb978f-9f49-4e4c-8286-f6b398fae0de','da1711d7-f770-4e30-b305-9d812588f8b4'}
BASE=E/'cloud';CONTEXT=ROOT/'.wrangler/p0-finance-context'

def sha(value): return hashlib.sha256(value).hexdigest()
def write(p,v): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf8')
def validate_resource(r):
 assert r['account_id']==ACCOUNT and r['project_name']==PROJECT and r['database_name']==DBNAME
 assert r['created_by_this_run'] is True
 ids=[r[k] for k in ['database_id','restore_database_id'] if k in r]
 assert len(ids)==len(set(ids)) and all(re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',v) and v not in PROTECTED for v in ids)
 return r
def config(r):
 validate_resource(r)
 flags={k:'false' for k in ['TASK11_IMPORT_ENABLED','TASK12_IMPORT_ENABLED','TASK13_IMPORT_ENABLED','TASK14_IMPORT_ENABLED',
  'TASK15_IMPORT_ENABLED','TASK16_IMPORT_ENABLED','TASK21_NOTIFICATION_READS_ENABLED','TASK21_NOTIFICATION_WRITES_ENABLED',
  'TASK22_TRANSFER_READS_ENABLED','TASK22_TRANSFER_WRITES_ENABLED','WORKERS_AI_ENABLED','FINANCE_AI_ENABLED',
  'LEGACY_API_FALLBACK_ENABLED','TASK26_ADAPTIVE_LEARNING_ENABLED']}
 flags.update({k:'true' for k in ['CLOUD_FOUNDATION_ENABLED','CLOUD_READS_ENABLED','CLOUD_WRITES_ENABLED','CLOUD_DEEP_HEALTH_CHECKS',
  'TASK12_CLOUD_ACCOUNTS_ENABLED','TASK13_CLOUD_READS_ENABLED','TASK15_CLOUD_ONLY_ENABLED','TASK16_CLOUD_READS_ENABLED',
  'TASK16_CLOUD_WRITES_ENABLED','TASK20_ANDROID_APP_ENABLED','TASK25_FEATURE_FLAGS_ENABLED','D1_RATE_LIMIT_ENABLED','FINANCE_AI_KILL_SWITCH']})
 flags.update(WYJ_ENVIRONMENT='preview',CLOUD_STATUS_MODE='cloud',CLOUD_RATE_LIMIT_REQUESTS='120',CLOUD_RATE_LIMIT_WINDOW_SECONDS='60',
  ANDROID_LATEST_VERSION_CODE='50',ANDROID_LATEST_VERSION_NAME='1.3.37',ANDROID_MINIMUM_VERSION_CODE='1')
 binding=dict(binding='WYJ_DB',database_name=DBNAME,database_id=r['database_id'],migrations_table='wyj_d1_migrations',migrations_dir=str(ROOT/'cloudflare/migrations'))
 return dict(name=PROJECT,pages_build_output_dir='.',compatibility_date='2026-08-06',send_metrics=False,
  vars=flags,d1_databases=[binding],env=dict(preview=dict(vars=dict(flags),d1_databases=[dict(binding)])))

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['audit','create-db','create-restore','create-project','migrate','prepare','secrets','seed','deploy','verify','export','restore'])
 p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label)
 dest=BASE/a.label;dest.mkdir(parents=True,exist_ok=False);private=BASE/'private';private.mkdir(exist_ok=True)
 context=CONTEXT;context.mkdir(parents=True,exist_ok=True);write(context/'package.json',dict(private=True))
 record=dict(utc=datetime.now(timezone.utc).isoformat(),action=a.action,status='IN_PROGRESS',production_data_mutations=0,
  shared_data_mutations=0,external_model_calls=0,commands=[])
 env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false',CLOUDFLARE_ACCOUNT_ID=ACCOUNT)
 env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
 def run(name,args,cwd=context,parse=False,timeout=240):
  cmd=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*args]
  t=time.monotonic()
  with (dest/(name+'.log')).open('xb') as log:
   child=subprocess.Popen(cmd,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
   record['commands'].append(dict(argv=cmd,pid=child.pid));write(dest/'result.json',record)
   try:code=child.wait(timeout)
   except subprocess.TimeoutExpired:child.kill();child.wait();raise
  record['commands'][-1].update(exit_code=code,elapsed_seconds=round(time.monotonic()-t,3))
  assert code==0,name+' failed; raw output retained'
  text=(dest/(name+'.log')).read_text(encoding='utf8-sig')
  return json.loads(text) if parse else text
 def resources(): return validate_resource(json.loads((BASE/'resources.json').read_text()))
 def all_projects(cloud):
  # Pages currently rejects the documented list query parameters (8000024).
  # Use the installed pinned CLI's supported inventory instead of guessing.
  rows=run('project-inventory',['pages','project','list','--json'],parse=True)
  return [dict(name=v.get('Project Name',v.get('name')),id=v.get('id')) for v in rows]
 def live_own(cloud,r):
  databases=cloud.request('/d1/database?per_page=100')
  for key,name in [('database_id',DBNAME),('restore_database_id',RESTORE)]:
   if key in r: assert any(d['uuid']==r[key] and d['name']==name for d in databases),'Owned D1 identity missing'
  return databases
 try:
  cloud=Cloud();shared=cloud.request('/pages/projects/thewyj-uk');before=protected(shared)
  old,new,rows=plan(shared);assert old==new,'Shared Preview finance branch exclusions must already be active'
  record['shared_protected_before']=before
  if a.action=='audit':
   projects=all_projects(cloud);dbs=cloud.request('/d1/database?per_page=100')
   record.update(projects=[dict(name=v['name'],id=v['id']) for v in projects],databases=[dict(name=v['name'],uuid=v['uuid']) for v in dbs],branch_controls=rows)
  elif a.action=='create-db':
   assert not (BASE/'resources.json').exists(),'Never adopt an unverified old resource'
   dbs=cloud.request('/d1/database?per_page=100');assert all(d['name'] not in [DBNAME,RESTORE] for d in dbs)
   text=run('create-db',['d1','create',DBNAME,'--location','apac','--update-config=false'])
   found=set(re.findall(r'"database_id"\s*:\s*"([0-9a-f-]{36})"',text));assert len(found)==1,'Unexpected CLI create response'
   r=validate_resource(dict(account_id=ACCOUNT,project_name=PROJECT,database_name=DBNAME,database_id=found.pop(),created_by_this_run=True,created_utc=record['utc']))
   write(BASE/'resources.json',r);record['resource']=r;live_own(cloud,r)
  elif a.action=='create-restore':
   r=resources();assert 'restore_database_id' not in r
   assert all(d['name']!=RESTORE for d in live_own(cloud,r))
   text=run('create-restore',['d1','create',RESTORE,'--location','apac','--update-config=false'])
   found=set(re.findall(r'"database_id"\s*:\s*"([0-9a-f-]{36})"',text));assert len(found)==1
   r['restore_database_id']=found.pop();validate_resource(r);write(BASE/'resources.json',r);record['resource']=r;live_own(cloud,r)
  elif a.action=='create-project':
   r=resources();live_own(cloud,r);projects=all_projects(cloud);assert all(v['name']!=PROJECT for v in projects)
   run('create-project',['pages','project','create',PROJECT,'--production-branch','release-held'])
   project=cloud.request('/pages/projects/'+PROJECT);assert project['production_branch']=='release-held' and not project.get('source')
   r['project_created_by_this_run']=True;write(BASE/'resources.json',r)
  elif a.action=='migrate':
   r=resources();live_own(cloud,r);c=config(r);write(context/'wrangler.jsonc',c)
   run('migrations',['d1','migrations','apply','WYJ_DB','--remote','--config',str(context/'wrangler.jsonc')])
   sql="SELECT name FROM wyj_d1_migrations ORDER BY id;SELECT key,value FROM task16_metadata;SELECT key,value FROM task21_metadata;PRAGMA foreign_key_check;"
   record['schema']=run('schema',['d1','execute','WYJ_DB','--remote','--config',str(context/'wrangler.jsonc'),'--command',sql,'--json'],parse=True)
  elif a.action=='prepare':
   r=resources();live_own(cloud,r);assert not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(),'Commit reviewed inputs before stage'
   head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
   stage=ROOT/'.wrangler'/('p0-finance-rc-'+head[:12]);assert not stage.exists()
   subprocess.run([str(NODE),str(ROOT/'scripts/stage_pages_deploy.mjs')],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
   source=ROOT/'.wrangler/pages-output';assert source.resolve()==source and not source.is_symlink()
   files={v.relative_to(source).as_posix():sha(v.read_bytes()) for v in source.rglob('*') if v.is_file()}
   assert len(files)>100 and all(not v.is_symlink() for v in source.rglob('*'))
   shutil.copytree(source,stage);c=config(r);write(stage/'wrangler.jsonc',c);write(stage/'package.json',dict(private=True))
   meta=dict(source_commit=head,project_name=PROJECT,source_tree_sha256=sha(json.dumps(files,sort_keys=True).encode()),
    environment='isolated-finance-qa',synthetic_only=True,production=False,ai_enabled=False)
   write(stage/'__preview/build.json',meta);write(BASE/'stage.json',dict(path=str(stage),head=head,files=files,metadata=meta))
   record.update(staged_files=len(files),metadata=meta)
  elif a.action=='secrets':
   r=resources();assert r.get('project_created_by_this_run');live_own(cloud,r)
   secret_file=private/'secrets.json'
   keys=['WYJ_TASK12_PASSWORD_PEPPER','WYJ_TASK14_TEMPORARY_SECRET','WYJ_TASK20_DEVICE_SESSION_SECRET']
   if secret_file.exists():
    # Resume an interrupted upload using the same owned identity, no rotation.
    values=json.loads(secret_file.read_text());assert set(values)==set(keys) and all(len(v)>=40 for v in values.values())
    record['resumed_existing_secret_file']=True
   else:write(secret_file,{key:secrets.token_urlsafe(36) for key in keys})
   write(context/'wrangler.jsonc',config(r))
   for suffix,label in [([], 'default'),(['--env','preview'],'preview')]:
    run('secrets-'+label,['pages','secret','bulk',str(secret_file),'--project-name',PROJECT,*suffix])
   record['secret_names']=['WYJ_TASK12_PASSWORD_PEPPER','WYJ_TASK14_TEMPORARY_SECRET','WYJ_TASK20_DEVICE_SESSION_SECRET']
  elif a.action=='seed':
   r=resources();live_own(cloud,r)
   assert (private/'accounts.sql').exists(),'Generate fresh synthetic account hashes through task12-crypto first'
   run('seed',['d1','execute',r['database_id'],'--remote','--file',str(private/'accounts.sql'),'--json'])
  elif a.action=='deploy':
   r=resources();live_own(cloud,r);s=json.loads((BASE/'stage.json').read_text());stage=Path(s['path'])
   assert stage.parent==ROOT/'.wrangler' and stage.name=='p0-finance-rc-'+s['head'][:12] and stage.resolve()==stage
   c=json.loads((stage/'wrangler.jsonc').read_text());assert c==config(r)
   assert all(sha((stage/k).read_bytes())==v for k,v in s['files'].items())
   assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==s['head']
   assert not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()
   run('deploy',['pages','deploy',str(stage),'--project-name',PROJECT,'--branch','p0-finance-rc','--commit-hash',s['head'],'--commit-dirty=false'],cwd=stage)
   deployments=cloud.request('/pages/projects/'+PROJECT+'/deployments?per_page=10')
   own=[d for d in deployments if d['deployment_trigger']['metadata'].get('commit_hash')==s['head']]
   assert own;d=own[0];record['deployment']=dict(id=d['id'],url=d['url'],environment=d['environment'],stage=d['latest_stage'],source_commit=s['head'])
   write(BASE/'deployment.json',record['deployment'])
  elif a.action=='verify':
   r=resources();live_own(cloud,r);p=cloud.request('/pages/projects/'+PROJECT)
   assert not p.get('source') and p['production_branch']=='release-held'
   safe=[]
   for name,c in p['deployment_configs'].items():
    ids={d['id'] for d in c.get('d1_databases',{}).values()}
    # An undeployed environment may be empty; every actual binding is owned.
    assert ids in [set(),{r['database_id']}]
    assert not any(c.get(k) for k in ['r2_buckets','ai_bindings','services','service_bindings','kv_namespaces','durable_object_namespaces'])
    flags={k:v.get('value') for k,v in c.get('env_vars',{}).items() if k in ['WORKERS_AI_ENABLED','FINANCE_AI_ENABLED','FINANCE_AI_KILL_SWITCH','WYJ_ENVIRONMENT']}
    if ids: assert flags.get('WORKERS_AI_ENABLED')=='false' and flags.get('FINANCE_AI_ENABLED')=='false' and flags.get('FINANCE_AI_KILL_SWITCH')=='true'
    safe.append(dict(environment=name,database_ids=sorted(ids),flags=flags,secret_names=[k for k,v in c.get('env_vars',{}).items() if v.get('type')=='secret_text']))
   record['verified_configs']=safe
  elif a.action=='export':
   r=resources();live_own(cloud,r);backup=private/('backup-'+a.label+'.sql')
   run('export',['d1','export',r['database_id'],'--remote','--output',str(backup),'--skip-confirmation'])
   record['backup']=dict(path=backup.relative_to(ROOT).as_posix(),sha256=sha(backup.read_bytes()),bytes=backup.stat().st_size,source='owned-synthetic-D1-engine-export')
   write(BASE/'backup.json',record['backup'])
  elif a.action=='restore':
   r=resources();live_own(cloud,r);assert 'restore_database_id' in r
   b=json.loads((BASE/'backup.json').read_text());backup=ROOT/b['path'];assert backup.is_relative_to(private) and sha(backup.read_bytes())==b['sha256']
   # Dedicated empty clone only, never the source QA or any shared database.
   check=run('empty-check',['d1','execute',r['restore_database_id'],'--remote','--command',"SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE '_cf_%' AND name NOT IN ('sqlite_sequence','sqlite_stat1') AND type='table';",'--json'],parse=True)
   assert check[0]['results'][0]['n']==0,'Existing clone data is protected'
   run('restore',['d1','execute',r['restore_database_id'],'--remote','--file',str(backup),'--yes','--json'],timeout=360)
   record['restored_backup_sha256']=b['sha256']
  assert protected(cloud.request('/pages/projects/thewyj-uk'))==before,'Protected shared configuration or Production deployment drifted'
  record['status']='PASS'
 except Exception as error:
  record.update(status='FAIL_OR_BLOCKED',error_type=type(error).__name__,error=str(error)[:240])
 finally:
  record['finished_utc']=datetime.now(timezone.utc).isoformat();write(dest/'result.json',record)
  print(json.dumps({k:v for k,v in record.items() if k not in ['commands','shared_protected_before','projects','databases','schema']}))
 if record['status']!='PASS': raise SystemExit(1)
if __name__=='__main__':main()
