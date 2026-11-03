"""Repair missing historic inputs/output guards, retaining all first-run failures."""
from common import *
from js_adapters import adapt_js
import shutil

OUT=E/'environment-repair';OUT.mkdir(exist_ok=False);copies=[];adapters=[]
folders=['finance-p03/closeout/baseline-v3/functions/_lib',
         'finance-p03/phase-a/baseline-v4/functions/_lib',
         'finance-p03/final/baseline-source/functions/_lib']
for folder in folders:
    base=OLD/'docs/migration-evidence'/folder
    for src in sorted(base.glob('*')):
        assert src.suffix in ['.mjs','.js'],src
        dest=E/'historical-baselines'/folder/src.name
        dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists()
        shutil.copy2(src,dest);assert sha(src)==sha(dest)
        copies.append(dict(source=str(src),dest=dest.relative_to(ROOT).as_posix(),sha256=sha(dest)))
replacements=[]
for name,src,folder in [
    ('clearing-migration','qa/finance-p03/final/clearing-migration.mjs',folders[0]),
    ('correction-migration','qa/finance-p03/final/correction-migration.mjs',folders[1]),
    ('migration','qa/finance-p03/final/migration.mjs',folders[2])]:
    dest=OUT/(name+'.mjs')
    adapters.append(adapt_js(src,dest,[('docs/migration-evidence/'+folder,
        'docs/migration-evidence/aeris-finance-quality/historical-baselines/'+folder)]))
    replacements.append((src,str(dest).replace('\\','/')))
redirect=OUT/'output-redirect.mjs'
adapters.append(adapt_js('qa/finance-p04/output-redirect.mjs',redirect,[
    ('docs/migration-evidence/finance-p04','docs/migration-evidence/aeris-finance-quality')]))
src=E/'drivers/node.py';text=src.read_text();original=text
for old,new in replacements+[('./qa/finance-p04/output-redirect.mjs',redirect.as_uri())]:
    assert old in text,old;text=text.replace(old,new)
dest=E/'drivers/node-r2.py';assert not dest.exists();dest.write_text(text)
adapters.append(dict(source=src.relative_to(ROOT).as_posix(),source_sha256=sha(src),dest=dest.relative_to(ROOT).as_posix(),dest_sha256=sha(dest)))
# The native/full orchestration joins the independently started Node cohort.
text=(E/'drivers/regression.py').read_text()
text=text.replace("BASE=E/args.label;BASE.mkdir(exist_ok=False)","BASE=E/args.label;BASE.mkdir(exist_ok=True)")
text=text.replace((E/'drivers/node.py').as_posix(),(E/'drivers/node-r2.py').as_posix())
# Keep persistent runtime files inside this run's evidence namespace as well.
text=text.replace("'FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json')",
    "'FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json'),'FINANCE_P03_PERSIST_RUNTIME_ROOT':str(E/'native-persist-r2')")
dest=E/'drivers/regression-r2.py';assert not dest.exists();dest.write_text(text)
write(OUT/'provenance.json',dict(copies=copies,adapters=adapters,original_oracles_modified=False,first_run_failures_preserved=True))
print(json.dumps(dict(status='PASS',copied_historical_modules=len(copies),adapters=len(adapters))))
