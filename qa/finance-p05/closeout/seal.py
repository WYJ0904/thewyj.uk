"""New seal with explicit old-raw / mutable-source boundaries; never overwrite old evidence."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
OLD=ROOT/'docs/migration-evidence/finance-p04/continuation-p05';B=E/'final-r1'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    d=hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):d.update(chunk)
    return d.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def now():return datetime.now(timezone.utc).isoformat()
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['old-integrity','seal','verify']);parser.add_argument('--post-run',action='store_true');args=parser.parse_args()
assert not args.post_run or args.action=='old-integrity'
if args.action=='old-integrity':
    dest=E/('old-integrity-post-run.json' if args.post_run else 'old-integrity-final.json');assert not dest.exists();manifest=read(OLD/'FINAL_EVIDENCE_MANIFEST.json');archive=read(E/'baseline-source-manifest.json')
    raw=[];archived=[];working_changed=[];errors=[]
    for name,row in manifest['files'].items():
        if name in archive:
            p=E/'baseline-source'/name;archived.append(name)
            if not (ROOT/name).is_file() or sha(ROOT/name)!=row['sha256']:working_changed.append(name)
        else:p=ROOT/name;raw.append(name)
        if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:errors.append(name)
    legacy=read(ROOT/'docs/migration-evidence/finance-p04/closure-current/FINAL_EVIDENCE_MANIFEST.json')
    exception=set(read(OLD/'FINAL_PROVENANCE.json')['historical_seal']['historical_missing_cache']);legacy_ok=0
    for row in legacy['files']:
        p=ROOT/row['path']
        if row['path'] in exception:
            if p.exists():errors.append('Historical cache exception changed: '+row['path'])
        elif not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:errors.append(row['path'])
        else:legacy_ok+=1
    frozen=read(OLD/'frozen-source-manifest.json')
    for name,digest in frozen.items():
        if sha(ROOT/'qa/finance-p02'/name)!=digest:errors.append('Frozen '+name)
    audit=read(E/'legacy-currency-audit.json')
    for name,digest in audit['original_test_hashes'].items():
        if sha(ROOT/'android/app/src/test/java/uk/thewyj/app/task21/payment'/name)!=digest:errors.append('Original failing test '+name)
    result={'checked_utc':now(),'status':'PASS' if not errors else 'FAIL','old_manifest_sha256':sha(OLD/'FINAL_EVIDENCE_MANIFEST.json'),
        'old_raw_unchanged':len(raw),'old_source_bytes_archived':len(archived),'authorized_working_source_changes':working_changed,'errors':errors,
        'older_primary_unchanged':legacy_ok,'older_missing_rebuildable_caches':len(exception),'older_full_seal_result':'FAIL retained; missing cause NOT CONFIRMED',
        'frozen_inputs_unchanged':len(frozen),'original_failure_files_unchanged':len(audit['original_test_hashes'])}
    dest.write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not errors
elif args.action=='seal':
    dest=E/'FINAL_EVIDENCE_MANIFEST.json';proof=E/'FINAL_PROVENANCE.json';assert not dest.exists() and not proof.exists();assert not git('status','--porcelain')
    old=read(E/'old-integrity-post-run.json');assert old['status']=='PASS'
    protected=read(E/'protected-final.comparison.json');assert len(protected)==13
    assert all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in protected.values())
    summary=read(B/'delivery-current/summary.json');android=read(B/'android-current/command.json');assert android['source_stable']
    for name,digest in android['source_after']['files'].items():assert sha(ROOT/name)==digest,name
    assert read(E/'emulator-r3/result.json')['status']=='PASS';assert read(E/'e2e-r2/result.json')['status']=='SYNTHETIC_E2E_PASS'
    assert read(E/'avd-cleanup.json')['status']=='PASS';assert read(E/'sdk-input-integrity.json')['status']=='PASS'
    assert read(E/'source-binding.json')['status']=='PASS'
    assert read(B/'delivery-current/regression-comparison.json')['status']=='PASS'
    files={};skip={'.gradle','.kotlin','.wrangler','node_modules','__pycache__','build','build-sources','generated-schemas','home','private'}
    for folder,dirs,names in os.walk(E,followlinks=False):
        dirs[:]=[name for name in dirs if name not in skip and not name.startswith(('build-','owned-chrome','owned-browser')) and not (Path(folder)/name).is_symlink()]
        for name in names:
            p=Path(folder)/name
            if p.is_symlink() or name.startswith('FINAL_') or name.endswith('.lock'):continue
            files[p.relative_to(ROOT).as_posix()]={'bytes':p.stat().st_size,'sha256':sha(p)}
    changed=git('diff','--name-only','adbd485..HEAD').splitlines()
    for name in changed:
        p=ROOT/name
        if p.is_file():files[name]={'bytes':p.stat().st_size,'sha256':sha(p)}
    # The actual persistent Miniflare experiment needs a short owned Windows
    # path for SQLite journals. Retain and seal this exact result-bound runtime
    # too; do not silently omit its binary backup because it lies outside E.
    native=read(B/'regression/native-persist-auto/result.json');assert native['status']=='PASS'
    nativeRoot=Path(native['runtime_root']).resolve()
    assert nativeRoot.parent==(ROOT/'docs/migration-evidence').resolve()
    assert nativeRoot.name.startswith('native-') and nativeRoot.name.endswith('-'+str(native['pid']))
    assert nativeRoot.is_dir() and not nativeRoot.is_symlink()
    for name,digest in native['files'].items():assert sha(nativeRoot/name)==digest,name
    for p in nativeRoot.rglob('*'):
        assert not p.is_symlink() and p.resolve().is_relative_to(nativeRoot)
        if p.is_file():files[p.relative_to(ROOT).as_posix()]={'bytes':p.stat().st_size,'sha256':sha(p)}
    dest.write_text(json.dumps({'sealed_utc':now(),'scope':'New local source, synthetic evidence and immutable baseline byte archives; no upload',
        'excluded':'SDK/AVD disk, compiler/cache trees, private credentials, owned browser state, FINAL self references','files':dict(sorted(files.items()))},indent=2))
    report=ROOT/'docs/finance/FINANCE_P03_P04_P05_NON_DEVICE_CLOSEOUT_REPORT.md'
    result={'sealed_utc':now(),'final_local_commit':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'worktree':str(ROOT),
        'starting_commit':'adbd4851410b47894cc8bf90ffb989e8e407ebdd','tested_head':summary['tested_head'],'clean':True,
        'report':str(report.relative_to(ROOT)),'report_sha256':sha(report),'manifest_sha256':sha(dest),'sealed_files':len(files),
        'summary':summary,'old_integrity':old,'protected_groups':13,'artifacts':android['artifacts'],
        'extra_retained_evidence':[str(nativeRoot.relative_to(ROOT))],
        'sdk_result':'33 vector PASS; 6 instrumentation methods PASS; first failures retained','sdk_tested_head':read(E/'emulator-r3/result.json')['head'],
        'synthetic_e2e':'PASS; 2 JVM methods + 6 Chrome checks; five precise ledgers','raw_provider_or_samsung_proof':False,
        'P03_STATUS':'PARTIAL','P04_STATUS':'PARTIAL','P05_STATUS':'PARTIAL','physical_device_operations':False,
        'production_or_preview_mutations':False,'push_merge_release':False,'p06_started':False,'changed_files':changed}
    proof.write_text(json.dumps(result,indent=2));print(json.dumps({'commit':result['final_local_commit'],'files':len(files),'manifest_sha256':sha(dest)}))
else:
    proof=read(E/'FINAL_PROVENANCE.json');manifest=E/'FINAL_EVIDENCE_MANIFEST.json';assert sha(manifest)==proof['manifest_sha256']
    errors=[]
    for name,row in read(manifest)['files'].items():
        p=ROOT/name
        if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:errors.append(name)
    assert not git('status','--porcelain');assert git('rev-parse','HEAD')==proof['final_local_commit']
    result={'checked_utc':now(),'status':'PASS' if not errors else 'FAIL','files':proof['sealed_files'],'differences':errors,'final_commit':proof['final_local_commit']}
    target=E/'FINAL_VERIFY.json';assert not target.exists();target.write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not errors
