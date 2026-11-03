"""Reuse the original identity-aware collector, redirecting only evidence locations."""
from pathlib import Path
import difflib,hashlib,json
ROOT=Path(__file__).resolve().parents[2]
ORIGIN=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
E=ROOT/'docs/migration-evidence/finance-p04/remediation'
source=ROOT/'qa/finance-p06/collect.py';before=source.read_text();after=before
changes=[
 ("ROOT=Path(__file__).resolve().parents[2]",f'ROOT=Path({str(ROOT)!r})\nORIGIN=Path({str(ORIGIN)!r})'),
 ("HISTORY=ROOT/'docs/migration-evidence/finance-p03'","HISTORY=ORIGIN/'docs/migration-evidence/finance-p03'"),
 ("ROOT/'docs/migration-evidence/finance-p04/p06-validation/final-r3'","ROOT/'docs/migration-evidence/finance-p04/remediation/final-r1'"),
 ("ROOT/'docs/migration-evidence/finance-p04/p06-validation'","ROOT/'docs/migration-evidence/finance-p04/remediation'"),
 ("previousP05=read(ROOT/","previousP05=read(ORIGIN/"),
 ("beforeP05=read(ROOT/","beforeP05=read(ORIGIN/"),
 ("junit(ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')","junit(ORIGIN/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')"),
 ("source=ROOT/'docs/migration-evidence/finance-p03/final/compat-p03/kotlin/P03BridgeTest.kt'","source=ROOT/'docs/migration-evidence/finance-p04/remediation/fixtures/compat-p03/kotlin/P03BridgeTest.kt'"),
 ("expected={'prepare-backup',","expected={"),
 ("'regression/closeout-d1/migration.ndjson'","'regression-baseline-retry/closeout-d1/migration.ndjson'"),
 ("path=Path(path).resolve(); INPUTS.add(path); return path", """path=Path(path).resolve()
    # Initial missing-v3-module command failed before any original test ran.
    # Its log/exit remain in the primary command manifest; only the current
    # five test results are read from the independent, unchanged-oracle retry.
    oldPath=BASE/'regression/closeout-d1'
    if path.is_relative_to(oldPath):path=BASE/'regression-baseline-retry/closeout-d1'/path.relative_to(oldPath)
    INPUTS.add(path); return path"""),
]
for old,new in changes:
    assert old in after,old
    after=after.replace(old,new)
target=E/'preparation/collector-r2.py';assert not target.exists();target.write_text(after)
target.with_suffix('.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True))))
(E/'preparation/collector-adaptation-r2.json').write_text(json.dumps(dict(source='qa/finance-p06/collect.py',source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    derived_sha256=hashlib.sha256(after.encode()).hexdigest(),
    changes='Absolute ROOT / read-only historical identity locations / new owned output / separate five-case missing-baseline retry. No test assertion, fixture, status or counting expression changed.'),indent=2))
print(target)
