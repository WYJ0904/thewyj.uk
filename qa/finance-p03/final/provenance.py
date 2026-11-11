"""Seal the one unified P03 delivery. No remote or protected-worktree writes."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p03/final'
ORIGINAL='75e6561c4d32db77ee1192a7f2995bedf2060d78'
REPORT='docs/finance-p03/FINANCE_P03_FINAL_REPORT.md'

def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf8').strip()
def read(p):return json.loads(p.read_text(encoding='utf8-sig'))
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def write(name,value):
    p=BASE/name;assert not p.exists(),p
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def scope():
    assert git('branch','--show-current')=='codex/finance-p03-identity-preauth'
    subprocess.run(['git','merge-base','--is-ancestor',ORIGINAL,'HEAD'],cwd=ROOT,check=True)
    changed=set(git('diff','--name-only',ORIGINAL).splitlines())|set(git('ls-files','--others','--exclude-standard').splitlines())
    assert all(p==REPORT or p.startswith(('qa/finance-p03/final/','android/app/src/main/java/uk/thewyj/app/task21/','android/app/src/test/java/uk/thewyj/app/task21/')) or
        p in {'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/14.json','cloudflare/migrations/0030_payment_supersession.sql'} or
        p.startswith('functions/_lib/') for p in changed),changed
    assert not git('diff','--name-only','--diff-filter=D',ORIGINAL)
    for p in git('ls-tree','-r','--name-only',ORIGINAL,'cloudflare/migrations','android/app/schemas').splitlines():
        assert git('hash-object',p)==git('rev-parse',ORIGINAL+':'+p),p
    historical=read(BASE/'baseline.json')['history']
    assert all((ROOT/p).is_file() and sha(ROOT/p)==d for p,d in historical.items()),'Historical evidence changed'
    comparison=read(BASE/'protected-final-2.json')['comparison'];assert not comparison['historical_changes']
    for result in comparison['protected'].values():
        assert not result['added'] and not result['missing'] and not result['changed']
        assert all(v for k,v in result.items() if k.endswith('Same'))
    return changed
def capture():
    changed=scope();summary=read(BASE/'delivery-final/summary.json')
    assert summary['jvm']=={'PASS':681} and summary['new_unified_tests']=={'PASS':79}
    assert summary['matrix']=={'PASS':536,'FAIL':7,'EXPECTED_RED':42,'NOT_TESTED':23} and not summary['matrix_changes']
    names=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0')
    names=sorted({p for p in names if p and p.startswith(('android/','functions/','cloudflare/migrations/','qa/','js/'))})
    starts={prefix:datetime.datetime.fromisoformat(read(BASE/file)['started_utc']).timestamp() for prefix,file in [('android/','full-candidate-3-run.json')]}
    bad=[p for p in names if p.startswith('android/') and p in changed and (ROOT/p).stat().st_mtime>starts['android/']]
    assert not bad,('Android inputs changed after the final full run',bad)
    node_start=datetime.datetime.fromisoformat(read(BASE/'node-final-2/exits.json')[0]['started_utc']).timestamp()
    bad=[p for p in names if p.startswith(('functions/','cloudflare/migrations/')) and p in changed and (ROOT/p).stat().st_mtime>node_start]
    assert not bad,('Backend source changed after final campaign began',bad)
    write('candidate-inputs.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':{p:sha(ROOT/p) for p in names},
        'source_changed_since_baseline':sorted(changed),'tested_source_timing':'Android before full-candidate-3; backend before node-final-2; no later product edits',
        'apk_sha256':sha(BASE/'artifacts/finance-p03-debug-final.apk')})
    print(json.dumps({'candidate_files':len(names),'changed_files':len(changed)}))
def seal():
    changed=scope();assert not git('status','--porcelain=v1'),'Commit the reviewed local delivery first'
    inputs=read(BASE/'candidate-inputs.json')
    assert all(sha(ROOT/p)==d for p,d in inputs['sha256'].items())
    value={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),
        'branch':git('branch','--show-current'),'baseline':ORIGINAL,'status':'PARTIAL','apk_sha256':sha(BASE/'artifacts/finance-p03-debug-final.apk'),
        'apk_bytes':(BASE/'artifacts/finance-p03-debug-final.apk').stat().st_size,'formal_app_installed':False,'release':False}
    write('REVISION.json',value)
    raw={p.relative_to(ROOT).as_posix():sha(p) for p in sorted(BASE.rglob('*')) if p.is_file() and p.name not in {'provenance.json','validation.json','seal.log'} and '__pycache__' not in p.parts}
    write('provenance.json',{**value,'source_report_sha256':{p:sha(ROOT/p) for p in sorted(changed)},'raw_evidence_sha256':raw,'tested_inputs_sha256':inputs['sha256'],
        'protection':read(BASE/'protected-final-2.json')['comparison'], 'boundaries':{'ADB_phone':'NONE','Production_D1_R2':'NONE','formal_accounts_payments':'NONE','push_merge_PR_release_signing':'NONE','P04_P05_P06':'NOT_STARTED'}})
    print(json.dumps(value,indent=2))
def verify():
    m=read(BASE/'provenance.json');errors=[]
    for group in ['source_report_sha256','raw_evidence_sha256','tested_inputs_sha256']:
        for p,d in m[group].items():
            if not (ROOT/p).is_file() or sha(ROOT/p)!=d:errors.append(p)
    assert not errors,errors
    assert git('rev-parse','HEAD')==m['commit'] and not git('status','--porcelain=v1')
    write('validation.json',{'status':'PASS','commit':m['commit'],'tree':m['tree'],'working_tree':'CLEAN','task_status':'PARTIAL','mismatches':errors,
        'source_report_files':len(m['source_report_sha256']),'raw_evidence_files':len(m['raw_evidence_sha256']),'candidate_files':len(m['tested_inputs_sha256']),
        'provenance_sha256':sha(BASE/'provenance.json')})
    print(json.dumps(read(BASE/'validation.json'),indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['scope','capture','seal','verify']);a=p.parse_args()
    if a.mode=='scope':print(sorted(scope()))
    else:globals()[a.mode]()
