from pathlib import Path
import json,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence'
OUT=E/'device';OUT.mkdir(exist_ok=False);pixels=OUT/'pixels';shutil.copytree(ROOT/'qa/finance-p05/closeout/emulator',pixels)
shutil.copy2(ROOT/'qa/finance-convergence/ocr-probe/ReferenceOcrProbeTest.kt',pixels/'ReferenceOcrProbeTest.kt')
shutil.copy2(E/'inputs/r1/synthetic-ai-page.png',pixels/'assets/reference-original.png')
source=ROOT/'qa/finance-p05/closeout/boot-avd.py';s=source.read_text().replace('ROOT=Path(__file__).resolve().parents[3]',f'ROOT=Path({str(ROOT)!r})').replace("docs/migration-evidence/finance-p04/non-device-closeout","docs/migration-evidence/finance-p04/convergence").replace('FinanceCloseoutIsolated','FinanceConvergence').replace('CLOSEOUT_NO_USB','FINANCE_CONVERGENCE_NO_USB').replace('5041','5053').replace('5584','5576').replace('5585','5577')
(OUT/'boot.py').write_text(s)
print('Prepared exact original PNG and private emulator 5053/5576.')
