"""Preserve frozen oracles; adapt only root/import/output paths in fresh drivers."""
from common import *
import re, shutil, sys

OLD_E=OLD/'docs/migration-evidence/finance-p04/convergence'
D=E/'drivers';D.mkdir(exist_ok=False)
manifest=json.loads((OLD_E/'FINAL_EVIDENCE_MANIFEST.json').read_text())['files']
copies=[];adapters=[]
def copy(src,dst):
    assert src.is_relative_to(OLD_E) and dst.is_relative_to(E) and not dst.exists()
    key=src.relative_to(OLD).as_posix();info=manifest.get(key)
    assert info and sha(src)==info['sha256'],key
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst);assert sha(src)==sha(dst)
    copies.append(dict(source=key,dest=dst.relative_to(ROOT).as_posix(),sha256=sha(dst)))
for name in ['baseline-modules','trace-source','backup-proof-source','explicit-source']:
    for src in sorted((OLD_E/'preparation'/name).rglob('*')):
        if src.is_file():copy(src,E/'preparation'/name/src.relative_to(OLD_E/'preparation'/name))
for name in ['compat-p03','explicit-currency-bridge']:
    for src in sorted((OLD_E/'fixtures'/name).rglob('*')):
        if src.is_file():copy(src,E/'fixtures'/name/src.relative_to(OLD_E/'fixtures'/name))
for src in sorted((OLD_E/'live-models').glob('response-*.json')):
    copy(src,E/'live-models'/src.name)
settings=json.loads((OLD_E/'preparation/environment.json').read_text())
settings={k:v.replace(str(OLD),str(ROOT)).replace('finance-p04\\convergence','aeris-finance-quality').replace('finance-p04/convergence','aeris-finance-quality') for k,v in settings.items()}
settings['FINANCE_NODE_WORKERS']='2'
write(E/'preparation/environment.json',settings)

def adapt(src,name,replacements):
    path=ROOT/src;text=path.read_text(encoding='utf-8')
    for old,new in replacements:
        assert old in text,(src,old);text=text.replace(old,new)
    dest=D/name
    if dest.suffix=='.py':compile(text,str(dest),'exec')
    dest.write_text(text,encoding='utf-8')
    adapters.append(dict(source=src,source_sha256=sha(path),dest=dest.relative_to(ROOT).as_posix(),dest_sha256=sha(dest),
        replacements=[dict(before=a,after=b) for a,b in replacements]))
    return dest
root0=[('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})')]
root1=[('ROOT = Path(__file__).resolve().parents[2]',f'ROOT = Path({str(ROOT)!r})')]
scope=[('docs/migration-evidence/finance-p04','docs/migration-evidence/aeris-finance-quality')]
for src,name,root in [
    ('qa/finance-p04/android.py','android.py',root0),
    ('qa/finance-p04/run-regression-jvm.py','jvm.py',root1),
    ('qa/finance-p04/run-regression-node.py','node.py',root1),
    ('qa/finance-p04/prepare-contract-drivers.py','contracts.py',root0),
    ('qa/finance-p04/upgraded-legacy-http.py','upgraded.py',root0)]:
    adapt(src,name,root+scope if 'docs/migration-evidence/finance-p04' in (ROOT/src).read_text() else root)
calls=[('qa/finance-p04/android.py',(D/'android.py').as_posix()),
       ('qa/finance-p04/run-regression-jvm.py',(D/'jvm.py').as_posix()),
       ('qa/finance-p04/run-regression-node.py',(D/'node.py').as_posix()),
       ('qa/finance-p04/prepare-contract-drivers.py',(D/'contracts.py').as_posix()),
       ('qa/finance-p04/upgraded-legacy-http.py',(D/'upgraded.py').as_posix())]
adapt('qa/finance-remediation/regression.py','regression.py',root0+[
    ('docs/migration-evidence/finance-p04/remediation','docs/migration-evidence/aeris-finance-quality')]+calls)
source=E/'versioned-identity-source';(source/'kotlin').mkdir(parents=True)
shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',source/'test.init.gradle')
shutil.copy2(ROOT/'qa/finance-convergence/kotlin/VersionedIdentityContractTest.kt',source/'kotlin/VersionedIdentityContractTest.kt')
write(E/'regression-adapters.json',dict(only_path_adapters=True,original_oracles_modified=False,copies=copies,adapters=adapters))
print(json.dumps(dict(status='PASS',verified_copies=len(copies),path_adapters=len(adapters))))
