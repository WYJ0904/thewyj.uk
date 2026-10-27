from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/convergence'
p=E/'device/pixels/ReferenceOcrProbeTest.kt';shutil.copy2(p,p.with_suffix('.kt.before-r2'));shutil.copy2(ROOT/'qa/finance-convergence/ocr-probe/ReferenceOcrProbeTest.kt',p)
s=(ROOT/'qa/finance-convergence/run-probe.py').read_text().replace("OUT=E/'ocr-probe'","OUT=E/'ocr-probe-r2'").replace('files/reference-probe/','files/reference-probe-r2/').replace('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})')
(E/'device/run-probe-r2.py').write_text(s)
