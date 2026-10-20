"""Retain only this turn's synthetic finance state before deleting test auth."""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
target=OUT/'server7-public-finance.json';assert not target.exists()
assert json.loads((OUT/'server-runtime7/stopped.json').read_text())['stopped']
source=OUT/'private/server7-closed/snapshot.json';snapshot=json.loads(source.read_text())
users=snapshot['tables']['task12_users']
assert len(users)==1 and users[0]['id']=='synthetic-p03-device-owner'
tables={name:rows for name,rows in snapshot['tables'].items() if name.startswith(('task16_','task21_'))}
text=json.dumps(tables,ensure_ascii=False)
assert not re.search(r'(?i)"(?:access_token|refresh_token|session_token|authorization_header|password_hash|password|pepper|cookie|secret)"\s*:',text)
for rows in tables.values():
    for row in rows:
        if 'user_id' in row:assert row['user_id']=='synthetic-p03-device-owner'
state=json.loads((OUT/'server7-final-finance.json').read_text(encoding='utf8-sig'))
tx={row['id']:row for row in tables['task16_finance_transactions']}
assert len(tx)==3 and len(state['transactions'])==3
for row in state['transactions']:assert all(tx[row['id']][key]==value for key,value in row.items())
result={'scope':'Only self-created local synthetic finance state; no auth tables or formal backup','synthetic_only':True,'account_id':'synthetic-p03-device-owner','tables':tables,'schema':[row for row in snapshot['schema'] if row['type']=='table' and row['name'] in tables],'excluded_tables':sorted(set(snapshot['tables'])-set(tables)),'finance_matches_last_live_state':True,'formal_data_read':False,'credentials_retained':False}
target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'status':'PASS','finance_tables':len(tables),'rows':sum(len(rows) for rows in tables.values()),'transactions':len(tx),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'private_auth_tables_exported':False}))
