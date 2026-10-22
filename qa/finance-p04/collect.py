"""Join final evidence by original identity; preserve frozen failures and inputs."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
HISTORY=ROOT/'docs/migration-evidence/finance-p03'
P03=HISTORY/'nonphone-entry/cloud-20261021'
BASE=ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022'
REG=BASE/'regression'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def relative(p):return str(p.relative_to(ROOT))
def counts(rows):return dict(Counter(row['status'] for row in rows))
def nd(p):return [dict(json.loads(line),evidence=relative(p)) for line in p.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
def junit(folder):
    result={}
    for p in folder.glob('TEST-*.xml'):
        for c in ET.parse(p).getroot().iter('testcase'):
            key=(c.get('classname'),c.get('name'));assert key not in result
            result[key]=dict(classname=key[0],name=key[1],status='FAIL' if c.find('failure') is not None or c.find('error') is not None else 'SKIP' if c.find('skipped') is not None else 'PASS',evidence=relative(p))
    return result
def embedded(text,field):
    decoder=json.JSONDecoder()
    for match in re.finditer(r'\{',text):
        try:v,_=decoder.raw_decode(text[match.start():])
        except ValueError:continue
        if isinstance(v,dict) and field in v:return v
    raise AssertionError(field)

full=junit(BASE/'android-current/junit');assert len(full)==705 and counts(full.values())=={'PASS':705}
protected=set(junit(P03/'standard-full-junit'));assert len(protected)==681 and protected<=full.keys()
initial=junit(HISTORY/'reviewed-final-junit')
original={key for key in initial if '.FinanceP03' not in key[0]}
legacy=set(initial)-original
close=set(junit(HISTORY/'closeout/completion-full-junit'))-set(initial)
previous=set(junit(HISTORY/'phase-a/closure-full-junit'))-original-legacy-close
final=protected-original-legacy-close-previous
assert [len(x) for x in [original,legacy,close,previous,final]]==[588,26,18,31,18]
groups=[[dict(full[k],case_id=prefix+k[1]) for k in sorted(keys)] for keys,prefix in [(legacy,'P03-JVM-'),(close,'CO-JVM-'),(previous,'A-JVM-'),(final,'FINAL-JVM-')]]
groups[0]+=nd(REG/'p03-server/server.ndjson')+nd(REG/'p03-legacy-corrected/legacy-raw.ndjson')
groups[0]+=[dict(r,evidence=relative(REG/'p03-migration/migration.json')) for r in read(REG/'p03-migration/migration.json')]
groups[1]+=nd(REG/'closeout-server/clearing.ndjson')+nd(REG/'closeout-d1/migration.ndjson')
groups[2]+=nd(REG/'device-reconciliation/reconciliation.ndjson')+nd(REG/'device-correction-migration/migration.ndjson')
for name in ['device-resolution/resolution.ndjson','device-controls/controls.ndjson','device-providers/providers.ndjson','device-d1-migration/migration.ndjson','device-projections/projections.ndjson','device-local-sandbox/sandbox.ndjson']:groups[3]+=nd(REG/name)
groups[3].append(dict(read(REG/'native-persist/result.json'),evidence=relative(REG/'native-persist/result.json')))
bridges={}
for index,name in enumerate(['legacy-bridge','clearing-bridge','correction-bridge','unified-bridge']):
    detail=read(REG/name/'server-final.json');assert detail['status']=='PASS'
    assert read(REG/name/'seed.json')['pid']!=read(REG/name/'restore.json')['pid']
    for step in ['seed','restore']:
        rows=junit(REG/f'{name}-{step}-junit');assert len(rows)==1 and counts(rows.values())=={'PASS':1}
        groups[index].append(dict(next(iter(rows.values())),case_id=f'{name}-{step}'))
    bridges[name]=detail
for size,rows in zip([63,41,99,79],groups):assert len(rows)==size and counts(rows)=={'PASS':size},(size,len(rows),counts(rows))

old={r['case_id']:r for r in read(P03/'delivery-final/frozen-608.json')}
matrix=[]
for group in 'ABCDE':matrix+=nd(REG/'frozen-native'/f'kotlin-{group}.ndjson')
for name in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:matrix+=nd(REG/'p02-web'/name)
for name in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:matrix+=nd(REG/'frozen-process'/name)
matrix+=nd(REG/'frozen-native/negative-bookings.ndjson')
matrix.append(dict(read(REG/'frozen-native/timing.json'),evidence=relative(REG/'frozen-native/timing.json')))
for r in old.values():
    if r['case_id'].startswith('G-REUSED-'):
        a=full[(r['fixture']['class'],r['fixture']['method'])];matrix.append(dict(r,status=a['status'],evidence=a['evidence']))
    elif r['case_id'].startswith('NT-'):matrix.append(dict(r,status='NOT_TESTED',evidence='Not exercised: phone, production or out-of-scope AI'))
assert len(matrix)==608 and len({r['case_id'] for r in matrix})==608 and {r['case_id'] for r in matrix}==set(old)
changes=[]
for r in matrix:
    before=old[r['case_id']];assert r.get('fixture')==before.get('fixture'),r['case_id']
    if r['status']!=before['status']:changes.append(dict(case_id=r['case_id'],before=before['status'],after=r['status']))
red26=[dict(before=old[r['case_id']],after=r) for r in matrix if (r.get('group')=='A' and old[r['case_id']]['status']!='PASS') or r['case_id'] in ['C005','C007']]
assert len(red26)==26 and all(r['before']['status']==r['after']['status'] for r in red26)
currency=[]
for r in matrix:
    before=old[r['case_id']]
    if r.get('group')!='D' or before['status']!='EXPECTED_RED':continue
    ident=r['case_id']
    if ident in ['D004','D008','D016','D020']:
        explanation='Frozen native driver omits fixture.default_currency and calls compatibility policy 1; its CNY result remains EXPECTED_RED. Separate policy-2 forwarding checks retain the six original inputs/expected values and pass.'
    elif ident.startswith('DW-DOM-'):
        explanation='Frozen DOM does not supply a rate to the controller; its assertion matches only 800 although its expected description permits explicit unconverted groups. Product shows currency groups and missing reference; no rate is invented.'
    else:explanation='Product exact-unit/original-role/historical-reference implementation now satisfies the unchanged frozen assertion.'
    currency.append(dict(case_id=ident,before=before,after=r,disposition=explanation))
assert len(currency)==18
assert counts(r['after'] for r in currency)=={'PASS':12,'EXPECTED_RED':6}
assert len(changes)==12 and all(c['before']=='EXPECTED_RED' and c['after']=='PASS' for c in changes)

tap=(REG/'aeris-node.log').read_text();assert re.search(r'# tests 13\b',tap) and re.search(r'# fail 0\b',tap)
dom=(REG/'aeris-dom.log').read_text();assert 'AssertionError' in dom
derived=embedded((BASE/'aeris-explicit-currency.log').read_text(),'tests');assert derived['tests']==derived['pass']==6 and derived['fail']==0
original607=dict(PASS=601,FAIL=1,NOT_RUN=5,parts=dict(JVM=588,Node=13,DOM=dict(PASS=0,FAIL=1,NOT_RUN=5)),unmodified_browser_evidence=relative(REG/'aeris-dom.log'),browser_source_sha256=hashlib.sha256((ROOT/'qa/aeris/state-consistency-browser.mjs').read_bytes()).hexdigest(),derived_explicit_CNY=dict(result=derived,evidence=relative(BASE/'aeris-explicit-currency.log'),replaces_original=False))
trace=junit(REG/'trace-five-junit');assert len(trace)==5 and counts(trace.values())=={'PASS':5}
extra=list(trace.values())
for folder,name,size in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
    rows=nd(REG/folder/name);assert len(rows)==size and counts(rows)=={'PASS':size};extra+=rows
assert len(extra)==38
lint=dict(Counter(i.get('severity') for i in ET.parse(BASE/'android-current/lint-results-debug.xml').getroot().findall('issue')));assert not lint.get('Error') and not lint.get('Fatal')
p04={}
for name,folder,size in [('HTTP_D1','contracts-projection',35),('migration_restore','migrations-weak-receipt',12),('Chromium','browser-legacy-unit',13),('live_FX','live-fx-final',12)]:
    file={'HTTP_D1':'contracts.json','migration_restore':'migrations.json','Chromium':'browser.json','live_FX':'live-fx.json'}[name]
    rows=read(BASE/folder/file)['rows'];assert len(rows)==size and counts(rows)=={'PASS':size};p04[name]=dict(counts=counts(rows),evidence=relative(BASE/folder/file))
for name,file,size in [('exact_money','money.log',76),('simulated_FX','fx-final.log',18),('independent_Decimal_oracle','oracle.log',219)]:
    text=(BASE/file).read_text();result=embedded(text,'PASS');assert result['PASS']==size and result.get('FAIL',0)==0;p04[name]=dict(counts=result,evidence=relative(BASE/file))
summary=dict(checked_at_utc=datetime.now(timezone.utc).isoformat(),standard_JVM=counts(full.values()),protected681=counts(full[k] for k in protected),new_native_methods=counts(full[k] for k in set(full)-protected),original607=original607,overlapping_p03_sets={str(size):counts(rows) for size,rows in zip([63,41,99,79],groups)},new38=counts(extra),frozen608=counts(matrix),frozen_changes=changes,currency18=counts(r['after'] for r in currency),p03_original26=counts(r['after'] for r in red26),p04=p04,lint=lint,bridges=bridges,native_persistence=read(REG/'native-persist/result.json'),p03_status='PARTIAL',p04_status='PARTIAL',limits=['Original 26 P03 business targets lack trusted external identity/revision/predecessor facts; historical Activity failure remains unresolved.','Original 607 browser fixture and six frozen currency assertions remain unfulfilled as reported; derived tests do not replace them.','No device, Production, deployment or real financial data acceptance; live FX is public reference data only.','Counts overlap; no summed overall PASS total.'])
dest=BASE/'delivery-final-v2';dest.mkdir(exist_ok=False)
for name,data in [('summary.json',summary),('jvm-705.json',list(full.values())),('frozen-608.json',matrix),('currency-18.json',currency),('p03-original-26.json',red26),('new-38.json',extra),('original-607.json',original607),('failure-ledger.json',[r for r in matrix if r['status']!='PASS'])]:
    (dest/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for size,rows in zip([63,41,99,79],groups):(dest/f'suite-{size}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['bridges','native_persistence','original607']},ensure_ascii=False))
