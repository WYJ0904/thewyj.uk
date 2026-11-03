"""Seal the completed local, synthetic P03/P04 delivery; never run remote work."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / 'docs/migration-evidence/finance-p04/local'
BASE = LOCAL / 'final-r2'
PRODUCT = '94ab0fc82bc5b21b4f04237ff110574d10da565c'
REPORTS = [
    'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md',
    'docs/finance-p04/FINANCE_P04_FINAL_REPORT.md',
    'docs/finance-p04/CURRENCY_18_LEDGER.md',
    'docs/finance-p04/VALIDATION_COMMANDS.md',
]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()


def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


def write_new(path, data):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write('\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['precommit', 'postcommit'])
    args = parser.parse_args()
    suffix = 'precommit-seal.json' if args.stage == 'precommit' else 'provenance.json'
    destination = BASE / suffix
    assert not destination.exists(), 'Preserve the previous seal'
    summary = json.loads((BASE / 'delivery-v2/summary.json').read_text(encoding='utf-8'))
    assert summary['head'] == PRODUCT
    assert summary['standard_JVM'] == {'PASS': 716, 'FAIL': 6}
    assert summary['original607']['counts'] == {'PASS': 602, 'FAIL': 5}
    assert summary['frozen608'] == {'PASS': 549, 'FAIL': 8, 'EXPECTED_RED': 28, 'NOT_TESTED': 23}
    assert summary['contract608'] == {'PASS': 555, 'FAIL': 8, 'EXPECTED_RED': 22, 'NOT_TESTED': 23}
    assert summary['currency18'] == {'PASS': 18}
    assert summary['currency18_raw'] == {'EXPECTED_RED': 6, 'PASS': 12}
    assert summary['p03_status'] == summary['p04_status'] == 'PARTIAL'
    changed_since_product = git('diff', PRODUCT, '--name-only').splitlines()
    assert all(path in REPORTS or path.startswith('qa/') for path in changed_since_product)
    chain = [
        '5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc',
        'dd5fc98b3ac636830a3517e2eae11fad14031b07',
        '3b710e3c7a8c1da4a82ee5fe75221ec4d877ae5a',
        PRODUCT,
        git('rev-parse', 'HEAD'),
    ]
    for earlier, later in zip(chain, chain[1:]):
        subprocess.run(['git', 'merge-base', '--is-ancestor', earlier, later], cwd=ROOT, check=True)
    checked_links = []
    pending_generated = {BASE / 'REVISION.json', BASE / 'provenance.json'}
    for name in REPORTS:
        path = ROOT / name
        text = path.read_text(encoding='utf-8')
        if name.startswith('docs/finance-p03/'):
            text = text.split('## 历史报告原文')[0]
        for link in re.findall(r'\]\(([^)]+)\)', text):
            if re.match(r'^[a-zA-Z]+:', link) or link.startswith('#'):
                continue
            target = (path.parent / link.split('#')[0]).resolve()
            assert target.is_relative_to(ROOT), f'Unexpected report path: {link}'
            assert target.exists() or target in pending_generated, f'Missing report evidence: {link}'
            checked_links.append({'report': name, 'target': target.relative_to(ROOT).as_posix()})
    extra_roots = [
        LOCAL / 'contract-input-drivers',
        LOCAL / 'backup-proof-source',
        ROOT / 'docs/migration-evidence/native-mvke507e-2196',
    ]
    files = {path for path in BASE.rglob('*') if path.is_file()}
    for directory in extra_roots:
        assert directory.exists(), directory
        files.update(path for path in directory.rglob('*') if path.is_file())
    files.update(ROOT / name for name in REPORTS)
    files.update(ROOT / name for name in git('ls-files', 'qa/finance-p04').splitlines())
    files.update(path for path in (ROOT / 'qa/finance-p04').glob('*.py'))
    files.add(ROOT / 'qa/finance-p03/nonphone/native-persist.mjs')
    files.add(ROOT / 'package-lock.json')
    files.update(path for path in LOCAL.glob('protected-*.json'))
    files.add(LOCAL / 'cloud-import-validation.json')
    # These are synthetic QA roots and explicitly named source/reports only.
    assert all(path.name != '\u8bbf\u95ee\u53e3\u4ee4.txt' for path in files)
    entries = {path.relative_to(ROOT).as_posix(): {'bytes': path.stat().st_size, 'sha256': digest(path)}
               for path in sorted(files)}
    assert entries['package-lock.json']['sha256'] == '75f023a2e4a47d248d3246e1b3c7e4a86ab7e5739b105b37ca8320021a1fdeb3'
    apk_key = (BASE / 'android-current/app-debug.apk').relative_to(ROOT).as_posix()
    assert entries[apk_key]['sha256'] == 'cc73b16ae40271b2299621c0405f15b946f48df565ec9e55f3bf2076b80a3f6f'
    snapshot_name = 'protected-after' if args.stage == 'postcommit' else 'protected-pre-report'
    protection = json.loads((LOCAL / f'{snapshot_name}.comparison.json').read_text(encoding='utf-8'))
    assert len(protection) == 13
    assert all(not row['added'] and not row['missing'] and not row['changed']
               and all(value for key, value in row.items() if key.endswith('Same'))
               for row in protection.values())
    old_p03 = ROOT.parents[1] / 'finance-p03-identity-preauth/thewyj.uk'
    # ROOT is <worktrees>/finance-p04-multicurrency/thewyj.uk.
    old_head = subprocess.check_output(['git', '-C', str(old_p03), 'rev-parse', 'HEAD'], text=True).strip()
    assert old_head == chain[0]
    assert not subprocess.check_output(['git', '-C', str(old_p03), 'diff', '--name-only'], text=True).strip()
    status = git('status', '--porcelain=v1')
    if args.stage == 'postcommit':
        assert not status, 'Final tracked/untracked state must be clean'
    result = {
        'sealed_at_utc': datetime.now(timezone.utc).isoformat(),
        'stage': args.stage, 'workspace': str(ROOT), 'branch': git('branch', '--show-current'),
        'delivery_commit': git('rev-parse', 'HEAD'), 'delivery_tree': git('rev-parse', 'HEAD^{tree}'),
        'product_source_commit': PRODUCT, 'ancestry': chain, 'git_status': status,
        'p03_status': 'PARTIAL', 'p04_status': 'PARTIAL',
        'protected_groups': 13, 'protection': 'PASS', 'old_p03_head': old_head,
        'phone': 'NOT USED / NOT_TESTED', 'production': 'NOT USED / NOT_TESTED',
        'push_pr_merge_sign_release': 'NOT PERFORMED',
        'cleanup': json.loads((BASE / 'profile-cleanup-blocked.json').read_text(encoding='utf-8')),
        'checked_report_links': checked_links, 'file_count': len(entries), 'files': entries,
        'scope': 'Local synthetic current execution; overlaps not added; failures and historical evidence retained',
    }
    write_new(destination, result)
    if args.stage == 'postcommit':
        write_new(BASE / 'REVISION.json', {
            'delivery_commit': result['delivery_commit'], 'delivery_tree': result['delivery_tree'],
            'product_source_commit': PRODUCT, 'provenance': destination.name,
            'provenance_sha256': digest(destination), 'status': 'P03 PARTIAL / P04 PARTIAL',
        })
    print(json.dumps({'stage': args.stage, 'commit': result['delivery_commit'],
                      'sealed_files': len(entries), 'report_links': len(checked_links),
                      'protection': '13/13 PASS', 'output': str(destination)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
