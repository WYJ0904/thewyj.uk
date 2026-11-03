"""Existing-authority, read-only Cloudflare metadata. Never serialize credentials."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,subprocess,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p03-p07'
parser=argparse.ArgumentParser();parser.add_argument('label');args=parser.parse_args();assert re.fullmatch('[a-z0-9-]+',args.label)
OUT=E/args.label;OUT.mkdir(exist_ok=False)
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe';WRANGLER=ROOT/'node_modules/wrangler/bin/wrangler.js'
record=dict(status='IN_PROGRESS',utc=datetime.now(timezone.utc).isoformat(),production_data_writes=0,production_financial_rows_read=0,external_model_calls=0)
try:
    auth=subprocess.run([str(NODE),str(WRANGLER),'auth','token','--json'],cwd=ROOT,capture_output=True,timeout=30)
    assert auth.returncode==0,'Existing credential unavailable; no interactive or alternate secret acquisition'
    credential=json.loads(auth.stdout);token=credential.get('token') or credential.get('oauth_token') or credential.get('api_token');assert token
    base='https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614'
    def get(path):
        request=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(request,timeout=25) as r:raw=r.read(2_000_001)
        assert len(raw)<=2_000_000
        data=json.loads(raw);assert data.get('success') is True
        return data['result']
    p=get('/pages/projects/thewyj-uk');d=p['canonical_deployment'];cfg=p['deployment_configs']['production'];expected=json.loads((ROOT/'wrangler.jsonc').read_text())['env']['production']
    plain={k:v['value'] for k,v in cfg['env_vars'].items() if v['type']=='plain_text'}
    assert plain==expected['vars'],'Production plain configuration differs; investigate before any deployment'
    assert cfg['d1_databases']['WYJ_DB']['id']=='11c288d8-c584-409f-bb1f-7e7af11793e5'
    assert cfg['r2_buckets']['WYJ_STORAGE']['name']=='wyj-cloud-production'
    record['production']=dict(commit=d['deployment_trigger']['metadata']['commit_hash'],deployment_id=d['id'],url=d['url'],stage=d['latest_stage'],build_config=p['build_config'],vars_match=True,vars_sha256=hashlib.sha256(json.dumps(plain,sort_keys=True).encode()).hexdigest(),d1_id=cfg['d1_databases']['WYJ_DB']['id'],r2_bucket=cfg['r2_buckets']['WYJ_STORAGE']['name'])
    sql="SELECT flag_key,enabled,kill_switch,channels_json,rollout_basis_points,revision FROM task25_feature_flags ORDER BY flag_key;SELECT key,value FROM task16_metadata WHERE key='schema_version';SELECT key,value FROM task21_metadata WHERE key='schema_version';SELECT code,price_cents,currency FROM task13_membership_plans WHERE code IN ('finance_monthly','notification_archive_access','all_access_monthly','all_access_lifetime') ORDER BY code;"
    cmd=[str(NODE),str(WRANGLER),'d1','execute','11c288d8-c584-409f-bb1f-7e7af11793e5','--remote','--command',sql,'--json']
    result=subprocess.run(cmd,cwd=ROOT,capture_output=True,timeout=45,env=dict(os.environ,WRANGLER_SEND_METRICS='false',CI='true'))
    assert result.returncode==0,'Metadata read failed; raw credential-bearing output intentionally not logged'
    data=json.loads(result.stdout);assert all(x.get('success') and x['meta']['rows_written']==0 for x in data)
    record['production']['flags']=data[0]['results'];record['production']['finance_schema']=data[1]['results'];record['production']['notification_schema']=data[2]['results'];record['production']['public_prices']=data[3]['results']
    qa=get('/pages/projects/thewyj-p07-ui-rc');q=qa['deployment_configs']['preview'];assert q['d1_databases']['WYJ_DB']['id']=='ee869f78-b54a-4018-bc99-871089ecb8cd'
    assert not q.get('r2_buckets') and not q.get('ai_bindings')
    record['owned_preview']=dict(project='thewyj-p07-ui-rc',d1_id='ee869f78-b54a-4018-bc99-871089ecb8cd',url='https://p07-ui-rc.thewyj-p07-ui-rc.pages.dev',r2_or_ai_binding=False)
    deployments=get('/pages/projects/thewyj-uk/deployments?env=production&per_page=10')
    record['rollback_candidates']=[dict(id=v['id'],commit=v['deployment_trigger']['metadata'].get('commit_hash'),stage=v['latest_stage']['status']) for v in deployments]
    record['status']='PASS'
except urllib.error.HTTPError as e:
    record.update(status='BLOCKED_EXISTING_CLOUDFLARE_AUTH' if e.code in (401,403) else 'FAIL_METADATA_HTTP',http_status=e.code)
except Exception as e:
    record.update(status='FAIL',error_type=type(e).__name__,error=str(e)[:200])
finally:
    (OUT/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k not in ['production','rollback_candidates']}))
