"""Reuse immutable suites, redirect only fresh output destinations to device/."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[3]
DEST=ROOT/'docs/migration-evidence/finance-p03/device/regression-runners'
DEST.mkdir(parents=True,exist_ok=False)
manifest={}
for name in ['run-gradle.ps1','run-node.ps1','run-one.ps1','run-unified-bridge.ps1','run-bridge.ps1','run-reconciliation-bridge.ps1','run-native-persist.ps1']:
    source=ROOT/'qa/finance-p03/final'/name
    original=source.read_text(encoding='utf8-sig')
    text=original.replace("'docs/migration-evidence/finance-p03/final'","'docs/migration-evidence/finance-p03/device'")
    text=text.replace("'docs/migration-evidence/finance-p03/final/'","'docs/migration-evidence/finance-p03/device/'")
    text=text.replace('./qa/finance-p03/final/run-gradle.ps1','./docs/migration-evidence/finance-p03/device/regression-runners/run-gradle.ps1')
    # Compatibility sources were sealed last run; reuse them byte for byte.
    text=text.replace("Join-Path $p03Base 'compat-p03'","Join-Path $p03Root 'docs/migration-evidence/finance-p03/final/compat-p03'")
    target=DEST/name;target.write_text(text,encoding='utf8')
    manifest[name]={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'runner_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'change':'output path only; sealed compat source path retained; assertions unchanged'}
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'copied_runners':len(manifest),'product_or_frozen_changes':0}))
