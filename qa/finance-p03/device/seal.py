"""Seal retained public evidence only; never hash/archive ephemeral credentials."""
from pathlib import Path
import hashlib,json,subprocess,datetime
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,text=True,encoding='utf8').strip()
def read(p):return json.loads(p.read_text(encoding='utf8-sig'))
assert read(OUT/'cleanup.json')['status']=='CLEANED_REBUILDABLE_ONLY'
assert not (OUT/'private').exists()
assert git('branch','--show-current')=='codex/finance-p03-identity-preauth'
assert git('diff','976eed4','--','android','functions','js','app.js','cloudflare')=='','Product code changed'
assert git('status','--porcelain=v1')=='','Commit reviewed source/report before seal'
assert len(read(OUT/'protected-final.json')['comparison']['history_changes'])==1
canonical=read(OUT/'apk-final12.json')['artifacts']
for row,name in zip(canonical,['finance-p03-device-debug.apk','finance-p03-device-tests.apk']):assert sha(OUT/'artifacts-final'/name)==row['sha256']
source={}
for p in (ROOT/'qa/finance-p03/device').rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts:source[p.relative_to(ROOT).as_posix()]=sha(p)
p=ROOT/'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md';source[p.relative_to(ROOT).as_posix()]=sha(p)
raw={}
for p in OUT.rglob('*'):
    if not p.is_file() or (p.parent==OUT and p.name in ['provenance.json','validation.json','REVISION.json']):continue
    assert not any(part in ['private','persist','build','build-sources','generated-schemas','__pycache__'] for part in p.relative_to(OUT).parts),p
    assert not p.suffix in ['.key','.p12','.pfx','.jks','.keystore'],p
    raw[p.relative_to(ROOT).as_posix()]=sha(p)
revision={'head':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1'),'baseline':'976eed4644556e70266fe0ef5e54b7c8e419d0ba','product_delta':[],'result':'PARTIAL','utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
result={'revision':revision,'source_report_sha256':source,'retained_public_evidence_sha256':raw,'canonical_artifacts':canonical,'excluded_and_removed':'owned TLS private key and synthetic auth persistence; rebuildable intermediates','prior_seal_preserved':read(OUT/'baseline.json')['prior_seal_verified']}
for name,data in [('REVISION.json',revision),('provenance.json',result)]:
    p=OUT/name;assert not p.exists();p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
errors=[name for name,d in {**source,**raw}.items() if not (ROOT/name).is_file() or sha(ROOT/name)!=d]
validation={'status':'PASS' if not errors else 'FAIL','errors':errors,'source_files':len(source),'retained_evidence_files':len(raw),'head':revision['head'],'tree':revision['tree'],'task_status':'PARTIAL','provenance_sha256':sha(OUT/'provenance.json')}
(OUT/'validation.json').write_text(json.dumps(validation,indent=2),encoding='utf8');print(json.dumps(validation));assert not errors
