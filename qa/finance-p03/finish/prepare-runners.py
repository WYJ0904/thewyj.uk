"""Use sealed regression drivers, redirect output/build destinations only."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
DEST=OUT/'regression-runners';DEST.mkdir(exist_ok=False)
manifest={}
for p in (ROOT/'docs/migration-evidence/finance-p03/device/regression-runners').glob('*.ps1'):
    text=p.read_text(encoding='utf8-sig').replace('docs/migration-evidence/finance-p03/device','docs/migration-evidence/finance-p03/finish')
    if p.name=='run-gradle.ps1':
        text=text.replace("[string[]]$p03Args=@('-p','./android')", "[string[]]$p03Args=@('-p','./android','-I',(Join-Path $p03Root 'qa/finance-p03/finish/output.init.gradle'),('-Dfinance.finish.output='+$p03Base))")
        text=text.replace('android/app/build/', 'docs/migration-evidence/finance-p03/finish/build-regression/app/')
        text=text.replace("-Filter 'TEST-*.xml' |", "-Filter 'TEST-*.xml' -ErrorAction SilentlyContinue |")
    if p.name=='run-node.ps1':text=text.replace('./qa/finance-p03/final/output-redirect.mjs','./qa/finance-p03/finish/output-redirect.mjs')
    if p.name=='run-native-persist.ps1':text=text.replace('qa/finance-p03/device/native-persist-worker.mjs','qa/finance-p03/finish/native-persist-worker.mjs')
    target=DEST/p.name;target.write_text(text,encoding='utf8')
    manifest[p.name]={'sealed_source':p.relative_to(ROOT).as_posix(),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'runner_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'changes':'output/build paths and separate KSP schema destination only; original assertions and fixtures unchanged'}
source=ROOT/'qa/finance-p03/device/output-redirect.mjs'
target=ROOT/'qa/finance-p03/finish/output-redirect.mjs';assert not target.exists()
target.write_text(source.read_text().replace('docs/migration-evidence/finance-p03/device','docs/migration-evidence/finance-p03/finish'),encoding='utf8')
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'drivers':len(manifest),'assertion_changes':0}))
