"""Read-only authentication and current public Workers type references."""
from pathlib import Path
from datetime import datetime,timezone
import base64,hashlib,io,json,os,subprocess,tarfile,urllib.request
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/finance-p06/provider';OUT.mkdir(exist_ok=False);private=OUT/'private';private.mkdir()
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
command=[str(NODE),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'whoami']
p=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=60)
(private/'whoami.log').write_bytes(p.stdout+b'\n'+p.stderr)
text=(p.stdout+p.stderr).decode(errors='replace')
auth=p.returncode==0 and 'not authenticated' not in text.lower() and ('logged in' in text.lower() or 'api token' in text.lower())
row=dict(checked_utc=datetime.now(timezone.utc).isoformat(),command=command,exit_code=p.returncode,authenticated=auth,
    scopes_present=[s for s in ['ai (write)','workers (write)','account (read)'] if s in text],provider_requests=0,production_or_preview_mutations=False)
(OUT/'preflight.json').write_text(json.dumps(row,indent=2));print(json.dumps(row),flush=True)
metadata=json.load(urllib.request.urlopen('https://registry.npmjs.org/@cloudflare/workers-types/latest',timeout=30))
with urllib.request.urlopen(metadata['dist']['tarball'],timeout=30) as response:blob=response.read(10_000_001)
assert len(blob)<=10_000_000
assert 'sha512-'+base64.b64encode(hashlib.sha512(blob).digest()).decode()==metadata['dist']['integrity']
(OUT/'workers-types.tgz').write_bytes(blob)
with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
    member=archive.getmember('package/index.d.ts');assert member.isfile() and member.size<8_000_000
    (OUT/'workers-types-index.d.ts').write_bytes(archive.extractfile(member).read())
(OUT/'workers-types-reference.json').write_text(json.dumps(dict(version=metadata['version'],source=metadata['dist']['tarball'],integrity=metadata['dist']['integrity'],sha256=hashlib.sha256(blob).hexdigest(),project_dependencies_modified=False),indent=2))
print('Current public Workers types preserved:',metadata['version'])
