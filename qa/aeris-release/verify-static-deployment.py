"""Read-only full public-file proof against committed Git bytes, not screenshots."""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, quote
import argparse
import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--commit',required=True);parser.add_argument('--origin',required=True);parser.add_argument('--label',required=True);args=parser.parse_args()
assert re.fullmatch('[0-9a-f]{40}',args.commit)
u=urlparse(args.origin);assert u.scheme=='https' and not u.username and not u.password and not u.port and not u.path and not u.query and not u.fragment
assert u.hostname=='thewyj.uk' or u.hostname.endswith('.thewyj-uk.pages.dev') or u.hostname.endswith('.thewyj-p07-ui-rc.pages.dev')
assert re.fullmatch('[a-z0-9-]+',args.label)
OUT=ROOT/'docs/migration-evidence/aeris-p03-p07'/args.label;OUT.mkdir(exist_ok=False)
allowed={'app.js','changelog.js','design-system.css','favicon.ico','icon-192.png','icon-512.png','index.html','learning-sync.js','manifest.webmanifest','product-ui.css','public-experience.css','styles.css','sw.js','THIRD_PARTY_NOTICES.md','tools.js','workspace-experience.css','workflows.js','spatial-experience.css'}
tree=subprocess.check_output(['git','ls-tree','-rz',args.commit],cwd=ROOT).split(b'\0');files=[]
for row in tree:
 if not row:continue
 meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode('utf-8')
 if name in allowed or name.startswith(('assets/','js/','vendor/')):
  assert mode in ['100644','100755'] and kind=='blob' and not any(p in ['.','..'] or p.startswith('.') for p in name.split('/'))
  raw=subprocess.check_output(['git','cat-file','blob',blob],cwd=ROOT)
  files.append((name,hashlib.sha256(raw).hexdigest(),len(raw)))
assert len(files)>70
index=next(v[1]for v in files if v[0]=='index.html')
def fetch(relative):
 request=urllib.request.Request(args.origin+('/' if relative=='index.html' else '/'+quote(relative,safe='/')),headers={'Cache-Control':'no-cache','Accept-Encoding':'identity','User-Agent':'Aeris exact-source acceptance'})
 try:
  with urllib.request.urlopen(request,timeout=35)as response:return response.status,response.read(20_000_001)
 except urllib.error.HTTPError as error:return error.code,error.read(20_000_001)
def verify(item):
 name,expected,size=item
 try:
  status,raw=fetch(name);digest=hashlib.sha256(raw).hexdigest()
  return dict(path=name,http=status,bytes=len(raw),expected_bytes=size,sha256=digest,expected_sha256=expected,status='PASS' if status==200 and digest==expected else 'FAIL')
 except Exception as error:return dict(path=name,status='FAIL',error_type=type(error).__name__)
with ThreadPoolExecutor(max_workers=6)as pool:rows=list(pool.map(verify,files))
exclusions=[]
for name in ['package.json','package-lock.json','.git/config','qa/aeris-release/baseline.py','docs/release/AERIS_V62_CI_RESTORATION.md']:
 try:
  status,raw=fetch(name);shell=hashlib.sha256(raw).hexdigest()==index
  exclusions.append(dict(path=name,http=status,index_shell=shell,status='PASS' if status in [400,403,404] or status==200 and shell else 'FAIL'))
 except Exception as error:exclusions.append(dict(path=name,status='FAIL',error_type=type(error).__name__))
result=dict(utc=datetime.now(timezone.utc).isoformat(),commit=args.commit,git_tree=subprocess.check_output(['git','rev-parse',args.commit+'^{tree}'],cwd=ROOT,text=True).strip(),origin=args.origin,
 scope='Committed public files only; no login, user rows, flags, migrations or writes',files=rows,exclusions=exclusions,public_file_count=len(rows),
 pass_count=sum(r['status']=='PASS'for r in rows),fail_count=sum(r['status']!='PASS'for r in rows+exclusions),
 functions_bundle='Not served as public source; deployment/check metadata establishes the build source separately',financial_rows_read=0,business_writes=0)
(OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:result[k]for k in ['commit','origin','public_file_count','pass_count','fail_count']}))
raise SystemExit(int(result['fail_count']>0))
