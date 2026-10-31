"""Keep exact compiled privacy-QA inputs before deleting rebuildable trees."""
from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
dest=OUT/'artifacts/exact-qa-inputs';dest.mkdir(exist_ok=False)
generated=OUT/'qa-generated';overlay=json.loads((OUT/'source-overlay.json').read_text())
for name,row in overlay['files'].items():
    p=OUT/'build-sources/main'/Path(name).relative_to('android/app/src/main/java')
    assert sha(ROOT/name)==row['product_sha256'] and sha(p)==row['qa_sha256']
with zipfile.ZipFile(dest/'qa-generated.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in generated.rglob('*'):
        if p.is_file():z.write(p,p.relative_to(generated).as_posix())
with zipfile.ZipFile(dest/'privacy-source-overlays.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name,row in overlay['qa_only_changes'].items():
        z.write(ROOT/row['copy'],name)
ca=OUT/'generated-res/raw/p03_device_ca.pem';shutil.copy2(ca,dest/ca.name)
result={'code_baseline':'1e04945d1964c0e6a9420b0aff99011001f4ab98','compiled_product_sources':len(overlay['files']),
    'unchanged_main_activity':overlay['files']['android/app/src/main/java/uk/thewyj/app/MainActivity.kt']['product_sha256']==overlay['files']['android/app/src/main/java/uk/thewyj/app/MainActivity.kt']['qa_sha256'],
    'source_overlays':list(overlay['qa_only_changes']),'generated_source_sha256':{p.relative_to(generated).as_posix():sha(p) for p in generated.rglob('*') if p.is_file()},
    'archive_sha256':{p.name:sha(p) for p in dest.iterdir() if p.is_file()},'ca_scope':'App-specific localhost QA CA only, no installed system trust',
    'privacy_boundary':'No private notification/window extras; no MediaStore/SMS/screenshot capability; loopback-only WebView',
    'source_generator':'qa/finance-p03/finish/prepare-device.py (final reproducible namespace and label changes included)'}
(OUT/'qa-generation-final.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
patch=subprocess.check_output(['git','diff','--','functions/_lib/task21-provider-evidence.mjs','js/finance/app.js'],cwd=ROOT)
(OUT/'product-diff.patch').write_bytes(patch)
print(json.dumps({k:result[k] for k in ['compiled_product_sources','unchanged_main_activity','archive_sha256']}))
