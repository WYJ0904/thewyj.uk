"""Archive public current provider references; do not upgrade project dependencies."""
from pathlib import Path
from datetime import datetime,timezone
import base64,hashlib,io,json,tarfile,urllib.request
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/finance-p06/remediation/references'
OUT.mkdir(exist_ok=False);rows=[]
for name,url in [('model','https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/index.md'),
                 ('errors','https://developers.cloudflare.com/workers-ai/platform/errors/index.md'),
                 ('best-practices','https://developers.cloudflare.com/workers/best-practices/workers-best-practices/index.md')]:
    try:
        with urllib.request.urlopen(url,timeout=30) as response:raw=response.read(2_000_001)
        assert len(raw)<=2_000_000
        (OUT/(name+'.md')).write_bytes(raw);rows.append(dict(name=name,url=url,status='FETCHED',sha256=hashlib.sha256(raw).hexdigest()))
    except Exception as error:rows.append(dict(name=name,url=url,status='UNAVAILABLE',error_type=type(error).__name__))
metadata=json.load(urllib.request.urlopen('https://registry.npmjs.org/@cloudflare/workers-types/latest',timeout=30))
with urllib.request.urlopen(metadata['dist']['tarball'],timeout=30) as response:raw=response.read(10_000_001)
assert len(raw)<=10_000_000
assert 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()==metadata['dist']['integrity']
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    member=archive.getmember('package/index.d.ts');assert member.isfile() and member.size<8_000_000
    (OUT/'workers-types-index.d.ts').write_bytes(archive.extractfile(member).read())
(OUT/'reference.json').write_text(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),docs=rows,
    types=dict(version=metadata['version'],source=metadata['dist']['tarball'],integrity=metadata['dist']['integrity'],archive_sha256=hashlib.sha256(raw).hexdigest()),
    installed_dependencies_changed=False),indent=2))
print('Public references archived; project lock/dependencies unchanged.')
