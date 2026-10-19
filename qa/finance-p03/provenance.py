"""Seal local P03 sources, evidence and Debug artifact after the final commit."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/migration-evidence/finance-p03'
BASELINE = '6ff9b9fd89bb6dedf5837f28421825c4418925f9'
PRODUCT = {
    'android/app/src/main/java/uk/thewyj/app/task21/' + p for p in [
        'NotificationCaptureContracts.kt', 'NotificationCaptureCoordinator.kt', 'NotificationIngestClient.kt',
        'payment/AndroidPaymentNotificationLifecycleRegistry.kt', 'payment/AndroidPaymentRecognitionHook.kt',
        'payment/LocalPaymentLedger.kt', 'payment/LocalPaymentReceiptReconciler.kt', 'payment/PaymentHintSync.kt',
        'payment/PaymentRecognitionCoordinator.kt', 'payment/PaymentRecognitionModel.kt', 'payment/PaymentRecords.kt',
        'payment/PaymentVerificationCenter.kt', 'payment/PaymentEventSafety.kt',
        'store/NotificationDatabase.kt', 'store/PaymentDao.kt', 'store/PaymentEntities.kt',
        'store/PaymentRecognitionStore.kt']
} | {'functions/_lib/' + p for p in [
    'task16-model.mjs', 'task16-service.mjs', 'task21-hints.mjs', 'task21-model.mjs',
    'task21-service.mjs', 'task21-event-safety.mjs', 'payment-currency-evidence.mjs']
} | {'cloudflare/migrations/0027_payment_identity_lifecycle.sql',
     'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/11.json'}
TESTS = {'android/app/src/test/java/uk/thewyj/app/task21/' + p for p in [
    'payment/LocalPaymentBookingTest.kt', 'payment/FinanceP03IdentityLifecycleTest.kt',
    'store/NotificationDatabaseMigrationTest.kt', 'store/FinanceP03PersistenceTest.kt']}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8').strip()


def main():
    output = BASE / 'provenance.json'
    revision = BASE / 'FINAL_REVISION.json'
    assert not output.exists() and not revision.exists(), 'Preserve previous sealed evidence'
    assert git('branch', '--show-current') == 'codex/finance-p03-identity-preauth'
    assert not git('status', '--porcelain=v1'), 'Commit the reviewed local sources and reports first'
    changed = set(git('diff', '--name-only', BASELINE, 'HEAD').splitlines())
    assert all(p in PRODUCT | TESTS or p.startswith(('qa/finance-p03/', 'docs/finance-p03/'))
               for p in changed), 'Modification outside the explicit P03 scope'
    assert not git('diff', '--name-only', '--diff-filter=D', BASELINE, 'HEAD'), 'Deleted baseline file'
    assert not git('diff', '--name-only', BASELINE, 'HEAD', '--', 'qa/finance-p02', 'docs/finance-p02'), 'Frozen P02 changed'
    proof = json.loads((BASE / 'protected-final.comparison.json').read_text(encoding='utf-8'))
    assert all(not r['added'] and not r['missing'] and not r['changed']
               and all(v for k, v in r.items() if k.endswith('Same')) for r in proof.values())
    history = []
    for ref in ['e2febc6', '94f5177', '9ff7a7f', 'f6a2ec7', '57b622e', '8c0de9c',
                'ff11072', '1398c76', BASELINE]:
        commit = git('rev-parse', ref)
        subprocess.run(['git', 'merge-base', '--is-ancestor', commit, 'HEAD'], cwd=ROOT, check=True)
        history.append(commit)
    owner_copy = BASE / 'materials/OWNER_P03.txt'
    owner_original = Path(os.environ['USERPROFILE']) / '.codex/attachments/5ada51e6-2370-4d78-b18c-fc2e7a6c8410/已粘贴的文本.txt'
    assert sha(owner_copy) == sha(owner_original), 'Owner material differs'
    artifact = BASE / 'artifacts/finance-p03-debug.apk'
    artifact.parent.mkdir(exist_ok=True)
    assert not artifact.exists(), 'Preserve prior APK'
    shutil.copy2(ROOT / 'android/app/build/outputs/apk/debug/app-debug.apk', artifact)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    revision.write_text(json.dumps({
        'captured_at_utc': now, 'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
        'branch': git('branch', '--show-current'), 'baseline_commit': BASELINE,
        'implementation_commit': json.loads((BASE / 'code-commit.json').read_text(encoding='utf-8'))['commit'],
        'debug_apk_sha256': sha(artifact), 'debug_apk_bytes': artifact.stat().st_size,
        'not_a_release': True}, ensure_ascii=False, indent=2), encoding='utf-8')
    sources = {p: sha(ROOT / p) for p in sorted(changed)}
    evidence = {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(BASE.rglob('*'))
                if p.is_file() and p != output and '__pycache__' not in p.parts}
    result = {
        'captured_at_utc': now, 'final_commit': git('rev-parse', 'HEAD'),
        'git_tree': git('rev-parse', 'HEAD^{tree}'), 'baseline_commit': BASELINE,
        'inherited_history': history, 'changed_paths': sorted(changed),
        'product_files': sorted(changed & PRODUCT), 'test_files': sorted(changed & TESTS),
        'source_and_report_sha256': sources, 'raw_evidence_sha256': evidence,
        'owner_material_sha256': sha(owner_copy), 'protected_comparison': proof,
        'runtime_versions': {
            'node': subprocess.check_output(['node', '--version']).decode().strip(),
            'python': subprocess.check_output(['python', '--version']).decode().strip(),
            'jbr': subprocess.check_output([r'C:\Program Files\Android\Android Studio\jbr\bin\java.exe', '--version']).decode().strip(),
            'gradle': '9.4.1', 'compile_sdk': 36, 'robolectric_sdk': 34},
        'scope': {'adb_or_device_calls': 'NONE_THIS_P03', 'production_or_hosted_operations': 'NONE_THIS_P03',
                  'real_transactions_or_accounts': 'NONE_THIS_P03', 'model_calls': 'NONE_THIS_P03',
                  'phone_state': 'NOT_TESTED', 'production_state': 'NOT_TESTED',
                  'push_merge_pr_release': 'NONE_THIS_P03'},
        'note': 'Debug artifact only. Git rollback is not a database downgrade.'}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'commit': result['final_commit'], 'product_files': len(changed & PRODUCT),
                      'sources': len(sources), 'raw_files': len(evidence),
                      'apk_sha256': sha(artifact), 'provenance_sha256': sha(output)}, indent=2))


if __name__ == '__main__':
    main()
