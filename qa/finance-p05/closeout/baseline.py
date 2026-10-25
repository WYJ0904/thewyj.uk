"""New evidence root; verify the old seal without changing any old artifact."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout';OUT.mkdir(exist_ok=False)
OLD=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
def sha(p):
    d=hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):d.update(chunk)
    return d.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
head=git('rev-parse','HEAD');assert head=='adbd4851410b47894cc8bf90ffb989e8e407ebdd'
assert git('branch','--show-current')=='codex/finance-p05-page-ocr'
assert not git('diff','--name-only')
manifest=json.loads((OLD/'FINAL_EVIDENCE_MANIFEST.json').read_text())
proof=json.loads((OLD/'FINAL_PROVENANCE.json').read_text())
assert sha(OLD/'FINAL_EVIDENCE_MANIFEST.json')==proof['evidence_manifest_sha256']
differences=[name for name,row in manifest['files'].items()
    if not (ROOT/name).is_file() or (ROOT/name).stat().st_size!=row['bytes'] or sha(ROOT/name)!=row['sha256']]
ancestors={ref:subprocess.run(['git','merge-base','--is-ancestor',ref,'HEAD'],cwd=ROOT).returncode==0
    for ref in ['25142acb9a22c5293d5c3b8a7710c4bd418f477c','5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc']}
record={'checked_utc':datetime.now(timezone.utc).isoformat(),'status':'PASS' if not differences else 'FAIL','head':head,
    'branch':git('branch','--show-current'),'status_at_snapshot':git('status','--short'),'tracked_clean':True,
    'old_tested_source':proof['tested_product_commit'],'old_sealed_files':len(manifest['files']),'differences':differences,
    'old_manifest_sha256':sha(OLD/'FINAL_EVIDENCE_MANIFEST.json'),'ancestors':ancestors,
    'legacy_107_cache_exceptions_preserved':proof['historical_seal']['historical_missing_cache'],
    'real_phone_operations':False,'production_or_preview_mutations':False}
(OUT/'baseline.json').write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k!='legacy_107_cache_exceptions_preserved'}))
assert not differences and all(ancestors.values())
