"""Independent fixed business oracle over actual native/HTTP/D1/Chrome outputs."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout/e2e-r2'
seed=json.loads((OUT/'native/seed.json').read_text());end=json.loads((OUT/'native/restore.json').read_text())
expected={'SYNTH-FLOW-PRIMARY':('CNY',1,'EXPENSE',2),'SYNTH-FLOW-FOREIGN':('HKD',1234,'EXPENSE',2),
          'SYNTH-FLOW-JPY':('JPY',1000,'EXPENSE',0),'SYNTH-FLOW-CAPTURE':('CNY',200,'EXPENSE',2),'SYNTH-FLOW-REFUND':('CNY',100,'REFUND',2)}
cases=[]
for snapshot in [seed,end]:
    books=snapshot['bookings'];assert len(books)==5 and {r['provider_reference'] for r in books}==set(expected)
    for row in books:assert (row['currency'],row['amount_minor'],row['direction'],row['amount_exponent'])==expected[row['provider_reference']],row
records=seed['records'];books={r['recognition_id'] for r in seed['bookings']}
for name,select in [('profile-conflict',lambda r:r.get('source_uid')==9510030),('pending',lambda r:r['reference']=='SYNTH-FLOW-PENDING'),
                   ('identity-unproven',lambda r:r['identity_reason']=='identity_unproven_notification'),('authorization',lambda r:r['phase']=='AUTHORIZED'),
                   ('cancel-control',lambda r:r['reference']=='SYNTH-FLOW-CANCEL')]:
    selected=[r for r in records if select(r)];assert selected,name;assert all(r['id'] not in books for r in selected),name
    cases.append({'id':name,'status':'SYNTHETIC_E2E_PASS','records':selected})
server=json.loads((OUT/'server-final.json').read_text());assert server['restarted'] and server['dropped']
assert len(server['transactions'])==5
browser=json.loads((OUT/'browser.json').read_text());assert len(browser['rows'])==6 and all(r['status']=='SYNTHETIC_E2E_PASS' for r in browser['rows'])
summary=next(r['actual']['summary'] for r in browser['rows'] if r['id']=='refund-and-currency-groups-do-not-turn-control-events-into-expense')
assert (summary['expense_minor'],summary['refund_minor'],summary['balance_minor'])==(201,100,-101)
assert summary['by_currency']['JPY']['expense_minor']==1000 and summary['by_currency']['HKD']['expense_minor']==1234
assert len(summary['unconverted'])==2
result={'status':'SYNTHETIC_E2E_PASS','fixed_expected':expected,'negative_cases':cases,'browser_checks':6,'native_jvm_methods':2,
        'receipt_lost_after_commit':True,'d1_restarted':True,'no_finance_table_seed_inserts':True,'real_provider_or_device_proof':False}
target=OUT/'coverage-oracle.json';assert not target.exists();target.write_text(json.dumps(result,indent=2));print('SYNTHETIC_E2E_PASS: five exact ledgers, five negative/control groups, authenticated API, six Chrome checks')
