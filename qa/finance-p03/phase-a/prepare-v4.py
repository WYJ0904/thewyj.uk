import hashlib,json,subprocess
from pathlib import Path
R=Path(__file__).resolve().parents[3];base=R/'docs/migration-evidence/finance-p03/phase-a/baseline-v4'
revision='09442c2985368dfb09ddfa6b613c3be2d0f21b9d'
paths=subprocess.check_output(['git','ls-tree','-r','--name-only',revision,'functions/_lib'],cwd=R).decode().splitlines();result={}
for name in paths:
 data=subprocess.check_output(['git','show',revision+':'+name],cwd=R);out=base/name;out.parent.mkdir(parents=True,exist_ok=True)
 if out.exists():assert out.read_bytes()==data
 else:out.write_bytes(data)
 result[name]=hashlib.sha256(data).hexdigest()
seal=base/'sources.json'
if not seal.exists():seal.write_text(json.dumps({'revision':revision,'sha256':result},indent=2),encoding='utf8')
print('Frozen actual v4 modules:',len(result))
