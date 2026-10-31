"""Fresh P03 non-device entry; old source/evidence are immutable."""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,sys,datetime
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/nonphone-entry'
OUT.mkdir(exist_ok=False)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
assert head=='5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc'
prior=ROOT/'docs/migration-evidence/finance-p03/finish/provenance.json'
data=json.loads(prior.read_text(encoding='utf8'))
for group in ['source_report_sha256','retained_public_evidence_sha256']:
 for name,value in data[group].items():assert sha(ROOT/name)==value,name
(OUT/'previous-report.md').write_bytes((ROOT/'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md').read_bytes())
spec=importlib.util.spec_from_file_location('protection',ROOT/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
result={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':head,'prior_provenance_sha256':sha(prior),
 'prior_files_verified':{k:len(data[k]) for k in ['source_report_sha256','retained_public_evidence_sha256']},'protected':m.snapshot(),'phone_used':False}
(OUT/'baseline.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in result.items() if k!='protected'},ensure_ascii=False))
