"""Recreate read-only v3 modules from the exact handoff commit for local QA."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
COMMIT = '81d5aa7cc51b55d386b59414019c4a0f01272032'
DEST = ROOT / 'docs/migration-evidence/finance-p03/closeout/baseline-v3'
subprocess.run(['git', 'merge-base', '--is-ancestor', COMMIT, 'HEAD'], cwd=ROOT, check=True)
names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', COMMIT, '--', 'functions/_lib'], cwd=ROOT).decode().splitlines()
hashes = {}
for name in names:
    data = subprocess.check_output(['git', 'show', COMMIT + ':' + name], cwd=ROOT)
    target = DEST / name
    if target.exists():
        assert target.read_bytes() == data, 'Never replace different baseline material'
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    hashes[name] = hashlib.sha256(data).hexdigest()
manifest = DEST / 'source-sha256.json'
if manifest.exists():
    assert json.loads(manifest.read_text()) == hashes
else:
    manifest.write_text(json.dumps(hashes, indent=2), encoding='utf-8')
print('Verified immutable baseline modules:', len(hashes))
