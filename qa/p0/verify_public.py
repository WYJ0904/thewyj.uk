"""Fetch the exact owned Preview public bytes over the normal Python HTTPS stack."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,urllib.request,urllib.parse
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args()
out=a.out.resolve();assert out.is_relative_to(ROOT/'docs/migration-evidence/aeris-p0-closeout/cloud')
out.mkdir(parents=True,exist_ok=False)
base=ROOT/'docs/migration-evidence/aeris-p0-closeout/cloud'
d=json.loads((base/'deployment.json').read_text());s=json.loads((base/'stage.json').read_text())
url=urllib.parse.urlsplit(d['url']);assert url.scheme=='https' and url.netloc.endswith('.aeris-p0-finance-rc.pages.dev') and url.netloc.split('.')[0].isalnum()
rows=[]
for name,expected in s['files'].items():
 if name.startswith('functions/'):continue
 try:
  with urllib.request.urlopen(d['url']+'/'+urllib.parse.quote(name,safe='/'),timeout=20)as r:
   raw=r.read();actual=hashlib.sha256(raw).hexdigest();status=r.status
  row=dict(path=name,status='PASS'if status==200 and actual==expected else'FAIL',http=status,expected_sha256=expected,actual_sha256=actual)
 except Exception as error:row=dict(path=name,status='FAIL',error_type=type(error).__name__,error=str(error)[:120])
 rows.append(row)
 (out/'result.json').write_text(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),source_commit=d['source_commit'],deployment_id=d['id'],origin=d['url'],rows=rows,assertion='Exact source SHA-256 for every non-Functions allowlist file; no retries, no authenticated requests',external_model_calls=0),indent=2),encoding='utf8')
print(json.dumps(dict(files=len(rows),PASS=sum(x['status']=='PASS'for x in rows),FAIL=sum(x['status']=='FAIL'for x in rows))))
raise SystemExit(int(any(x['status']!='PASS'for x in rows)))
