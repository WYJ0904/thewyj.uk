"""Bind actual SDK, final JVM/APK and current product bytes without equating APKs."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json

ROOT = Path(__file__).resolve().parents[3]
E = ROOT / 'docs/migration-evidence/finance-p04/non-device-closeout'
OUT = E / 'source-binding.json'
assert not OUT.exists()
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
sdk = read(E / 'emulator-r3/result.json')
full = read(E / 'final-r1/android-current/command.json')
e2e = read(E / 'e2e-r2/result.json')
assert sdk['source_stable'] and full['source_stable'] and e2e['sdk_product_source_identical']
final = full['source_after']['files']
product = {n: d for n, d in final.items() if n.startswith('android/app/src/main/')
           or n.endswith(('.gradle', '.gradle.kts', 'gradle.properties', 'gradle-wrapper.properties'))}
assert product
for name, digest in product.items():
    assert sdk['source_before'].get(name) == sdk['source_after'].get(name) == digest, name
    assert sha(ROOT / name) == digest, name
for artifact in full['artifacts']:
    assert sha(ROOT / artifact['path']) == artifact['sha256'], artifact['path']
test_apk = read(E / 'final-r1/android-test-build-current/artifact.json')
assert sha(ROOT / test_apk['path']) == test_apk['sha256']
nonidentical = sorted(n for n in sdk['source_after'].keys() | final.keys()
                      if n.startswith('android/') and sdk['source_after'].get(n) != final.get(n))
assert all(n.startswith('android/app/src/test/') for n in nonidentical), nonidentical
scope_difference = sorted(sdk['source_after'].keys() ^ final.keys())
for name in sdk['source_after'].keys() & final.keys():
    assert sdk['source_after'][name] == final[name], name
result = dict(checked_utc=datetime.now(timezone.utc).isoformat(), status='PASS',
              sdk_head=sdk['head'], full_head=full['head'], synthetic_e2e_head=e2e['head'],
              identical_product_files=len(product), product_files=product,
              differing_android_test_files=nonidentical, manifest_scope_differences=scope_difference,
              artifacts=full['artifacts'],
              android_test_apk=test_apk, apk_byte_equality_claimed=False,
              physical_device_or_production_proof=False)
OUT.write_text(json.dumps(result, indent=2))
print(json.dumps({k: v for k, v in result.items() if k not in ['product_files', 'artifacts', 'android_test_apk']}))
