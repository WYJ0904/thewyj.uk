"""Immutable old-evidence audit, exact product binding, and a separate new seal."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
OLD=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout';PREVIOUS=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
EXTRA=ROOT/'docs/migration-evidence/finance-p04/p06-validation';FULL=EXTRA/'final-r2'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
 d=hashlib.sha256()
 with p.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1048576),b''):d.update(chunk)
 return d.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def now():return datetime.now(timezone.utc).isoformat()
def rel(p):return p.relative_to(ROOT).as_posix()
def save_new(path,value):
 assert not path.exists(),path
 path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def check(path,row):return path.is_file() and path.stat().st_size==row['bytes'] and sha(path)==row['sha256']
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['audit','bind','seal','verify']);args=parser.parse_args()
if args.action=='audit':
 errors=[];baseline=read(E/'baseline.json');latest=read(OLD/'FINAL_EVIDENCE_MANIFEST.json');archive=read(E/'baseline-source-manifest.json')
 assert sha(OLD/'FINAL_EVIDENCE_MANIFEST.json')==baseline['previous_manifest_sha256']
 counts={'previous_raw':0,'previous_source_archived':0,'older_raw':0,'older_source_archived':0,'oldest_exact':0,'historical_missing_cache':0}
 for name,row in latest['files'].items():
  archived=name in archive;p=E/'baseline-source'/name if archived else ROOT/name;counts['previous_source_archived' if archived else 'previous_raw']+=1
  if not check(p,row):errors.append(name)
 previous_archive=read(OLD/'baseline-source-manifest.json')
 for name,row in read(PREVIOUS/'FINAL_EVIDENCE_MANIFEST.json')['files'].items():
  archived=name in previous_archive;p=OLD/'baseline-source'/name if archived else ROOT/name;counts['older_source_archived' if archived else 'older_raw']+=1
  if not check(p,row):errors.append(name)
 exceptions=set(read(PREVIOUS/'FINAL_PROVENANCE.json')['historical_seal']['historical_missing_cache'])
 for row in read(ROOT/'docs/migration-evidence/finance-p04/closure-current/FINAL_EVIDENCE_MANIFEST.json')['files']:
  p=ROOT/row['path']
  if row['path'] in exceptions:
   counts['historical_missing_cache']+=1
   if p.exists():errors.append('Historical cache exception changed: '+row['path'])
  elif not check(p,row):errors.append(row['path'])
  else:counts['oldest_exact']+=1
 frozen=read(PREVIOUS/'frozen-source-manifest.json')
 for name,digest in frozen.items():
  if sha(ROOT/'qa/finance-p02'/name)!=digest:errors.append('Frozen '+name)
 failure_files=read(OLD/'legacy-currency-audit.json')['original_test_hashes']
 for name,digest in failure_files.items():
  if sha(ROOT/'android/app/src/test/java/uk/thewyj/app/task21/payment'/name)!=digest:errors.append('Original failure '+name)
 result={'utc':now(),'status':'PASS' if not errors else 'FAIL','counts':counts,'frozen_files':len(frozen),'original_failure_files':len(failure_files),'errors':errors,
  'historical_full_seal':'FAIL remains;107 missing rebuildable caches have no confirmed cause','prior_business_results_not_reclassified':True}
 save_new(E/'prior-integrity.json',result);print(json.dumps(result));assert not errors
elif args.action=='bind':
 assert read(E/'prior-integrity.json')['status']=='PASS'
 required_prefixes=('android/app/src/main/','android/app/schemas/','functions/','js/finance/','qa/finance-p06/device/','qa/finance-p06/device-res/')
 records={};errors=[]
 for name,folder in [('Samsung','joint-r7'),('emulator','emulator-joint-r2')]:
  row=read(E/folder/'result.json');assert row['status']=='PASS' and row['source_stable'];checked=0
  for path,digest in row['source_after'].items():
   if path.startswith(required_prefixes):
    checked+=1
    if sha(ROOT/path)!=digest:errors.append(name+': '+path)
  for artifact in row['artifacts']:
   if sha(ROOT/artifact['path'])!=artifact['sha256']:errors.append('APK '+artifact['path'])
  records[name]={'tested_head':row['head'],'bound_source_files':checked,'artifacts':row['artifacts'],'physical':row['physical_device']}
 assert records['Samsung']['artifacts'][0]['sha256']==records['emulator']['artifacts'][0]['sha256']
 reference=E/'device/p03-p05-r4/native';current=E/'joint-r7/sdk-final';virtual=E/'emulator-joint-r2/sdk-final'
 recipe=read(reference/'cases.json');assert read(current/'cases.json')==read(virtual/'cases.json')==recipe
 changed=[r['id'] for r in recipe if sha(reference/(r['id']+'.png'))!=sha(current/(r['id']+'.png'))]
 if changed:errors.append('Same Samsung pixel inputs changed: '+','.join(changed))
 full=read(FULL/'android-current/command.json');assert full['source_stable']
 for name,digest in full['source_after']['files'].items():
  if sha(ROOT/name)!=digest:errors.append('Full Android '+name)
 node=read(FULL/'regression/node-source-lock.json');assert node['source_stable']
 for name,digest in node['after']['files'].items():
  if sha(ROOT/name)!=digest:errors.append('Full Node '+name)
 supplementary=read(E/'supplementary-r1/result.json');assert supplementary['source_stable'] and all(r['exit_code']==0 for r in supplementary['commands'])
 for name,digest in supplementary['source_after'].items():
  if sha(ROOT/name)!=digest:errors.append('Supplementary '+name)
 result={'utc':now(),'status':'PASS' if not errors else 'FAIL','current_head':git('rev-parse','HEAD'),'records':records,'same_Samsung_pngs':len(recipe),'same_recipe_on_emulator':True,'errors':errors,
  'scope':'Exact source bytes and APK hashes; QA package/network overlay differs from standard Debug; neither is a formal release APK'}
 save_new(E/'source-binding.json',result);print(json.dumps(result));assert not errors
elif args.action=='seal':
 assert not git('status','--porcelain'),'Commit reports and owned QA helpers first'
 assert read(E/'prior-integrity.json')['status']==read(E/'source-binding.json')['status']=='PASS'
 protected=read(E/'protected-final.comparison.json');assert len(protected)==13
 assert all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in protected.values())
 assert read(E/'phone-cleanup/result.json')['status']=='PASS';assert read(E/'privacy-seal-r1/plaintext-cleanup-result.json')['status']=='PASS'
 assert read(E/'local-cleanup/result.json')['status']=='PASS';assert read(E/'emulator-cleanup.json')['status']=='PASS'
 summary=read(FULL/'delivery-current/summary.json');files={}
 skip={'.gradle','.kotlin','.wrangler','node_modules','__pycache__','build','build-sources','generated-schemas','home','private'}
 for base in [E,EXTRA]:
  for folder,dirs,names in os.walk(base,followlinks=False):
   dirs[:]=[n for n in dirs if n not in skip and not n.startswith(('build-','owned-chrome','owned-browser')) and not (Path(folder)/n).is_symlink()]
   for name in names:
    p=Path(folder)/name
    if p.is_symlink() or name.startswith('FINAL_') or name.endswith('.lock'):continue
    files[rel(p)]={'bytes':p.stat().st_size,'sha256':sha(p)}
 native=read(FULL/'regression/native-persist-auto/result.json');assert native['status']=='PASS';runtime=Path(native['runtime_root']).resolve()
 assert runtime.parent==(ROOT/'docs/migration-evidence').resolve() and runtime.name.startswith('native-') and runtime.name.endswith('-'+str(native['pid']))
 for p in runtime.rglob('*'):
  assert not p.is_symlink() and p.resolve().is_relative_to(runtime)
  if p.is_file():files[rel(p)]={'bytes':p.stat().st_size,'sha256':sha(p)}
 for name in git('diff','--name-only','425776f086d5a2b9165f9b9de311826a8d218f9e..HEAD').splitlines():
  p=ROOT/name
  if p.is_file():files[name]={'bytes':p.stat().st_size,'sha256':sha(p)}
 reports=['docs/finance/FINANCE_P03_P04_P05_DEVICE_ACCEPTANCE_REPORT.md','docs/finance/FINANCE_P06_AI_IMPLEMENTATION_REPORT.md','docs/finance/FINANCE_P03_P06_UNIFIED_ACCEPTANCE_REPORT.md']
 manifest=E/'FINAL_EVIDENCE_MANIFEST.json';save_new(manifest,{'utc':now(),'files':dict(sorted(files.items())),'excluded':'Private plaintext, compiler/browser caches,AVD disks,self-references; owner-DPAPI blobs are included'})
 proof={'utc':now(),'final_local_commit':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'starting_commit':'425776f086d5a2b9165f9b9de311826a8d218f9e','clean':True,'worktree':str(ROOT),'manifest_sha256':sha(manifest),'sealed_files':len(files),'reports':{n:sha(ROOT/n) for n in reports},'summary':summary,
  'P03_STATUS':'PARTIAL','P04_STATUS':'PARTIAL','P05_STATUS':'PARTIAL','P06_STATUS':'PARTIAL','extra_retained_evidence':[rel(EXTRA),rel(runtime)],'protected_groups':13,'production_finance_changes':False,'preview_changes':False,'push_merge_release':False,'physical_QA_removed':True,'real_transfer_acceptance':'PARTIAL; historical notification/provider identity not proven','provider_validation':'Actual Workers AI responses and invocation failures retained; not equivalent to real financial E2E'}
 save_new(E/'FINAL_PROVENANCE.json',proof);print(json.dumps({'commit':proof['final_local_commit'],'files':len(files),'manifest_sha256':sha(manifest)}))
else:
 proof=read(E/'FINAL_PROVENANCE.json');manifest=E/'FINAL_EVIDENCE_MANIFEST.json';assert sha(manifest)==proof['manifest_sha256']
 errors=[name for name,row in read(manifest)['files'].items() if not check(ROOT/name,row)]
 assert not git('status','--porcelain') and git('rev-parse','HEAD')==proof['final_local_commit']
 result={'utc':now(),'status':'PASS' if not errors else 'FAIL','sealed_files':proof['sealed_files'],'errors':errors,'final_commit':proof['final_local_commit']}
 save_new(E/'FINAL_VERIFY.json',result);print(json.dumps(result));assert not errors
