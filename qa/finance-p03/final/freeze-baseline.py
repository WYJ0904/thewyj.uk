"""Extract exact committed product sources; do not mix an ongoing edit into BEFORE."""
import hashlib
import json
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[3]
BASE = '75e6561c4d32db77ee1192a7f2995bedf2060d78'
DEST = ROOT / 'docs/migration-evidence/finance-p03/final/baseline-source'
assert not DEST.exists()
names = subprocess.check_output(['git','ls-tree','-r','--name-only',BASE,'functions','cloudflare/migrations'],cwd=ROOT).decode().splitlines()
manifest={}
for name in names:
    data=subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT)
    p=DEST/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    manifest[name]=hashlib.sha256(data).hexdigest()
test='qa/finance-p03/final/resolution.mjs'
p=DEST/test;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((ROOT/test).read_bytes())
(DEST/'manifest.json').write_text(json.dumps({'commit':BASE,'product_sha256':manifest,'test_sha256':hashlib.sha256(p.read_bytes()).hexdigest()},indent=2))
print(json.dumps({'commit':BASE,'files':len(names),'test':str(p)}))
