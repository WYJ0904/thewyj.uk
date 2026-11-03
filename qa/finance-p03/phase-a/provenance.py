"""P03-A source scope, candidate timing, and final local evidence seal."""
import argparse,datetime,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p03/phase-a'
BASELINE='09442c2985368dfb09ddfa6b613c3be2d0f21b9d'
PRODUCT={'android/app/src/main/java/uk/thewyj/app/task21/'+p for p in [
 'NotificationCaptureContracts.kt','NotificationCaptureCoordinator.kt','payment/AndroidPaymentRecognitionHook.kt',
 'payment/LocalPaymentLedger.kt','payment/PaymentRecognitionCoordinator.kt','payment/PaymentReconciliation.kt',
 'store/NotificationDatabase.kt','store/PaymentRecognitionStore.kt','store/PaymentReconciliationEntities.kt','store/PaymentReconciliationDao.kt']}
PRODUCT|={'functions/_lib/'+p for p in ['cloudflare-foundation.mjs','task16-service.mjs','task21-hints.mjs','task21-lifecycle.mjs','task21-model.mjs','task21-service.mjs','task21-reconciliation.mjs']}
PRODUCT|={'cloudflare/migrations/0029_payment_reconciliation.sql','android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/13.json'}
TESTS={'android/app/src/test/java/uk/thewyj/app/task21/'+p for p in ['payment/FinanceP03AReconciliationTest.kt','store/FinanceP03AMigrationTest.kt',
 'store/FinanceP03CloseoutMigrationTest.kt','store/FinanceP03PersistenceTest.kt','store/NotificationDatabaseMigrationTest.kt']}
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf8').strip()
def read(p):return json.loads(p.read_text(encoding='utf8-sig'))
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def current_files():
 names=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0')
 return {p:sha(ROOT/p) for p in sorted(set(names)) if p and p.startswith(('android/','functions/','cloudflare/migrations/','qa/'))}
def scope():
 assert git('branch','--show-current')=='codex/finance-p03-identity-preauth'
 subprocess.run(['git','merge-base','--is-ancestor',BASELINE,'HEAD'],cwd=ROOT,check=True)
 changed=set(git('diff','--name-only',BASELINE).splitlines())|set(git('ls-files','--others','--exclude-standard').splitlines())
 assert all(p in PRODUCT|TESTS or p.startswith('qa/finance-p03/') or (p.startswith('docs/finance-p03/P03A_') and p.endswith('.md')) for p in changed),changed
 assert not git('diff','--name-only','--diff-filter=D',BASELINE)
 for version in range(1,13):
  p=f'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/{version}.json'
  assert git('hash-object',p)==git('rev-parse',BASELINE+':'+p),p
 for p in git('ls-tree','-r','--name-only',BASELINE,'cloudflare/migrations').splitlines():assert git('hash-object',p)==git('rev-parse',BASELINE+':'+p),p
 baseline=read(BASE/'baseline.json')
 for p,d in baseline['history'].items():assert sha(ROOT/p)==d,p
 proof=read(BASE/'protected-seal.json')['comparison']
 assert not proof['history_changed']
 for name,r in proof['protected'].items():
  assert not r['missing'] and not r['changed']
  assert not r['added'] or (name=='main' and r['added']==['thewyj-finance-materials/thewyj_roadmap_v5_fixed_history_2026-10-19.txt'])
  assert all(v for k,v in r.items() if k.endswith('Same'))
 return changed,proof
def capture():
 changed,proof=scope();old=read(BASE/'candidate-inputs.json')['sha256'];new=current_files()
 delta={p:{'before':old.get(p),'after':new.get(p)} for p in old.keys()|new.keys() if old.get(p)!=new.get(p)}
 for name in ['wire-initial.py','native-wiring.py','prepare-runners.py','extend-migration-tests.py']:
  p='qa/finance-p03/phase-a/'+name;archived=BASE/'implementation-transforms'/name
  assert sha(archived)==old[p];delta[p]['archived']=str(archived.relative_to(ROOT).as_posix())
 jvm=read(BASE/'closure-full-run.json');node=read(BASE/'node-closure/exits.json')
 start_jvm=datetime.datetime.fromisoformat(jvm['started_utc']).timestamp()
 start_node=datetime.datetime.fromisoformat(node[0]['started_utc']).timestamp()
 bad=[]
 for p,d in new.items():
  time=(ROOT/p).stat().st_mtime
  if p.startswith('android/') and time>start_jvm and old.get(p)!=d:bad.append(p)
  if p.startswith(('functions/','cloudflare/migrations/')) and time>start_node:bad.append(p)
 assert not bad,('Source changed after its selected domain run',bad)
 value={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':BASELINE,'sha256':new,'delta_from_first_full_campaign':delta,
  'source_domain_checks':{'android_no_change_after_closure_full':True,'backend_no_change_after_node_closure':True,
    'late_changes':'Audit capacity, latest alias facts, legacy fences, controller-role preservation and existing Capture adoption; targeted failures retained, affected domains rerun.'},
  'selected_jvm':jvm,'selected_node':node,'product_files':sorted(changed&PRODUCT),'protected':proof}
 target=BASE/'candidate-final-inputs.json';assert not target.exists();target.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
 (BASE/'candidate-source-deltas.json').write_text(json.dumps(delta,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'source_files':len(new),'product_files':len(changed&PRODUCT),'deltas':len(delta),'source_domain_checks':value['source_domain_checks']}))
def seal():
 changed,proof=scope();assert not git('status','--porcelain=v1'),'Commit reviewed sources/reports before sealing'
 captured=read(BASE/'candidate-final-inputs.json')
 for p,d in captured['sha256'].items():assert sha(ROOT/p)==d,p
 summary=read(BASE/'summary.json')
 assert summary['test_jvm']=={'PASS':663} and summary['existing_p03']=={'PASS':63} and summary['closeout']=={'PASS':41} and summary['p03a_new']=={'PASS':99}
 assert summary['matrix']=={'PASS':536,'FAIL':7,'EXPECTED_RED':42,'NOT_TESTED':23} and summary['matrix_changes']==[]
 for n in ['server-closure','migration-final-role']:
  assert read(BASE/(n+'-run.json'))['exit_code']==0
 assert read(BASE/'node-closure/exits.json')[-1]['exit_code']==0
 artifact=BASE/'artifacts/finance-p03a-debug.apk';assert artifact.exists()
 revision={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),'branch':git('branch','--show-current'),
  'baseline':BASELINE,'phase_status':'PARTIAL','apk_sha256':sha(artifact),'apk_bytes':artifact.stat().st_size,'not_a_release':True}
 rev=BASE/'REVISION.json';manifest=BASE/'provenance.json';assert not rev.exists() and not manifest.exists()
 rev.write_text(json.dumps(revision,ensure_ascii=False,indent=2),encoding='utf8')
 excluded={'provenance.json','seal.log','validation.json'}
 raw={p.relative_to(ROOT).as_posix():sha(p) for p in sorted(BASE.rglob('*')) if p.is_file() and p.name not in excluded and '__pycache__' not in p.parts}
 result={**revision,'source_report_sha256':{p:sha(ROOT/p) for p in sorted(changed)},'raw_evidence_sha256':raw,
  'tested_candidate_sha256':captured['sha256'],'product_files':sorted(changed&PRODUCT),'protected':proof,
  'scope':{'adb_phone':'NONE','real_payments_accounts':'NONE','production_d1_r2':'NONE','push_merge_pr_deploy_release':'NONE','real_provider_adapter':'BLOCKED_DEFAULT_REJECT','old_P01_P02_P03_evidence':'PRESERVED'}}
 manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'commit':revision['commit'],'tree':revision['tree'],'source_files':len(changed),'evidence_files':len(raw),'apk_sha256':revision['apk_sha256'],'provenance_sha256':sha(manifest)},indent=2))
def verify():
 m=read(BASE/'provenance.json');errors=[]
 for group in ['source_report_sha256','raw_evidence_sha256','tested_candidate_sha256']:
  for p,d in m[group].items():
   if not (ROOT/p).is_file() or sha(ROOT/p)!=d:errors.append(p)
 assert not errors,errors
 assert git('rev-parse','HEAD')==m['commit'] and not git('status','--porcelain=v1')
 result={'status':'PASS','commit':m['commit'],'tree':m['tree'],'source_report_files_verified':len(m['source_report_sha256']),
  'raw_evidence_files_verified':len(m['raw_evidence_sha256']),'candidate_files_verified':len(m['tested_candidate_sha256']),
  'mismatches':errors,'working_tree':'CLEAN','provenance_sha256':sha(BASE/'provenance.json'),'phase_status':'PARTIAL'}
 (BASE/'validation.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['scope','capture','seal','verify']);args=p.parse_args()
 if args.mode=='scope':changed,proof=scope();print('P03-A scope PASS',len(changed),'paths',len(proof['protected']),'protected groups')
 elif args.mode=='capture':capture()
 elif args.mode=='seal':seal()
 else:verify()
