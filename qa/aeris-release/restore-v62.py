"""Preserve the two in-progress checkouts without changing their Git state."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/migration-evidence/aeris-p03-p07/v62-restore'
OUT.mkdir(exist_ok=False)
trees = {'ui': ROOT, 'finance': Path.home() / '.codex/worktrees/aeris-finance-quality/thewyj.uk'}
result = {'utc': datetime.now(timezone.utc).isoformat(), 'trees': {}, 'phone_operations': 0, 'remote_mutations': 0}
for name, root in trees.items():
    target = OUT / name
    target.mkdir()
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root)
    (target / 'working.patch').write_bytes(git('diff', '--binary', 'HEAD'))
    (target / 'staged.patch').write_bytes(git('diff', '--binary', '--cached'))
    status = git('status', '--porcelain=v1', '-z').decode('utf-8')
    (target / 'status.json').write_text(json.dumps(status, ensure_ascii=False), encoding='utf-8')
    names = set(git('diff', '--name-only', '-z', 'HEAD').decode('utf-8').split('\0'))
    names.update(git('ls-files', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0'))
    files = {}
    for rel in sorted(names - {''}):
        source = root / rel
        if not source.is_file():
            continue
        if source.is_symlink() or any(part in {'.git', 'node_modules', '.wrangler'} for part in Path(rel).parts):
            raise RuntimeError('Unexpected source snapshot path')
        destination = target / 'source' / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        files[rel] = {'bytes': source.stat().st_size, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    evidence_root = root / 'docs/migration-evidence'
    evidence = {}
    for source in evidence_root.rglob('*'):
        if not source.is_file() or source.is_symlink() or OUT in source.parents:
            continue
        relative = source.relative_to(root).as_posix()
        if any(part in {'chrome-profile', 'Default', 'Cache', 'Code Cache', 'GPUCache', 'node_modules'} for part in source.parts):
            continue
        evidence[relative] = {'bytes': source.stat().st_size, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    (target / 'source-manifest.json').write_text(json.dumps(files, ensure_ascii=False, indent=2), encoding='utf-8')
    (target / 'evidence-manifest.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    result['trees'][name] = {'head': git('rev-parse', 'HEAD').decode().strip(),
        'branch': git('branch', '--show-current').decode().strip(), 'source_files_copied': len(files), 'evidence_files_hashed': len(evidence)}
(OUT / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
