"""Capture local P02 provenance after reports and protected-tree checks finish."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/migration-evidence/finance-p02'
BASELINE = '1398c76d9321919ac8c94550f2d23c2c8e1a1e84'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def command(*args):
    return subprocess.check_output(args, cwd=ROOT).decode('utf-8').strip()


def main():
    output = BASE / 'provenance.json'
    assert not output.exists(), 'Preserve existing provenance'
    allowed = ('qa/finance-p02/', 'docs/finance-p02/')
    changed = set(command('git', 'diff', '--name-only', BASELINE).splitlines())
    changed.update(command('git', 'ls-files', '--others', '--exclude-standard').splitlines())
    assert all(name.startswith(allowed) for name in changed), 'Change outside P02 scope'
    product_diff = command('git', 'diff', '--name-only', BASELINE, '--', '.',
                           ':!qa/finance-p02', ':!docs/finance-p02')
    assert not product_diff, 'Product/config/history changed'
    history = []
    for ref in ['e2febc6','94f5177','9ff7a7f','f6a2ec7','57b622e','8c0de9c','ff11072','1398c76']:
        commit = command('git', 'rev-parse', ref)
        subprocess.run(['git','merge-base','--is-ancestor',commit,BASELINE], cwd=ROOT, check=True)
        history.append(commit)
    candidate_product_diff = command('git','diff','--name-only','f6a2ec7',BASELINE,'--',
        'android','js','functions','cloudflare','local-backend','package.json','package-lock.json')
    assert not candidate_product_diff, 'Unexpected product difference in inherited candidate'
    protected = json.loads((BASE / 'protected-final.comparison.json').read_text(encoding='utf-8'))
    assert all(not p['added'] and not p['missing'] and not p['changed']
               and all(value for key, value in p.items() if key.endswith('Same'))
               for p in protected.values())
    materials = []
    source = Path(os.environ['USERPROFILE']) / 'Desktop/编程/thewyj.uk/thewyj-finance-materials'
    for name in ['FINANCE_P01_AUDIT_2026-10-19.md', 'FINANCE_P02_CODEX_PROMPT_2026-10-19.txt']:
        original, copy = sha(source / name), sha(BASE / 'materials' / name)
        assert original == copy, 'Material changed'
        materials.append({'file': name, 'original_sha256': original, 'evidence_copy_sha256': copy})
    source_hashes = {p.relative_to(ROOT).as_posix(): sha(p)
                     for folder in ['qa/finance-p02', 'docs/finance-p02']
                     for p in sorted((ROOT / folder).rglob('*'))
                     if p.is_file() and '__pycache__' not in p.parts}
    raw_hashes = {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(BASE.rglob('*'))
                  if p.is_file() and p != output and '__pycache__' not in p.parts}
    jbr = Path(os.environ['ProgramFiles']) / 'Android/Android Studio/jbr/bin/java.exe'
    result = {
        'captured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'baseline_commit': BASELINE, 'head_when_captured': command('git', 'rev-parse', 'HEAD'),
        'branch': command('git', 'branch', '--show-current'),
        'changed_paths': sorted(changed), 'product_config_diff': product_diff,
        'inherited_history': history, 'f6_to_candidate_product_diff': candidate_product_diff,
        'materials': materials, 'source_and_report_sha256': source_hashes,
        'raw_evidence_sha256': raw_hashes, 'protected_comparison': protected,
        'runtime_versions': {'node': command('node', '--version'),
                             'python': command('python', '--version'),
                             'jbr': command(str(jbr), '--version'),
                             'gradle': '9.4.1 (wrapper and successful run)',
                             'compile_sdk': 36, 'new_robolectric_sdk': 34},
        'scope': {'adb_or_device_calls': 'NONE_THIS_P02',
                  'production_or_hosted_operations': 'NONE_THIS_P02',
                  'real_transactions_or_accounts': 'NONE_THIS_P02',
                  'paid_model_calls': 'NONE_THIS_P02',
                  'production_live_state': 'NOT_TESTED',
                  'phone_state': 'NOT_TESTED'},
        'note': 'Final local commit is resolved with git log; no self-referential commit hash in tracked report.'
    }
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'sources': len(source_hashes), 'raw_files': len(raw_hashes),
                      'changed_paths': len(changed), 'product_diff': product_diff,
                      'protected_groups': len(protected), 'sha256': sha(output)}, indent=2))


if __name__ == '__main__':
    main()
