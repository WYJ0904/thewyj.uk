"""Versioned repairs for omitted fixture inputs. Frozen files and oracles stay intact."""
from pathlib import Path
import hashlib
import json
import os
import re

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ['FINANCE_CONTRACT_ROOT']).resolve()
assert OUT.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
OUT.mkdir(exist_ok=False,parents=True)
def sha(value):return hashlib.sha256(value).hexdigest()
manifest=[]
source=ROOT/'qa/finance-p02/kotlin/FinanceP02MatrixTest.kt';original=source.read_text(encoding='utf8')
modified=original
for before,after in [
 ('capturedAtMs=1000L)\n            val parserMs=', 'capturedAtMs=1000L,defaultCurrency=f.optString("default_currency").takeIf{it.isNotBlank()},currencyPolicyVersion=2)\n            val parserMs='),
 ('val c=PaymentRecognitionCoordinator(store,now={1000L});c.onSourceEvent(owner,f.getString("package"),type,"p02-source-${f.getString("case_id")}"',
  'val c=PaymentRecognitionCoordinator(store,now={1000L},defaultCurrency={f.optString("default_currency").takeIf{it.isNotBlank()}},currencyPolicyVersion=2);c.onSourceEvent(owner,f.getString("package"),type,"p02-source-${f.getString("case_id")}"'),
]:
    assert modified.count(before)==1,before
    modified=modified.replace(before,after)
oracle=original[original.index('    private fun checkExpected'):]
assert modified[modified.index('    private fun checkExpected'):]==oracle
dest=OUT/'native';(dest/'kotlin').mkdir(parents=True);(dest/'fixtures').mkdir()
(dest/'kotlin'/source.name).write_text(modified,encoding='utf8')
fixture=(ROOT/'qa/finance-p02/fixtures/matrix.json').read_bytes();(dest/'fixtures/matrix.json').write_bytes(fixture)
(dest/'test.init.gradle').write_bytes((ROOT/'qa/finance-p02/test.init.gradle').read_bytes())
manifest.append(dict(source=source.relative_to(ROOT).as_posix(),source_sha256=sha(source.read_bytes()),derived_sha256=sha((dest/'kotlin'/source.name).read_bytes()),fixture_sha256=sha(fixture),oracle_sha256=sha(oracle.encode()),changes='Only parser/coordinator default_currency forwarding and current policy2. All source text, currency, amount, fixture JSON and checkExpected oracle unchanged.'))

source=ROOT/'qa/finance-p02/web-dom.mjs';original=source.read_text(encoding='utf8');modified=original
primary=Path(os.environ['FINANCE_PRIMARY_DOM']).resolve()
rows=[json.loads(line) for line in primary.read_text(encoding='utf8-sig').splitlines() if line]
mixed=[row for row in rows if row['case_id'].startswith('DW-DOM-MIXED-')]
assert len(mixed)==2 and mixed[0]['fixture']==mixed[1]['fixture']
data=mixed[0]['fixture'];assert data['market_data'] is False
imports='''
import {fixture as makeContractFixture} from FIXTURE;
import {referenceRate as contractRate,transactionReferences as contractReferences} from FX;
const declaredContract=DECLARED;
const contractRuntime=await makeContractFixture();
await contractRuntime.db.prepare("INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,'','reset_required',0,'user',?2,?2,?2,?2)").bind('synthetic-finance-p02-dom',new Date().toISOString()).run();
contractRuntime.account.id='synthetic-finance-p02-dom';
for(const [index,id]of ['p02-cny-001','p02-other-001'].entries())await contractRuntime.transaction(declaredContract.currency[index],declaredContract.amount_minor[index],{id,payload:{occurred_at_ms:Date.parse(declaredContract.date+'T12:00:00Z')}});
await contractRate(contractRuntime.db,'USD','CNY',declaredContract.date,{fetcher:async()=>new Response(JSON.stringify({base:'USD',quote:'CNY',date:declaredContract.date,rate:declaredContract.synthetic_rate}),{headers:{'Content-Type':'application/json'}})});
const contractData=await contractReferences(contractRuntime.db,contractRuntime.account.id,{transaction_ids:['p02-other-001'],display_currency:'CNY'},{fetcher:()=>{throw Error('No undeclared provider call')}});
'''.replace('FIXTURE',json.dumps((ROOT/'qa/finance-p04/fixture.mjs').as_uri())).replace('FX',json.dumps((ROOT/'functions/_lib/finance-fx.mjs').as_uri())).replace('DECLARED',json.dumps(data))
modified=imports+modified
before="window.mode='cny';window.writeCalls=0;";assert modified.count(before)==1
modified=modified.replace(before,"window.contractReferences=${JSON.stringify(contractData.references)};\n"+before)
before="apiGet:async p=>p.includes('bootstrap')?{transaction_count:2,server_version:1,"
assert modified.count(before)==1
modified=modified.replace(before,"apiGet:async p=>p.includes('/references')?{references:mode==='mixed'?window.contractReferences:{}}:p.includes('bootstrap')?{money_version:2,currency_preferences:{account_currency:'CNY',display_currency:'CNY',default_currency:null,revision:0},transaction_count:2,server_version:1,")
modified=modified.replace("child.kill();await new Promise(r=>server.close(r));","child.kill();await new Promise(r=>server.close(r));await contractRuntime.dispose();")
for match in list(re.finditer(r"from (['\"])(\.\.?/[^'\"]+)\1",modified)):
    modified=modified.replace(match[0],'from '+json.dumps((source.parent/match[2]).resolve().as_uri()))
modified=modified.replace("const root=path.resolve(import.meta.dirname,'../..');",'const root='+json.dumps(str(ROOT).replace('\\','/'))+';')
modified=modified.replace("path.join(root,'docs/migration-evidence/finance-p02/matrix/web-dom.ndjson')",json.dumps(str(OUT/'web-dom.ndjson').replace('\\','/')))
oracle=[line for line in original.splitlines() if 'const actual=value' in line or 'assert.' in line]
assert [line for line in modified.splitlines() if 'const actual=value' in line or 'assert.' in line]==oracle
(OUT/'web-dom-declared-inputs.mjs').write_text(modified,encoding='utf8')
manifest.append(dict(source=source.relative_to(ROOT).as_posix(),source_sha256=sha(source.read_bytes()),derived_sha256=sha((OUT/'web-dom-declared-inputs.mjs').read_bytes()),fixture=data,primary_evidence=primary.relative_to(ROOT).as_posix(),oracle_sha256=sha('\n'.join(oracle).encode()),changes='Only protocol2 bootstrap capability and the fixture-declared nonmarket rate/date are forwarded. Real product FX/D1 creates immutable references for the original IDs, currencies, amounts and date. Original DOM, write-count guard, /800/ and /200/ assertions unchanged.'))
(OUT/'adaptations.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(OUT)
