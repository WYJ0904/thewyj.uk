"""Collect current closure evidence only; historical identities are not historical PASSes.

--check lists pending inputs without creating a delivery. Default execution is
fail-closed, writes only delivery-current, and never edits a fixture or oracle.
Overlapping suites remain separate; the report contains no summed grand total.
"""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import os
import subprocess
import argparse
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[3]
HISTORY=ROOT/'docs/migration-evidence/finance-p03'
OLD=HISTORY/'nonphone-entry/cloud-20261021'
BASE=Path(os.environ.get('FINANCE_P05_FINAL',ROOT/'docs/migration-evidence/finance-p04/non-device-closeout/final-r1')).resolve();assert BASE.is_relative_to(ROOT/'docs/migration-evidence/finance-p04/non-device-closeout')
REG=BASE/'regression'
deliveryLabel=os.environ.get('FINANCE_CLOSURE_DELIVERY','delivery-current')
assert re.fullmatch('delivery-current(?:-r[0-9]+)?',deliveryLabel)
DEST=BASE/deliveryLabel
INPUTS=set()
def tracked(path):
    path=Path(path).resolve(); INPUTS.add(path); return path
def read(path):return json.loads(tracked(path).read_text(encoding='utf-8-sig'))

def extra_commands():
    result=read(BASE/'extra-commands.json')
    for path in sorted(BASE.glob('extra-commands-resume-r*.json')):result+=read(path)
    return result
def rel(path):return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.as_posix()
def counts(rows):return dict(Counter(row['status'] for row in rows))
def nd(path):return [dict(json.loads(line),evidence=rel(path)) for line in tracked(path).read_text(encoding='utf-8-sig').splitlines() if line.strip()]
def junit(folder):
    result={}
    for path in folder.glob('TEST-*.xml'):
        for case in ET.parse(tracked(path)).getroot().iter('testcase'):
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

def pending_inputs():
    required=[
        'android-current/command.json','android-current/lint-results-debug.xml',
        'regression/node-commands.json','regression/node-source-lock.json',
        'regression/jvm-commands.json','extra-commands.json',
        'declared-native/kotlin-D.ndjson','contract-input-drivers/web-dom.ndjson',
        'declared-native-command/command.json','explicit-v2-command/command.json',
        'backup-seed-command/command.json','backup-restore-command/command.json',
        'contract-input-drivers/adaptations.json',
        'regression/native-persist-auto/result.json',
        'native-backup/backup-restore.json','upgraded-task21/result.json',
        'derived-current-client/legacy-bridge/server-final.json',
        'derived-current-client/legacy-bridge/seed.json',
        'derived-current-client/legacy-bridge/restore.json',
        'regression/p03-server/server.ndjson','regression/p03-legacy/legacy-raw.ndjson',
        'regression/p03-migration/migration.json','regression/closeout-server/clearing.ndjson',
        'regression/closeout-d1/migration.ndjson',
        'regression/device-reconciliation/reconciliation.ndjson',
        'regression/device-correction-migration/migration.ndjson',
        'regression/device-resolution/resolution.ndjson','regression/device-controls/controls.ndjson',
        'regression/device-providers/providers.ndjson','regression/device-d1-migration/migration.ndjson',
        'regression/device-projections/projections.ndjson','regression/device-local-sandbox/sandbox.ndjson',
        'regression/p02-web/web-pure.ndjson','regression/p02-web/web-dom.ndjson',
        'regression/p02-web/ledger-d1.ndjson','regression/p02-web/ai-contract.ndjson',
        'regression/frozen-process/process-G-PROCESS-SEED.ndjson',
        'regression/frozen-process/process-G-PROCESS-RESTORE.ndjson',
        'regression/frozen-native/negative-bookings.ndjson','regression/frozen-native/timing.json',
        'regression/aeris-node.log','regression/aeris-dom/original-six.ndjson',
        'regression/legacy-projection-release/legacy-controls.ndjson',
        'regression/legacy-browser-release/legacy-browser.ndjson',
        'regression/provider-identity-final/provider-identity.ndjson',
        'regression/contracts/contracts.json','regression/migrations/migrations.json',
        'regression/review-migrations/review-migrations.json','regression/default-currency/default-currency.json',
        'regression/browser/browser.json','regression/live-fx/live-fx.json',
        'regression/raw-transport/raw-transport.json','regression/unit-review/unit-review.json',
        'regression/money.log','regression/fx.log','regression/oracle.log',
    ]
    required += [f'regression/frozen-native/kotlin-{group}.ndjson' for group in 'ABCDE']
    for name in ['clearing-bridge','correction-bridge','unified-bridge']:
        required += [f'regression/{name}/{file}.json' for file in ['server-final','seed','restore']]
    missing=[rel(BASE/name) for name in required if not (BASE/name).is_file()]
    for name in ['android-current/junit','regression/trace-five-junit','regression/legacy-bridge-seed-junit','explicit-v2-command/junit']:
        if not list((BASE/name).glob('TEST-*.xml')):missing.append(rel(BASE/name)+' / TEST-*.xml')
    extra=BASE/'extra-commands.json'
    if extra.exists():
        actual={row['name'] for row in extra_commands()}
        expected={'prepare-backup','declared-native','explicit-v2','backup-seed','backup-restore','declared-dom','task21-capability3','current-projection','native-persistence','explicit-currency-bridge'}
        missing += ['Incomplete command record: '+name for name in sorted(expected-actual)]
    return missing

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check',action='store_true',help='Print pending artifacts; do not create or overwrite a delivery')
args=parser.parse_args()
missing=pending_inputs()
if args.check or missing:
    print(json.dumps(dict(status='PENDING' if missing else 'READY',base=rel(BASE),missing=missing),ensure_ascii=False,indent=2))
    sys.exit(2 if missing else 0)

full=junit(BASE/'android-current/junit');assert full
android=read(BASE/'android-current/command.json');assert android['source_stable']
previousP05=read(ROOT/'docs/migration-evidence/finance-p04/continuation-p05/final-r7/android-current/command.json')
beforeP05=read(ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current/android-current/command.json')
previousKeys={(r['classname'],r['name']) for r in previousP05['cases']}
beforeKeys={(r['classname'],r['name']) for r in beforeP05['cases']}
assert len(previousKeys)==767 and len(beforeKeys)==730 and beforeKeys<=previousKeys<=full.keys()
p05Previous37=[full[k] for k in sorted(previousKeys-beforeKeys)];assert len(p05Previous37)==37
previousStatuses={(r['classname'],r['name']):r['status'] for r in previousP05['cases']}
newFailures=[k for k,r in full.items() if r['status']=='FAIL' and previousStatuses.get(k)!='FAIL']
regressionComparison=dict(previous_methods=len(previousKeys),current_methods=len(full),
    added_methods=[full[k] for k in sorted(full.keys()-previousKeys)],
    changed_previous_statuses=[dict(classname=k[0],name=k[1],before=previousStatuses[k],after=full[k]['status'])
                               for k in sorted(previousKeys) if previousStatuses[k]!=full[k]['status']],
    new_failure_identities=[dict(classname=k[0],name=k[1]) for k in sorted(newFailures)],
    status='FAIL' if newFailures else 'PASS',scope='Current results versus historical method identities and statuses; historical PASSes are never substituted')
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
# These controls explain a prior long-path failure; they were NOT rerun now.
# Their historical outcomes are never added to the current suite counts.
historicalControls=[]
for name in ['native-short-b','native-control','native-persist']:
    historical=ROOT/'docs/migration-evidence/finance-p04/local/final-r2/regression'/name/'result.json'
    historicalControls.append(dict(status='HISTORICAL_NOT_RERUN',counted_as_current=False,evidence=rel(historical),exists=historical.exists()))
assert native['source_sha256']==hashlib.sha256(tracked(ROOT/'qa/finance-p03/nonphone/native-persist.mjs').read_bytes()).hexdigest()
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
        actual=full[(row['fixture']['class'],row['fixture']['method'])]
        matrix.append(dict(row,status=actual['status'],evidence=actual['evidence'],
            historical_actual=row.get('actual'),historical_closeout_disposition=row.get('closeout_disposition'),
            actual=dict(junit=actual['status'],classname=actual['classname'],method=actual['name'],failure=actual['failure'],evidence=actual['evidence']),
            closeout_disposition='Current unmodified JUnit result; historical result/disposition retained separately and never counted as current PASS'))
    elif row['case_id'].startswith('NT-'):matrix.append(dict(row,status='NOT_TESTED',evidence='Not exercised: device, Production or out-of-scope AI'))
assert len(matrix)==608 and len({row['case_id'] for row in matrix})==608 and {row['case_id'] for row in matrix}==set(old)
changes=[]
for row in matrix:
    before=old[row['case_id']];assert row.get('fixture')==before.get('fixture'),row['case_id']
    if row['status']!=before['status']:changes.append(dict(case_id=row['case_id'],before=before['status'],after=row['status']))
red26=[dict(before=old[row['case_id']],after=row) for row in matrix if (row.get('group')=='A' and old[row['case_id']]['status']!='PASS') or row['case_id'] in ['C005','C007']]
assert len(red26)==26
adaptations=read(BASE/'contract-input-drivers/adaptations.json')
assert len(adaptations)==2
for item in adaptations:
    source=ROOT/item['source']
    assert hashlib.sha256(tracked(source).read_bytes()).hexdigest()==item['source_sha256'],item['source']
    target=BASE/'contract-input-drivers'/('native/kotlin/FinanceP02MatrixTest.kt' if source.suffix=='.kt' else 'web-dom-declared-inputs.mjs')
    assert hashlib.sha256(tracked(target).read_bytes()).hexdigest()==item['derived_sha256'],str(target)
    originalText=source.read_text(encoding='utf-8');derived=target.read_text(encoding='utf-8')
    if source.suffix=='.kt':
        oldOracle=originalText[originalText.index('    private fun checkExpected'):]
        newOracle=derived[derived.index('    private fun checkExpected'):]
        assert oldOracle==newOracle
        assert hashlib.sha256(oldOracle.encode()).hexdigest()==item['oracle_sha256']
        fixture=tracked(ROOT/'qa/finance-p02/fixtures/matrix.json').read_bytes()
        assert tracked(BASE/'contract-input-drivers/native/fixtures/matrix.json').read_bytes()==fixture
        assert hashlib.sha256(fixture).hexdigest()==item['fixture_sha256']
    else:
        oldOracle=[line for line in originalText.splitlines() if 'const actual=value' in line or 'assert.' in line]
        newOracle=[line for line in derived.splitlines() if 'const actual=value' in line or 'assert.' in line]
        assert oldOracle==newOracle
        assert hashlib.sha256('\n'.join(oldOracle).encode()).hexdigest()==item['oracle_sha256']

currentNative=nd(BASE/'declared-native/kotlin-D.ndjson')
currentDom=nd(BASE/'contract-input-drivers/web-dom.ndjson')
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

node_log=tracked(REG/'aeris-node.log').read_text(encoding='utf-8')
assert re.search(r'# tests 13\b',node_log)
node_names=re.findall(r'^# Subtest: (.+)$',node_log,re.M);assert len(node_names)==13
tap=list(re.finditer(r'^(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*?)?$',node_log,re.M))
assert len(tap)==13 and [match[2] for match in tap]==node_names
node_rows=[dict(case_id='ORIGINAL-NODE-'+match[2],status='SKIP' if match[3]=='SKIP' else 'FAIL' if match[1]=='not ok' else 'PASS',evidence=rel(REG/'aeris-node.log')) for match in tap]
assert sum(row['status']=='FAIL' for row in node_rows)==int(re.search(r'# fail (\d+)',node_log)[1])
browser=nd(REG/'aeris-dom/original-six.ndjson');assert len(browser)==6
original607=[full[key] for key in sorted(original)]+node_rows+browser;assert len(original607)==607
trace=junit(REG/'trace-five-junit');assert len(trace)==5
extra=list(trace.values())
for folder,name,size in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
    rows=nd(REG/folder/name);assert len(rows)==size;extra+=rows
assert len(extra)==38
lint=dict(Counter(issue.get('severity') for issue in ET.parse(tracked(BASE/'android-current/lint-results-debug.xml')).getroot().findall('issue')))
p04={}
for name,file in [('HTTP_D1','contracts/contracts.json'),('migration_restore','migrations/migrations.json'),('default_review_migration','review-migrations/review-migrations.json'),('default_review','default-currency/default-currency.json'),('Chromium','browser/browser.json'),('live_FX','live-fx/live-fx.json')]:
    data=read(REG/file);rows=data if isinstance(data,list) else data['rows'];p04[name]=dict(counts=counts(rows),evidence=rel(REG/file))
for name,file in [('raw_transport','raw-transport/raw-transport.json'),('unit_review','unit-review/unit-review.json')]:
    rows=read(REG/file)['rows'];p04[name]=dict(counts=counts(rows),evidence=rel(REG/file))
for name,file in [('exact_money','money.log'),('simulated_FX','fx.log'),('independent_Decimal_oracle','oracle.log')]:
    result=embedded(tracked(REG/file).read_text(encoding='utf-8'),'PASS');p04[name]=dict(result=result,evidence=rel(REG/file))
node_lock=read(REG/'node-source-lock.json');assert node_lock['source_stable']
derivedRoot=BASE/'derived-current-client'
derivedBridge=read(derivedRoot/'legacy-bridge/server-final.json')
assert read(derivedRoot/'legacy-bridge/seed.json')['pid']!=read(derivedRoot/'legacy-bridge/restore.json')['pid']
explicitV2=list(junit(BASE/'explicit-v2-command/junit').values());assert len(explicitV2)==10
nodeCommands=read(REG/'node-commands.json');assert len(nodeCommands)==34
jvmCommands=read(REG/'jvm-commands.json');assert len(jvmCommands)==11
extraCommands=extra_commands()
projectionCurrent=next(row for row in extraCommands if row['name']=='current-projection')
assert projectionCurrent['exit_code']==0
projectionDisposition=dict(current=projectionCurrent,classification='QA_INPUT_PATH_PREPARATION_REPAIRED',
    earlier_failures='continuation-p05/final-r3/{current-projection,native-persistence}.log',
    original_failures_preserved=True,product_assertions_ran_in_failed_attempts=False,rows_counted_once=True)
versionedNativeCommands={name:read(BASE/(name+'-command/command.json')) for name in ['declared-native','explicit-v2','backup-seed','backup-restore']}
for name,record in versionedNativeCommands.items():
    assert record['source_stable'],name
    assert record['head_before']==record['head']==android['head'],name
backupProof=read(BASE/'native-backup/backup-restore.json')
assert backupProof['seed_pid']!=backupProof['restore_pid']
for name,expected in node_lock['after']['files'].items():
    assert hashlib.sha256(tracked(ROOT/name).read_bytes()).hexdigest()==expected, 'Node scoped source changed: '+name
# Native P05 changes do not change the exactly byte-bound JS/SQL suite. Both execution heads are retained.
assert android['head_before']==android['head'] and android['source_stable']
for artifact in android['artifacts']:
    artifactPath=ROOT/Path(artifact['path'].replace('\\','/'))
    assert artifactPath.is_file(),str(artifactPath)
    assert hashlib.sha256(tracked(artifactPath).read_bytes()).hexdigest()==artifact['sha256'],str(artifactPath)

summary=dict(checked_at_utc=datetime.now(timezone.utc).isoformat(),tested_head=android['head'],evidence_base=rel(BASE),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
             standard_JVM=counts(full.values()),original588=counts(full[key] for key in original),protected681=counts(full[key] for key in protected),
             p05_previous37=counts(p05Previous37),
             new_native_methods=counts(full[key] for key in set(full)-protected),new_local_native_methods=counts(full[key] for key in set(full)-set(junit(ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit'))),
             original607=dict(counts=counts(original607),JVM=counts(full[key] for key in original),Node=counts(node_rows),Chrome=counts(browser)),
             overlapping_p03_sets={str(size):counts(rows) for size,rows in zip([63,41,99,79],groups)},new38=counts(extra),frozen608=counts(matrix),frozen_changes=changes,
             currency18=counts(row['after'] for row in currency),currency18_raw=counts(row['frozen_after'] for row in currency),contract608=counts(contract),p03_original26=counts(row['after'] for row in red26),p04=p04,lint=lint,
             bridges=bridges,native_persistence=native,android_source_stable=True,node_source_stable=True,p03_status='PARTIAL',p04_status='PARTIAL',
             android_current_command=dict(evidence=rel(BASE/'android-current/command.json'),exit_code=android['exit_code'],started_utc=android['started_utc'],finished_utc=android['finished_utc'],artifacts=android['artifacts']),backup=backupProof,upgraded_task21=read(BASE/'upgraded-task21/result.json'),explicit_v2=counts(explicitV2),commands=dict(Node=nodeCommands,JVM=jvmCommands,extra=extraCommands),projection_qa_retry=projectionDisposition,
             explicit_default_bridge=derivedBridge,historical_persistence_controls=historicalControls,
             limits=['This collector covers current local tests only. Samsung, real WeChat and hosted evidence are separate and are not counted in these local totals.','No trusted provider credentials or original private backup; isolated synthetic integration cannot supply them.','Original identities, fixtures and assertions retained. Overlapping sets are not summed.','Historical separate Activity anomaly remains INCONCLUSIVE; D-01/D-02 stay CLOSED.'])
assert not DEST.exists(),f'Existing evidence is preserved: {DEST}'
DEST.mkdir(exist_ok=False)
for name,data in [('summary.json',summary),('jvm-current.json',list(full.values())),('frozen-608.json',matrix),('contract-608.json',contract),('currency-18.json',currency),('p03-original-26.json',red26),('new-38.json',extra),('original-607.json',original607),('failure-ledger.json',[row for row in matrix if row['status']!='PASS']),('jvm-failures.json',[row for row in full.values() if row['status']!='PASS'])]:
    (DEST/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for size,rows in zip([63,41,99,79],groups):(DEST/f'suite-{size}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(DEST/'p05-previous-37.json').write_text(json.dumps(p05Previous37,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(DEST/'regression-comparison.json').write_text(json.dumps(regressionComparison,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name,data in [
    ('explicit-v2.json',explicitV2),
    ('qa-retries.json',[projectionDisposition]),
    ('versioned-native-commands.json',[dict(name=name,evidence=rel(BASE/(name+'-command/command.json')),exit_code=record['exit_code'],source_stable=record['source_stable'],head=record['head'],cases=record['cases']) for name,record in versionedNativeCommands.items()]),
    ('original-607-failures.json',[row for row in original607 if row['status']!='PASS']),
    ('command-failures.json',[dict(row,command_group=group) for group,commands in [('Node',nodeCommands),('JVM',jvmCommands),('extra',extraCommands)] for row in commands if row.get('exit_code') not in [0,None] or row.get('status') in ['FAIL','NOT_TESTED']]),
    ('input-integrity.json',dict(adapter_manifest=adaptations,fixtures_and_oracles_unchanged=True,historical_controls_not_counted=historicalControls)),
]:
    (DEST/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
manifest=[dict(path=rel(path),bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),role='CURRENT' if path.is_relative_to(BASE) else 'HISTORICAL_IDENTITY_OR_SOURCE') for path in sorted(INPUTS)]
(DEST/'evidence-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
keys=['tested_head','standard_JVM','original607','overlapping_p03_sets','new38','frozen608','contract608','currency18','currency18_raw','p03_original26','explicit_v2','lint']
print(json.dumps({key:summary[key] for key in keys},ensure_ascii=False,indent=2))
