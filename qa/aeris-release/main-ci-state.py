"""Discover push-run IDs missing from the PR-only connector; never log credentials."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,json,re,subprocess,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--commit',required=True);p.add_argument('--label',required=True);a=p.parse_args()
assert re.fullmatch('[0-9a-f]{40}',a.commit) and re.fullmatch('[a-z0-9-]+',a.label)
OUT=ROOT/'docs/migration-evidence/aeris-p03-p07'/a.label;OUT.mkdir(exist_ok=False)
remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=ROOT,text=True).strip();assert remote in ['https://github.com/WYJ0904/thewyj.uk.git','https://github.com/WYJ0904/thewyj.uk']
url='https://api.github.com/repos/WYJ0904/thewyj.uk/actions/runs?event=push&head_sha='+a.commit+'&per_page=10'
headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Aeris source acceptance'}
result=dict(utc=datetime.now(timezone.utc).isoformat(),commit=a.commit,requests_read_only=True,credential_serialized=False,auth='public')
def request():
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30)as response:return json.load(response)
try:
 try: data=request()
 except urllib.error.HTTPError as error:
  if error.code!=404:raise
  # Use the same normally configured provider that just authorized Git pushes.
  # Provider credentials remain in memory and go only to api.github.com.
  credential=subprocess.run(['git','credential','fill'],cwd=ROOT,input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,timeout=30)
  assert credential.returncode==0,'Existing GitHub credential provider unavailable'
  values=dict(line.split('=',1)for line in credential.stdout.splitlines()if '='in line)
  assert values.get('password')
  headers['Authorization']='Bearer '+values['password'];result['auth']='existing_git_provider'
  data=request();values.clear();headers.pop('Authorization',None)
 result['runs']=[{k:r.get(k)for k in ['id','name','event','head_sha','head_branch','status','conclusion','html_url','run_attempt']}for r in data['workflow_runs']]
 assert all(r['head_sha']==a.commit and r['event']=='push'for r in result['runs'])
 result['status']='PASS_READ' if result['runs']else 'NO_PUSH_RUN_FOUND'
except urllib.error.HTTPError as error:result.update(status='BLOCKED_HTTP',http_status=error.code)
except Exception as error:result.update(status='BLOCKED',error_type=type(error).__name__)
(OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
