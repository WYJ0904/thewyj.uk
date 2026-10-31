"""Derive fresh path-only copies of the executed P03 offline drivers."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/nonphone-entry'
assert OUT.is_dir()
DEST=OUT/'regression-runners';DEST.mkdir(exist_ok=False);manifest={}
for p in (ROOT/'docs/migration-evidence/finance-p03/finish/regression-runners').glob('*.ps1'):
 text=p.read_text(encoding='utf8-sig').replace('docs/migration-evidence/finance-p03/finish','docs/migration-evidence/finance-p03/nonphone-entry')
 text=text.replace('qa/finance-p03/finish/output-redirect.mjs','qa/finance-p03/nonphone/output-redirect.mjs')
 text=text.replace('qa/finance-p03/finish/native-persist-worker.mjs','qa/finance-p03/nonphone/native-persist.mjs')
 (DEST/p.name).write_text(text,encoding='utf8')
 manifest[p.name]={'source':p.relative_to(ROOT).as_posix(),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'runner_sha256':hashlib.sha256(text.encode()).hexdigest(),'only_output_paths_changed':True}
for old,new in [('output-redirect.mjs','output-redirect.mjs'),('native-persist-worker.mjs','native-persist.mjs')]:
 p=ROOT/'qa/finance-p03/finish'/old;target=Path(__file__).parent/new
 expected=p.read_text().replace('docs/migration-evidence/finance-p03/finish','docs/migration-evidence/finance-p03/nonphone-entry')
 if target.exists():assert target.read_text()==expected,'Never overwrite a different existing helper'
 else:target.write_text(expected,encoding='utf8')
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('Prepared',len(manifest),'offline runners; no phone code invoked')
