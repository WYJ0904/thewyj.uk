"""Explicitly authorized, no-Activity Samsung SDK probes over synthetic pixels only."""
from common import ROOT, E, SDK, PKG, sha, utc, write
import argparse
import hashlib
import json
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--serial', required=True)
args = parser.parse_args()
assert re.fullmatch(r'[A-Za-z0-9_-]+', args.serial)
OUT = E / 'v62-samsung-sdk'
OUT.mkdir(exist_ok=False)
ADB = str(SDK / 'platform-tools/adb.exe')
record = dict(started_utc=utc(), status='IN_PROGRESS', device_serial_sha256=hashlib.sha256(args.serial.encode()).hexdigest(),
    real_payment_operations=0, private_pages_read=0, screen_captures=0, activity_launches=0,
    sensitive_permissions_granted=0, external_ai_calls=0, commands=[], newly_installed_packages=[])

def adb(*parts, timeout=40):
    p = subprocess.run([ADB, '-P', '5037', '-s', args.serial, *parts], capture_output=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('Scoped ADB command failed: ' + parts[0] + ' (exit ' + str(p.returncode) + ')')
    return p.stdout

def state():
    package = adb('shell', 'dumpsys', 'package', 'uk.thewyj.app').decode(errors='replace')
    version = re.search(r'versionCode=(\d+)', package)
    name = re.search(r'versionName=([^\r\n ]+)', package)
    permission_hashes = {}
    for key in ['enabled_accessibility_services', 'enabled_notification_listeners']:
        raw = adb('shell', 'settings', 'get', 'secure', key).strip()
        permission_hashes[key] = hashlib.sha256(raw).hexdigest()
    return dict(version_code=version.group(1) if version else None, version_name=name.group(1) if name else None,
                sensitive_permission_configuration_sha256=permission_hashes)

def pull_json(remote, destination):
    data = adb('exec-out', 'run-as', PKG, 'cat', 'files/' + remote)
    expected = adb('shell', 'run-as', PKG, 'sha256sum', 'files/' + remote).decode().split()[0]
    assert hashlib.sha256(data).hexdigest() == expected
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return json.loads(data)

before = None
try:
    devices = subprocess.check_output([ADB, '-P', '5037', 'devices']).decode().splitlines()[1:]
    connected = [line.split()[:2] for line in devices if line.strip()]
    assert connected == [[args.serial, 'device']], 'Requires exactly the owner-designated authenticated transport'
    assert adb('shell', 'getprop', 'ro.product.model').strip() == b'SM-S9360'
    assert adb('shell', 'getprop', 'ro.build.version.sdk').strip() == b'36'
    assert adb('shell', 'getprop', 'ro.kernel.qemu').strip() != b'1'
    record.update(model='SM-S9360', api=36, physical_device=True, synthetic_images_only=True)
    before = state(); record['formal_before'] = before
    build = json.loads((E / 'sdk-build-r5/result.json').read_text(encoding='utf-8'))
    assert build['status'] == 'PASS' and build['source_stable']
    for relative, digest in build['source_after'].items():
        assert sha(ROOT / relative) == digest, 'Archived SDK APK no longer matches current diagnostic/product sources'
    record['build_evidence'] = 'sdk-build-r5/result.json'
    for item in build['artifacts']:
        package = item['package']
        assert package in [PKG, PKG + '.test'] and package != 'uk.thewyj.app'
        existing = adb('shell', 'pm', 'list', 'packages', '--user', '0', package).decode().splitlines()
        assert 'package:' + package not in existing, 'Pre-existing QA data is preserved; no replacement or cleanup assumed'
        artifact = ROOT / item['path']; assert sha(artifact) == item['sha256']
    for item in build['artifacts']:
        assert b'Success' in adb('install', '-t', str(ROOT / item['path']), timeout=180)
        record['newly_installed_packages'].append(item['package'])
        write(OUT / 'result.json', record)
    for label, method in [
        ('cold', 'ReferenceOcrProbeTest#degradedReferencesNeverBypassExactSourceBinding'),
        ('ready-then-original', 'RawOcrDiagnosticTest#directSdkThenUnchangedOracles')]:
        started = utc()
        command = [ADB, '-P', '5037', '-s', args.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
                   'uk.thewyj.app.task21.payment.' + method, PKG + '.test/androidx.test.runner.AndroidJUnitRunner']
        with (OUT / (label + '.log')).open('xb') as stream:
            process = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, timeout=180)
        log = (OUT / (label + '.log')).read_text(encoding='utf-8', errors='replace')
        record['commands'].append(dict(method=method, started_utc=started, finished_utc=utc(),
            exit_code=process.returncode, junit_pass=process.returncode == 0 and 'OK (1 test)' in log))
        corpus = pull_json('reference-corpus/results.json', OUT / label / 'corpus.json')
        record[label] = dict(cases=len(corpus), safety_pass=sum(row['status'] == 'PASS' for row in corpus),
            decoder_exact=sum(row['decoder_exact'] for row in corpus), ledger_writes=sum(row['ledger_writes'] for row in corpus))
        write(OUT / 'result.json', record)
        assert record['commands'][-1]['junit_pass'], 'Original method failure preserved; no assertion changed'
    direct = pull_json('raw-sdk-diagnostic/direct.json', OUT / 'direct.json')
    views = pull_json('reference-probe-r2/views.json', OUT / 'original/views.json')
    record['direct'] = direct
    expected_reference = 'SYNTH-P06-JOINT-123456'
    # Evaluate whole opaque reference tokens, never substring/fuzzy agreement.
    exact = []
    for row in views:
        candidates = []
        for line in row['lines']:
            if '交易号' in line:
                candidates.append(line.split('交易号', 1)[1].strip().lstrip(':：').strip())
        exact.append(candidates == [expected_reference])
    record['original'] = dict(views=len(views), whole_reference_exact=sum(exact),
        original_pixels_sha256=sha(ROOT / 'qa/aeris-finance-quality/sdk/assets/reference-original.png'))
    record['status'] = 'PROBES_EXECUTED_NOT_BUSINESS_ACCEPTANCE'
except Exception as error:
    record.update(status='FAIL_OR_BLOCKED', error_type=type(error).__name__, error=str(error)[:350])
finally:
    # Only packages proved absent before this run can be removed, after pulling
    # all QA-only evidence. No permission change, app-data clear or formal stop.
    for package in reversed(record['newly_installed_packages']):
        try:
            assert b'Success' in adb('uninstall', package, timeout=90)
            record.setdefault('removed_new_qa_packages', []).append(package)
        except Exception as error:
            record.setdefault('cleanup_errors', []).append(type(error).__name__)
    if before:
        record['formal_after'] = state()
        record['formal_state_unchanged'] = record['formal_after'] == before
    record['finished_utc'] = utc()
    write(OUT / 'result.json', record)
    print(json.dumps({key: record.get(key) for key in ['status', 'model', 'cold', 'ready-then-original', 'original', 'formal_state_unchanged', 'removed_new_qa_packages', 'error_type', 'error']}))
