"""Normal API setup for the already-owned UI Preview, never Production."""
from pathlib import Path
from datetime import datetime, timezone
import json, secrets, urllib.request, urllib.error, hashlib, os, re, subprocess

ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/aeris-p03-p07'
deployment=json.loads((E/'v62-spatial-preview-r1/result.json').read_text())
assert deployment['status']=='PREVIEW_DEPLOYED' and deployment['project']=='thewyj-p07-ui-rc'
assert deployment['d1_id']=='ee869f78-b54a-4018-bc99-871089ecb8cd'
ORIGIN=deployment['url'];assert ORIGIN=='https://ac8cec2c.thewyj-p07-ui-rc.pages.dev'
label=os.environ.get('AERIS_PREVIEW_ACCESS_LABEL','v62-owned-preview-access-r3');assert re.fullmatch('v62-owned-preview-access-r[1-9][0-9]*',label)
OUT=E/label;OUT.mkdir(exist_ok=False)
private=E/'private';private.mkdir(exist_ok=True)
credential_file=private/'v62-owned-preview-access.json'
accounts=json.loads(credential_file.read_text())['accounts']if credential_file.exists()else []
assert len(accounts)<=2 and all(a['scope']in ['owner','validation']and a['role']=='user' for a in accounts)
checks=[]
routes={'/api/status?source=cloud','/api/login','/api/register','/api/me','/api/features','/api/ui/features',
 '/api/admin/feature-flags','/api/admin/membership/manage','/api/finance/bootstrap','/api/logout'}
def api(route,payload=None,token=None,expected=200):
 assert route in routes
 headers={'Content-Type':'application/json','Cache-Control':'no-cache','Accept':'application/json','User-Agent':'Mozilla/5.0 Aeris isolated QA'}
 if token:headers['X-Session-Token']=token
 req=urllib.request.Request(ORIGIN+route,data=None if payload is None else json.dumps(payload).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=30)as r:status=r.status;data=json.load(r)
 except urllib.error.HTTPError as r:status=r.code;data=json.load(r)
 assert status==expected,f'{route}: HTTP {status}, code {data.get("code","unknown")}'
 return data
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
def save():credential_file.write_text(json.dumps(dict(origin=ORIGIN,accounts=accounts),indent=2),encoding='utf-8')
def fixture_entitlement(user_id,admin):
 # The owned Preview deliberately has payment-primary OFF. Do not enable that
 # payment API just to prepare a UI fixture. Only these freshly registered QA
 # users receive an explicit, reversible test entitlement in the owned D1.
 assert user_id in [a['id']for a in accounts]
 node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
 auth=subprocess.run([str(node),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],cwd=ROOT,capture_output=True,timeout=30)
 assert auth.returncode==0
 c=json.loads(auth.stdout);token=c.get('token')or c.get('oauth_token')or c.get('api_token');assert token
 endpoint='https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614'
 def cf(route,data=None):
  req=urllib.request.Request(endpoint+route,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=30)as response:body=json.load(response)
  assert body['success'];return body['result']
 config=cf('/pages/projects/thewyj-p07-ui-rc')['deployment_configs']['preview']
 assert config['d1_databases']['WYJ_DB']['id']==deployment['d1_id']and not config.get('ai_bindings')and not config.get('r2_buckets')
 now=datetime.now(timezone.utc).isoformat()
 sql="""INSERT INTO task13_user_entitlement_overrides(user_id,entitlement_code,allowed,note,updated_by,updated_at)
 SELECT id,'all_features_access',1,'Aeris V6.2 reversible owned Preview UI fixture only',?,?
 FROM task12_users WHERE id=? AND role='user'
 ON CONFLICT(user_id,entitlement_code) DO UPDATE SET allowed=1,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at"""
 rows=cf('/d1/database/'+deployment['d1_id']+'/query',dict(sql=sql,params=[admin['username'],now,user_id]))
 assert len(rows)==1 and rows[0]['success']and rows[0]['meta']['changes']==1
 return dict(mode='explicit_reversible_owned_D1_fixture',scope='fresh_registered_QA_user_only',payment_primary_enabled=False,table='task13_user_entitlement_overrides',entitlement='all_features_access')
result=dict(utc=datetime.now(timezone.utc).isoformat(),origin=ORIGIN,commit=deployment['commit'],
 deployment_id=deployment['deployment_id'],d1_id=deployment['d1_id'],production_mutations=0,ai_calls=0,checks=checks)
admin_session=None
try:
 status=api('/api/status?source=cloud');assert status['environment']=='preview'
 old=json.loads((Path.home()/'.codex/worktrees/p07-ui-release/thewyj.uk/docs/migration-evidence/p07-ui-release/private/preview-accounts.json').read_text())
 admin=next(a for a in old if a['role']=='super_admin' and a['scope']=='maintainer')
 logged=api('/api/login',dict(username=admin['username'],secret=admin['secret']))
 assert logged['account']['id']==admin['id'] and logged['account']['role']=='super_admin'
 admin_session=logged['session'];checks.append(dict(id='normal-preview-admin-login-exact-identity',status='PASS'))
 before=api('/api/admin/feature-flags',token=admin_session)['flags']
 flag=next((f for f in before if f['flag_key']=='p07_accessibility'),None)
 payload=dict(flag_key='p07_accessibility',description='Aeris V6.2 isolated spatial UI acceptance',enabled=True,kill_switch=False,
  channels=['stable','beta','experimental'],rollout_percentage=100,expected_revision=flag['revision'] if flag else 0)
 flag=api('/api/admin/feature-flags',payload,admin_session)['flag']
 after=api('/api/admin/feature-flags',token=admin_session)['flags']
 others=lambda flags:[f for f in flags if f['flag_key']!='p07_accessibility']
 assert digest(others(before))==digest(others(after))
 result.update(flag=flag,other_flags_sha256=digest(others(after)))
 public=api('/api/ui/features');result['public_policy']=public
 assert 'account_id' not in json.dumps(public) and public.get('public_ui',{}).get('enabled') is True
 api('/api/admin/feature-flags',expected=401);api('/api/features',expected=401)
 checks.append(dict(id='owned-p07-on-other-flags-unchanged-public-private-boundary',status='PASS'))
 for scope in ['owner','validation']:
  existing=next((a for a in accounts if a['scope']==scope),None)
  if existing:username=existing['username'];secret=existing['secret'];user=dict(id=existing['id'])
  else:
   username='aeris_v62_'+scope+'_'+secrets.token_hex(4);secret=secrets.token_urlsafe(24)
   user=api('/api/register',dict(username=username,secret=secret,confirm_secret=secret),expected=201)['account']
   accounts.append(dict(id=user['id'],username=username,secret=secret,scope=scope,role='user'));save()
  logged=api('/api/login',dict(username=username,secret=secret));assert logged['account']['id']==user['id']
  ordinary=api('/api/me',token=logged['session']);assert ordinary.get('account',ordinary).get('role')=='user'
  api('/api/admin/feature-flags',token=logged['session'],expected=403)
  api('/api/logout',{},logged['session'])
  fixture=fixture_entitlement(user['id'],admin)
  logged=api('/api/login',dict(username=username,secret=secret));me=api('/api/me',token=logged['session'])['account']
  assert me['id']==user['id']and 'all_features_access'in me['entitlements']and me['role']=='user'
  bootstrap=api('/api/finance/bootstrap',token=logged['session']);assert bootstrap['transaction_count']==0 and bootstrap['raw_event_count']==0
  api('/api/logout',{},logged['session'])
  checks.append(dict(id=scope+'-normal-register-login-nonadmin-test-entitlement-empty-ledger',status='PASS',account_id=user['id'],fixture=fixture))
 result['status']='PASS';result['accounts']=[{k:v for k,v in a.items()if k!='secret'}for a in accounts]
except Exception as error:
 result.update(status='FAIL',error_type=type(error).__name__,error=str(error)[:250])
finally:
 if admin_session:
  try:api('/api/logout',{},admin_session)
  except Exception:pass
 (OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps(dict(status=result['status'],checks=checks,output=OUT.relative_to(ROOT).as_posix())))
 if result['status']!='PASS':raise SystemExit(1)
