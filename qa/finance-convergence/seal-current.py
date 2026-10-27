"""Seal current reports, Git source and non-rebuildable local evidence, without secrets."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,subprocess
parser=argparse.ArgumentParser();parser.add_argument('kind',choices=['finance','p07','ui']);args=parser.parse_args()
specs={
 'finance':('finance-release-convergence','docs/migration-evidence/finance-p04/convergence','1af08aa1731377698c6713ab553606a49ff927b8',['docs/migration-evidence/finance-p04/convergence','docs/migration-evidence/finance-p06/convergence','docs/migration-evidence/finance-p04/remediation/convergence-quality-r2'],['docs/finance/FINANCE_P03_P06_RELEASE_READINESS.md','docs/finance/contracts/FINANCE_V2_ACCEPTANCE_CONTRACT.json','docs/finance/contracts/FINANCE_F001_F015_PROTOCOL_MIGRATION.json']),
 'p07':('p07-design-optimization','docs/migration-evidence/p07','2ee4934450acb8e4bc79d75f44a32eef43370ba8',['docs/migration-evidence/p07'],['docs/p07/P07_DESIGN_OPTIMIZATION_REPORT.md','docs/release/UNATTENDED_EXECUTION_FINAL_REPORT.md','docs/p07/SKILLS_LOCK.json','docs/p07/SKILL_REVIEW.md','docs/p07/UI_AUDIT.md']),
 'ui':('p07-ui-release','docs/migration-evidence/p07-ui-release','1b16c18cbe56c0706fb9cff06bf955cada3094da',['docs/migration-evidence/p07-ui-release'],['docs/release/P07_UI_CODE_ONLY_RELEASE.md'])}
folder,base,reference,evidence,reports=specs[args.kind]
ROOT=(Path.home()/'.codex/worktrees'/folder/'thewyj.uk').resolve();assert Path.cwd().resolve()==ROOT
E=ROOT/base
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT).decode().strip()
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def write(path,value):
 assert not path.exists(),f'Preserve existing seal: {path}'
 path.write_text(json.dumps(value,ensure_ascii=False,indent=2))
assert git('status','--porcelain')=='','Commit first; no dirty-source claim'
head=git('rev-parse','HEAD');delta=git('diff','--name-only',reference,head).splitlines()
assert all(n.startswith(('docs/','qa/')) for n in delta),'Runtime changed after the tested/deployed reference'
names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
source={}
for name in sorted(n for n in names if n and not n.startswith(('docs/','qa/'))):
 assert Path(name).name!='访问口令.txt'
 p=ROOT/name
 if p.is_file():source[name]={'bytes':p.stat().st_size,'sha256':sha(p),'git_blob':git('rev-parse',head+':'+name)}
sourceLock=E/'SOURCE_LOCK.json';write(sourceLock,dict(head=head,reference=reference,files=source,runtime_diff_from_reference=[],post_reference_changes=delta))
finalNames={'FINAL_EVIDENCE_MANIFEST.json','FINAL_PROVENANCE.json','FINAL_VERIFY.json'}
files={};excluded=set()
for rel in evidence:
 directory=ROOT/rel;assert directory.is_dir()
 for p in directory.rglob('*'):
  if not p.is_file():continue
  n=p.relative_to(ROOT).as_posix();parts=p.relative_to(directory).parts
  if p.parent==E and p.name in finalNames:continue
  # Closed, archived JUnit/commands/images/databases are retained. Rebuildable
  # Gradle/npm sources and AVD disks are deliberately outside this manifest.
  bad=next((part for part in parts[:-1] if part in {'node_modules','.gradle','build','__pycache__','private'}),None)
  if bad:excluded.add(str(directory.relative_to(ROOT)/Path(*parts[:parts.index(bad)+1])));continue
  if '/avd/home/' in '/'+n:excluded.add(base+'/avd/home');continue
  if p.is_symlink():raise RuntimeError('Evidence symlink: '+n)
  files[n]={'bytes':p.stat().st_size,'sha256':sha(p)}
manifest=E/'FINAL_EVIDENCE_MANIFEST.json';write(manifest,dict(kind=args.kind,files=files,exclusions=sorted(excluded),excluded_files_preserved=True,raw_failures_preserved=True))
reportHashes={n:{'bytes':(ROOT/n).stat().st_size,'sha256':sha(ROOT/n)} for n in reports}
deployment={}
if args.kind=='p07':
 meta=json.loads((ROOT/'.wrangler/p07-owner-preview-r4/__preview/build.json').read_text())
 deployment=dict(source_commit=meta['source_commit'],deployment_id='f9d0d5ad-b143-49cf-9557-82ef6d8897c3',url='https://p07-design.thewyj-p07-design-lab.pages.dev',artifact_tree_sha256=meta['artifact_tree_sha256'])
elif args.kind=='ui':
 meta=json.loads((E/'production/control-and-runtime-final.json').read_text())
 deployment={k:meta[k] for k in ['production_commit','deployment_id','deployment_url','p07_feature']}
provenance=E/'FINAL_PROVENANCE.json';write(provenance,dict(kind=args.kind,checked_utc=datetime.now(timezone.utc).isoformat(),worktree=str(ROOT),branch=git('branch','--show-current'),head=head,tree=git('rev-parse','HEAD^{tree}'),status='CLEAN',tested_product_reference=reference,runtime_source_unchanged_since_reference=True,post_reference_changes=delta,reports=reportHashes,manifest_sha256=sha(manifest),source_lock_sha256=sha(sourceLock),deployment=deployment,phone_operations=0,release_scope='Financial bundle HELD; separate UI B code-only/OFF only'))
bad=[n for n,v in files.items() if not (ROOT/n).is_file() or (ROOT/n).stat().st_size!=v['bytes'] or sha(ROOT/n)!=v['sha256']]
assert not bad,bad
assert git('status','--porcelain')==''
verification=E/'FINAL_VERIFY.json';write(verification,dict(status='PASS',files=len(files),bytes=sum(x['bytes'] for x in files.values()),differences=bad,head=head,manifest_sha256=sha(manifest),provenance_sha256=sha(provenance),source_lock_sha256=sha(sourceLock),reports=reportHashes,exclusions_preserved=True,checked_utc=datetime.now(timezone.utc).isoformat()))
print(json.dumps(dict(kind=args.kind,head=head,files=len(files),manifest_sha256=sha(manifest),provenance_sha256=sha(provenance),status='PASS')))
