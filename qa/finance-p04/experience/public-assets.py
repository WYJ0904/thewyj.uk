"""Unauthenticated static fetch only; never load Production app code or auth routes."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p04/experience-channel-current'
dest=OUT/'public-production-assets-r1';dest.mkdir(exist_ok=False)
rows=[]
for name,route in [('index.html','/finance'),('app.js','/app.js'),('js/finance/app.js','/js/finance/app.js'),('sw.js','/sw.js')]:
    url='https://thewyj.uk'+route
    item={'url':url,'authenticated':False,'asset':name,'status':'NOT_TESTED'}
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Accept-Encoding':'identity'}),timeout=20) as response:
            raw=response.read(3*1024*1024);assert len(raw)<3*1024*1024
            assert response.status==200
            path=dest/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            baseline=subprocess.check_output(['git','show','74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc:'+name],cwd=ROOT)
            latest=(ROOT/name).read_bytes()
            item.update(status='PASS',http_status=200,sha256=hashlib.sha256(raw).hexdigest(),matches_production_source=raw==baseline,matches_local_source=raw==latest,
                        cache_control=response.headers.get('Cache-Control'),content_type=response.headers.get('Content-Type'),bytes=len(raw))
    except urllib.error.HTTPError as error:
        # Do not inspect forbidden diagnostic response headers/body or retry via alternate identities.
        item.update(status='BLOCKED',http_status=error.code,reason='HTTP request rejected; no response diagnostics or bypass attempted')
        rows.append(item);break
    except Exception as error:item.update(status='BLOCKED',reason=type(error).__name__)
    rows.append(item)
record={'checked_utc':datetime.now(timezone.utc).isoformat(),'requests':rows,'production_browser_session_used':False,'production_api_called':False,
        'actual_user_cache_inspected':False,'remaining_after_rejection':'NOT_TESTED' if any(r['status']=='BLOCKED' for r in rows) else 'None'}
(dest/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
