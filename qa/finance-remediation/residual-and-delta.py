"""Record retained rebuildable disk after a tool rejection, plus current-only deltas."""
from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import hashlib,json
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/remediation';P6=ROOT/'docs/migration-evidence/finance-p06/remediation'
out=P6/'local-cleanup.json';assert not out.exists()
home=(P6/'avd/home').resolve();assert home.is_relative_to(ROOT.resolve()) and home.name=='home'
files=[p for p in home.rglob('*') if p.is_file()];logical=sum(p.stat().st_size for p in files)
out.write_text(json.dumps(dict(status='PARTIAL',utc=datetime.now(timezone.utc).isoformat(),qa_packages_uninstalled=True,emulator_stopped=True,private_adb_stopped=True,
    avd_disk=dict(status='BLOCKED_BY_TOOL_POLICY',path=str(home),files=len(files),logical_bytes=logical,reclaim_bytes=0,
        tool_rejection='exec_command rejected before process creation: blocked by policy',retry_or_alternate_deletion_attempted=False),
    retained=['Source','Required APKs, JUnit, logs, screenshots, synthetic databases, fixtures and provenance','Configuration archive','Rebuildable node_modules / Android build caches in this owned worktree'],
    physical_phone_operations=False,production_operations=False),indent=2))
base=E/'baseline/delivery';current=E/'final-r1/delivery-current';rows=[]
for name,key in [('jvm-current.json',lambda r:(r['classname'],r['name'])),('frozen-608.json',lambda r:r['case_id']),('contract-608.json',lambda r:r['case_id'])]:
    before={key(r):r for r in json.loads((base/name).read_text())};after={key(r):r for r in json.loads((current/name).read_text())}
    assert set(before)==set(after),name
    changed=[dict(id=k,before=before[k]['status'],after=after[k]['status']) for k in before if before[k]['status']!=after[k]['status']]
    rows.append(dict(set=name,total=len(after),before=dict(Counter(r['status'] for r in before.values())),after=dict(Counter(r['status'] for r in after.values())),changed=changed))
(E/'current-vs-a065.json').write_text(json.dumps(dict(status='PASS' if not any(r['changed'] for r in rows) else 'CHANGED',
    comparisons=rows,scope='Same identities, current results versus a065. Collector frozen_changes is versus the older P03 baseline, NOT this remediation delta.'),indent=2))
raw=json.loads((P6/'artifact-recovery/r1/native/synthetic-sdk-lines.json').read_text());expected='SYNTH-P06-JOINT-123456'
observed=next(x for x in raw if x.startswith('交易号')).removeprefix('交易号').strip();assert observed!=expected
(P6/'artifact-recovery/alpha-diagnosis.json').write_text(json.dumps(dict(status='CONFIRMED_SOURCE_REFERENCE_MISMATCH',expected_synthetic_reference=expected,
    actual_synthetic_ocr_reference=observed,actual_sdk_lines_sha256=hashlib.sha256((P6/'artifact-recovery/r1/native/synthetic-sdk-lines.json').read_bytes()).hexdigest(),
    product_guard='FinanceAiEvidence.capture: pageReference != record.providerReference returns null',
    source='android/app/src/main/java/uk/thewyj/app/finance/FinanceAiEvidence.kt',
    original_result='FAIL, unchanged',numeric_control='PASS independently; changes the reference fixture and cannot close original alpha FAIL',
    fix_disposition='No guessed 0/O, missing-letter or fuzzy reference repair; keep pending review and zero financial facts.',
    historical_same_failure='Previous joint-r4/native-seed.log has the same Actual SDK text must reach the native assistance observer assertion; original seal unchanged.'),indent=2))
print(json.dumps(dict(avd_retained_logical_bytes=logical,current_delta=rows)))
