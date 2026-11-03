"""Non-circular raw-evidence seal, then final-commit verification. No remote operations."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];P4=ROOT/'docs/migration-evidence/finance-p04/remediation';P6=ROOT/'docs/migration-evidence/finance-p06/remediation'
parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['raw','final']);args=parser.parse_args()
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
manifest=P6/'FINAL_EVIDENCE_MANIFEST.json'
if args.phase=='raw':
    assert not manifest.exists()
    assert read(P4/'protection-final.json')['status']=='PASS'
    assert read(P6/'artifact-recovery/result.json')['status']=='PASS'
    assert read(P6/'database-recovery/result.json')['status']=='PASS'
    assert read(P4/'ai-quality-final-command/command.json')['exit_code']==0
    assert len(read(P4/'tail/service-r2-command/command.json')['cases'])==3
    roots=[P4,P6,ROOT/'docs/migration-evidence/finance-p03/closeout/baseline-v3',ROOT/'docs/migration-evidence/finance-p03/phase-a/baseline-v4',ROOT/'docs/migration-evidence/finance-p03/final/baseline-source']
    runtime=Path(read(P4/'final-r1/regression/native-persist-auto/runtime-paths.json')['runtime_root']).resolve()
    assert runtime.is_relative_to(ROOT/'docs/migration-evidence')
    if not any(runtime.is_relative_to(r) for r in roots):roots.append(runtime)
    omitted=P6/'avd/home';files={}
    for directory in roots:
        assert directory.resolve().is_relative_to(ROOT.resolve())
        for p in sorted(directory.rglob('*')):
            if not p.is_file() or p.is_relative_to(omitted) or '__pycache__' in p.parts or p.name.startswith('FINAL_'):continue
            assert p.resolve().is_relative_to(ROOT.resolve()) and p.name!='访问口令.txt'
            files[p.relative_to(ROOT).as_posix()]=dict(bytes=p.stat().st_size,sha256=sha(p),role='PRIVATE_LOCAL_ONLY' if 'private' in p.parts else 'SYNTHETIC_EVIDENCE_OR_PUBLIC_REFERENCE')
    record=dict(utc=datetime.now(timezone.utc).isoformat(),files=files,roots=[str(p.relative_to(ROOT)) for p in roots],
        excluded=[dict(path=str(omitted.relative_to(ROOT)),reason='Stopped rebuildable owned AVD disk; deletion denied by tool policy; configuration, copied databases and test evidence sealed separately.')],
        old_seal=read(P4/'protection-final.json')['previous_manifest_sha256'])
    manifest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (P6/'FINAL_MANIFEST.sha256').write_text(sha(manifest)+'  FINAL_EVIDENCE_MANIFEST.json\n')
    print(json.dumps(dict(files=len(files),manifest_sha256=sha(manifest))))
else:
    assert git('status','--porcelain=v1')==''
    assert git('branch','--show-current')=='codex/finance-p03-p06-remediation'
    data=read(manifest);bad=[]
    for name,r in data['files'].items():
        p=ROOT/name
        if not p.is_file() or p.stat().st_size!=r['bytes'] or sha(p)!=r['sha256']:bad.append(name)
    assert not bad,bad
    changes=git('diff','--name-only','a065cd15d48b508c2797b9b563cfd24228b6bed9','HEAD').splitlines()
    product=[n for n in changes if n.startswith(('functions/','android/','js/','cloudflare/'))]
    assert product==['functions/_lib/finance-ai.mjs'],product
    protected=read(P4/'protected-before.json');live={}
    import importlib.util
    spec=importlib.util.spec_from_file_location('final_protection',ROOT/'qa/finance-p03/protection.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.TREES['finance_origin']=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
    for name,path in module.TREES.items():
        live[name]=dict(head=module.git(path,'rev-parse','HEAD'),branch=module.git(path,'branch','--show-current'),status=module.git(path,'status','--porcelain=v1'))
        assert all(live[name][field]==protected[name][field] for field in live[name]),name
    provenance=dict(status='PASS',utc=datetime.now(timezone.utc).isoformat(),head=git('rev-parse','HEAD'),branch=git('branch','--show-current'),git_status=git('status','--porcelain=v1'),
        base='a065cd15d48b508c2797b9b563cfd24228b6bed9',tree=git('rev-parse','HEAD^{tree}'),manifest_sha256=sha(manifest),files_verified=len(data['files']),
        changed_files=changes,source_sha256={n:sha(ROOT/n) for n in changes},product_files=product,
        report='docs/finance/FINANCE_P03_P06_REMEDIATION_REPORT.md',protected_git_state=live,protected_full_hash_audit='finance-p04/remediation/protection-final.json',
        physical_phone_operations=False,push_merge_pr_release=False,production_or_existing_preview_mutations=False,
        cleanup='Own AVD disk retained after automatic tool-policy denial; QA packages/private ADB/emulator removed or stopped.')
    for name,value in [('FINAL_PROVENANCE.json',provenance),('FINAL_VERIFY.json',dict(status='PASS',head=provenance['head'],manifest_sha256=sha(manifest),files_verified=len(data['files']),differences=bad,git_clean=True,protected_git_same=True))]:
        p=P6/name;assert not p.exists();p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(head=provenance['head'],status='PASS',files_verified=len(data['files']),manifest_sha256=sha(manifest))))
