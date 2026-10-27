"""Read existing Pages build metadata with already-authorized Wrangler credentials."""
from pathlib import Path
import argparse,json,os,subprocess,urllib.request,re
parser=argparse.ArgumentParser();parser.add_argument('--label',default='r1');args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.label)
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/p07-ui-release';OUT=E/('cf-build' if args.label=='r1' else 'cf-build-'+args.label);OUT.mkdir(exist_ok=False);(OUT/'private').mkdir()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
credentials=subprocess.run([str(node),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],cwd=ROOT,capture_output=True,timeout=30)
assert credentials.returncode==0,'Existing Wrangler credential unavailable; do not prompt or bypass authentication'
value=json.loads(credentials.stdout);token=value.get('token') or value.get('api_token') or value.get('oauth_token')
if not token:raise RuntimeError('Credential schema keys only: '+','.join(value.keys()))
assert token
base='https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614/pages/projects/thewyj-uk'
for name,suffix in [('project',''),('deployment','/deployments/3edc3287-6d53-47e8-92bb-48024cea4fc1'),('logs','/deployments/3edc3287-6d53-47e8-92bb-48024cea4fc1/history/logs')]:
    req=urllib.request.Request(base+suffix,headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=30) as r:raw=r.read(2_000_001)
    assert len(raw)<=2_000_000
    (OUT/'private'/(name+'.json')).write_bytes(raw)
    data=json.loads(raw);assert data['success']
    if name=='project':(OUT/'configuration-summary.json').write_text(json.dumps({'build_config':data['result']['build_config'],'production_branch':data['result']['production_branch'],'canonical_deployment_id':data['result']['canonical_deployment']['id']},indent=2))
    if name=='logs':
        rows=data['result'].get('data',[])
        messages=[str(x.get('line',x.get('message',x))) for x in rows]
        excerpt=[x for i,line in enumerate(messages) if any(w in line.lower() for w in ['error','failed','failure','exit code']) for x in messages[max(0,i-1):i+2]]
        text='\n'.join(excerpt);text=re.sub(r'(Bearer\s+)[A-Za-z0-9._~-]+',r'\1[REDACTED]',text)
        (OUT/'error-summary.txt').write_text(text)
print((OUT/'error-summary.txt').read_text()[-3500:])
