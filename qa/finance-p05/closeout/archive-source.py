"""Preserve old sealed working bytes before authorized edits to product files."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
old=json.loads((ROOT/'docs/migration-evidence/finance-p04/continuation-p05/FINAL_EVIDENCE_MANIFEST.json').read_text())
OUT=E/'baseline-source';OUT.mkdir(exist_ok=False);rows={}
for name,record in old['files'].items():
    if name.startswith('docs/migration-evidence/'):continue
    source=ROOT/name;assert hashlib.sha256(source.read_bytes()).hexdigest()==record['sha256']
    target=OUT/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==record['sha256'];rows[name]=record
(E/'baseline-source-manifest.json').write_text(json.dumps(rows,indent=2));print('Archived original source/report bytes:',len(rows))
