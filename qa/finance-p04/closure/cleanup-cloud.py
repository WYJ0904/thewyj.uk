"""Retire this run's disposable hosted QA only after its complete SQL restore proof."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, subprocess, time
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',choices=['r1','r2'],default='r1');args=parser.parse_args()
DEST=OUT/('cloud-cleanup-'+args.attempt);DEST.mkdir(exist_ok=False)
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
STAGE=ROOT/'.wrangler/pages-output'
record={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','production_mutations':False,'shared_preview_mutations':False,'commands':[]}
backup=json.loads((OUT/'cloud-final-backup-r2/result.json').read_text());assert backup['status']=='PASS'
for path,key in [('backup_sql','sql_sha256'),('restored_sqlite','sqlite_sha256')]:
    assert hashlib.sha256((ROOT/backup[path]).read_bytes()).hexdigest()==backup[key]
assert backup['transactions']==19 and backup['finance_receipts']==25 and backup['notification_receipts']==6
owned={'c2eb978f-9f49-4e4c-8286-f6b398fae0de','da1711d7-f770-4e30-b305-9d812588f8b4'}
protected={'11c288d8-c584-409f-bb1f-7e7af11793e5','a3e6253b-689f-49f3-998b-7c5828ea255a'}
env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false');env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
def run(name,parts,parse=False):
    argv=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*parts,'--cwd',str(STAGE)]
    begin=time.monotonic()
    with (DEST/(name+'.stdout.log')).open('xb') as out,(DEST/(name+'.stderr.log')).open('xb') as err:
        p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=out,stderr=err)
        try:code=p.wait(60)
        except subprocess.TimeoutExpired:p.kill();p.wait();raise
    record['commands'].append({'argv':argv,'exit_code':code,'seconds':round(time.monotonic()-begin,3)})
    assert code==0,name+' failed; do not proceed with later deletions'
    return json.loads((DEST/(name+'.stdout.log')).read_text(encoding='utf8-sig')) if parse else None
try:
    before=run('before-d1',['d1','list','--json'],True)
    assert owned|protected<={r['uuid'] for r in before}
    projects=run('before-pages',['pages','project','list','--json'],True)
    assert len([r for r in projects if r['Project Name']=='thewyj-finance-qa'])==1
    assert any(r['Project Name']=='thewyj-uk' for r in projects)
    run('delete-owned-pages',['pages','project','delete','thewyj-finance-qa','--yes'])
    for i,identifier in enumerate(sorted(owned)):
        assert identifier not in protected
        run('delete-owned-d1-'+str(i),['d1','delete',identifier,'--skip-confirmation'])
    after=run('after-d1',['d1','list','--json'],True)
    remaining={r['uuid'] for r in after};assert not owned&remaining and protected<=remaining
    pages_after=run('after-pages',['pages','project','list','--json'],True)
    assert not any(r['Project Name']=='thewyj-finance-qa' for r in pages_after)
    assert any(r['Project Name']=='thewyj-uk' for r in pages_after)
    record.update(status='PASS',owned_pages_deleted=True,owned_deployments_retired=4,owned_d1_deleted=sorted(owned),protected_d1_still_present=True,production_pages_still_present=True,
                  backup_sql_sha256=backup['sql_sha256'],shared_preview_own_failed_login_audits='Preserved: necessary incident evidence; no further mutation to conceal the original binding error',owner_wrangler_keyring='Preserved')
except Exception as error:record.update(status='FAIL',error=str(error));raise
finally:
    record['finished_utc']=datetime.now(timezone.utc).isoformat();(DEST/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
