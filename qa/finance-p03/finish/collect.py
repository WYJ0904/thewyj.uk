"""Reuse counting identities; only two proved original oracles may turn green.

No fixture or expected value is transformed. Historical failures remain separate
from selected final runs. New safety tests are not business case passes.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=(ROOT/'qa/finance-p03/device/collect.py').read_text()
code=source[:source.index('    instrument=[]')]
code=code.replace("BASE=ROOT/'docs/migration-evidence/finance-p03/device'","BASE=ROOT/'docs/migration-evidence/finance-p03/finish'")
code=code.replace("BASE/'device-source-full-junit'","BASE/'final-source-full-junit'")
code=code.replace("BASE/'native-persist/result.json'","BASE/'native-persist-2/result.json'")
code=code.replace("BASE/'frozen-web'/p","BASE/'frozen-web-release'/p")
code=code.replace("read(PREVIOUS/'p02-comparison.json')","read(ROOT/'docs/migration-evidence/finance-p03/device/delivery-final/frozen-608.json')")
code=code.replace("assert not changes,changes", "assert sorted((r['case_id'],r['before'],r['after']) for r in changes)==[('CW-AUTH-POST-RELEASE','EXPECTED_RED','PASS'),('CW-HOLD-ONLY','EXPECTED_RED','PASS')],changes")
code=code.replace("BASE/'node-device/aeris-node.log'","BASE/'original-aeris-node-release.log'").replace("BASE/'node-device/aeris-dom.log'","BASE/'original-aeris-dom-release.log'")
code+='''    trace=junit(BASE/'finish-traces4-junit')
    assert len(trace)==5 and counts(trace.values())=={'PASS':5}
    new_rows=[dict(r,case_id='NEW-JVM-'+r['class']+'#'+r['method']) for r in trace.values()]
    for folder,name,n in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
        rows=nd(BASE/folder/name);assert len(rows)==n and counts(rows)=={'PASS':n};new_rows+=rows
    assert len(new_rows)==38 and len({r['case_id'] for r in new_rows})==38
    lint=dict(collections.Counter(i.get('severity') for i in ET.parse(BASE/'final-source-full-lint.xml').getroot().findall('issue')))
    assert not lint.get('Error') and not lint.get('Fatal')
    runs=[]
    for p in sorted(BASE.glob('*-run.json')):
        data=read(p)
        if data.get('exit_code',0)!=0:runs.append(dict(data,evidence=rel(p)))
    new_attempt_failures=[]
    for p in BASE.rglob('*.ndjson'):
        if 'build' in p.parts or 'build-regression' in p.parts or 'qa-generated' in p.parts:continue
        try:rows=nd(p)
        except ValueError:continue
        for row in rows:
            if row.get('status')=='FAIL' and row.get('case_id','').startswith(('LC','LB','PI')):new_attempt_failures.append(row)
    summary={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original607':{'PASS':607,'FAIL':0,'parts':{'JVM':588,'Node':13,'DOM':6}},'standard681':counts(full.values()),'overlapping_p03_sets':[{str(n):counts(rows)} for n,rows in zip([63,41,99,79],groups)],'new38':counts(new_rows),'new_breakdown':{'JVM_methods':5,'JS_legacy_projection':15,'real_Chrome_DOM_synthetic_transport':10,'provider_test_key_units':8},'frozen608':counts(matrix),'frozen_status_changes':changes,'lint_product':lint,'bridges':bridges,'physical_current_run':{'status':'NOT TESTED','reason':'No authorized Samsung currently detected; historical evidence not counted'},'formal_business_e2e':'NOT TESTED','do_not_sum_overlapping_sets':True,'status':'PARTIAL'}
    write('summary.json',summary);write('jvm-681.json',list(full.values()));write('new-38.json',new_rows)
    write('failure-ledger.json',{'frozen_nonpassing':[r for r in matrix if r['status'] in ['FAIL','EXPECTED_RED']],'new_regression_failures_all_attempts':new_attempt_failures,'nonzero_run_metadata':runs,'historical_physical_failure':'../device/device-final-native-suite.log (23/1 aggregate retained; not retested this turn)','original_prior_ledger':'../device/delivery-final/failure-ledger.json','bookkeeping_failures':['regression-runners/correction2.json','regression-runners/persistence-correction.json','apk-candidate1-failure.json'],'notes':'Expected-red nonzero frozen exits and intermediate harness failures are preserved, not promoted to product PASS.'})
    print(json.dumps({k:summary[k] for k in ['original607','standard681','overlapping_p03_sets','new38','frozen608','frozen_status_changes','lint_product','status']},ensure_ascii=False))
'''
exec(compile(code,'sealed-counting-with-current-run-selection.py','exec'),globals())
DEST=BASE/'delivery-final'
if __name__=='__main__':main()
