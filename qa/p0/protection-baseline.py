"""Read-only recheck of protected checkouts and inherited evidence seals."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, importlib.util, json, re, subprocess, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--label',default='v62-final-protection-r2')
args=parser.parse_args()
assert re.fullmatch(r'v62-final-protection-r[1-9][0-9]*',args.label)
OUT = ROOT / 'docs/migration-evidence/aeris-p0-closeout' / args.label
OUT.mkdir(exist_ok=False)
BASE = Path.home() / '.codex/worktrees/aeris-p07-quality-release/thewyj.uk/docs/migration-evidence/aeris-p03-p07/baseline'
WORKTREES = Path.home() / '.codex/worktrees'
F = WORKTREES / 'finance-release-convergence/thewyj.uk'

def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

spec = importlib.util.spec_from_file_location('protected', F / 'qa/finance-p03/protection.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.TREES.update(finance_origin=WORKTREES/'finance-p04-multicurrency/thewyj.uk',
    finance_remediation=WORKTREES/'finance-p03-p06-remediation/thewyj.uk',
    finance_p03=WORKTREES/'finance-p03-identity-preauth/thewyj.uk',prior_convergence=F,
    prior_design=WORKTREES/'p07-design-optimization/thewyj.uk',prior_ui=WORKTREES/'p07-ui-release/thewyj.uk')
before_path = BASE / 'protected-before.json'
before = json.loads(before_path.read_text(encoding='utf-8'))
after = {}; unavailable = []
# Continue independent groups when a historical checkout is missing. Missing
# source is never silently treated as an empty, successfully protected tree.
for name,path in m.TREES.items():
    if not path.is_dir():
        unavailable.append(dict(group=name,path=str(path),reason='CHECKOUT_PATH_NOT_PRESENT'))
        continue
    names=m.git(path,'ls-files','--cached','--others','--exclude-standard','-z').split('\0')
    names=sorted(set(n for n in names if n))
    assert all(Path(n).name!='访问口令.txt' for n in names)
    after[name]=dict(head=m.git(path,'rev-parse','HEAD'),branch=m.git(path,'branch','--show-current'),
        status=m.git(path,'status','--porcelain=v1'),files={n:sha(path/n) for n in names})
for name,directory in [
 ('phase3',m.TREES['repair']/'docs/migration-evidence/device-acceptance'),
 ('d01Evidence',m.TREES['d01']/'docs/migration-evidence/d01'),
 ('d02Evidence',m.TREES['d02']/'docs/migration-evidence/d02'),
 ('candidateEvidence',m.TREES['candidate']/'docs/migration-evidence/hotfix-phase4'),
 ('p02Evidence',m.TREES['p02']/'docs/migration-evidence/finance-p02')]:
    if not directory.is_dir():
        unavailable.append(dict(group=name,path=str(directory),reason='EVIDENCE_PATH_NOT_PRESENT'))
        continue
    files=[p for p in directory.rglob('*')if p.is_file()and not any(
        part.startswith('build-')or part=='__pycache__' for part in p.relative_to(directory).parts)]
    after[name]=dict(files={p.relative_to(directory).as_posix():sha(p)for p in sorted(files)})
assert len(before)==19 and len(after)+len(unavailable)==19
comparison=m.compare({k:v for k,v in before.items()if k in after},after)
(OUT/'protected-after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'protected-comparison.json').write_text(json.dumps(comparison,ensure_ascii=False,indent=2),encoding='utf-8')
available_same = all(not row['added'] and not row['missing'] and not row['changed']
    and all(value for key,value in row.items() if key.endswith('Same')) for row in comparison.values())
protected_same=available_same and not unavailable

old = json.loads((BASE/'result.json').read_text(encoding='utf-8'))
seals = []
for folder,relative,count in [
 ('finance-p03-p06-remediation','finance-p06/remediation',1935),
 ('finance-p04-multicurrency','finance-p06',2588),
 ('finance-release-convergence','finance-p04/convergence',1186),
 ('p07-design-optimization','p07',183),('p07-ui-release','p07-ui-release',243)]:
    origin = WORKTREES/folder/'thewyj.uk'
    manifest = origin/'docs/migration-evidence'/relative/'FINAL_EVIDENCE_MANIFEST.json'
    data = json.loads(manifest.read_text(encoding='utf-8')); files = data['files']
    assert len(files) == count
    bad = []
    for name,item in files.items():
        target = origin/name
        if not target.is_file() or target.stat().st_size != item['bytes'] or sha(target) != item['sha256']:
            bad.append(name)
    digest = sha(manifest)
    prior_digest = next(row['manifest_sha256'] for row in old['seals'] if row['tree'] == folder)
    seals.append(dict(tree=folder,files=len(files),manifest_sha256=digest,
        manifest_same=digest==prior_digest,differences=bad))
    print(json.dumps(dict(tree=folder,files=len(files),differences=len(bad),manifest_same=digest==prior_digest)),flush=True)

result = dict(utc=datetime.now(timezone.utc).isoformat(),
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    baseline_sha256=sha(before_path),protected_groups=19,verified_groups=len(after),
    unavailable_groups=unavailable,available_groups_same=available_same,
    protected_source_files=sum(len(v['files']) for k,v in after.items() if 'head' in v),
    protected_evidence_files=sum(len(v['files']) for k,v in after.items() if 'head' not in v),
    protected_same=protected_same,seals=seals,sealed_file_count=sum(row['files'] for row in seals),
    status='PASS' if protected_same and all(not row['differences'] and row['manifest_same'] for row in seals)
        else 'PARTIAL_UNAVAILABLE_PATH' if unavailable and available_same and all(not row['differences']and row['manifest_same']for row in seals) else 'DRIFT',
    phone_operations=0,production_mutations=0,protected_writes=0,
    limitation='Source/evidence byte and Git-state comparison only; no physical device, live Production data or credential content inspected.')
(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
raise SystemExit(int(result['status']!='PASS'))
