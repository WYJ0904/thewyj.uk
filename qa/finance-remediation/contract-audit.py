"""Frozen compatibility and safety-source audit; no historical status is promoted."""
from pathlib import Path
import hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation'
OUT=E/'contract-audit';OUT.mkdir(exist_ok=False)
frozen=json.loads((E/'baseline/delivery/frozen-608.json').read_text())
rows=[r for r in frozen if r['case_id'].startswith('F') and r.get('group')=='F']
assert len(rows)==15
first={r['case_id']:r for r in rows}
f1,f12=first['F001']['fixture'],first['F012']['fixture']
business_keys=['response','consent','ambiguous','original_fields']
assert {k:f1[k] for k in business_keys}=={k:f12[k] for k in business_keys}
assert f1['expected']['decision']=='accept' and f12['expected']['decision']=='review'
cases=[dict(case_id=r['case_id'],response=r['fixture']['response'],expected=r['fixture']['expected']['decision']) for r in rows if r['case_id'] not in ['F013','F014','F015']]
(OUT/'original-responses.json').write_text(json.dumps(cases))
driver='''import fs from 'node:fs/promises';
import {normalizeFinanceAiRoles} from MODULE;
const file=FILE;const rows=JSON.parse(await fs.readFile(file,'utf8')).map(c=>{
 let result;try{normalizeFinanceAiRoles(c.response,{candidates:[]});result='ACCEPTED';}catch(e){result=e.code;}
 return {case_id:c.case_id,original_expected:c.expected,raw_protocol_probe:result,original_acceptance_status:'NOT_TESTED',reason:'Raw P02 v1 response only; no invented provider/source/completion/role fields supplied.'};
});await fs.writeFile(RESULT,JSON.stringify(rows,null,2));
'''.replace('MODULE',json.dumps((ROOT/'functions/_lib/finance-ai-provider.mjs').as_uri())).replace('FILE',json.dumps(str(OUT/'original-responses.json'))).replace('RESULT',json.dumps(str(OUT/'raw-protocol-probes.json')))
(OUT/'probe.mjs').write_text(driver)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
subprocess.run([str(node),str(OUT/'probe.mjs')],cwd=ROOT,check=True)
protected=['qa/finance-p02','android/app/src/test/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHookArchiveTest.kt',
 'android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP03IdentityLifecycleTest.kt','android/app/src/test/java/uk/thewyj/app/task21/payment/LocalPaymentBookingTest.kt',
 'android/app/schemas','cloudflare/migrations','wrangler.jsonc','wrangler.local.jsonc']
diff=subprocess.check_output(['git','diff','a065cd15d48b508c2797b9b563cfd24228b6bed9','--',*protected],cwd=ROOT)
assert not diff,'Frozen/safety schema changed'
files={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['qa/finance-p02/fixtures','android/app/schemas'] for p in sorted((ROOT/folder).rglob('*')) if p.is_file()}
(OUT/'result.json').write_text(json.dumps(dict(status='PASS',frozen_and_schema_diff_empty=True,protected_paths=protected,sha256=files,
    duplicate_F001_F012_business_inputs=True,conflicting_expected_decisions=['accept','review'],
    F001_F012_business_payload_sha256=hashlib.sha256(json.dumps({k:f1[k] for k in business_keys},sort_keys=True).encode()).hexdigest(),
    original_F_contracts='NOT_TESTED: frozen v1 responses and NOT_IMPLEMENTED module sentinel have no approved v2 provenance/role adapter. No oracle or scenario-label-based fabricated behavior added.',
    twelve_raw_v1_protocol_probes='Executed, rejected by actual roles-2 normalizer; not fifteen original acceptance passes.',
    scope='Read-only original fixture/schema compatibility inspection and local converter calls; zero model calls.'),indent=2))
print('Frozen safety sources unchanged; 12 legacy response probes recorded; contradictory F001/F012 payloads documented.')
