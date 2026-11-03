"""Recheck 13 protected groups and every prior sealed source/raw file."""
from pathlib import Path
import hashlib,importlib.util,json,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('p03_protection',ROOT/'qa/finance-p03/protection.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
after=module.snapshot();before=read(OUT/'baseline.json')['protected'];comparison=module.compare(before,after)
assert len(comparison)==13
assert all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in comparison.values())
prior=read(ROOT/'docs/migration-evidence/finance-p03/device/provenance.json');errors=[];exceptions=[]
for name,digest in prior['source_report_sha256'].items():
    if name=='docs/finance-p03/FINANCE_P03_FINAL_REPORT.md':
        assert sha(OUT/'baseline-report.md')==digest
        exceptions.append({'path':name,'reason':'Only current unified report updated; exact prior sealed bytes retained as finish/baseline-report.md and Git 1e04945'})
    elif not (ROOT/name).is_file() or sha(ROOT/name)!=digest:errors.append(name)
for name,digest in prior['retained_public_evidence_sha256'].items():
    if not (ROOT/name).is_file() or sha(ROOT/name)!=digest:errors.append(name)
assert not errors,errors
data={'status':'PASS','protected_groups':13,'comparison':comparison,'prior_source_report_entries':len(prior['source_report_sha256']),
    'prior_raw_entries':len(prior['retained_public_evidence_sha256']),'prior_provenance_sha256':sha(ROOT/'docs/migration-evidence/finance-p03/device/provenance.json'),
    'intentional_current_report_exception':exceptions,'old_file_errors':errors,'main_task26_hotfix_d01_d02_p02_untouched':True}
file=OUT/'protected-final.json';assert not file.exists();file.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:data[k] for k in ['status','protected_groups','prior_source_report_entries','prior_raw_entries','old_file_errors']}))
