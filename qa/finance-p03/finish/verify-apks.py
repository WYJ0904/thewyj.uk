"""Offline artifact isolation; never label stored formal metadata a live check."""
from pathlib import Path
import json
output=Path(__file__).resolve().parents[3]/'docs/migration-evidence/finance-p03/finish'
latest=max(output.glob('build*-run.json'),key=lambda p:p.stat().st_mtime)
assert json.loads(latest.read_text(encoding='utf8-sig'))['exit_code']==0,'Never verify stale APKs as the result of a failed build'
source=Path(__file__).resolve().parents[3]/'qa/finance-p03/device/verify-apks.py'
code=source.read_text().replace("OUT=ROOT/'docs/migration-evidence/finance-p03/device'","OUT=ROOT/'docs/migration-evidence/finance-p03/finish'")
code=code.replace("'baseline':'976eed4644556e70266fe0ef5e54b7c8e419d0ba'","'baseline':'1e04945d1964c0e6a9420b0aff99011001f4ab98'")
code=code.replace("'formal_signature_unchanged':True","'formal_signature_reference_only':True,'formal_live_signature_check':'NOT TESTED unless separately measured on device'")
code=code.replace('uk.thewyj.app.debug.p03acceptance','uk.thewyj.app.qa.financep03finish.test').replace('uk.thewyj.app.debug','uk.thewyj.app.qa.financep03finish')
exec(compile(code,str(source),'exec'),globals())
