"""Read-only protection and historical seal checks for the unified P03 run."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p03/final'
BASELINE = '75e6561c4d32db77ee1192a7f2995bedf2060d78'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf8').strip()

def load(path):
    return json.loads(path.read_text(encoding='utf8-sig'))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name')
    ap.add_argument('--before')
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / (args.name + '.json')
    assert not target.exists(), 'Never overwrite a run'
    spec = importlib.util.spec_from_file_location('protection', ROOT / 'qa/finance-p03/protection.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    history = {}
    for base in ['docs/finance-p02', 'docs/finance-p03', 'qa/finance-p02', 'qa/finance-p03',
                 'docs/migration-evidence/finance-p03']:
        for path in (ROOT / base).rglob('*'):
            if path.is_file() and OUT not in path.parents and 'final' not in path.relative_to(ROOT / base).parts and '__pycache__' not in path.parts:
                history[path.relative_to(ROOT).as_posix()] = sha(path)
    data = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'head': git('rev-parse', 'HEAD'), 'branch': git('branch', '--show-current'),
            'status': git('status', '--porcelain=v1'), 'history': history, 'protected': module.snapshot()}
    assert data['branch'] == 'codex/finance-p03-identity-preauth'
    if not args.before:
        assert data['head'] == BASELINE
        assert not git('diff', '--name-only') and not git('diff', '--cached', '--name-only')
        seal = load(ROOT / 'docs/migration-evidence/finance-p03/phase-a/provenance.json')
        errors = []
        for group in ['source_report_sha256', 'raw_evidence_sha256', 'tested_candidate_sha256']:
            for path, digest in seal[group].items():
                if not (ROOT / path).is_file() or sha(ROOT / path) != digest: errors.append(path)
        assert not errors, errors
        data['previous_seal_verified'] = {key: len(seal[key]) for key in
            ['source_report_sha256', 'raw_evidence_sha256', 'tested_candidate_sha256']}
    else:
        old = load(OUT / (args.before + '.json'))
        changed = [p for p, d in old['history'].items() if history.get(p) != d]
        comparison = module.compare(old['protected'], data['protected'])
        data['comparison'] = {'historical_changes': changed, 'protected': comparison}
        assert not changed, changed
        assert all(not r['added'] and not r['missing'] and not r['changed'] and
                   all(v for k, v in r.items() if k.endswith('Same')) for r in comparison.values()), comparison
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'output': str(target), 'head': data['head'], 'historical_files': len(history),
                      'protected_groups': len(data['protected']), 'previous_seal': data.get('previous_seal_verified'),
                      'comparison': data.get('comparison')}, ensure_ascii=False))

if __name__ == '__main__': main()
