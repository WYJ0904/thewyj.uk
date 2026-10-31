"""Fresh approved argument-forwarding contract, never a replacement raw oracle."""
from common import *
import sys
OUT=E/'v62-forwarded';OUT.mkdir(exist_ok=False)
source=E/'contract-repair-r1/contract-input-drivers'
dom_source=(source/'web-dom-declared-inputs.mjs').read_text(encoding='utf-8')
old_output=json.dumps((source/'web-dom.ndjson').as_posix())
new_output=json.dumps((OUT/'dom/web-dom.ndjson').as_posix())
assert dom_source.count(old_output)==1
dom_driver=OUT/'dom-driver.mjs'
dom_driver.write_text(dom_source.replace(old_output,new_output),encoding='utf-8')
(OUT/'dom').mkdir()
rows=[]
for name,command,extra in [
 ('native',[sys.executable,str(E/'drivers/android.py'),'--qa-root',str(source/'native'),'--qa-output',str(OUT/'native'),
            '--tests','*FinanceP02MatrixTest.D_parserCurrencyTarget'],{'FINANCE_P04_OUTPUT':str(OUT/'native-command')}),
 ('dom',[str(NODE),str(dom_driver)],{'FINANCE_P03_OUTPUT':str(OUT/'dom'),'FINANCE_P04_OUTPUT':str(OUT/'dom'),'AERIS_TEST_CHROME':'C:/Program Files/Google/Chrome/Application/chrome.exe'})]:
 started=utc()
 with (OUT/(name+'.log')).open('xb') as stream:
  process=subprocess.run(command,cwd=ROOT,env={**environment(),**extra},stdout=stream,stderr=subprocess.STDOUT)
 rows.append(dict(name=name,command=command,started_utc=started,finished_utc=utc(),exit_code=process.returncode))
 write(OUT/'commands.json',rows);print(json.dumps(rows[-1]),flush=True)
write(OUT/'result.json',dict(commands=rows,source_adaptations_sha256=sha(source/'adaptations.json'),
    raw_oracles_unchanged=True,raw_frozen_608_not_replaced=True,external_ai_calls=0))
raise SystemExit(int(any(row['exit_code']for row in rows)))
