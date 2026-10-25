"""Scope the existing identity-preserving collector to this new evidence root."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=(ROOT/'qa/finance-p05/collect.py').read_text()
assert source.count('ROOT=Path(__file__).resolve().parents[2]')==1
source=source.replace('ROOT=Path(__file__).resolve().parents[2]','ROOT=Path(__file__).resolve().parents[3]')
source=source.replace('finance-p04/continuation-p05/final-r5','finance-p04/non-device-closeout/final-r1')
source=source.replace('finance-p04/continuation-p05','finance-p04/non-device-closeout')
target=ROOT/'qa/finance-p05/closeout/collect.py';assert not target.exists();target.write_text(source)
print('Collector scope changed only; no oracle, fixture or status mapping changed.')
