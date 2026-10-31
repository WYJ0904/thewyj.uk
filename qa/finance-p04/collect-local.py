"""Join fresh Windows results by identity. Never require failures to become green."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import os
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
HISTORY=ROOT/'docs/migration-evidence/finance-p03'
OLD=HISTORY/'nonphone-entry/cloud-20261021'
BASE=Path(os.environ.get('FINANCE_P04_FINAL_BASE',ROOT/'docs/migration-evidence/finance-p04/local/final-r2')).resolve()
REG=BASE/'regression'
DEST=BASE/os.environ.get('FINANCE_P04_DELIVERY_NAME','delivery-v2')
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def rel(path):return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.as_posix()
def counts(rows):return dict(Counter(row['status'] for row in rows))
def nd(path):return [dict(json.loads(line),evidence=rel(path)) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
def junit(folder):
    result={}
    for path in folder.glob('TEST-*.xml'):
        for case in ET.parse(path).getroot().iter('testcase'):
            key=(case.get('classname'),case.get('name'));assert key not in result,key
            failure=[child for child in case if child.tag in ['failure','error']]
            result[key]=dict(classname=key[0],name=key[1],status='FAIL' if failure else 'SKIP' if case.find('skipped') is not None else 'PASS',
                             failure='\n'.join(''.join(child.itertext()) for child in failure),evidence=rel(path))
    return result
def embedded(text,field):
    for match in re.finditer(r'\{',text):
        try:value,_=json.JSONDecoder().raw_decode(text[match.start():])
        except ValueError:continue
        if isinstance(value,dict) and field in value:return value
    raise AssertionError(field)

full=junit(BASE/'android-current/junit');assert full
android=read(BASE/'android-current/command.json');assert android['source_stable']
protected=set(junit(OLD/'standard-full-junit'));assert len(protected)==681 and protected<=full.keys()
def identity_register(size,prefix):
    # These sealed historical JSONs supply identities only. All statuses below
    # come from this run's current JUnit, never a historical PASS.
    return {(row.get('class',row.get('classname')),row.get('method',row.get('name')))
            for row in read(OLD/f'delivery-final/suite-{size}.json') if row.get('case_id','').startswith(prefix)}
legacy=identity_register(63,'P03-JVM-')
close=identity_register(41,'CO-JVM-')
previous=identity_register(99,'A-JVM-')
final=identity_register(79,'FINAL-JVM-')
original=protected-legacy-close-previous-final
assert [len(x) for x in [original,legacy,close,previous,final]]==[588,26,18,31,18]
windowsHistory=Path(os.environ['USERPROFILE'])/'.codex/worktrees/finance-p03-identity-preauth/thewyj.uk/docs/migration-evidence/finance-p03'
assert set(junit(windowsHistory/'reviewed-final-junit'))==original|legacy
assert set(junit(windowsHistory/'closeout/completion-full-junit'))==original|legacy|close
assert set(junit(windowsHistory/'phase-a/closure-full-junit'))==original|legacy|close|previous
groups=[[dict(full[key],case_id=prefix+key[1]) for key in sorted(keys)] for keys,prefix in [(legacy,'P03-JVM-'),(close,'CO-JVM-'),(previous,'A-JVM-'),(final,'FINAL-JVM-')]]
groups[0]+=nd(REG/'p03-server/server.ndjson')+nd(REG/'p03-legacy/legacy-raw.ndjson')
groups[0]+=[dict(row,evidence=rel(REG/'p03-migration/migration.json')) for row in read(REG/'p03-migration/migration.json')]
groups[1]+=nd(REG/'closeout-server/clearing.ndjson')+nd(REG/'closeout-d1/migration.ndjson')
groups[2]+=nd(REG/'device-reconciliation/reconciliation.ndjson')+nd(REG/'device-correction-migration/migration.ndjson')
for name in ['device-resolution/resolution.ndjson','device-controls/controls.ndjson','device-providers/providers.ndjson','device-d1-migration/migration.ndjson','device-projections/projections.ndjson','device-local-sandbox/sandbox.ndjson']:
    groups[3]+=nd(REG/name)
native=read(REG/'native-persist-auto/result.json');groups[3].append(dict(native,evidence=rel(REG/'native-persist-auto/result.json')))
shortControl=read(REG/'native-short-b/result.json')
pathControl=read(REG/'native-control/result.json')
assert native['status']=='PASS' and pathControl['status']=='FAIL'
assert shortControl['source_sha256']==pathControl['source_sha256'] and native['snapshot_sha256']==shortControl['snapshot_sha256']==pathControl['snapshot_sha256']
assert native['source_sha256']==hashlib.sha256((ROOT/'qa/finance-p03/nonphone/native-persist.mjs').read_bytes()).hexdigest()
bridges={}
for index,name in enumerate(['legacy-bridge','clearing-bridge','correction-bridge','unified-bridge']):
    if name=='legacy-bridge' and not (REG/name/'server-final.json').exists():
        seeded=junit(REG/f'{name}-seed-junit');assert len(seeded)==1 and counts(seeded.values())=={'FAIL':1}
        groups[index].append(dict(next(iter(seeded.values())),case_id=name+'-seed'))
        source=ROOT/'docs/migration-evidence/finance-p03/final/compat-p03/kotlin/P03BridgeTest.kt'
        method=re.search(r'class P03BridgeRestoreTest[\s\S]*?@Test fun (\w+)',source.read_text())[1]
        groups[index].append(dict(classname='uk.thewyj.app.task21.payment.P03BridgeRestoreTest',name=method,status='NOT_TESTED',case_id=name+'-restore',evidence='Not started because original seed failed; original source/account-default precondition was not changed'))
        bridges[name]=dict(status='NOT_TESTED',seed='FAIL',restore='NOT_TESTED',requests=0,reason='Original implicit-CNY seed expected3 bookings, observed1; preserved original fixture. Separate explicit default replay is reported independently.')
        continue
    detail=read(REG/name/'server-final.json')
    seed,restore=read(REG/name/'seed.json'),read(REG/name/'restore.json')
    assert seed['pid']!=restore['pid'],name
    for step in ['seed','restore']:
        rows=junit(REG/f'{name}-{step}-junit');assert len(rows)==1,(name,step,len(rows))
        groups[index].append(dict(next(iter(rows.values())),case_id=f'{name}-{step}'))
    bridges[name]=dict(detail,independent_jvms=True)
for size,rows in zip([63,41,99,79],groups):assert len(rows)==size,(size,len(rows))

old={row['case_id']:row for row in read(OLD/'delivery-final/frozen-608.json')}
matrix=[]
for group in 'ABCDE':matrix+=nd(REG/'frozen-native'/f'kotlin-{group}.ndjson')
for name in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:matrix+=nd(REG/'p02-web'/name)
for name in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:matrix+=nd(REG/'frozen-process'/name)
matrix+=nd(REG/'frozen-native/negative-bookings.ndjson')
matrix.append(dict(read(REG/'frozen-native/timing.json'),evidence=rel(REG/'frozen-native/timing.json')))
for row in old.values():
    if row['case_id'].startswith('G-REUSED-'):
        actual=full[(row['fixture']['class'],row['fixture']['method'])];matrix.append(dict(row,status=actual['status'],evidence=actual['evidence']))
    elif row['case_id'].startswith('NT-'):matrix.append(dict(row,status='NOT_TESTED',evidence='Not exercised: device, Production or out-of-scope AI'))
assert len(matrix)==608 and len({row['case_id'] for row in matrix})==608 and {row['case_id'] for row in matrix}==set(old)
changes=[]
for row in matrix:
    before=old[row['case_id']];assert row.get('fixture')==before.get('fixture'),row['case_id']
    if row['status']!=before['status']:changes.append(dict(case_id=row['case_id'],before=before['status'],after=row['status']))
red26=[dict(before=old[row['case_id']],after=row) for row in matrix if (row.get('group')=='A' and old[row['case_id']]['status']!='PASS') or row['case_id'] in ['C005','C007']]
assert len(red26)==26
currentNative=nd(BASE/'declared-native/kotlin-D.ndjson')
currentDom=nd(ROOT/'docs/migration-evidence/finance-p04/local/contract-input-drivers/web-dom.ndjson')
wired={row['case_id']:row for row in currentNative+currentDom}
contract=[]
currency=[]
for row in matrix:
    before=old[row['case_id']]
    if row.get('group')!='D' or before['status']!='EXPECTED_RED':continue
    ident=row['case_id']
    if ident in ['D004','D008','D016','D020']:
        why='Original driver omits declared default_currency and calls compatibility policy1. The versioned driver forwards that exact fixture field under current policy2; original fixture and checkExpected oracle are byte/hash checked unchanged. Original red is retained separately.'
    elif ident.startswith('DW-DOM-'):
        why='Original mock omits protocol2/declared FX input. Versioned driver forwards original nonmarket rate7/date into real product FX/D1 and supplies its immutable reference to the same controller; original /800/ assertion and all inputs remain unchanged. Original red is retained separately.'
    else:why='Actual original assertion now exercises exact units, source roles or immutable references.'
    actual=wired.get(ident,row);assert actual.get('fixture')==row.get('fixture'),ident
    currency.append(dict(case_id=ident,before=before,frozen_after=row,after=actual,disposition=why))
assert len(currency)==18
currencyIds={row['case_id'] for row in currency}
for row in matrix:
    if row['case_id'] in currencyIds:contract.append(dict(wired.get(row['case_id'],row),raw_frozen_status=row['status'],driver='Versioned input-forwarding adapter for omitted arguments; otherwise same original driver. Fixture and oracle unchanged'))
    else:contract.append(row)

node_log=(REG/'aeris-node.log').read_text(encoding='utf-8')
assert re.search(r'# tests 13\b',node_log)
node_names=re.findall(r'^# Subtest: (.+)$',node_log,re.M);assert len(node_names)==13
node_failed=int(re.search(r'# fail (\d+)',node_log)[1])
assert node_failed==0,'Join individual TAP failures explicitly if this changes'
node_rows=[dict(case_id='ORIGINAL-NODE-'+name,status='PASS',evidence=rel(REG/'aeris-node.log')) for name in node_names]
browser=nd(REG/'aeris-dom/original-six.ndjson');assert len(browser)==6
original607=[full[key] for key in sorted(original)]+node_rows+browser;assert len(original607)==607
trace=junit(REG/'trace-five-junit');assert len(trace)==5
extra=list(trace.values())
for folder,name,size in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
    rows=nd(REG/folder/name);assert len(rows)==size;extra+=rows
assert len(extra)==38
lint=dict(Counter(issue.get('severity') for issue in ET.parse(BASE/'android-current/lint-results-debug.xml').getroot().findall('issue')))
p04={}
for name,file in [('HTTP_D1','contracts/contracts.json'),('migration_restore','migrations/migrations.json'),('default_review_migration','review-migrations/review-migrations.json'),('default_review','default-currency/default-currency.json'),('Chromium','browser/browser.json'),('live_FX','live-fx/live-fx.json')]:
    data=read(REG/file);rows=data if isinstance(data,list) else data['rows'];p04[name]=dict(counts=counts(rows),evidence=rel(REG/file))
for name,file in [('raw_transport','raw-transport/raw-transport.json'),('unit_review','unit-review/unit-review.json')]:
    rows=read(REG/file)['rows'];p04[name]=dict(counts=counts(rows),evidence=rel(REG/file))
for name,file in [('exact_money','money.log'),('simulated_FX','fx.log'),('independent_Decimal_oracle','oracle.log')]:
    result=embedded((REG/file).read_text(encoding='utf-8'),'PASS');p04[name]=dict(result=result,evidence=rel(REG/file))
node_lock=read(REG/'node-source-lock.json');assert node_lock['source_stable']
derivedRoot=BASE/'derived-current-client'
derivedBridge=read(derivedRoot/'legacy-bridge/server-final.json')
assert read(derivedRoot/'legacy-bridge/seed.json')['pid']!=read(derivedRoot/'legacy-bridge/restore.json')['pid']
summary=dict(checked_at_utc=datetime.now(timezone.utc).isoformat(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
             standard_JVM=counts(full.values()),original588=counts(full[key] for key in original),protected681=counts(full[key] for key in protected),
             new_native_methods=counts(full[key] for key in set(full)-protected),new_local_native_methods=counts(full[key] for key in set(full)-set(junit(ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit'))),
             original607=dict(counts=counts(original607),JVM=counts(full[key] for key in original),Node=counts(node_rows),Chrome=counts(browser)),
             overlapping_p03_sets={str(size):counts(rows) for size,rows in zip([63,41,99,79],groups)},new38=counts(extra),frozen608=counts(matrix),frozen_changes=changes,
             currency18=counts(row['after'] for row in currency),currency18_raw=counts(row['frozen_after'] for row in currency),contract608=counts(contract),p03_original26=counts(row['after'] for row in red26),p04=p04,lint=lint,
             bridges=bridges,native_persistence=native,android_source_stable=True,node_source_stable=True,p03_status='PARTIAL',p04_status='PARTIAL',
             backup=read(BASE/'native-backup/backup-restore.json'),upgraded_task21=read(BASE/'upgraded-task21/result.json'),
             explicit_default_bridge=derivedBridge,persistence_path_control=pathControl,persistence_short_control=shortControl,persistence_initial_failure=read(REG/'native-persist/result.json'),
             limits=['No phone, real payment, formal app or Production acceptance.','No trusted provider credentials or original private backup; isolated synthetic integration cannot supply them.','Original identities, fixtures and assertions retained. Overlapping sets are not summed.','Historical separate Activity anomaly remains INCONCLUSIVE; D-01/D-02 stay CLOSED.'])
DEST.mkdir(exist_ok=False)
for name,data in [('summary.json',summary),('jvm-current.json',list(full.values())),('frozen-608.json',matrix),('contract-608.json',contract),('currency-18.json',currency),('p03-original-26.json',red26),('new-38.json',extra),('original-607.json',original607),('failure-ledger.json',[row for row in matrix if row['status']!='PASS']),('jvm-failures.json',[row for row in full.values() if row['status']!='PASS'])]:
    (DEST/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for size,rows in zip([63,41,99,79],groups):(DEST/f'suite-{size}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:value for key,value in summary.items() if key not in ['bridges','native_persistence']},ensure_ascii=False))
