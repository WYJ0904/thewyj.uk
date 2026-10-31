"""Reuse prior narrow guards with fresh output; allow only new QA test prefix."""
from pathlib import Path
import sys,json,hashlib
sys.dont_write_bytecode=True
source=Path(__file__).resolve().parents[3]/'qa/finance-p03/device/phone.py'
if __name__=='__main__' and len(sys.argv)>1 and sys.argv[1] in ['install','update']:
    output=source.parents[3]/'docs/migration-evidence/finance-p03/finish'
    latest=max(output.glob('build*-run.json'),key=lambda p:p.stat().st_mtime)
    assert json.loads(latest.read_text(encoding='utf8-sig'))['exit_code']==0,'Failed build must never trigger an installation of stale APKs'
    verified=[]
    for item in output.glob('apk-*.json'):
        try:data=json.loads(item.read_text(encoding='utf8-sig'))
        except ValueError:continue
        if data.get('artifacts') and item.stat().st_mtime>=latest.stat().st_mtime:verified.append(data)
    assert verified,'Verify current build artifacts before installation'
    assert any(all(hashlib.sha256((source.parents[3]/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in d['artifacts']) for d in verified)
code=source.read_text().replace("OUT=ROOT/'docs/migration-evidence/finance-p03/device'","OUT=ROOT/'docs/migration-evidence/finance-p03/finish'")
code=code.replace("PKG='uk.thewyj.app.debug';TEST=PKG+'.p03acceptance'","PKG='uk.thewyj.app.qa.financep03finish';TEST=PKG+'.test'")
code=code.replace("startswith('uk.thewyj.app.qa.finance.FinanceDevice')","startswith(('uk.thewyj.app.qa.finance.FinanceDevice','uk.thewyj.app.qa.finance.FinanceFinish'))")
exec(compile(code,str(source),'exec'),globals())
