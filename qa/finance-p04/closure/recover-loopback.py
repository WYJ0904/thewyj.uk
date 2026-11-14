"""Recover only the stopped synthetic loopback backend's actual SQLite snapshot."""
from pathlib import Path
import argparse,hashlib,json,socket,sqlite3
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('--generation',type=int,choices=range(6,20),default=6);args=parser.parse_args()
with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',19443))!=0,'Stop through the owned server endpoint first'
source=ROOT/f'docs/migration-evidence/fp04-live-server{args.generation}/persist/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite'
dest=OUT/f'device-final/private/server{args.generation}-closed';dest.mkdir(exist_ok=False)
connection=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
try:
    assert connection.execute('PRAGMA quick_check').fetchall()==[('ok',)]
    connection.row_factory=sqlite3.Row
    schema=[dict(row) for row in connection.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
    quote=lambda value:'"'+value.replace('"','""')+'"'
    tables={row['name']:[dict(value) for value in connection.execute('SELECT * FROM '+quote(row['name']))] for row in schema if row['type']=='table'}
    sequence=[dict(row) for row in connection.execute('SELECT name,seq FROM sqlite_sequence')]
    assert len(tables)==105 and len(tables['task12_users'])==1 and tables['task12_users'][0]['id']=='synthetic-p03-device-owner'
    assert len(tables['task16_finance_transactions'])==3
    native=sqlite3.connect(dest/'export.sqlite');connection.backup(native);native.close()
finally:connection.close()
snapshot={'schema':schema,'tables':tables,'sequence':sequence,'scope':'Actual SQLite recovery of stopped synthetic QA backend; not Production or a claimed graceful shutdown'}
raw=json.dumps(snapshot).encode();(dest/'snapshot.json').write_bytes(raw)
record={'status':'PASS','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'snapshot_sha256':hashlib.sha256(raw).hexdigest(),'tables':105,'synthetic_transactions':3,'formal_data_read':False,'production':False,'closed_port_confirmed':True,'previous_shutdown_cause':'NOT ESTABLISHED; no fabricated crash attribution'}
target=OUT/('loopback-native-recovery.json' if args.generation==6 else f'loopback-native-recovery-g{args.generation}.json');assert not target.exists();target.write_text(json.dumps(record,indent=2));print(json.dumps(record))
