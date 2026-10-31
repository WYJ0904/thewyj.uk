import copy,unittest
from qa.p0.cloud_guard import plan,eligible,protected,skipped_by_branch_without_execution
def fixture():
 return dict(name='thewyj-uk',production_branch='main',source=dict(type='github',config=dict(owner='WYJ0904',repo_name='thewyj.uk',production_branch='main',production_deployments_enabled=True,preview_deployment_setting='all',preview_branch_includes=['*'],preview_branch_excludes=[],pr_comments_enabled=True)),build_config=dict(build_command='npm run build'),deployment_configs={'preview':{'d1':'shared'},'production':{'d1':'formal'}},canonical_deployment={'id':'retained'},domains=['thewyj.uk'])
class Isolation(unittest.TestCase):
 def test_only_our_finance_refs_are_excluded(self):
  old,new,rows=plan(fixture());self.assertTrue(all(not r['after']for r in rows[:6]));self.assertTrue(all(r['before']==r['after']for r in rows[6:]));self.assertTrue(eligible(old,'codex/aeris-p0-p03'))
 def test_p07_and_existing_hotfix_stay_unchanged(self):
  old,new,_=plan(fixture())
  for b in ['codex/aeris-spatial-preview','codex/aeris-p07-quality-release','codex/android-accessibility-accounting-hotfix','codex/task26-wrong-review']:self.assertEqual(eligible(old,b),eligible(new,b))
 def test_production_settings_are_retained(self):
  p=fixture();old,new,_=plan(p);p2=copy.deepcopy(p);p2['source']['config']=new;self.assertEqual(protected(p),protected(p2));self.assertEqual(old['production_deployments_enabled'],new['production_deployments_enabled'])
 def test_existing_exclusions_preserved(self):
  p=fixture();p['source']['config'].update(preview_deployment_setting='custom',preview_branch_excludes=['private/*']);_,new,_=plan(p);self.assertIn('private/*',new['preview_branch_excludes']);self.assertFalse(eligible(new,'private/branch'))
 def test_existing_narrow_includes_not_widened(self):
  p=fixture();p['source']['config'].update(preview_deployment_setting='custom',preview_branch_includes=['safe/*']);_,new,_=plan(p);self.assertEqual(new['preview_branch_includes'],['safe/*'])
 def test_none_never_reenabled(self):
  p=fixture();p['source']['config']['preview_deployment_setting']='none';old,new,_=plan(p);self.assertEqual(old,new)
 def test_no_other_project(self):
  p=fixture();p['name']='unrelated'
  with self.assertRaises(AssertionError):plan(p)
 def test_wrong_repository_refused(self):
  p=fixture();p['source']['config']['repo_name']='different'
  with self.assertRaises(AssertionError):plan(p)
 def test_wrong_production_branch_refused(self):
  p=fixture();p['production_branch']='other'
  with self.assertRaises(AssertionError):plan(p)
 def test_unknown_mode_refused(self):
  p=fixture();p['source']['config']['preview_deployment_setting']='unexpected'
  with self.assertRaises(AssertionError):plan(p)
 def test_skipped_record_is_not_a_running_deployment(self):
  d=dict(is_skipped=True,skip_reason='branch_config',stages=[dict(name=n,status='idle',started_on=None,ended_on=None)for n in ['queued','initialize','clone_repo','build','deploy']])
  self.assertTrue(skipped_by_branch_without_execution(d))
  for field,value in [('is_skipped',False),('skip_reason','path_config')]:
   changed=copy.deepcopy(d);changed[field]=value;self.assertFalse(skipped_by_branch_without_execution(changed))
  changed=copy.deepcopy(d);changed['stages'][3].update(status='active',started_on='started');self.assertFalse(skipped_by_branch_without_execution(changed))
if __name__=='__main__':unittest.main()
