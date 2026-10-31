"""Independent output/source adapter; the first hosted failure is never overwritten."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
assert json.loads((OUT/'hosted-bindings-final/result.json').read_text())['database_ids']==['c2eb978f-9f49-4e4c-8286-f6b398fae0de']
src=ROOT/'qa/finance-p04/closure/hosted-fx.mjs';text=src.read_text()
assert text.count("rate.source.includes('frankfurter')")==1
text=text.replace("rate.source.includes('frankfurter')","rate.source==='Frankfurter v2 daily reference'")
text=text.replace("'../../../js/finance/money.js'",json.dumps((ROOT/'js/finance/money.js').as_uri()))
text=text.replace("const out=path.resolve(import.meta.dirname,'../../../docs/migration-evidence/finance-p04/closure-current');",'const out='+json.dumps(str(OUT))+';')
text=text.replace("'hosted-fx-r1.json'","'hosted-fx-r2.json'")
target=OUT/'hosted-fx-r2.mjs';assert not target.exists();target.write_text(text,encoding='utf8')
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
started=datetime.now(timezone.utc).isoformat()
with (OUT/'hosted-fx-r2.log').open('xb') as output:result=subprocess.run([str(node),str(target)],cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=120)
record={'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'derived_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'changes':['Absolute import/output paths and fresh r2 evidence','Unexecuted provider-name assertion now checks the exact canonical API value (Frankfurter, capital F); all amounts, dates and monetary assertions unchanged'],
        'started':started,'finished':datetime.now(timezone.utc).isoformat(),'exit_code':result.returncode}
(OUT/'hosted-fx-r2-adaptation.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
raise SystemExit(result.returncode)
