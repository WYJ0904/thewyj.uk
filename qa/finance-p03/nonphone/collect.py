"""Fresh non-device results only; old phone results stay historical."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=(ROOT/'qa/finance-p03/device/collect.py').read_text()
code=source[:source.index('    instrument=[]')]
code=code.replace("BASE=ROOT/'docs/migration-evidence/finance-p03/device'","BASE=ROOT/'docs/migration-evidence/finance-p03/nonphone-entry'")
code=code.replace("BASE/'device-source-full-junit'","BASE/'final-source-full-junit'")
code=code.replace("BASE/'frozen-web'/p","BASE/'node-device/p02-web'/p")
code=code.replace("read(PREVIOUS/'p02-comparison.json')","read(ROOT/'docs/migration-evidence/finance-p03/finish/delivery-final/frozen-608.json')")
code+='''    trace=junit(BASE/'finish-traces5-junit')
    assert len(trace)==5 and counts(trace.values())=={'PASS':5}
    extra=list(trace.values())
    for folder,name,n in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
        rows=nd(BASE/folder/name);assert len(rows)==n and counts(rows)=={'PASS':n};extra+=rows
    assert len(extra)==38
    lint=dict(collections.Counter(i.get('severity') for i in ET.parse(BASE/'final-source-full-lint.xml').getroot().findall('issue')))
    assert not lint.get('Error') and not lint.get('Fatal')
    summary={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'standard681':counts(full.values()),'original607':{'PASS':607,'FAIL':0,'SKIP':0,'parts':{'JVM':588,'Node':13,'DOM':6}},'overlapping_p03_sets':{str(n):counts(r) for n,r in zip([63,41,99,79],groups)},'new38':counts(extra),'frozen608':counts(matrix),'changes':changes,'lint':lint,'bridges':bridges,'phone':'NOT TESTED; prohibited this run','production':'NOT TESTED; no access','p03_status':'PARTIAL','nonphone_engineering':'COMPLETE_FOR_AVAILABLE_EVIDENCE','p04_transition':'AUTHORIZED_BY_CURRENT_OWNER'}
    write('summary.json',summary);write('jvm-681.json',list(full.values()));write('new-38.json',extra)
    ledger={'frozen_nonpassing':[r for r in matrix if r['status'] in ['FAIL','EXPECTED_RED']],'nonzero_run_metadata':[dict(read(p),evidence=rel(p)) for p in BASE.glob('*-run.json') if read(p).get('exit_code')],'historical_lifecycle_failure':'UNRESOLVED; original failure/stacks reviewed, no new phone diagnosis authorized','missing_provider_evidence':'No operation/revision/predecessor proof becomes available by replaying identical inputs'}
    write('failure-ledger.json',ledger)
    print(json.dumps(summary,ensure_ascii=False))
'''
exec(compile(code,'original-counting-fresh-nonphone-selection.py','exec'),globals())
DEST=BASE/'delivery-final'
if __name__=='__main__':main()
