"""Probe excluded branch with already-qualified main bytes, never finance first."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,re,subprocess
from cloud_guard import Cloud,ROOT,E,protected,plan,eligible,skipped_by_branch_without_execution
REF='codex/aeris-p0-isolation-probe';SHA='c4d63fa2fb8181a368826db034017fbdabd6ce6f'
p=argparse.ArgumentParser();p.add_argument('action',choices=['create','observe']);p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('[a-z0-9-]+',a.label)
out=E/a.label;out.mkdir(parents=True,exist_ok=False)
record=dict(utc=datetime.now(timezone.utc).isoformat(),action=a.action,ref=REF,source_commit=SHA,production_mutations=0,financial_source_pushed=False)
try:
 cloud=Cloud();project=cloud.request('/pages/projects/thewyj-uk');old,new,rows=plan(project);assert old==new and not eligible(new,REF)
 record['protected']=protected(project);record['branch_rule_matches_exclusion']=True
 remote=subprocess.check_output(['git','ls-remote','origin','refs/heads/'+REF],cwd=ROOT,text=True).strip()
 if a.action=='create':
  assert not remote,'Existing branch is protected'
  main=subprocess.check_output(['git','ls-remote','origin','refs/heads/main'],cwd=ROOT,text=True).split()[0];assert main==SHA,'Qualified main drifted; do not guess'
  r=subprocess.run(['git','push','origin',SHA+':refs/heads/'+REF],cwd=ROOT,capture_output=True)
  (out/'push.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0
  record['created_by_this_run']=True
 else:assert remote.split()[0]==SHA
 deps=cloud.request('/pages/projects/thewyj-uk/deployments')
 matches=[]
 for d in deps:
  if d['deployment_trigger']['metadata'].get('branch')!=REF:continue
  actual=cloud.request('/pages/projects/thewyj-uk/deployments/'+d['id'])
  matches.append({k:actual.get(k)for k in ['id','is_skipped','skip_reason','latest_stage','stages']})
 record['shared_deployments_for_probe']=matches
 assert all(skipped_by_branch_without_execution(d) for d in matches),'Probe not explicitly skipped by branch; hold finance push'
 if a.action=='observe':assert matches,'Need actual skipped-record evidence, not absence alone'
 assert protected(cloud.request('/pages/projects/thewyj-uk'))==record['protected']
 record['status']='PASS_SHARED_BUILD_SKIPPED_BY_BRANCH'
except Exception as error:record.update(status='FAIL_OR_BLOCKED',error_type=type(error).__name__,error=str(error)[:250])
(out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
if record['status']!='PASS_SHARED_BUILD_SKIPPED_BY_BRANCH':raise SystemExit(1)
