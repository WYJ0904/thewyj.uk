"""Recheck the sealed P05 source/evidence, preserving mutable source bytes first."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil, subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/migration-evidence/finance-p06'
OLD = ROOT / 'docs/migration-evidence/finance-p04/non-device-closeout'
HEAD = '425776f086d5a2b9165f9b9de311826a8d218f9e'
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
def sha(p):
    digest = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()
assert git('rev-parse', 'HEAD') == HEAD
assert not git('diff', '--name-only') and not git('diff', '--cached', '--name-only')
assert all(n.startswith('qa/finance-p06/') for n in git('ls-files', '--others', '--exclude-standard').splitlines())
OUT.mkdir(exist_ok=False)
proof = json.loads((OLD / 'FINAL_PROVENANCE.json').read_text())
manifest = OLD / 'FINAL_EVIDENCE_MANIFEST.json'
assert proof['final_local_commit'] == HEAD and sha(manifest) == proof['manifest_sha256']
files = json.loads(manifest.read_text())['files']
errors = [n for n, row in files.items() if not (ROOT/n).is_file()
          or (ROOT/n).stat().st_size != row['bytes'] or sha(ROOT/n) != row['sha256']]
tracked = set(git('ls-files').splitlines()); archive = {}
assert not errors, errors
for name, row in files.items():
    if name not in tracked: continue
    dest = OUT / 'baseline-source' / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open('xb') as stream: stream.write((ROOT/name).read_bytes())
    assert sha(dest) == row['sha256']
    archive[name] = row
(OUT / 'baseline-source-manifest.json').write_text(json.dumps(archive, indent=2))
result = dict(checked_utc=datetime.now(timezone.utc).isoformat(), status='PASS',
              head=HEAD, branch=git('branch', '--show-current'), worktree=str(ROOT),
              sealed_files_checked=len(files), source_bytes_archived=len(archive),
              previous_manifest_sha256=sha(manifest), differences=errors,
              historical_cache_missing=107, historical_cache_cause='NOT_CONFIRMED',
              historical_not_current_pass=proof['summary'])
(OUT / 'baseline.json').write_text(json.dumps(result, indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='historical_not_current_pass'}))
