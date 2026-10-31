"""History is evidence of past semantics, never evidence for a new unknown capture."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
path='android/app/src/main/java/uk/thewyj/app/finance/CurrencyReferenceRepository.kt'
history=git('log','--format=%H %s','-S','wyj-currency-context','--',path).splitlines()
legacy='f6a2ec787f47468b6c0565141a1e4d82cd41330b'
old_currency_mentions=git('grep','-n','-E','currency.*CNY|defaultCurrency|default_currency',legacy,'--','android/app/src/main/java/uk/thewyj/app/task21/payment/').splitlines()
test_files=['AndroidPaymentRecognitionHookArchiveTest.kt','FinanceP03IdentityLifecycleTest.kt','LocalPaymentBookingTest.kt']
hashes={name:hashlib.sha256((ROOT/'android/app/src/test/java/uk/thewyj/app/task21/payment'/name).read_bytes()).hexdigest() for name in test_files}
result={'baseline':'adbd4851410b47894cc8bf90ffb989e8e407ebdd','runtime_preferences_history':history,
    'legacy_hotfix_commit':legacy,'legacy_currency_source_mentions':old_currency_mentions,
    'original_test_hashes':hashes,'original_six_evidence':'six-before/command.json',
    'conclusion':'Original six fixtures have no persisted account currency evidence. Legacy implicit CNY cannot safely authorize a new v2 capture.',
    'safe_compatibility':'Exact durable ledger replay reuses its verified stored ISO unit; genuine schema14 to18 tested. Persisted account settings recover from actual FX Room v1; no global CNY default.',
    'owner_decision':'Keep original FAILs, or explicitly approve a revised account-currency precondition contract. Existing separate explicit-v2 PASSes cannot be relabelled original PASS.',
    'derived_dom_provenance_limit':'Prior driver embeds its preparation-directory output path. This phase generates fresh drivers directly in each final run, never copies prior ndjson as a new result.'}
target=E/'legacy-currency-audit.json';assert not target.exists();target.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
