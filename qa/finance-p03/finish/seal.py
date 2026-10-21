"""Seal only retained evidence and reviewed local source after cleanup/commit."""
from pathlib import Path
import datetime,hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,encoding='utf8').strip()
assert git('status','--porcelain=v1')=='' and git('branch','--show-current')=='codex/finance-p03-identity-preauth'
assert read(OUT/'cleanup.json')['status']=='CLEANED_REBUILDABLE_ONLY' and not (OUT/'private').exists()
assert read(OUT/'phone-cleanup-final.json')['status']=='CLEANED_OWNED_QA_USER0_ONLY'
assert read(OUT/'protected-final.json')['status']=='PASS'
assert set(git('diff','--name-only','1e04945d1964c0e6a9420b0aff99011001f4ab98','HEAD','--','android','functions','js','app.js','cloudflare').splitlines())=={'functions/_lib/task21-provider-evidence.mjs','js/finance/app.js'}
source={}
for p in (ROOT/'qa/finance-p03/finish').rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts:source[p.relative_to(ROOT).as_posix()]=sha(p)
for name in ['functions/_lib/task21-provider-evidence.mjs','js/finance/app.js','docs/finance-p03/FINANCE_P03_FINAL_REPORT.md']:
    source[name]=sha(ROOT/name)
raw={}
for p in OUT.rglob('*'):
    if not p.is_file() or (p.parent==OUT and p.name in ['provenance.json','validation.json','REVISION.json']):continue
    relative=p.relative_to(OUT)
    assert not any(s in ['private','persist','build','build-regression','build-sources','qa-generated','generated-schemas','__pycache__'] or s.startswith('owned-browser-') for s in relative.parts),p
    assert p.suffix not in ['.key','.p12','.pfx','.jks','.keystore'],p
    raw[p.relative_to(ROOT).as_posix()]=sha(p)
artifacts=read(OUT/'phone-maintenance2-artifacts.json')['artifacts']
for r in artifacts:assert sha(ROOT/r['canonical_path'])==r['sha256']
head=git('rev-parse','HEAD');revision={'head':head,'tree':git('rev-parse','HEAD^{tree}'),'branch':git('branch','--show-current'),
    'status':git('status','--porcelain=v1'),'baseline':'1e04945d1964c0e6a9420b0aff99011001f4ab98',
    'code_commit':git('rev-parse','HEAD^'),'result':'PARTIAL','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'product_delta':['functions/_lib/task21-provider-evidence.mjs','js/finance/app.js']}
data={'revision':revision,'source_report_sha256':source,'retained_public_evidence_sha256':raw,'canonical_artifacts':artifacts,
    'prior_provenance_sha256':read(OUT/'protected-final.json')['prior_provenance_sha256'],
    'ephemeral_auth_tls_and_rebuildable_trees_removed':True,'no_phone_qa_left_user0':True}
for name,value in [('REVISION.json',revision),('provenance.json',data)]:
    p=OUT/name;assert not p.exists();p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
errors=[name for name,digest in {**source,**raw}.items() if not (ROOT/name).is_file() or sha(ROOT/name)!=digest]
validation={'status':'PASS' if not errors else 'FAIL','errors':errors,'head':head,'tree':revision['tree'],'task_status':'PARTIAL',
    'source_files':len(source),'retained_evidence_files':len(raw),'provenance_sha256':sha(OUT/'provenance.json')}
(OUT/'validation.json').write_text(json.dumps(validation,indent=2),encoding='utf8');print(json.dumps(validation));assert not errors
