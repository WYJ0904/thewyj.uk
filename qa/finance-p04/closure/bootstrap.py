"""Verify the sealed handoff before continuing the owner-authorized closure."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
OUT.mkdir(exist_ok=False)
git = lambda *a: subprocess.check_output(['git', *a], cwd=ROOT, text=True).strip()
baseline = ROOT / 'docs/migration-evidence/finance-p04/local/final-r2'
revision = json.loads((baseline / 'REVISION.json').read_text(encoding='utf8'))
assert git('rev-parse', 'HEAD') == revision['delivery_commit'] == '329aa0c8da33776d72bc778c9a3737865d26fd6f'
raw = (baseline / 'provenance.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == revision['provenance_sha256']
sealed = json.loads(raw)
checked = []
for name, expected in sealed['files'].items():
    path = (ROOT / name).resolve()
    assert path.is_relative_to(ROOT) and path.name != '\u8bbf\u95ee\u53e3\u4ee4.txt'
    sha = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    assert sha == expected['sha256'], f'Sealed artifact changed: {name}'
    checked.append(name)
result = {'checked_utc': datetime.now(timezone.utc).isoformat(), 'head': git('rev-parse', 'HEAD'),
          'branch': git('branch', '--show-current'), 'status': git('status', '--porcelain=v1'),
          'sealed_files_checked': len(checked), 'sealed_handoff': 'PASS',
          'owner_authority': 'Current request authorizes isolated phone and hosted QA; production remains gated',
          'device': 'ADB unauthorized at initial connection; owner RSA confirmation pending',
          'phone_private_data_read': False, 'production_mutated': False}
(OUT / 'baseline.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
checklist = {'environment_and_seal': 'PASS', 'remaining_failure_ledger': 'IN_PROGRESS',
             'versioned_regressions': 'NOT_TESTED', 'samsung_synthetic': 'NOT_TESTED',
             'existing_wechat_001': 'NOT_TESTED', 'hosted_isolated_d1': 'NOT_TESTED',
             'backup_restore': 'NOT_TESTED', 'rc6': 'NOT_TESTED',
             'production_release': 'HELD_BY_GATES', 'cleanup': 'PENDING_EVIDENCE_SEAL'}
(OUT / 'checklist.json').write_text(json.dumps(checklist, indent=2), encoding='utf8')
(OUT / 'execution.ndjson').write_text(json.dumps(result, ensure_ascii=False)+'\n', encoding='utf8')
print(json.dumps({k: v for k, v in result.items() if k != 'status'}, ensure_ascii=False))
