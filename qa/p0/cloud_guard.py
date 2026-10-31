"""Narrow Pages preview-branch isolation; never changes deployment bindings/data."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,copy,fnmatch,hashlib,json,re,subprocess,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/aeris-p0-closeout'
ACCOUNT='97c274a981e8dd6703aa6388e11c4614';PROJECT='thewyj-uk'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
EXCLUDES=('codex/finance-release-convergence','codex/aeris-finance-quality','codex/aeris-p0-*')
FIELDS=('preview_deployment_setting','preview_branch_includes','preview_branch_excludes')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class Cloud:
 def __init__(self):
  p=subprocess.run([str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],cwd=ROOT,capture_output=True,timeout=30)
  assert p.returncode==0,'Existing authorized Wrangler session unavailable'
  v=json.loads(p.stdout);self.token=v.get('token')or v.get('oauth_token')or v.get('api_token');assert self.token
 def request(self,route,method='GET',body=None):
  assert route.startswith('/')and not route.startswith('//')
  req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+route,
    data=None if body is None else json.dumps(body).encode(),method=method,
    headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=35)as r:data=json.load(r)
  except urllib.error.HTTPError as error:
   try:
    errors=json.load(error).get('errors',[]);codes=[str(e.get('code'))for e in errors]
    # Only static service validation messages; never headers/request bodies.
    reason=';'.join(str(e.get('message',''))for e in errors).replace(self.token,'[redacted]')[:160]
   except Exception:codes=[];reason=''
   raise RuntimeError('Cloudflare HTTP '+str(error.code)+'; route='+route+'; codes='+','.join(codes)+'; '+reason)from None
  assert data.get('success')is True,'Cloudflare request did not succeed'
  return data['result']
def eligible(cfg,branch):
 if branch==cfg.get('production_branch'):return False
 mode=cfg.get('preview_deployment_setting')
 if mode=='none':return False
 if mode=='all':return True
 assert mode=='custom'
 if any(fnmatch.fnmatchcase(branch,p)for p in cfg.get('preview_branch_excludes',[])):return False
 return any(fnmatch.fnmatchcase(branch,p)for p in cfg.get('preview_branch_includes',[]))
def plan(project):
 assert project['name']==PROJECT and project['production_branch']=='main'
 assert project['source']['type']=='github'
 old=copy.deepcopy(project['source']['config'])
 assert old['owner'].lower()=='wyj0904'and old['repo_name']=='thewyj.uk'
 assert old['production_branch']=='main'and old['production_deployments_enabled']is True
 assert old['preview_deployment_setting']in ['all','custom','none']
 new=copy.deepcopy(old)
 if old['preview_deployment_setting']!='none':
  new['preview_deployment_setting']='custom'
  if old['preview_deployment_setting']=='all':new['preview_branch_includes']=['*']
  new['preview_branch_excludes']=list(dict.fromkeys(old.get('preview_branch_excludes',[])+list(EXCLUDES)))
 assert all(old.get(k)==new.get(k)for k in old if k not in FIELDS)
 probes=['codex/finance-release-convergence','codex/aeris-finance-quality','codex/aeris-p0-closeout',
  'codex/aeris-p0-p03','codex/aeris-p0-ocr','codex/aeris-p0-ai',
  'codex/aeris-p07-quality-release','codex/aeris-spatial-preview','codex/android-accessibility-accounting-hotfix','codex/task26-wrong-review','unrelated-branch','main']
 rows=[dict(branch=b,before=eligible(old,b),after=eligible(new,b))for b in probes]
 assert all(not r['after']for r in rows[:6])
 assert all(r['before']==r['after']for r in rows[6:])
 return old,new,rows
def protected(project):
 cfg=copy.deepcopy(project['source']['config'])
 for k in FIELDS:cfg.pop(k,None)
 return dict(source_type=project['source']['type'],source_other=cfg,
   production_branch=project['production_branch'],build_config=project['build_config'],
   deployment_configs_sha256=digest(project['deployment_configs']),domains=project.get('domains'),
   production_deployment_id=project.get('canonical_deployment',{}).get('id'))
def main():
 p=argparse.ArgumentParser();p.add_argument('--label',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 assert re.fullmatch('[a-z0-9-]+',a.label);out=E/a.label;out.mkdir(parents=True,exist_ok=False)
 record=dict(utc=datetime.now(timezone.utc).isoformat(),project=PROJECT,production_data_writes=0,
  database_queries=0,model_calls=0,pages_binding_changes=0,source_control_patch=0)
 try:
  cloud=Cloud();before=cloud.request('/pages/projects/'+PROJECT);old,new,rows=plan(before)
  lock=protected(before);record.update(status='PLAN_VERIFIED',before={k:old.get(k)for k in FIELDS},after={k:new.get(k)for k in FIELDS},branch_controls=rows,protected_before=lock)
  (out/'plan.json').write_text(json.dumps(record,indent=2),encoding='utf8')
  if a.apply and old!=new:
   fresh=cloud.request('/pages/projects/'+PROJECT)
   assert digest(fresh['source'])==digest(before['source'])and protected(fresh)==lock,'Concurrent settings change; no patch made'
   # Full current source config retains every unrelated source-control setting.
   cloud.request('/pages/projects/'+PROJECT,'PATCH',dict(source=dict(type='github',config=new)))
   record['source_control_patch']=1
  after=cloud.request('/pages/projects/'+PROJECT)
  expected=new if a.apply else old
  assert after['source']['config']==expected,'Source settings readback mismatch'
  assert protected(after)==lock,'Unexpected protected configuration or canonical-deployment drift'
  record.update(status='ISOLATED_PUSH_RULES_VERIFIED'if a.apply else 'PLAN_VERIFIED',protected_after=protected(after),
    rollback_preview_fields={k:old.get(k)for k in FIELDS},official_docs=[
    'https://developers.cloudflare.com/pages/configuration/branch-build-controls/',
    'https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/'])
 except Exception as error:record.update(status='BLOCKED_OR_FAILED',error_type=type(error).__name__,error=str(error)[:260])
 (out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8')
 print(json.dumps({k:v for k,v in record.items()if k not in ['protected_before','protected_after','official_docs']}))
 if record['status']=='BLOCKED_OR_FAILED':raise SystemExit(1)
if __name__=='__main__':main()
