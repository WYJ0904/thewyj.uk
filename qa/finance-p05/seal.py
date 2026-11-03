"""Bind the local final report/source to retained, immutable evidence. No uploads or decryption."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
X=ROOT/'docs/migration-evidence/finance-p04/experience-channel-current';B=E/'final-r7'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    d=hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):d.update(chunk)
    return d.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def now():return datetime.now(timezone.utc).isoformat()
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['preflight','seal','verify']);args=parser.parse_args()
if args.action=='preflight':
    output=E/'final-preflight.json';assert not output.exists()
    manifest=ROOT/'docs/migration-evidence/finance-p04/closure-current/FINAL_EVIDENCE_MANIFEST.json'
    old=read(manifest);unchanged=[];missing=[];changed=[]
    for row in old['files']:
        p=ROOT/row['path'];assert p.is_relative_to(ROOT/'docs/migration-evidence/finance-p04/closure-current')
        if not p.is_file():missing.append(row['path'])
        elif p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:changed.append(row['path'])
        else:unchanged.append(row['path'])
    previous=read(E/'historical-seal-classification.json')
    assert not changed and set(missing)==set(previous['missing_rebuildable_cache_files'])
    current=read(B/'android-current/command.json');assert current['source_stable']
    for name,digest in current['source_after']['files'].items():assert sha(ROOT/name)==digest,name
    frozen=read(E/'frozen-source-manifest.json')
    for name,digest in frozen.items():
        p=ROOT/'qa/finance-p02'/name
        assert p.is_relative_to(ROOT/'qa/finance-p02') and sha(p)==digest,name
    ancestors={ref:subprocess.run(['git','merge-base','--is-ancestor',ref,'HEAD'],cwd=ROOT).returncode==0
        for ref in ['ce7c87ef3e23907577c0266bfcccc002bcebcd2c','5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc',
                    '57b622e40e22573ec652f4dfa21e8cd62b36c0e6','8c0de9ca23ff8fd04c281a0a0bbbcee66d206384']}
    assert all(ancestors.values())
    record={'checked_utc':now(),'status':'PASS_WITH_DISCLOSED_HISTORICAL_CACHE_EXCEPTIONS','head':git('rev-parse','HEAD'),
        'tested_product_head':current['head'],'product_source_matches_final_test':True,'ancestors':ancestors,
        'historical_manifest_sha256':sha(manifest),'historical_total':len(old['files']),'historical_unchanged':len(unchanged),
        'historical_missing_cache':missing,'historical_changed':changed,'historical_full_manifest_result':'FAIL retained',
        'historical_missing_cause':'NOT CONFIRMED','frozen_source_manifest_sha256':sha(E/'frozen-source-manifest.json'),
        'frozen_inputs_unchanged':True,'emulator_validation':read(E/'emulator-validation-r2/result.json')['status'],
        'emulator_cleanup':read(E/'emulator-cleanup-r2.json')['status']}
    output.write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k!='historical_missing_cache'}))
elif args.action=='seal':
    manifest_path=E/'FINAL_EVIDENCE_MANIFEST.json';provenance=E/'FINAL_PROVENANCE.json'
    assert not manifest_path.exists() and not provenance.exists();assert not git('status','--porcelain')
    check=read(E/'final-preflight.json');summary=read(B/'delivery-current/summary.json');current=read(B/'android-current/command.json')
    for name,digest in current['source_after']['files'].items():assert sha(ROOT/name)==digest,name
    protected=read(E/'protected-final.comparison.json')
    assert len(protected)==13 and all(not row['added'] and not row['missing'] and not row['changed']
        and all(value for key,value in row.items() if key.endswith('Same')) for row in protected.values())
    # Verify the disclosed historical exception set again at final seal time.
    legacy=read(ROOT/'docs/migration-evidence/finance-p04/closure-current/FINAL_EVIDENCE_MANIFEST.json')
    missing=set(check['historical_missing_cache'])
    for row in legacy['files']:
        p=ROOT/row['path']
        if row['path'] in missing:assert not p.exists(),row['path']
        else:assert p.is_file() and p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],row['path']
    files={}
    ignored_parts={'.gradle','.kotlin','.wrangler','node_modules','__pycache__','build','build-sources','tools','generated-schemas'}
    for base in [E,X]:
        for path,dirs,names in os.walk(base,followlinks=False):
            relative=Path(path).relative_to(base)
            dirs[:]=[name for name in dirs if name not in ignored_parts and name!='private' and not name.startswith('build-')
                and not name.startswith('owned-browser') and not (Path(path)/name).is_symlink()]
            for name in names:
                p=Path(path)/name
                if p.is_symlink() or name.startswith('FINAL_') or name.endswith('.lock'):continue
                if 'emulator-preparation' in relative.parts and name.endswith('.zip'):continue
                # Actual APKs, XML, logs, fixture inputs and cold backups are included;
                # dependency runtime, browser state and compiler caches are not evidence.
                files[p.relative_to(ROOT).as_posix()]={'bytes':p.stat().st_size,'sha256':sha(p)}
    delta=git('diff','--name-only','ce7c87e..HEAD').splitlines()
    for name in delta:
        p=ROOT/name
        if p.is_file():files[name]={'bytes':p.stat().st_size,'sha256':sha(p)}
    manifest={'sealed_utc':now(),'scope':'Current retained public/synthetic source, report and raw evidence only; no upload',
        'excluded':'Compiler/build trees, browser state, SDK archive/runtime, AVD image, private credentials, self-referential FINAL files',
        'files':dict(sorted(files.items()))}
    manifest_path.write_text(json.dumps(manifest,indent=2))
    report=ROOT/'docs/finance/FINANCE_P03_P04_P05_CONTINUATION_REPORT.md'
    proof={'sealed_utc':now(),'final_local_commit':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),
        'worktree':str(ROOT),'working_tree_clean':not git('status','--porcelain'),'starting_commit':'ce7c87ef3e23907577c0266bfcccc002bcebcd2c',
        'tested_product_commit':summary['tested_head'],'node_execution_head':read(B/'node-evidence-copy.json')['execution_head'],
        'node_scoped_bytes_identical':True,'report':str(report.relative_to(ROOT)),'report_sha256':sha(report),
        'evidence_manifest_sha256':sha(manifest_path),'sealed_files':len(files),'summary':summary,
        'debug_artifacts':current['artifacts'],'emulator_artifacts':read(E/'emulator-validation-r2/result.json')['artifacts'],
        'emulator_result':'5 PASS; first 4 PASS / 1 FAIL retained','emulator_cleanup':'PASS',
        'protected_groups':13,'historical_seal':check,'historical_primary_recheck_utc':now(),'changed_files':delta,
        'preview_source_commit':'298d5057d7b4c7432e0625bb5c9297ba9243b6df',
        'preview_deployment_id':'fa42e9b0-5027-40f1-9377-b0942aaeb857',
        'preview_url':'https://owner-p04-preview.thewyj-finance-p04-preview.pages.dev/finance',
        'production_source_commit_observed':'74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc',
        'statuses':{'P03':'PARTIAL','P04':'PARTIAL','P05':'PARTIAL'},'real_phone_operations':False,'production_mutation':False,
        'push':False,'merge':False,'release':False,'p05_deployed':False,'secrets_in_manifest':False}
    provenance.write_text(json.dumps(proof,indent=2));print(json.dumps({'head':proof['final_local_commit'],'sealed_files':len(files),'manifest_sha256':sha(manifest_path)}))
else:
    manifest_path=E/'FINAL_EVIDENCE_MANIFEST.json';proof=read(E/'FINAL_PROVENANCE.json');assert sha(manifest_path)==proof['evidence_manifest_sha256']
    differences=[]
    for name,row in read(manifest_path)['files'].items():
        p=ROOT/name
        if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:differences.append(name)
    assert not git('status','--porcelain');assert git('rev-parse','HEAD')==proof['final_local_commit']
    result={'checked_utc':now(),'status':'PASS' if not differences else 'FAIL','differences':differences,
        'files_verified':proof['sealed_files'],'final_head':proof['final_local_commit']}
    target=E/'FINAL_VERIFY.json';assert not target.exists();target.write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not differences
