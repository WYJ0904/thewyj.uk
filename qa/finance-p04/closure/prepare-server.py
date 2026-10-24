"""Adapt the proven loopback backend paths; preserve actual product API routing."""
from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current/device-final'
original=ROOT/'qa/finance-p03/device/server.mjs'
text=original.read_text(encoding='utf8').replace('\r\n','\n')
text=re.sub(r"from '([^']+)'",lambda m:"from '"+((original.parent/m.group(1)).resolve().as_uri() if m.group(1).startswith('.') else m.group(1))+"'",text)
needle="const root=path.resolve(import.meta.dirname,'../../..'),out=path.join(root,'docs/migration-evidence/finance-p03/device');"
assert needle in text
text=text.replace(needle,'const root='+json.dumps(str(ROOT))+',out='+json.dumps(str(OUT))+';')
text=text.replace("const runtime=path.join(out,'server-runtime'+generation);", "const runtime=path.join(root,'docs/migration-evidence/fp04-live-server'+generation);")
text=text.replace('task21_db:6,task16_db:3','task21_db:9,task16_db:5')
target=OUT/'server.mjs'
with target.open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
result={'original':original.relative_to(ROOT).as_posix(),'original_sha256':hashlib.sha256(original.read_bytes()).hexdigest(),
        'derived_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'changes':['Filesystem imports, dedicated output and short native persistence path','Current metadata reported as Task16=5 / Task21=9'],
        'product_router':'unchanged actual catch-all and cloud middleware','origin':'https://localhost:19443','production_bindings':False}
(OUT/'server-adaptation.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
