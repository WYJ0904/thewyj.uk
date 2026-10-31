"""Owner comfort: same three lifecycle assertions, paced UI; no timeout change."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
SOURCE=ROOT/'qa/finance-p05/closeout/emulator';OUT=E/'device/slow-sdk-source';assert not OUT.exists()
shutil.copytree(SOURCE,OUT)
p=OUT/'CloseoutEmulatorTest.kt';original=p.read_text()
start=original.index('    @Test fun test03_activityStopsResumesAndRecreates()')
end=original.index('    @Test fun test04_',start)
body=original[start:end]
for token in ['scenario.moveToState(Lifecycle.State.CREATED)','scenario.moveToState(Lifecycle.State.RESUMED)','scenario.recreate()','scenario.close()']:
    assert body.count(token)==1,token
    body=body.replace(token,'SystemClock.sleep(5000);'+token)
assert body.replace('SystemClock.sleep(5000);','')==original[start:end]
p.write_text(original[:start]+body+original[end:])
result=dict(scope='QA-only physical-device UI pacing; assertions/three rounds/ActivityScenario timeouts unchanged',
    owner_minimum_dwell_ms=5000,source_sha256=hashlib.sha256((SOURCE/p.name).read_bytes()).hexdigest(),
    derived_sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
    same_fixture=hashlib.sha256((OUT/'assets/closeout-cases.json').read_bytes()).hexdigest()==hashlib.sha256((SOURCE/'assets/closeout-cases.json').read_bytes()).hexdigest(),
    assertion_changes=0,pacing_insertions=4)
(E/'phone-pacing-preparation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
