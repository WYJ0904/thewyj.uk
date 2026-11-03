"""Collect fresh unified P03 evidence. Never regenerate a historical report."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p03/final'
OLD=BASE.parent/'phase-a'
DEST=BASE/'delivery-final'

def read(path):return json.loads(path.read_text(encoding='utf8-sig'))
def rel(path):return path.relative_to(ROOT).as_posix()
def ndjson(path):return [dict(json.loads(s),evidence=rel(path)) for s in path.read_text(encoding='utf8-sig').splitlines() if s.strip()]
def counts(rows):return dict(collections.Counter(r['status'] for r in rows))
def write(name,value):
    path=DEST/name
    path.parent.mkdir(parents=True,exist_ok=True)
    assert not path.exists(),path
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def junit(folder):
    rows={}
    for path in folder.glob('TEST-*.xml'):
        suite=ET.parse(path).getroot()
        for t in suite.findall('testcase'):
            key=(t.get('classname'),t.get('name'));assert key not in rows,key
            status='FAIL' if t.find('failure') is not None or t.find('error') is not None else 'SKIP' if t.find('skipped') is not None else 'PASS'
            rows[key]={'status':status,'class':key[0],'method':key[1],'evidence':rel(path),
                'error':'\n'.join(e.text or '' for e in list(t) if e.tag in ['failure','error'])}
    return rows
def bridge(name,prefix):
    rows=[];server=read(BASE/name/'server-final.json');assert server['status']=='PASS',server
    for suffix in ['seed','restore']:
        run=read(BASE/(name+'-'+suffix+'-run.json'));assert run['exit_code']==0
        actual=junit(BASE/(name+'-'+suffix+'-junit'));assert len(actual)==1
        row=next(iter(actual.values()));rows.append(dict(row,case_id=prefix+suffix.upper(),server_evidence=rel(BASE/name/'server-final.json')))
    seed=read(BASE/name/'seed.json');restored=read(BASE/name/'restore.json');assert seed['pid']!=restored['pid']
    return rows,{**server,'seed_pid':seed['pid'],'restore_pid':restored['pid']}

def main():
    full=junit(BASE/'full-candidate-3-junit');assert len(full)==681 and counts(full.values())=={'PASS':681}
    initial=junit(BASE.parent/'reviewed-final-junit')
    original={k for k in initial if '.FinanceP03' not in k[0]};legacy=set(initial)-original
    closeout=set(junit(BASE.parent/'closeout/completion-full-junit'))-set(initial)
    previous=set(junit(OLD/'closure-full-junit'))-original-legacy-closeout
    new=set(full)-original-legacy-closeout-previous
    assert [len(x) for x in [original,legacy,closeout,previous,new]]==[588,26,18,31,18]
    legacy_rows=[dict(full[k],case_id='P03-JVM-'+k[1]) for k in sorted(legacy)]
    legacy_rows+=ndjson(BASE/'node-final-2/p03-server/server.ndjson')+ndjson(BASE/'node-final-2/p03-legacy/legacy-raw.ndjson')
    legacy_rows+=[dict(r,evidence=rel(BASE/'node-final-2/p03-migration/migration.json')) for r in read(BASE/'node-final-2/p03-migration/migration.json')]
    closed_rows=[dict(full[k],case_id='CO-JVM-'+k[1]) for k in sorted(closeout)]
    closed_rows+=ndjson(BASE/'node-final-2/closeout-server/clearing.ndjson')+ndjson(BASE/'node-final-2/closeout-d1/migration.ndjson')
    prev_rows=[dict(full[k],case_id='A-JVM-'+k[1]) for k in sorted(previous)]
    prev_rows+=ndjson(BASE/'reconciliation-final-2/reconciliation.ndjson')+ndjson(BASE/'correction-migration-final-3/migration.ndjson')
    new_rows=[dict(full[k],case_id='FINAL-JVM-'+k[1]) for k in sorted(new)]
    for p in ['resolution-final-2/resolution.ndjson','controls-final-2/controls.ndjson','provider-final/providers.ndjson','migration-current-d1-final-2/migration.ndjson','finance-projections-final/projections.ndjson','local-sandbox-final/sandbox.ndjson']:
        new_rows+=ndjson(BASE/p)
    new_rows.append(dict(read(BASE/'native-persist-4/result.json'),evidence=rel(BASE/'native-persist-4/result.json')))
    bridges={}
    for name,prefix,target in [('legacy-bridge-final2','P03-BRIDGE-',legacy_rows),('clearing-bridge-final2','CO-BRIDGE-',closed_rows),
            ('correction-bridge-final2','A-BRIDGE-',prev_rows),('unified-bridge-final2','FINAL-BRIDGE-',new_rows)]:
        rows,detail=bridge(name,prefix);target+=rows;bridges[name]=detail
    for rows,oldfile,number in [(legacy_rows,BASE.parent/'p03-results.json',63),(closed_rows,BASE.parent/'closeout/new-results.json',41),(prev_rows,OLD/'new-results.json',99)]:
        assert len(rows)==number and counts(rows)=={'PASS':number}
        assert {r['case_id'] for r in rows}=={r['case_id'] for r in read(oldfile)}
    assert len(new_rows)==79 and counts(new_rows)=={'PASS':79}
    oldmatrix={r['case_id']:r for r in read(OLD/'p02-comparison.json')};matrix=[]
    for group in 'ABCDE':matrix+=ndjson(BASE/'final2-frozen-native'/('kotlin-'+group+'.ndjson'))
    for filename in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:matrix+=ndjson(BASE/'node-final-2/p02-web'/filename)
    for filename in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:matrix+=ndjson(BASE/'final2-frozen-process'/filename)
    matrix+=ndjson(BASE/'final2-frozen-native/negative-bookings.ndjson')
    matrix.append(dict(read(BASE/'final2-frozen-native/timing.json'),evidence=rel(BASE/'final2-frozen-native/timing.json')))
    for r in oldmatrix.values():
        if r['case_id'].startswith('G-REUSED-'):
            f=r['fixture'];row=full[(f['class'],f['method'])];matrix.append(dict(r,status=row['status'],evidence=row['evidence']))
        elif r['case_id'].startswith('NT-'):matrix.append(dict(r,status='NOT_TESTED',evidence='NOT_TESTED: real phone, real account/cloud, physical downgrade or service callbacks not executed'))
    assert len(matrix)==608 and {r['case_id'] for r in matrix}==set(oldmatrix)
    for r in matrix:r['baseline_status']=oldmatrix[r['case_id']]['status']
    changes=[{'case_id':r['case_id'],'before':r['baseline_status'],'after':r['status']} for r in matrix if r['status']!=r['baseline_status']]
    assert not changes,changes
    nodes=read(BASE/'node-final-2/exits.json');assert len(nodes)==13
    assert all(r['exit_code']==0 or r['name'] in ['p02-web','p02-dom'] for r in nodes)
    tap=(BASE/'node-final-2/aeris-node.log').read_text(encoding='utf8-sig');dom=read(BASE/'node-final-2/aeris-dom.log')
    assert re.search(r'tests\s+13\b',tap) and re.search(r'fail\s+0\b',tap) and dom['tests']==dom['pass']==6 and dom['fail']==0
    assert read(BASE/'full-candidate-3-run.json')['exit_code']==0
    lint=dict(collections.Counter(r.get('severity') for r in ET.parse(BASE/'full-candidate-3-lint.xml').getroot().findall('issue')))
    assert not lint.get('Error') and not lint.get('Fatal')
    failures=[]
    for folder in {p.parent for p in BASE.rglob('TEST-*.xml')}:
        for row in junit(folder).values():
            if row['status']=='FAIL':failures.append(row)
        # Each directory parsed once below using unique evidence/class/method.
    failures=list({(r['evidence'],r['class'],r['method']):r for r in failures}.values())
    for p in BASE.rglob('*.ndjson'):
        try:failures += [r for r in ndjson(p) if r.get('status')=='FAIL']
        except (ValueError,UnicodeError):pass
    failure_runs=[]
    for p in BASE.glob('*-run.json'):
        r=read(p)
        if r.get('exit_code',0)!=0:failure_runs.append(dict(r,record=rel(p)))
    snapshot=read(BASE/'protected-final-2.json')['comparison'];assert not snapshot['historical_changes']
    summary={'task':'FINANCE-P03','status':'PARTIAL','baseline':'75e6561c4d32db77ee1192a7f2995bedf2060d78',
        'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'jvm':counts(full.values()),
        'original_607':{'JVM':588,'Node':13,'DOM':6,'PASS':607,'FAIL':0,'SKIP':0,'inherited_fixture_qualifications':3},
        'existing_p03_63':counts(legacy_rows),'previous_closeout_41':counts(closed_rows),'previous_reconciliation_99':counts(prev_rows),
        'new_unified_tests':counts(new_rows),'new_breakdown':{'JVM':18,'multi_id_service':11,'control_service':9,'provider_synthetic_signature':20,'D1_migration':8,'local_binary_backup':1,'bridge_methods':2,'JS_finance_projections':3,'self_created_HTTP_provider_sandbox':7},
        'matrix':counts(matrix),'matrix_changes':changes,'lint':lint,'debug':'PASS','bridges':bridges,
        'selected':{'full':'full-candidate-3','node':'node-final-2','reconciliation':'reconciliation-final-2','resolution':'resolution-final-2','control':'controls-final-2'},
        'external_gates':{'real_provider_credentials_and_original_source_relation':'NOT_TESTED','real_authorized_backup_restore':'NOT_TESTED','physical_old_APK_upgrade_downgrade':'NOT_TESTED',
            'real_notifications_pages_lifecycle_cloud':'NOT_TESTED'},'protected':snapshot,
        'failure_records':len(failures),'nonzero_run_records':len(failure_runs)}
    write('summary.json',summary);write('fresh-jvm.json',list(full.values()));write('p03-63.json',legacy_rows);write('closeout-41.json',closed_rows);write('reconciliation-99.json',prev_rows)
    write('new-tests.json',new_rows);write('p02-comparison.json',matrix);write('failure-ledger.json',{'cases':failures,'runs':failure_runs,'node_exits':nodes})
    print(json.dumps({k:summary[k] for k in ['jvm','original_607','existing_p03_63','previous_closeout_41','previous_reconciliation_99','new_unified_tests','matrix','lint','status']},ensure_ascii=False))

if __name__=='__main__':main()
