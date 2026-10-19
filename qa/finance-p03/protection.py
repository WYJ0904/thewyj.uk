"""Hash protected source/evidence; never inspect private phone data or root secrets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROFILE = Path(os.environ['USERPROFILE'])
WORKTREES = PROFILE / '.codex/worktrees'
TREES = {'main': PROFILE / 'Desktop/编程/thewyj.uk',
         'repair': WORKTREES / 'aeris-state-consistency/thewyj.uk',
         'task26': WORKTREES / 'task26-wrong-review/thewyj.uk',
         'd01': WORKTREES / 'aeris-d01-lifecycle/thewyj.uk',
         'd01control': WORKTREES / 'aeris-d01-control/thewyj.uk',
         'd02': WORKTREES / 'aeris-d02-webview-thread/thewyj.uk',
         'candidate': WORKTREES / 'aeris-hotfix-acceptance-candidate/thewyj.uk',
         'p02': WORKTREES / 'finance-p02-tests/thewyj.uk'}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args]).decode('utf-8').strip()


def snapshot():
    result = {}
    for name, path in TREES.items():
        names = git(path, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')
        names = sorted(set(n for n in names if n))
        assert all(Path(n).name != '访问口令.txt' for n in names)
        result[name] = {'head': git(path, 'rev-parse', 'HEAD'),
                        'branch': git(path, 'branch', '--show-current'),
                        'status': git(path, 'status', '--porcelain=v1'),
                        'files': {n: digest(path / n) for n in names}}
    for name, directory in [
        ('phase3', TREES['repair'] / 'docs/migration-evidence/device-acceptance'),
        ('d01Evidence', TREES['d01'] / 'docs/migration-evidence/d01'),
        ('d02Evidence', TREES['d02'] / 'docs/migration-evidence/d02'),
        ('candidateEvidence', TREES['candidate'] / 'docs/migration-evidence/hotfix-phase4'),
        ('p02Evidence', TREES['p02'] / 'docs/migration-evidence/finance-p02')]:
        # Generated Gradle trees are rebuildable; preserve every original raw run,
        # archived APK, fixture, report input and diagnostic snapshot.
        files = [p for p in directory.rglob('*') if p.is_file()
                 and not any(part.startswith('build-') or part == '__pycache__'
                             for part in p.relative_to(directory).parts)]
        result[name] = {'files': {p.relative_to(directory).as_posix(): digest(p) for p in sorted(files)}}
    return result


def compare(before, after):
    result = {}
    for name, old in before.items():
        new = after[name]
        a, b = old['files'], new['files']
        result[name] = {'files': len(a), 'added': sorted(set(b) - set(a)),
                        'missing': sorted(set(a) - set(b)),
                        'changed': [n for n in a.keys() & b.keys() if a[n] != b[n]]}
        for field in ['head', 'branch', 'status']:
            if field in old:
                result[name][field + 'Same'] = old[field] == new[field]
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--before', type=Path)
    args = parser.parse_args()
    assert not args.output.exists(), 'Preserve existing evidence'
    current = snapshot()
    args.output.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.before:
        differences = compare(json.loads(args.before.read_text(encoding='utf-8')), current)
        print(json.dumps(differences, ensure_ascii=False, indent=2))
        args.output.with_suffix('.comparison.json').write_text(json.dumps(differences, indent=2), encoding='utf-8')
        assert all(not row['added'] and not row['missing'] and not row['changed']
                   and all(v for k, v in row.items() if k.endswith('Same'))
                   for row in differences.values()), 'Protected state changed'
    else:
        print(json.dumps({name: len(value['files']) for name, value in current.items()}))
