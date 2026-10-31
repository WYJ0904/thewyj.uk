"""Reuse the sealed synthetic-only export filter, changing only its output root."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'qa/finance-p03/device/export-finance.py'
code=source.read_text().replace("OUT=ROOT/'docs/migration-evidence/finance-p03/device'","OUT=ROOT/'docs/migration-evidence/finance-p03/finish'")
exec(compile(code,str(source),'exec'),globals())
