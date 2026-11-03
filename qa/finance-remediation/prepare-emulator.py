"""Generate emulator-only derivatives with new ports/output; no physical fallback."""
from pathlib import Path
import difflib,hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-p06/remediation'
OUT=E/'drivers';OUT.mkdir(exist_ok=False)
rows=[]
def derive(source,name,changes):
    before=(ROOT/source).read_text();after=before
    for old,new in changes:
        assert old in after,old
        after=after.replace(old,new)
    target=OUT/name;target.write_text(after)
    target.with_suffix('.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True))))
    rows.append(dict(source=source,source_sha256=hashlib.sha256(before.encode()).hexdigest(),derived=name,derived_sha256=hashlib.sha256(after.encode()).hexdigest()))
derive('qa/finance-p05/closeout/boot-avd.py','boot.py',[
    ("ROOT=Path(__file__).resolve().parents[3]",f'ROOT=Path({str(ROOT)!r})'),
    ("docs/migration-evidence/finance-p04/non-device-closeout","docs/migration-evidence/finance-p06/remediation"),
    ('FinanceCloseoutIsolated','FinanceRemediationIsolated'),('CLOSEOUT_NO_USB','FINANCE_REMEDIATION_NO_USB'),('5041','5051'),('5584','5596'),('5585','5597')])
derive('qa/finance-p06/run-joint.py','joint.py',[
    ("ROOT=Path(__file__).resolve().parents[2]",f'ROOT=Path({str(ROOT)!r})'),
    ("docs/migration-evidence/finance-p06'","docs/migration-evidence/finance-p06/remediation'"),
    ("sdk_attempt='r'+", "assert args.emulator, 'This derivative is emulator-only; no physical fallback'\nsdk_attempt='r'+"),
    ('5043','5051'),('5589','5597'),('device/slow-sdk-source','device/sdk-source')])
derive('qa/finance-p06/finish-emulator.py','finish.py',[
    ("ROOT=Path(__file__).resolve().parents[2]",f'ROOT=Path({str(ROOT)!r})'),
    ("docs/migration-evidence/finance-p06'","docs/migration-evidence/finance-p06/remediation'"),
    ('FinanceP06Isolated','FinanceRemediationIsolated'),('5043','5051'),('5588','5596'),('5589','5597')])
derive('qa/finance-p06/supplementary.py','supplementary.py',[
    ("ROOT=Path(__file__).resolve().parents[2]",f'ROOT=Path({str(ROOT)!r})'),
    ("docs/migration-evidence/finance-p06'","docs/migration-evidence/finance-p06/remediation'")])
pixels=E/'device/sdk-source';pixels.parent.mkdir(parents=True)
shutil.copytree(ROOT/'qa/finance-p05/closeout/emulator',pixels)
rows.append(dict(pixel_fixture_sha256=hashlib.sha256((pixels/'assets/closeout-cases.json').read_bytes()).hexdigest(),assertion_changes=0))
(OUT/'adaptations.json').write_text(json.dumps(rows,indent=2))
print('Prepared emulator-only private server 5051 / AVD 5596, plus local P06 suites.')
