"""Recheck all fourteen protected groups and the full prior a065 evidence seal."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation'
OLD=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
out=E/'protection-final.json';assert not out.exists()
spec=importlib.util.spec_from_file_location('remediation_protection',ROOT/'qa/finance-p03/protection.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.TREES['finance_origin']=OLD
after=module.snapshot();before=json.loads((E/'protected-before.json').read_text());compared=module.compare(before,after)
(E/'protected-after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2))
good=all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in compared.values())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
manifest=OLD/'docs/migration-evidence/finance-p06/FINAL_EVIDENCE_MANIFEST.json'
provenance=json.loads((OLD/'docs/migration-evidence/finance-p06/FINAL_PROVENANCE.json').read_text())
assert sha(manifest)==provenance['manifest_sha256']
files=json.loads(manifest.read_text())['files'];bad=[n for n,r in files.items() if not (OLD/n).is_file() or (OLD/n).stat().st_size!=r['bytes'] or sha(OLD/n)!=r['sha256']]
out.write_text(json.dumps(dict(status='PASS' if good and not bad else 'FAIL',utc=datetime.now(timezone.utc).isoformat(),protected_groups=len(compared),groups=compared,
    previous_seal_files=len(files),previous_seal_differences=bad,previous_manifest_sha256=sha(manifest),physical_phone_operations=False,
    private_old_evidence_decrypted=False,remote_git_mutations=False,production_or_existing_preview_mutations=False),ensure_ascii=False,indent=2))
print(json.dumps(dict(status='PASS' if good and not bad else 'FAIL',groups=len(compared),old_seal_files=len(files),differences=bad)))
assert good and not bad
