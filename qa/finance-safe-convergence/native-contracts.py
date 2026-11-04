"""Run existing explicit-currency/strict-identity QA without changing their oracles."""
from pathlib import Path
import importlib.util, json, re, shutil, subprocess, sys, xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('lab',ROOT/'qa/p06-ai-quality-lab/run.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
label=sys.argv[1];assert re.fullmatch('[a-z0-9-]+',label)
out=ROOT/'docs/migration-evidence/finance-safe-convergence'/label;out.mkdir(parents=True,exist_ok=False)
src=out/'source';(src/'kotlin').mkdir(parents=True)
inputs=[]
for name,target in [('qa/finance-p02/test.init.gradle','test.init.gradle'),
 ('qa/finance-convergence/kotlin/VersionedIdentityContractTest.kt','kotlin/VersionedIdentityContractTest.kt'),
 ('qa/finance-p04/closure/kotlin/FinanceClosureContractTest.kt','kotlin/FinanceClosureContractTest.kt')]:
    shutil.copy2(ROOT/name,src/target);inputs.append({'path':name,'sha256':lab.sha(ROOT/name)})
args=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),
 '-I',str(src/'test.init.gradle'),'-Dfinance.p02.root='+str(src),'-Dfinance.p02.output='+str(out),
 ':app:testDebugUnitTest','--tests','*VersionedIdentityContractTest','--tests','*FinanceClosureContractTest',
 '--no-daemon','--max-workers=2','--console=plain','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
before=lab.snapshot(('android/',))
with (out/'gradle.log').open('xb') as log:p=subprocess.run(args,cwd=ROOT,env=lab.environment(),stdout=log,stderr=subprocess.STDOUT)
stable=before==lab.snapshot(('android/',));shutil.copytree(ROOT/'android/app/build/test-results/testDebugUnitTest',out/'junit')
totals={k:0 for k in ['tests','failures','errors','skipped']}
for file in (out/'junit').glob('TEST-*.xml'):
    suite=ET.parse(file).getroot()
    for key in totals:totals[key]+=int(suite.get(key,0))
(out/'command.json').write_text(json.dumps({'command':args,'exit_code':p.returncode,'source_stable':stable,'inputs':inputs,
 'junit':totals,'scope':'versioned account-currency and strict identity controls; not old oracle replacement'},indent=2),encoding='utf8')
print(json.dumps({'exit_code':p.returncode,'source_stable':stable,'junit':totals}))
sys.exit(p.returncode if stable else 1)
