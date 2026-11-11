"""Preserve every previous report/raw run and the parallel protected checkouts."""
import argparse, datetime, hashlib, importlib.util, json, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p03/phase-a'
BASELINE = '09442c2985368dfb09ddfa6b613c3be2d0f21b9d'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf8').strip()
def load(p):return json.loads(p.read_text(encoding='utf8'))
def check_seal():
    seal=load(ROOT/'docs/migration-evidence/finance-p03/closeout/provenance.json')
    errors=[]
    for group in ('source_and_report_sha256','raw_evidence_sha256'):
        for p,d in seal[group].items():
            if not (ROOT/p).is_file() or sha(ROOT/p)!=d:errors.append(p)
    assert not errors,errors
    assert load(ROOT/'docs/migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json')['commit']==BASELINE
    return {g:len(seal[g]) for g in ('source_and_report_sha256','raw_evidence_sha256')}
def history():
    paths=[]
    for base in ('docs/finance-p02','docs/finance-p03','qa/finance-p02','docs/migration-evidence/finance-p03'):
        for p in (ROOT/base).rglob('*'):
            if p.is_file() and OUT not in p.parents and '__pycache__' not in p.parts:paths.append(p)
    return {p.relative_to(ROOT).as_posix():sha(p) for p in sorted(set(paths))}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('name');ap.add_argument('--before');args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);target=OUT/(args.name+'.json');assert not target.exists()
    spec=importlib.util.spec_from_file_location('protection',ROOT/'qa/finance-p03/protection.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    seal=check_seal() if not args.before else {'checked_at_start':True}
    data={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':git('rev-parse','HEAD'),
          'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1'),
          'seal':seal,'history':history(),'protected':module.snapshot()}
    assert data['branch']=='codex/finance-p03-identity-preauth'
    subprocess.run(['git','merge-base','--is-ancestor',BASELINE,'HEAD'],cwd=ROOT,check=True)
    if args.before:
        old=load(OUT/(args.before+'.json'))
        changed=[p for p,d in old['history'].items() if data['history'].get(p)!=d]
        comparison=module.compare(old['protected'],data['protected'])
        material_file=OUT/'owner-materials.json'
        owner_added=[]
        if material_file.exists():
            material=load(material_file)
            allowed={'thewyj-finance-materials/'+n:d['sha256'] for n,d in material['files'].items()}
            owner_added=comparison['main']['added']
            already_present={p for p in allowed if p in old['protected']['main']['files']}
            assert set(owner_added)==set(allowed)-already_present,comparison['main']
            assert all(old['protected']['main']['files'][p]==allowed[p] for p in already_present)
            assert all(data['protected']['main']['files'][p]==d for p,d in allowed.items())
            def without_materials(value):
                return '\n'.join(line for line in value.splitlines() if line!='?? thewyj-finance-materials/' and line[3:] not in allowed)
            assert without_materials(data['protected']['main']['status'])==without_materials(old['protected']['main']['status'])
            comparison['main']['ownerMaterialsStatusOnly']=True
            comparison['main']['ownerInputAdded']=owner_added
            comparison['main']['ownerInputAlreadyPresent']=sorted(already_present)
        data['comparison']={'history_changed':changed,'protected':comparison}
        assert not changed,changed
        assert all((not v['added'] or (name=='main' and v['added']==owner_added)) and not v['missing'] and not v['changed'] and
            all(x or (name=='main' and k=='statusSame' and v.get('ownerMaterialsStatusOnly')) for k,x in v.items() if k.endswith('Same')) for name,v in comparison.items())
    else:assert data['head']==BASELINE
    target.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'output':str(target),'head':data['head'],'history_files':len(data['history']),
        'protected_groups':len(data['protected']),'seal':seal,'comparison':data.get('comparison',{})},ensure_ascii=False))
if __name__=='__main__':main()
