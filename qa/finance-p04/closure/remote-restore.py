"""Restore this run's synthetic D1 export into its newly owned, unbound recovery DB."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,sqlite3,subprocess,time

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('--verify-completed-import',action='store_true');args=parser.parse_args()
DEST=OUT/('hosted-d1-restore-r2' if args.verify_completed_import else 'hosted-d1-restore-r1');DEST.mkdir(exist_ok=False)
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
DB='da1711d7-f770-4e30-b305-9d812588f8b4'
assert DB in (OUT/'cloud-qa-create-restore/stdout.log').read_text()
source=OUT/'private/hosted-backup.sql';sql=source.read_bytes()
assert json.loads((OUT/'cloud-qa-export/command.json').read_text())['status']=='PASS'
env=dict(os.environ,CI='true',NO_COLOR='1',WRANGLER_SEND_METRICS='false')
env['PATH']=str(NODE.parent)+os.pathsep+env.get('PATH','')
commands=[]
def run(name,args,parse_json=True):
    argv=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),*args,'--cwd',str(ROOT/'.wrangler/pages-output')]
    start=time.monotonic()
    with (DEST/(name+'.stdout.log')).open('xb') as stdout,(DEST/(name+'.stderr.log')).open('xb') as stderr:
        process=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=stdout,stderr=stderr)
        try:code=process.wait(60);status='PASS' if code==0 else 'FAIL'
        except subprocess.TimeoutExpired:process.kill();code=process.wait();status='TIMEOUT'
    commands.append(dict(name=name,argv=argv,status=status,exit_code=code,ms=round((time.monotonic()-start)*1000)))
    (DEST/'commands.json').write_text(json.dumps(commands,indent=2))
    assert status=='PASS',name+': '+status
    return json.loads((DEST/(name+'.stdout.log')).read_text(encoding='utf8-sig')) if parse_json else None
QUERY="SELECT id,currency,amount_minor,amount_exponent,revision FROM task16_finance_transactions WHERE user_id='synthetic-p04-closure-owner' AND id LIKE 'synthetic-hosted-p04-%' ORDER BY id; SELECT COUNT(*) AS receipts FROM task16_finance_sync_operations WHERE user_id='synthetic-p04-closure-owner'; SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'; PRAGMA foreign_key_check;"
record={'started':datetime.now(timezone.utc).isoformat(),'target':DB,'source_sha256':hashlib.sha256(sql).hexdigest(),'scope':'Own synthetic remote SQL export and unbound isolated recovery database; Production Time Travel NOT_TESTED'}
try:
    if args.verify_completed_import:
        prior=json.loads((OUT/'hosted-d1-restore-r1/commands.json').read_text())
        assert any(row['name']=='import' and row['status']=='PASS' for row in prior)
    else:
        empty=run('precheck',['d1','execute',DB,'--remote','--json','--command',"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"])
        assert empty[0]['results']==[{'n':0}],'Never restore over an existing database'
    local=OUT/'private/hosted-export-restored.sqlite'
    assert local.exists() if args.verify_completed_import else not local.exists()
    connection=sqlite3.connect(local.as_uri()+'?mode=ro',uri=True) if args.verify_completed_import else sqlite3.connect(local)
    try:
        if not args.verify_completed_import:connection.executescript(sql.decode('utf8'))
        assert connection.execute('PRAGMA quick_check').fetchall()==[('ok',)]
        assert connection.execute('PRAGMA foreign_key_check').fetchall()==[]
        connection.row_factory=sqlite3.Row
        local_rows=[dict(row) for row in connection.execute(QUERY.split(';')[0])]
    finally:connection.close()
    assert len(local_rows)==12
    if not args.verify_completed_import:run('import',['d1','execute',DB,'--remote','--json','--file',str(source)],parse_json=False)
    verified=run('verify',['d1','execute',DB,'--remote','--json','--command',QUERY])
    assert verified[0]['results']==local_rows
    assert verified[1]['results']==[{'receipts':24}]
    assert verified[2]['results']==[{'tables':105}]
    assert verified[3]['results']==[]
    assert all(row['amount_minor']==23456 and row['amount_exponent']==(0 if row['currency']=='JPY' else 2) for row in local_rows)
    record.update(status='PASS',records=12,receipts=24,tables=105,foreign_key_violations=0,exact_ids_units_and_revisions_preserved=True,
                  restored_sqlite_sha256=hashlib.sha256(local.read_bytes()).hexdigest())
except Exception as error:record.update(status='FAIL',error=str(error));raise
finally:
    record['finished']=datetime.now(timezone.utc).isoformat()
    (DEST/'result.json').write_text(json.dumps(record,indent=2))
    print(json.dumps(record))
