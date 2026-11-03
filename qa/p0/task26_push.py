"""Update the recovered Task26 draft only after excluding its shared build."""
from pathlib import Path
from datetime import datetime,timezone
import copy,json,subprocess
from cloud_guard import Cloud,ROOT,E,protected,eligible
BRANCH='codex/task26-wrong-review';HEAD='569a1d20b2d33ee949f0c9b820e7864beff0916f';OLD='6247c4148904cafa264204fc1816b2e8e1d4360a';MAIN='c4d63fa2fb8181a368826db034017fbdabd6ce6f'
out=E/'task26-safe-push-r1';out.mkdir(parents=True,exist_ok=False)
r=dict(utc=datetime.now(timezone.utc).isoformat(),head=HEAD,previous_remote=OLD,branch=BRANCH,force=False,production_data_mutations=0)
try:
 def remote(ref):return subprocess.check_output(['git','ls-remote','origin','refs/heads/'+ref],cwd=ROOT,text=True).split()[0]
 assert remote(BRANCH)==OLD and remote('main')==MAIN
 subprocess.run(['git','merge-base','--is-ancestor',OLD,HEAD],cwd=ROOT,check=True)
 subprocess.run(['git','merge-base','--is-ancestor',MAIN,HEAD],cwd=ROOT,check=True)
 c=Cloud();before=c.request('/pages/projects/thewyj-uk');assert before['source']['config']['preview_deployment_setting']=='custom'
 lock=protected(before);cfg=copy.deepcopy(before['source']['config']);old=copy.deepcopy(cfg)
 cfg['preview_branch_excludes']=list(dict.fromkeys(cfg['preview_branch_excludes']+[BRANCH]))
 assert not eligible(cfg,BRANCH)
 for name in ['main','codex/aeris-spatial-preview','codex/aeris-p07-quality-release','codex/android-accessibility-accounting-hotfix','unrelated-branch']:
  assert eligible(old,name)==eligible(cfg,name)
 c.request('/pages/projects/thewyj-uk','PATCH',dict(source=dict(type='github',config=cfg)))
 after=c.request('/pages/projects/thewyj-uk');assert after['source']['config']==cfg and protected(after)==lock
 r['old_preview_excludes']=old['preview_branch_excludes'];r['new_preview_excludes']=cfg['preview_branch_excludes'];r['protected']=lock
 with (out/'plan.json').open('x')as f:json.dump(r,f,indent=2)
 p=subprocess.run(['git','push','origin',HEAD+':refs/heads/'+BRANCH],cwd=ROOT,capture_output=True)
 (out/'push.log').write_bytes(p.stdout+p.stderr);assert p.returncode==0
 assert remote(BRANCH)==HEAD and protected(c.request('/pages/projects/thewyj-uk'))==lock
 r['status']='TASK26_DRAFT_FAST_FORWARD_PUSHED_SHARED_BUILD_EXCLUDED'
except Exception as e:r.update(status='FAIL_OR_BLOCKED',error_type=type(e).__name__,error=str(e)[:200])
(out/'result.json').write_text(json.dumps(r,indent=2),encoding='utf8');print(json.dumps(r))
if r['status']!='TASK26_DRAFT_FAST_FORWARD_PUSHED_SHARED_BUILD_EXCLUDED':raise SystemExit(1)
