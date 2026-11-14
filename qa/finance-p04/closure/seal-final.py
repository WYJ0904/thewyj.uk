"""Append an immutable evidence manifest and commit provenance; never export secrets."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, ast, hashlib, json, subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['manifest','provenance']);args=parser.parse_args()
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def git(*parts):return subprocess.check_output(['git',*parts],cwd=ROOT,text=True,encoding='utf8').strip()
manifest=OUT/'FINAL_EVIDENCE_MANIFEST.json'
if args.stage=='manifest':
    assert not manifest.exists()
    excluded={'intermediates','.gradle','.kotlin','kspCaches','__pycache__'}
    rows=[]
    for p in sorted(OUT.rglob('*')):
        if not p.is_file() or p.is_symlink():continue
        relative=p.relative_to(OUT)
        if any(part in excluded for part in relative.parts) or p.name.startswith('FINAL_'):continue
        rows.append({'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)})
    record={'sealed_utc':datetime.now(timezone.utc).isoformat(),'tested_product_commit':'73764f77fd02ada240e41c24734e523c5dad8805',
            'scope':'Retained local evidence, including restricted synthetic backup and encrypted receipt digests; contents remain local, no upload',
            'excluded':'Rebuildable intermediates/caches, symlinks, FINAL_ self/provenance; report/source commit is bound separately',
            'files':rows,'count':len(rows),'logical_bytes':sum(row['bytes'] for row in rows)}
    manifest.write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps({'files':len(rows),'logical_bytes':record['logical_bytes'],'manifest_sha256':digest(manifest)}))
else:
    target=OUT/'FINAL_DELIVERY_PROVENANCE.json';assert not target.exists() and manifest.exists()
    assert git('status','--porcelain')=='','Commit final reports and source before provenance'
    record=json.loads(manifest.read_text())
    for row in record['files']:
        p=ROOT/row['path'];assert p.is_file() and p.stat().st_size==row['bytes'] and digest(p)==row['sha256'],row['path']
    protection=json.loads((OUT/'protected-final.comparison.json').read_text())
    assert len(protection)==13
    for row in protection.values():
        assert all(row.get(k,[])==[] for k in ['added','missing','changed'])
        assert all(row.get(k,True) is True for k in ['headSame','branchSame','statusSame'])
    for p in (ROOT/'qa/finance-p04/closure').glob('*.py'):ast.parse(p.read_text(encoding='utf8'))
    summary=json.loads((OUT/'final-current/delivery-current-r2/summary.json').read_text())
    assert summary['standard_JVM']=={'PASS':724,'FAIL':6}
    source_names=git('ls-files','--','qa/finance-p04/closure','docs/finance-p03/FINANCE_P03_FINAL_REPORT.md','docs/finance-p04').splitlines()
    assert all(Path(name).name!='访问口令.txt' for name in source_names)
    source={name:digest(ROOT/name) for name in source_names}
    result={'sealed_utc':datetime.now(timezone.utc).isoformat(),'status':'SEALED_PARTIAL','p03':'PARTIAL','p04':'PARTIAL',
            'branch':git('branch','--show-current'),'final_local_commit':git('rev-parse','HEAD'),'tested_product_commit':record['tested_product_commit'],
            'parent':git('rev-parse','HEAD^'),'git_worktree_clean':True,'protected_groups':13,'protection':'PASS',
            'manifest_sha256':digest(manifest),'evidence_files_verified':len(record['files']),'source_and_report_files':source,
            'regression':summary,'production_release':'HELD','pushed':False,'merged':False,'formally_signed':False,
            'owned_phone_cloud_cleanup':'PASS per sealed evidence; pycache policy rejection and incident audit retention disclosed'}
    target.write_text(json.dumps(result,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in result.items() if k not in {'source_and_report_files','regression'}}))
