"""Bounded metadata reads and an explicitly owned Preview; never mutate shared resources."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,subprocess,time
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/p07-ui-release'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
STAGE=ROOT/'.wrangler/p07-ui-rc-preview-r2'
ACCOUNT='97c274a981e8dd6703aa6388e11c4614'
PROJECT='thewyj-p07-ui-rc';DBNAME='p07-ui-rc-isolated'
PROTECTED={'11c288d8-c584-409f-bb1f-7e7af11793e5','a3e6253b-689f-49f3-998b-7c5828ea255a','c2eb978f-9f49-4e4c-8286-f6b398fae0de','da1711d7-f770-4e30-b305-9d812588f8b4'}
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['audit','create-db','create-project','schema','secrets','seed','deploy','verify-binding','verify-data','owner-state','deployments']);parser.add_argument('--attempt',default='r1');args=parser.parse_args()
assert re.fullmatch('r[1-9][0-9]*',args.attempt)
OUT.mkdir(exist_ok=True);(OUT/'private').mkdir(exist_ok=True)
DEST=OUT/(args.action+'-'+args.attempt);DEST.mkdir(exist_ok=False)
env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false',CLOUDFLARE_ACCOUNT_ID=ACCOUNT)
env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
record={'started_utc':datetime.now(timezone.utc).isoformat(),'action':args.action,'status':'IN_PROGRESS','production_mutations':False,'shared_preview_mutations':False,'commands':[]}
def run(name,parts,parse=False,cwd=None):
    argv=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*parts,'--cwd',str(cwd or DEST)]
    started=time.monotonic()
    with (DEST/(name+'.stdout.log')).open('xb') as out,(DEST/(name+'.stderr.log')).open('xb') as err:
        p=subprocess.Popen(argv,cwd=cwd or DEST,env=env,stdout=out,stderr=err)
        try:code=p.wait(60)
        except subprocess.TimeoutExpired:p.kill();p.wait();raise
    record['commands'].append({'argv':argv,'exit_code':code,'seconds':round(time.monotonic()-started,3)})
    assert code==0,name+' failed; preserve this evidence'
    raw=(DEST/(name+'.stdout.log')).read_text(encoding='utf8-sig')
    return json.loads(raw) if parse else raw
def resources():
    r=json.loads((OUT/'resources.json').read_text());assert r['account_id']==ACCOUNT and r['project_name']==PROJECT and r['database_name']==DBNAME
    assert re.fullmatch('[0-9a-f-]{36}',r['database_id']) and r['database_id'] not in PROTECTED
    return r
def staged():
    r=resources();c=json.loads((STAGE/'wrangler.jsonc').read_text())
    assert STAGE.resolve().is_relative_to(ROOT/'.wrangler') and not STAGE.is_symlink()
    assert c['name']==PROJECT
    assert {v['database_id'] for section in [c,c['env']['preview']] for v in section['d1_databases']}=={r['database_id']}
    assert not any(key in c or key in c['env']['preview'] for key in ['r2_buckets','ai','services','kv_namespaces','durable_objects'])
    return r
try:
    if args.action=='audit':
        remote=subprocess.run(['git','ls-remote','--heads','origin'],cwd=ROOT,capture_output=True,text=True,timeout=60);assert remote.returncode==0
        (DEST/'git-remote-heads.log').write_text(remote.stdout)
        heads={line.split()[1].removeprefix('refs/heads/'):line.split()[0] for line in remote.stdout.splitlines()}
        record['remote_heads']=heads;record['local_head']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        record['remote_finance_head']=heads.get('codex/finance-p04-multicurrency','ABSENT')
        record['projects']=run('projects',['pages','project','list','--json'],True)
        record['production_deployments']=run('production-deployments',['pages','deployment','list','--project-name','thewyj-uk','--environment','production','--json'],True)
        record['shared_preview_deployments']=run('shared-preview-deployments',['pages','deployment','list','--project-name','thewyj-uk','--environment','preview','--json'],True)
        record['databases']=run('databases',['d1','list','--json'],True)
        # Configuration reads only: no auth sessions, user ledger, usernames or financial data.
        sql="SELECT flag_key,enabled,kill_switch,channels_json,rollout_basis_points,revision FROM task25_feature_flags ORDER BY flag_key;SELECT key,value FROM task16_metadata WHERE key='schema_version';SELECT key,value FROM task21_metadata WHERE key='schema_version';"
        record['production_flags_and_versions']=run('production-flags',['d1','execute','11c288d8-c584-409f-bb1f-7e7af11793e5','--remote','--command',sql,'--json'],True)
        config_dir=DEST/'production-config';config_dir.mkdir()
        run('production-config',['pages','download','config','thewyj-uk'],cwd=config_dir)
    elif args.action=='create-db':
        assert not (OUT/'resources.json').exists()
        audit=json.loads((OUT/'audit-r1/result.json').read_text());assert audit['status']=='PASS'
        assert not any(r['name']==DBNAME for r in audit['databases'])
        raw=run('create-db',['d1','create',DBNAME,'--location','apac','--update-config=false'])
        ids=re.findall(r'"database_id"\s*:\s*"([0-9a-f-]{36})"|database_id\s*=\s*"([0-9a-f-]{36})"',raw)
        found={v for pair in ids for v in pair if v};assert len(found)==1, 'Unexpected D1 create output; do not guess'
        identifier=found.pop();assert identifier not in PROTECTED
        r=dict(account_id=ACCOUNT,project_name=PROJECT,database_name=DBNAME,database_id=identifier,branch='p07-ui-rc',production_branch='release-held',created_by_this_run=True)
        (OUT/'resources.json').write_text(json.dumps(r,indent=2));record['resource']=r
    elif args.action=='create-project':
        resources();audit=json.loads((OUT/'audit-r1/result.json').read_text())
        assert not any(r['Project Name']==PROJECT for r in audit['projects'])
        run('create-project',['pages','project','create',PROJECT,'--production-branch','release-held'])
    elif args.action=='schema':
        r=staged();run('schema',['d1','execute',r['database_id'],'--remote','--file',str(OUT/'schema.sql'),'--json'],cwd=STAGE)
    elif args.action=='secrets':
        staged()
        for suffix in [[],['--env','preview']]:run('secrets-'+('preview' if suffix else 'default'),['pages','secret','bulk',str(OUT/'private/preview-secrets.json'),'--project-name',PROJECT,*suffix],cwd=STAGE)
    elif args.action=='seed':
        r=staged();run('seed',['d1','execute',r['database_id'],'--remote','--file',str(OUT/'private/preview-accounts.sql'),'--json'],cwd=STAGE)
    elif args.action=='deploy':
        r=staged();meta=json.loads((STAGE/'__preview/build.json').read_text())
        assert subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()==''
        head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();assert meta['source_commit']==head
        run('deploy',['pages','deploy',str(STAGE),'--project-name',PROJECT,'--branch',r['branch'],'--commit-hash',head,'--commit-dirty=false'],cwd=STAGE)
    elif args.action=='verify-binding':
        r=resources();download=DEST/'actual-config';download.mkdir()
        run('download-config',['pages','download','config',PROJECT],cwd=download)
        files=list(download.glob('wrangler.*'));assert files
        found=set()
        for p in files:found.update(re.findall(r'database_id["\s]*[:=]\s*"([0-9a-f-]+)"',p.read_text()))
        assert found=={r['database_id']},'Actual remote binding differs; do not log in'
        record['verified_database_ids']=sorted(found)
    elif args.action=='owner-state':
        r=staged();sql="SELECT flag_key,enabled,kill_switch,channels_json,rollout_basis_points,revision FROM task25_feature_flags ORDER BY flag_key;SELECT channel,revision FROM task25_release_preferences WHERE user_id='isolated-p04-owner';SELECT COUNT(*) AS overrides FROM task25_user_flag_overrides WHERE user_id='isolated-p04-owner';SELECT COUNT(*) AS owner_transactions FROM task16_finance_transactions WHERE user_id='isolated-p04-owner';"
        record['data']=run('owner-state',['d1','execute',r['database_id'],'--remote','--command',sql,'--json'],True,cwd=STAGE)
    elif args.action=='verify-data':
        r=staged();sql="SELECT COUNT(*) AS transactions FROM task16_finance_transactions;SELECT COUNT(*) AS flags FROM task25_feature_flags;SELECT key,value FROM task16_metadata WHERE key='schema_version';SELECT key,value FROM task21_metadata WHERE key='schema_version';PRAGMA foreign_key_check;"
        record['data']=run('verify-data',['d1','execute',r['database_id'],'--remote','--command',sql,'--json'],True,cwd=STAGE)
    else:
        resources();record['deployments']=run('deployments',['pages','deployment','list','--project-name',PROJECT,'--json'],True,cwd=STAGE)
    record['status']='PASS'
except Exception as error:record.update(status='FAIL',error=str(error));raise
finally:
    record['finished_utc']=datetime.now(timezone.utc).isoformat();(DEST/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k not in {'commands','remote_heads','projects','production_deployments','shared_preview_deployments','databases','production_flags_and_versions'}}))
