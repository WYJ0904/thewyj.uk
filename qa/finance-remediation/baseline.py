"""Fresh remediation baseline; copy only required synthetic QA sources/evidence."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,importlib.util,json,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2];OLD=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk';E=ROOT/'docs/migration-evidence/finance-p04/remediation';E.mkdir(parents=True,exist_ok=False)
EXPECTED='a065cd15d48b508c2797b9b563cfd24228b6bed9'
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
def sha(p):
 d=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):d.update(block)
 return d.hexdigest()
assert git(ROOT,'rev-parse','HEAD')==git(OLD,'rev-parse','HEAD')==EXPECTED
assert not git(OLD,'status','--porcelain')
proof=json.loads((OLD/'docs/migration-evidence/finance-p06/FINAL_PROVENANCE.json').read_text());manifest=OLD/'docs/migration-evidence/finance-p06/FINAL_EVIDENCE_MANIFEST.json';assert sha(manifest)==proof['manifest_sha256']
files=json.loads(manifest.read_text())['files'];bad=[n for n,r in files.items() if not(OLD/n).is_file() or (OLD/n).stat().st_size!=r['bytes'] or sha(OLD/n)!=r['sha256']];assert not bad,bad
rows=[]
def copy(source,target):
 assert source.resolve().is_relative_to(OLD.resolve()) and 'private' not in source.relative_to(OLD).parts
 assert target.resolve().is_relative_to(E.resolve()) and not target.exists()
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);assert sha(source)==sha(target)
 rows.append({'source':str(source.relative_to(OLD)),'target':str(target.relative_to(ROOT)),'bytes':target.stat().st_size,'sha256':sha(target)})
base=OLD/'docs/migration-evidence/finance-p04/p06-validation/final-r3'
for p in sorted((base/'delivery-current').glob('*.json')):copy(p,E/'baseline/delivery'/p.name)
for name in ['command.json','lint-results-debug.xml']:
 p=base/'android-current'/name;copy(p,E/'baseline/android'/name)
for p in (base/'android-current/junit').glob('TEST-*.xml'):
 if any(n in p.name for n in ['AndroidPaymentRecognitionHookArchiveTest','FinanceP03IdentityLifecycleTest','LocalPaymentBookingTest']):copy(p,E/'baseline/junit'/p.name)
for key,folder in [('compat-p03','finance-p03/final/compat-p03'),('explicit-currency-bridge','finance-p04/local/bridge-currency-context')]:
 parent=OLD/'docs/migration-evidence'/folder
 copy(parent/'test.init.gradle',E/'fixtures'/key/'test.init.gradle')
 for p in (parent/'kotlin').glob('*.kt'):copy(p,E/'fixtures'/key/'kotlin'/p.name)
for folder in sorted((OLD/'docs/migration-evidence/finance-p06/provider').glob('live-r*')):
 for p in folder.glob('*.json'):
  if p.name in ['result.json','cases.json','calls.json','diagnostic-adapter.json','ERROR_EVIDENCE_LIMITATION.json'] or p.name.startswith('provider-'):copy(p,E/'baseline/provider'/folder.name/p.name)
spec=importlib.util.spec_from_file_location('finance_remediation_protection',ROOT/'qa/finance-p03/protection.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.TREES['finance_origin']=OLD;protected=module.snapshot();(E/'protected-before.json').write_text(json.dumps(protected,ensure_ascii=False,indent=2))
result={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','head':EXPECTED,'branch':git(ROOT,'branch','--show-current'),'source_old_clean':True,'previous_manifest_sha256':sha(manifest),'previous_sealed_files_verified':len(files),'differences':bad,'protected_groups':len(protected),'copies':rows,'physical_phone_operations':False,'private_evidence_decrypted_or_copied':False}
(E/'baseline.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='copies'}))
