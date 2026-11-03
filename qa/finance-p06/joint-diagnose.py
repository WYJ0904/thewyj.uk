"""Read a disposable copy of this task's synthetic Room failure, never original data."""
from pathlib import Path
import argparse,hashlib,json,re,shutil,sqlite3
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r2');args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.attempt)
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06';BASE=E/('joint-'+args.attempt);OUT=BASE/'diagnostics';OUT.mkdir(exist_ok=False)
for p in (BASE/'native').glob('notification.sqlite*'):shutil.copy2(p,OUT/p.name)
db=sqlite3.connect((OUT/'notification.sqlite').as_uri()+'?mode=ro',uri=True)
rows={}
for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
 if not any(part in name for part in ['recognition','ticket']):continue
 assert name.replace('_','').isalnum()
 c=db.execute('SELECT * FROM '+name);rows[name]=[dict(zip([x[0] for x in c.description],row)) for row in c.fetchall()]
db.close();sources=[E/'device/ui/wechat-primary-detail-r1/private/screen.png',BASE/'native/private/real-wechat-receipt.png']
record={'synthetic_room_rows':rows,'pngs':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'first_bytes':p.read_bytes()[:16].hex()}for p in sources]}
(OUT/'diagnosis.json').write_text(json.dumps(record,indent=2));print(json.dumps(record,ensure_ascii=False))
