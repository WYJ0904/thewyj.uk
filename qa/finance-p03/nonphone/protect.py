"""Read-only workspace/old-seal protection; no phone or network operations."""
from pathlib import Path
import hashlib,importlib.util,json,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/nonphone-entry'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
spec=importlib.util.spec_from_file_location('guard',ROOT/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
comparison=m.compare(read(OUT/'baseline.json')['protected'],m.snapshot())
assert len(comparison)==13 and all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in comparison.values())
prior=read(ROOT/'docs/migration-evidence/finance-p03/finish/provenance.json')
for name,value in prior['source_report_sha256'].items():
 target=OUT/'previous-report.md' if name=='docs/finance-p03/FINANCE_P03_FINAL_REPORT.md' else ROOT/name
 assert sha(target)==value,name
for name,value in prior['retained_public_evidence_sha256'].items():assert sha(ROOT/name)==value,name
file=OUT/'protected-final.json';assert not file.exists();file.write_text(json.dumps({'status':'PASS','groups':13,'comparison':comparison,'old_51_source_report_and_911_raw_verified':True,'old_unified_report_bytes_preserved':True,'phone_used':False},ensure_ascii=False,indent=2),encoding='utf8')
print('13 protection groups and prior seal PASS')
