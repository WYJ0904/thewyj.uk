import copy,unittest
from qa.p0.finance_cloud import validate_resource,config,ACCOUNT,PROJECT,DBNAME,PROTECTED
def fixture():return dict(account_id=ACCOUNT,project_name=PROJECT,database_name=DBNAME,database_id='01234567-89ab-4cde-8f01-23456789abcd',restore_database_id='11234567-89ab-4cde-8f01-23456789abcd',created_by_this_run=True)
class Guard(unittest.TestCase):
 def test_only_two_different_owned_ids(self):self.assertEqual(validate_resource(fixture()),fixture())
 def test_all_protected_databases_refused(self):
  for identifier in PROTECTED:
   r=fixture();r['database_id']=identifier
   with self.assertRaises(AssertionError):validate_resource(r)
 def test_restore_cannot_target_source(self):
  r=fixture();r['restore_database_id']=r['database_id']
  with self.assertRaises(AssertionError):validate_resource(r)
 def test_no_adopting_preexisting_resource(self):
  r=fixture();r['created_by_this_run']=False
  with self.assertRaises(AssertionError):validate_resource(r)
 def test_wrong_project_and_account_refused(self):
  for key in ['account_id','project_name','database_name']:
   r=fixture();r[key]='other'
   with self.assertRaises(AssertionError):validate_resource(r)
 def test_uuid_not_only_length_checked(self):
  r=fixture();r['database_id']='-'*36
  with self.assertRaises(AssertionError):validate_resource(r)
 def test_no_ai_r2_or_formal_environment(self):
  c=config(fixture())
  for section in [c,c['env']['preview']]:
   self.assertEqual(section['vars']['WYJ_ENVIRONMENT'],'preview')
   self.assertEqual(section['vars']['WORKERS_AI_ENABLED'],'false');self.assertEqual(section['vars']['FINANCE_AI_ENABLED'],'false')
   self.assertEqual(section['vars']['FINANCE_AI_KILL_SWITCH'],'true')
   self.assertTrue(all(k not in section for k in ['ai','r2_buckets','services','kv_namespaces','durable_objects']))
   self.assertEqual({b['database_id'] for b in section['d1_databases']},{fixture()['database_id']})
 def test_import_and_notification_writes_disabled(self):
  c=config(fixture())['vars']
  self.assertTrue(all(v=='false' for k,v in c.items() if k.endswith('IMPORT_ENABLED')))
  self.assertEqual(c['TASK21_NOTIFICATION_WRITES_ENABLED'],'false')
 def test_controlled_notification_phase_still_cannot_enable_ai_or_shared_data(self):
  r=fixture();r['controlled_notification_tests']=True;c=config(r)
  self.assertEqual(c['vars']['TASK21_NOTIFICATION_WRITES_ENABLED'],'true')
  self.assertEqual(c['vars']['TASK13_CLOUD_WRITES_ENABLED'],'true')
  self.assertEqual(c['vars']['FINANCE_AI_ENABLED'],'false');self.assertEqual(c['vars']['FINANCE_AI_KILL_SWITCH'],'true')
  r['database_id']=next(iter(PROTECTED))
  with self.assertRaises(AssertionError):config(r)
if __name__=='__main__':unittest.main()
