"""Compare a real D1 engine export with its isolated clone; test failed DDL rollback."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,re,sqlite3,subprocess
from cloud_guard import Cloud,ROOT,E,NODE,ACCOUNT
from finance_cloud import validate_resource,DBNAME,RESTORE
base=E/'cloud';out=base/'restore-proof-r1';out.mkdir(exist_ok=False)
r=validate_resource(json.loads((base/'resources.json').read_text()));clone=r['restore_database_id'];assert clone!=r['database_id']
backup=json.loads((base/'backup.json').read_text());raw=(ROOT/backup['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==backup['sha256']
record=dict(utc=datetime.now(timezone.utc).isoformat(),source_database_id=r['database_id'],restore_database_id=clone,backup_sha256=backup['sha256'],production_operations=0,cases=[],commands=[])
def save():(out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8')
def rowhash(rows):return hashlib.sha256(json.dumps(sorted(json.dumps(row,sort_keys=True,ensure_ascii=False,separators=(',',':'))for row in rows),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
try:
 cloud=Cloud();dbs=cloud.request('/d1/database?per_page=100')
 assert any(d['uuid']==clone and d['name']==RESTORE for d in dbs)
 local=sqlite3.connect(':memory:');local.row_factory=sqlite3.Row;local.executescript(raw.decode('utf8'))
 tables=[v[0]for v in local.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
 assert len(tables)>90 and all(re.fullmatch('[A-Za-z0-9_]+',v)for v in tables)
 def query(sql):
  results=cloud.request('/d1/database/'+clone+'/query','POST',dict(sql=sql))
  assert all(v.get('success')is True for v in results)
  return results
 def compare(label):
  rows=[]
  for start in range(0,len(tables),8):
   names=tables[start:start+8];actual=query(';'.join('SELECT * FROM "'+n+'"'for n in names)+';');assert len(actual)==len(names)
   for name,value in zip(names,actual):
    expected=[dict(v)for v in local.execute('SELECT * FROM "'+name+'"')]
    observed=value['results'];rows.append(dict(table=name,expected_rows=len(expected),actual_rows=len(observed),expected_sha256=rowhash(expected),actual_sha256=rowhash(observed),same=rowhash(expected)==rowhash(observed)))
  (out/(label+'.json')).write_text(json.dumps(rows,indent=2),encoding='utf8')
  assert all(v['same']for v in rows),'Clone rows differ from exact engine backup'
  return dict(tables=len(rows),rows=sum(v['actual_rows']for v in rows),all_row_hashes_equal=True)
 record['cases'].append(dict(id='engine-backup-restores-every-user-table',status='PASS',actual=compare('initial-rows')));save()
 fk=query('PRAGMA foreign_key_check;')[0]['results'];assert not fk
 record['cases'].append(dict(id='restored-foreign-keys',status='PASS',violations=0));save()
 ctx=out/'context';ctx.mkdir();(ctx/'package.json').write_text('{"private":true}')
 cfg=dict(name='aeris-p0-restore-proof',compatibility_date='2026-08-06',send_metrics=False,d1_databases=[dict(binding='QA_RESTORE',database_name=RESTORE,database_id=clone,migrations_table='wyj_d1_migrations',migrations_dir=str(ROOT/'cloudflare/migrations'))])
 config=ctx/'wrangler.jsonc';config.write_text(json.dumps(cfg,indent=2))
 env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false',CLOUDFLARE_ACCOUNT_ID=ACCOUNT)
 def cli(label,expected_code):
  cmd=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','QA_RESTORE','--remote','--config',str(config)]
  with (out/(label+'.log')).open('xb')as log:p=subprocess.run(cmd,cwd=ctx,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=180)
  record['commands'].append(dict(argv=cmd,exit_code=p.returncode,expected_outcome=expected_code));save()
  assert (p.returncode==0)if expected_code=='success'else(p.returncode!=0)
 cli('repeat-product-migrations','success');record['cases'].append(dict(id='ledger-replay-has-no-product-changes',status='PASS',actual=compare('after-repeat')));save()
 failed=out/'failed-migration';failed.mkdir();(failed/'0035_p0_failure_probe.sql').write_text('CREATE TABLE p0_restore_failure_probe(value INTEGER);\nINSERT INTO p0_restore_failure_probe VALUES(1);\nINSERT INTO p0_restore_table_does_not_exist VALUES(1);\n')
 cfg['d1_databases'][0]['migrations_dir']=str(failed);config.write_text(json.dumps(cfg,indent=2))
 cli('failed-ddl-rollback','expected-failure')
 assert not query("SELECT name FROM sqlite_master WHERE name='p0_restore_failure_probe';")[0]['results']
 assert not query("SELECT name FROM wyj_d1_migrations WHERE name='0035_p0_failure_probe.sql';")[0]['results']
 record['cases'].append(dict(id='failed-incremental-ddl-rolls-back-table-and-ledger',status='PASS',actual=compare('after-failed-ddl')))
 record.update(status='PASS',limitation='Owned synthetic D1 engine export/remote restore and SQL failure rollback. Not a real-user backup, physical power loss, production rollback or restored-client login.')
except Exception as error:record.update(status='FAIL_OR_BLOCKED',error_type=type(error).__name__,error=str(error)[:230])
record['finished_utc']=datetime.now(timezone.utc).isoformat();save();print(json.dumps({k:v for k,v in record.items()if k!='commands'}))
if record['status']!='PASS':raise SystemExit(1)
