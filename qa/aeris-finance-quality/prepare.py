"""Copy selected original synthetic evidence with immutable SHA provenance."""
from common import *
import shutil

E.mkdir(parents=True, exist_ok=True)
assert git('branch','--show-current') == 'codex/aeris-finance-quality'
assert git('rev-parse','HEAD') == 'c815f19f6a293efe0236a1441ffcac91707d8c1c'
source = OLD/'docs/migration-evidence/finance-p04/convergence'
manifest = json.loads((source/'FINAL_EVIDENCE_MANIFEST.json').read_text())['files']
copies = []
for rel in ['ocr-probe-r2/original.png','ocr-probe-r2/views.json','ocr-probe-r2/result.json',
            'avd/emulator.log','avd/result.json']:
    src = source/rel
    key = str(src.relative_to(OLD)).replace('\\','/')
    assert sha(src) == manifest[key]['sha256'], key
    dest = E/'inherited'/rel
    assert not dest.exists(), 'Preserve previous preparation'
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src,dest)
    assert sha(dest) == sha(src)
    copies.append(dict(source=key,dest=str(dest.relative_to(ROOT)),sha256=sha(dest)))
qa = ROOT/'qa/aeris-finance-quality'
(qa/'sdk/assets').mkdir(parents=True)
shutil.copy2(ROOT/'qa/finance-convergence/ocr-probe/ReferenceOcrProbeTest.kt',qa/'sdk/ReferenceOcrProbeTest.kt')
shutil.copy2(source/'ocr-probe-r2/original.png',qa/'sdk/assets/reference-original.png')
assert sha(qa/'sdk/assets/reference-original.png') == '46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f'
assert sha(qa/'sdk/ReferenceOcrProbeTest.kt') == sha(ROOT/'qa/finance-convergence/ocr-probe/ReferenceOcrProbeTest.kt')
oldlock=json.loads((source/'SOURCE_LOCK.json').read_text())
runtime={name: info['sha256'] for name,info in oldlock['files'].items()
         if name.startswith(('android/','functions/','js/','cloudflare/migrations/')) and (ROOT/name).is_file()}
differences=[n for n,digest in runtime.items() if sha(ROOT/n)!=digest]
assert not differences,differences
write(E/'baseline.json',dict(started_utc=utc(),head=git('rev-parse','HEAD'),
    branch=git('branch','--show-current'),inherited_copies=copies,
    runtime_reference=oldlock['reference'],runtime_files=runtime,runtime_differences=differences,
    external_model_calls=0,phone_operations=0,production_mutations=0,
    source_probe_sha256=sha(qa/'sdk/ReferenceOcrProbeTest.kt'),
    original_pixels_sha256=sha(qa/'sdk/assets/reference-original.png')))
print(json.dumps(dict(status='PASS',copied=len(copies),runtime_files=len(runtime),original_pixels_sha256=sha(qa/'sdk/assets/reference-original.png'))))
