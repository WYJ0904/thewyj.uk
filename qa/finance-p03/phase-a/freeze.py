import datetime,hashlib,json,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[3];OUT=R/'docs/migration-evidence/finance-p03/phase-a'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def files():
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=R).decode().split('\0')
 return {n:sha(R/n) for n in sorted(set(names)) if n and n.startswith(('android/','functions/','cloudflare/migrations/','qa/'))}
if len(sys.argv)>1:
 old=json.loads((OUT/'candidate-inputs.json').read_text(encoding='utf8'))['sha256'];new=files();diff={n:[old.get(n),new.get(n)] for n in old.keys()|new.keys() if old.get(n)!=new.get(n)}
 assert not diff,diff;print('Candidate source/test hash PASS',len(new))
else:
 p=OUT/'candidate-inputs.json';assert not p.exists();p.write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':files()},indent=2),encoding='utf8');print('Frozen',len(files()),'source/test files')
