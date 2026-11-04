"""Replay immutable synthetic ML Kit observations against the integrated Kotlin modules."""
from pathlib import Path
import hashlib, importlib.util, json, re, shutil, subprocess, sys, xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('lab',ROOT/'qa/p06-ai-quality-lab/run.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
label=sys.argv[1];assert re.fullmatch('[a-z0-9-]+',label)
out=ROOT/'docs/migration-evidence/finance-safe-convergence'/label;out.mkdir(parents=True,exist_ok=False)
source='6c95d20dde951e12cf58f98d2d00ce2a51933daa';inputs=out/'inputs';records=[]
for name in ['qa/p05-exactness-r2/replay.init.gradle','qa/p05-exactness-r2/kotlin/FrozenR1ReferenceExtractor.kt',
 'qa/p05-exactness-r2/kotlin/R2ReceiptReplayTest.kt','qa/p05-exactness/kotlin/ReferenceEvidenceReplayTest.kt',
 'qa/p05-exactness-r2/fixtures/r1-sdk.json','docs/finance/evidence/p05-r2/r2-sdk.json']:
    data=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
    file=inputs/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
    records.append({'path':name,'source':source,'sha256':hashlib.sha256(data).hexdigest()})
args=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),
 '-I',str(inputs/'qa/p05-exactness-r2/replay.init.gradle'),
 '-Dp05.r2.root='+str(inputs/'qa/p05-exactness-r2'),
 '-Dp05.lab.replay='+str(inputs/'qa/p05-exactness-r2/fixtures/r1-sdk.json'),
 '-Dp05.r2.replay='+str(inputs/'docs/finance/evidence/p05-r2/r2-sdk.json'),
 '-Dp05.r2.output='+str(out/'replay-comparison.json'),':app:testDebugUnitTest',
 '--tests','*R2ReceiptReplayTest','--tests','*ReferenceEvidenceReplayTest',
 '--no-daemon','--max-workers=2','--console=plain','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
before=lab.snapshot(('android/',))
with (out/'gradle.log').open('xb') as log:p=subprocess.run(args,cwd=ROOT,env=lab.environment(),stdout=log,stderr=subprocess.STDOUT)
after=lab.snapshot(('android/',));assert before==after
tests=ROOT/'android/app/build/test-results/testDebugUnitTest';shutil.copytree(tests,out/'junit')
totals={k:0 for k in ['tests','failures','errors','skipped']}
for file in (out/'junit').glob('TEST-*.xml'):
    suite=ET.parse(file).getroot()
    for key in totals:totals[key]+=int(suite.get(key,0))
(out/'command.json').write_text(json.dumps({'command':args,'exit_code':p.returncode,'source_stable':True,
 'inputs':records,'junit':totals,'scope':'offline replay of synthetic SDK observations; no new SDK/device call'},indent=2),encoding='utf8')
print(json.dumps({'exit_code':p.returncode,'junit':totals,'new_device_calls':0}))
sys.exit(p.returncode)
