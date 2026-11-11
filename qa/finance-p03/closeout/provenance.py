"""Audit P03-only scope and seal the final local closeout; never release anything."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'docs/migration-evidence/finance-p03/closeout'
BASELINE = '81d5aa7cc51b55d386b59414019c4a0f01272032'
PRODUCT = {'android/app/src/main/java/uk/thewyj/app/task21/' + p for p in [
    'NotificationCaptureContracts.kt','NotificationCaptureCoordinator.kt','NotificationIngestClient.kt',
    'payment/AndroidPaymentRecognitionHook.kt','payment/LocalPaymentLedger.kt','payment/PaymentEventSafety.kt',
    'payment/PaymentRecognitionCoordinator.kt','payment/PaymentRecognitionModel.kt','payment/PaymentRecords.kt',
    'payment/PaymentVerificationCenter.kt','payment/PaymentLifecycleBalance.kt',
    'store/NotificationDatabase.kt','store/PaymentEntities.kt','store/PaymentRecognitionStore.kt']}
PRODUCT |= {'functions/_lib/' + p for p in ['task21-model.mjs','task21-service.mjs','task21-event-safety.mjs','task21-lifecycle.mjs']}
PRODUCT |= {'cloudflare/migrations/0028_payment_lifecycle_accounting.sql',
            'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/12.json'}
TESTS = {'android/app/src/test/java/uk/thewyj/app/task21/' + p for p in [
    'store/FinanceP03PersistenceTest.kt','store/NotificationDatabaseMigrationTest.kt',
    'store/FinanceP03CloseoutMigrationTest.kt','store/CloseoutV11Database.kt','payment/FinanceP03ClearingCloseoutTest.kt']}
QA = {'qa/finance-p03/' + p for p in ['bridge-server.mjs','migration.mjs','kotlin/P03BridgeTest.kt','kotlin/P03CloseoutBridgeTest.kt']}


def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8').strip()
def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): result.update(block)
    return result.hexdigest()


def scope():
    assert git('branch','--show-current') == 'codex/finance-p03-identity-preauth'
    subprocess.run(['git','merge-base','--is-ancestor',BASELINE,'HEAD'], cwd=ROOT, check=True)
    changed = set(git('diff','--name-only',BASELINE).splitlines())
    changed.update(git('ls-files','--others','--exclude-standard').splitlines())
    assert all(p in PRODUCT | TESTS | QA or p.startswith(('qa/finance-p03/closeout/','docs/finance-p03/CLOSEOUT_')) for p in changed), changed
    assert not git('diff','--name-only','--diff-filter=D',BASELINE)
    assert not git('diff','--name-only',BASELINE,'--','qa/finance-p02','docs/finance-p02')
    for version in range(1,12):
        p=f'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/{version}.json'
        assert git('hash-object',p) == git('rev-parse',BASELINE+':'+p)
    old=json.loads((BASE/'baseline-audit.json').read_text(encoding='utf-8'))
    for group in ['reports','p02_sources','p03_raw']:
        for name,digest in old[group].items(): assert sha(ROOT/name)==digest,name
    proof=json.loads((BASE/'protected-seal.comparison.json').read_text())
    assert len(proof)==13 and all(not r['added'] and not r['missing'] and not r['changed'] and
        all(v for k,v in r.items() if k.endswith('Same')) for r in proof.values())
    return changed,proof


def seal():
    changed,proof=scope()
    assert not git('status','--porcelain=v1'), 'Commit reviewed sources and reports first'
    manifest=BASE/'provenance.json';revision=BASE/'CLOSEOUT_REVISION.json'
    assert not manifest.exists() and not revision.exists(), 'Preserve prior seals'
    artifact=BASE/'artifacts/finance-p03-closeout-debug.apk'
    artifact.parent.mkdir(exist_ok=True)
    built=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
    if artifact.exists(): assert sha(artifact)==sha(built)
    else: shutil.copy2(built,artifact)
    current={'captured_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'commit':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),
        'implementation_commit':json.loads((BASE/'code-commit-final.json').read_text())['commit'],
        'baseline_commit':BASELINE,'branch':git('branch','--show-current'),
        'debug_apk_sha256':sha(artifact),'debug_apk_bytes':artifact.stat().st_size,'not_a_release':True}
    revision.write_text(json.dumps(current,ensure_ascii=False,indent=2),encoding='utf-8')
    excluded={manifest,BASE/'provenance-run.log'}  # The active seal cannot hash its own unfinished stdout.
    raw={p.relative_to(ROOT).as_posix():sha(p) for p in sorted(BASE.rglob('*')) if p.is_file() and p not in excluded and '__pycache__' not in p.parts}
    result={**current,'product_files':sorted(changed & PRODUCT),'changed_paths':sorted(changed),
        'source_and_report_sha256':{p:sha(ROOT/p) for p in sorted(changed)},'raw_evidence_sha256':raw,
        'protected_comparison':proof,'seal_envelopes_excluded':['provenance.json','provenance-run.log'],
        'scope':{'phone_adb':'NONE','real_accounts_payments':'NONE','production_hosted':'NONE','push_merge_pr_release':'NONE',
                 'real_device_acceptance':'NOT_TESTED','production_backup_restore':'NOT_TESTED'},
        'note':'Source lifecycle projection and local synthetic QA only; Git rollback is not database rollback.'}
    manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'commit':current['commit'],'product_files':len(changed & PRODUCT),'source_files':len(changed),
        'evidence_files':len(raw),'apk_sha256':current['debug_apk_sha256'],'provenance_sha256':sha(manifest)},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
    if args.check_only:
        changes,proof=scope();print('P03-only scope PASS:',len(changes),'paths;',len(proof),'protected groups')
    else: seal()
