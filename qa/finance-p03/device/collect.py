"""Count fresh evidence by identity; retain historical reds and every attempt."""
from pathlib import Path
import argparse,collections,datetime,json,re,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3];BASE=ROOT/'docs/migration-evidence/finance-p03/device'
OLD=BASE.parent;PREVIOUS=OLD/'final/delivery-final';DEST=BASE/'delivery'
def read(p):return json.loads(p.read_text(encoding='utf8-sig'))
def rel(p):return p.relative_to(ROOT).as_posix()
def nd(p):return [dict(json.loads(s),evidence=rel(p)) for s in p.read_text(encoding='utf8-sig').splitlines() if s.strip()]
def counts(rows):return dict(collections.Counter(r['status'] for r in rows))
def junit(folder):
    rows={}
    for p in folder.glob('TEST-*.xml'):
        for t in ET.parse(p).getroot().findall('testcase'):
            key=(t.get('classname'),t.get('name'));assert key not in rows
            rows[key]={'class':key[0],'method':key[1],'status':'FAIL' if t.find('failure') is not None or t.find('error') is not None else 'SKIP' if t.find('skipped') is not None else 'PASS','evidence':rel(p),'error':'\n'.join(x.text or '' for x in t if x.tag in ['failure','error'])}
    return rows
def write(name,data):
    p=DEST/name;assert not p.exists();p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
def bridge(name,prefix):
    server=read(BASE/name/'server-final.json');assert server['status']=='PASS',server
    seed=read(BASE/name/'seed.json');restore=read(BASE/name/'restore.json');assert seed['pid']!=restore['pid']
    rows=[]
    for step in ['seed','restore']:
        suite=junit(BASE/(name+'-'+step+'-junit'));assert len(suite)==1 and counts(suite.values())=={'PASS':1}
        assert read(BASE/(name+'-'+step+'-run.json'))['exit_code']==0
        rows.append(dict(next(iter(suite.values())),case_id=prefix+step.upper()))
    return rows,server
def main():
    DEST.mkdir(exist_ok=False)
    full=junit(BASE/'device-source-full-junit');assert len(full)==681 and counts(full.values())=={'PASS':681}
    initial=junit(OLD/'reviewed-final-junit');original={k for k in initial if '.FinanceP03' not in k[0]};legacy=set(initial)-original
    closeout=set(junit(OLD/'closeout/completion-full-junit'))-set(initial)
    previous=set(junit(OLD/'phase-a/closure-full-junit'))-original-legacy-closeout
    new=set(full)-original-legacy-closeout-previous
    assert [len(s) for s in [original,legacy,closeout,previous,new]]==[588,26,18,31,18]
    groups=[]
    for keys,prefix in [(legacy,'P03-JVM-'),(closeout,'CO-JVM-'),(previous,'A-JVM-'),(new,'FINAL-JVM-')]:groups.append([dict(full[k],case_id=prefix+k[1]) for k in sorted(keys)])
    groups[0]+=nd(BASE/'node-device/p03-server/server.ndjson')+nd(BASE/'node-device/p03-legacy/legacy-raw.ndjson')+[dict(r,evidence=rel(BASE/'node-device/p03-migration/migration.json')) for r in read(BASE/'node-device/p03-migration/migration.json')]
    groups[1]+=nd(BASE/'node-device/closeout-server/clearing.ndjson')+nd(BASE/'node-device/closeout-d1/migration.ndjson')
    groups[2]+=nd(BASE/'device-reconciliation/reconciliation.ndjson')+nd(BASE/'device-correction-migration/migration.ndjson')
    for p in ['device-resolution/resolution.ndjson','device-controls/controls.ndjson','device-providers/providers.ndjson','device-d1-migration/migration.ndjson','device-projections/projections.ndjson','device-local-sandbox/sandbox.ndjson']:groups[3]+=nd(BASE/p)
    groups[3].append(dict(read(BASE/'native-persist/result.json'),evidence=rel(BASE/'native-persist/result.json')))
    bridges={}
    for i,name,prefix in [(0,'legacy-bridge-device','P03-BRIDGE-'),(1,'clearing-bridge-device','CO-BRIDGE-'),(2,'correction-bridge-device','A-BRIDGE-'),(3,'unified-bridge-device','FINAL-BRIDGE-')]:
        rows,detail=bridge(name,prefix);groups[i]+=rows;bridges[name]=detail
    for i,n in enumerate([63,41,99,79]):
        assert len(groups[i])==n and counts(groups[i])=={'PASS':n},(i,len(groups[i]),counts(groups[i]))
        write('suite-'+str(n)+'.json',groups[i])
    matrix=[]
    for group in 'ABCDE':matrix+=nd(BASE/'frozen-native'/('kotlin-'+group+'.ndjson'))
    for p in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:matrix+=nd(BASE/'frozen-web'/p)
    for p in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:matrix+=nd(BASE/'frozen-process'/p)
    matrix+=nd(BASE/'frozen-native/negative-bookings.ndjson');matrix.append(dict(read(BASE/'frozen-native/timing.json'),evidence=rel(BASE/'frozen-native/timing.json')))
    oldmatrix={r['case_id']:r for r in read(PREVIOUS/'p02-comparison.json')}
    for r in oldmatrix.values():
        if r['case_id'].startswith('G-REUSED-'):
            f=r['fixture'];row=full[(f['class'],f['method'])];matrix.append(dict(r,status=row['status'],evidence=row['evidence']))
        elif r['case_id'].startswith('NT-'):matrix.append(dict(r,status='NOT_TESTED',evidence='Historical frozen boundary retained; actual device supplementary scope is separately listed, no blanket promotion'))
    assert len(matrix)==608 and {r['case_id'] for r in matrix}==set(oldmatrix)
    changes=[]
    for r in matrix:
        r['baseline_status']=oldmatrix[r['case_id']]['status']
        if r['status']!=r['baseline_status']:changes.append({'case_id':r['case_id'],'before':r['baseline_status'],'after':r['status']})
        assert r.get('fixture')==oldmatrix[r['case_id']].get('fixture'),r['case_id']
        if r['status'] in ['FAIL','EXPECTED_RED']:
            r['p03_scope']='P03 identity/evidence contract unresolved' if r['case_id'].startswith('A') else 'P03 lifecycle/legacy model unresolved' if r['group']=='C' else 'P04 currency/FX; not changed' if r['group']=='D' else 'P05 page/OCR recognition; not changed'
    assert not changes,changes
    write('frozen-608.json',matrix)
    tap=(BASE/'node-device/aeris-node.log').read_text(encoding='utf8-sig');dom=read(BASE/'node-device/aeris-dom.log')
    assert re.search(r'tests\s+13\b',tap) and re.search(r'fail\s+0\b',tap) and dom['tests']==dom['pass']==6 and dom['fail']==0
    instrument=[]
    for p in BASE.glob('*.json'):
        try:data=read(p)
        except ValueError:continue
        if not isinstance(data,dict) or data.get('action')!='instrument':continue
        text=(ROOT/data['log']).read_text(encoding='utf8-sig');codes=[int(s) for s in re.findall(r'^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$',text,re.M)]
        instrument.append(dict(data,evidence=rel(p),counts={'PASS':codes.count(0),'FAIL':codes.count(-1)+codes.count(-2),'SKIP':codes.count(-3)+codes.count(-4)}))
    lint=dict(collections.Counter(i.get('severity') for i in ET.parse(BASE/'device-source-full-lint.xml').getroot().findall('issue')))
    assert not lint.get('Error') and not lint.get('Fatal')
    summary={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original607':{'PASS':607,'FAIL':0,'parts':{'JVM':588,'Node':13,'DOM':6}},'standard681':counts(full.values()),'overlapping_p03_sets':[{str(n):counts(rows)} for n,rows in zip([63,41,99,79],groups)],'frozen608':counts(matrix),'frozen_status_changes':changes,'lint_product':lint,'bridges':bridges,'physical_device_attempts':instrument,'do_not_sum_overlapping_sets':True,'formal_business_e2e':'NOT TESTED','status':'PARTIAL'}
    write('summary.json',summary);write('jvm-681.json',list(full.values()))
    journal=[]
    for attempt in instrument:
        fields={}
        for line in (ROOT/attempt['log']).read_text(encoding='utf8-sig').splitlines():
            m=re.match(r'INSTRUMENTATION_STATUS: (class|test)=(.*)',line)
            if m:fields[m.group(1)]=m.group(2)
            m=re.match(r'INSTRUMENTATION_STATUS_CODE: (-?\d+)',line)
            if m and int(m.group(1)) in [0,-1,-2,-3,-4] and fields.get('class') and fields.get('test'):
                code=int(m.group(1));journal.append({'class':fields['class'],'method':fields['test'],'status':'PASS' if code==0 else 'SKIP' if code in [-3,-4] else 'FAIL','attempt':attempt['evidence'],'log':attempt['log'],'scope':'diagnostic only' if fields['test']=='inspectActualFinancialBackNavigationWithoutChangingState' else 'QA cleanup only' if 'CleanupTest' in fields['class'] else 'physical synthetic QA; not real provider business'});fields={}
    write('physical-junit-all-attempts.json',journal)
    batches=[read(BASE/(n+'.json')) for n in ['device-final-native-suite','device-native-suite-watched','device-batch-repeat1','device-batch-repeat2']]
    write('physical-batch-repetitions.json',{'same_final_apk':'apk-final12.json','groups':batches,'summed_invocations_not_distinct_cases':{k:sum(r['counts'][k] for r in batches) for k in ['PASS','FAIL','SKIP']},'distinct_methods':6,'unresolved_failure_retained':True,'do_not_use_later_pass_to_close_first_failure':True})
    platforms={}
    for name in ['notification-os-matrix1','notification-os-matrix2','notification-os-final12']:
        platforms[name]=read(BASE/name/'summary.json')
    write('physical-os-notifications.json',{'groups':platforms,'distinct_methods':8,'timestamp_reversal':read(BASE/'notification-controls/timestamp-ab.json'),'real_wechat_alipay':'NOT TESTED','os_low_memory_kill':'NOT TESTED'})
    write('failure-ledger.json',{'frozen_nonpassing':[r for r in matrix if r['status'] in ['FAIL','EXPECTED_RED']],'physical_attempt_failures':[r for r in instrument if r['status'] in ['FAIL','WATCHDOG']],'qa_build_failures':[read(p) for p in BASE.glob('build*-run.json') if read(p).get('exit_code')!=0],'initial_frozen_node_guard_block':read(BASE/'node-device/exits.json')[-3:],'note':'The three initial frozen Node runs were stopped by output-root protection before executing cases; corrected path-only copies were rerun, originals unchanged'})
    print(json.dumps({k:summary[k] for k in ['original607','standard681','overlapping_p03_sets','frozen608','frozen_status_changes','lint_product','status']},ensure_ascii=False))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--name',default='delivery');args=parser.parse_args();assert re.fullmatch('[a-z0-9-]+',args.name)
    DEST=BASE/args.name;main()
