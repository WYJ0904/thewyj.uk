from pathlib import Path
import json,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence';D=E/'drivers';D.mkdir(exist_ok=False)
def derive(src,name,replacements):
 s=(ROOT/src).read_text()
 for old,new in replacements:
  assert old in s,old;s=s.replace(old,new)
 p=D/name;p.write_text(s);return p
prepare=derive('qa/finance-remediation/prepare.py','prepare.py',[('ROOT = Path(__file__).resolve().parents[2]',f'ROOT = Path({str(ROOT)!r})'),('docs/migration-evidence/finance-p04/remediation','docs/migration-evidence/finance-p04/convergence')])
subprocess.run([sys.executable,str(prepare)],cwd=ROOT,check=True)
derive('qa/finance-remediation/regression.py','regression.py',[('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})'),('docs/migration-evidence/finance-p04/remediation','docs/migration-evidence/finance-p04/convergence')])
source=E/'versioned-identity-source';(source/'kotlin').mkdir(parents=True);shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',source/'test.init.gradle');shutil.copy2(ROOT/'qa/finance-convergence/kotlin/VersionedIdentityContractTest.kt',source/'kotlin/VersionedIdentityContractTest.kt')
derive('qa/finance-p06/supplementary.py','supplementary.py',[('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})'),("docs/migration-evidence/finance-p06'","docs/migration-evidence/finance-p04/convergence/ai'")])
print('Prepared current-source regression directories and unmodified original oracles.')
