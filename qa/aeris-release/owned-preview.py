"""Build committed allowlisted bytes and deploy only the already-owned UI QA project."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,hashlib,json,os,re,subprocess,urllib.request

ROOT=Path(__file__).resolve().parents[2]
PROJECT='thewyj-p07-ui-rc';DATABASE='ee869f78-b54a-4018-bc99-871089ecb8cd'
ACCOUNT='97c274a981e8dd6703aa6388e11c4614'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
WRANGLER=ROOT/'node_modules/wrangler/bin/wrangler.js'
p=argparse.ArgumentParser();p.add_argument('--commit',required=True);p.add_argument('--label',required=True);p.add_argument('--deploy',action='store_true');a=p.parse_args()
assert re.fullmatch('[0-9a-f]{40}',a.commit)and re.fullmatch('[a-z0-9-]+',a.label)
OUT=ROOT/'docs/migration-evidence/aeris-p03-p07'/a.label;OUT.mkdir(exist_ok=False)
context=ROOT/'.wrangler/owned-preview-builds'/a.label;context.mkdir(parents=True,exist_ok=False)
record=dict(utc=datetime.now(timezone.utc).isoformat(),commit=a.commit,project=PROJECT,d1_id=DATABASE,
    production_mutations=0,remote_migrations=0,ai_calls=0,context=context.relative_to(ROOT).as_posix())
try:
 record['phase']='existing_auth'
 auth=subprocess.run([str(NODE),str(WRANGLER),'auth','token','--json'],cwd=ROOT,capture_output=True,timeout=30)
 assert auth.returncode==0,'Existing authorized Cloudflare session unavailable'
 credentials=json.loads(auth.stdout);token=credentials.get('token')or credentials.get('oauth_token')or credentials.get('api_token');assert token
 def get(route):
  req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+route,headers={'Authorization':'Bearer '+token})
  with urllib.request.urlopen(req,timeout=30)as response:data=json.load(response)
  assert data.get('success')is True
  return data['result']
 record['phase']='owned_project_metadata'
 project=get('/pages/projects/'+PROJECT);cfg=project['deployment_configs']['preview']
 assert project['name']==PROJECT and cfg['d1_databases']['WYJ_DB']['id']==DATABASE
 assert not cfg.get('r2_buckets')and not cfg.get('ai_bindings')
 plain={k:v['value']for k,v in cfg.get('env_vars',{}).items()if v['type']=='plain_text'}
 record['safe_preview_flags']={k:plain.get(k)for k in ['WORKERS_AI_ENABLED','LEGACY_API_FALLBACK_ENABLED','TASK25_FEATURE_FLAGS_ENABLED','WYJ_ENVIRONMENT']}
 assert not any(re.search('TOKEN|SECRET|PASSWORD|PEPPER|KEY',k,re.I)for k in plain),'Do not serialize plaintext credentials'
 assert str(plain.get('WORKERS_AI_ENABLED')).lower()=='false','Owned Preview must have AI disabled'
 assert plain.get('LEGACY_API_FALLBACK_ENABLED')in [None,'false'],'Owned Preview must have legacy fallback disabled'
 if 'LEGACY_API_FALLBACK_ENABLED'not in plain:
  # The existing product default is false (cloudflare-foundation.mjs). Keep it
  # explicit in this owned Preview's source-of-truth config; no production edit.
  record['owned_preview_var_change']={'LEGACY_API_FALLBACK_ENABLED':{'before':None,'after':'false','existing_product_default':False}}
  plain['LEGACY_API_FALLBACK_ENABLED']='false'
 database=get('/d1/database/'+DATABASE)
 base_config=json.loads((ROOT/'wrangler.jsonc').read_text(encoding='utf-8'))
 local_config=dict(name=PROJECT,pages_build_output_dir='./.wrangler/pages-output',compatibility_date=base_config['compatibility_date'],send_metrics=False,vars=plain,
    d1_databases=[dict(binding='WYJ_DB',database_name=database['name'],database_id=DATABASE,preview_database_id=DATABASE)])
 (context/'package.json').write_text(json.dumps(dict(name='aeris-owned-ui-preview-build',private=True,type='module')),encoding='utf-8')
 (context/'wrangler.jsonc').write_text(json.dumps(local_config,indent=2),encoding='utf-8')
 stage=(ROOT/'scripts/stage_pages_deploy.mjs').as_uri()
 # Ask the reviewed staging policy which Git tree paths are public/build inputs.
 policy_script="import {isAllowedPagesFile} from "+json.dumps(stage)+";let s='';for await(const c of process.stdin)s+=c;console.log(JSON.stringify(JSON.parse(s).filter(isAllowedPagesFile)))"
 tree=subprocess.check_output(['git','ls-tree','-rz',a.commit],cwd=ROOT).split(b'\0');blobs={}
 for row in tree:
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode('utf-8')
  if mode in ['100644','100755']and kind=='blob':blobs[name]=blob
 record['phase']='committed_allowlist_selection'
 selection=subprocess.run([str(NODE),'--input-type=module','-e',policy_script],input=json.dumps(list(blobs)),text=True,capture_output=True,cwd=ROOT,timeout=30)
 assert selection.returncode==0
 names=json.loads(selection.stdout);assert len(names)>=140
 files=[]
 for name in names:
  assert not Path(name).is_absolute()and '..'not in Path(name).parts
  raw=subprocess.check_output(['git','cat-file','blob',blobs[name]],cwd=ROOT)
  dest=context/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
  files.append(dict(path=name,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
 build_script="import {stagePages} from "+json.dumps(stage)+";console.log(JSON.stringify(await stagePages({root:"+json.dumps(str(context))+"})))"
 record['phase']='reviewed_stage'
 built=subprocess.run([str(NODE),'--input-type=module','-e',build_script],cwd=context,capture_output=True,timeout=60)
 assert built.returncode==0,'Reviewed staging validation failed'
 output=context/'.wrangler/pages-output'
 for item in files:assert hashlib.sha256((output/item['path']).read_bytes()).hexdigest()==item['sha256']
 branch='v62-spatial-'+a.commit[:10];assert branch!=project['production_branch']
 record.update(status='BUILD_VERIFIED',file_count=len(files),files=files,branch=branch,secret_names=sorted(k for k,v in cfg.get('env_vars',{}).items()if v['type']!='plain_text'),
   config_plain_sha256=hashlib.sha256(json.dumps(plain,sort_keys=True).encode()).hexdigest(),artifact_tree_sha256=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest())
 if a.deploy:
  command=[str(NODE),str(WRANGLER),'pages','deploy',str(output),'--project-name',PROJECT,'--branch',branch,'--commit-hash',a.commit,'--commit-message','Aeris V6.2 isolated spatial Preview','--commit-dirty=false']
  with (OUT/'deploy.log').open('xb')as stream:deployed=subprocess.run(command,cwd=context,env={**os.environ,'WRANGLER_SEND_METRICS':'false'},stdout=stream,stderr=subprocess.STDOUT,timeout=240)
  record['deploy_exit_code']=deployed.returncode;assert deployed.returncode==0,'Owned Preview deploy failed; raw output retained'
  deployments=get('/pages/projects/'+PROJECT+'/deployments?env=preview&per_page=20')
  current=[d for d in deployments if d.get('deployment_trigger',{}).get('metadata',{}).get('commit_hash')==a.commit]
  assert current,'No deployment metadata matches the committed source'
  deployment=current[0];assert deployment['environment']=='preview'and deployment['latest_stage']['status']=='success'
  record.update(status='PREVIEW_DEPLOYED',deployment_id=deployment['id'],url=deployment['url'],aliases=deployment.get('aliases',[]))
  after=get('/pages/projects/'+PROJECT)['deployment_configs']['preview']
  assert after['d1_databases']['WYJ_DB']['id']==DATABASE and not after.get('r2_buckets')and not after.get('ai_bindings')
  after_plain={k:v['value']for k,v in after.get('env_vars',{}).items()if v['type']=='plain_text'};assert plain==after_plain,'Unexpected owned Preview config drift'
except Exception as error:record.update(status='BLOCKED_OR_FAILED',error_type=type(error).__name__,error=str(error)[:200])
finally:
 (OUT/'result.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
 print(json.dumps({k:v for k,v in record.items()if k not in ['files','secret_names']}))
 if record['status']=='BLOCKED_OR_FAILED':raise SystemExit(1)
