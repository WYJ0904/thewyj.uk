"""CI-side readiness and hosted Preview probes, with no Production mutations.

Success means an evidence report was produced, never release approval. Missing
credentials and unsuccessful hosted gates remain explicitly BLOCKED. Original
signing inputs are used only by the separate boolean discovery invocation.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
KEYS = ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'WYJ_TASK25_ADMIN_SESSION',
        'THEWYJ_ANDROID_KEYSTORE_B64', 'THEWYJ_ANDROID_KEYSTORE_PASSWORD',
        'THEWYJ_ANDROID_KEY_ALIAS', 'THEWYJ_ANDROID_KEY_PASSWORD')
DEFAULT_ORIGIN = 'https://codex-task25-flags-release-c.thewyj-uk.pages.dev'
# Existing project's account, recorded by its successful Pages Git check.
PAGES_ACCOUNT = '97c274a981e8dd6703aa6388e11c4614'


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def child_env(allowed=()):
    return {key: value for key, value in os.environ.items() if key not in KEYS or key in allowed}


def command(args, env=None, timeout=180):
    try:
        return subprocess.run(args, cwd=ROOT, env=env or child_env(),
                              capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def public_json(origin, route):
    result = command(['curl', '--silent', '--show-error', '--max-time', '40',
                      '--write-out', '\n%{http_code}', origin + route])
    if not result or result.returncode:
        return {'http_status': None, 'body': None}
    body, _, code = result.stdout.rpartition('\n')
    try:
        return {'http_status': int(code), 'body': json.loads(body)}
    except ValueError:
        return {'http_status': None, 'body': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover-only', action='store_true')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--origin', default=os.environ.get('TASK25_PREVIEW_ORIGIN', DEFAULT_ORIGIN))
    args = parser.parse_args()
    origin = args.origin
    url = urlsplit(origin)
    if (url.scheme != 'https' or not url.hostname or not url.hostname.endswith('.thewyj-uk.pages.dev') or
            url.netloc != url.hostname or url.path or url.query or url.fragment):
        parser.error('Use only an existing thewyj-uk Pages Preview origin; no request performed')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if os.environ.get('TASK25_EXPECTED_SOURCE', head) != head:
        parser.error('Checkout differs from pinned source; no request performed')
    out = args.output_dir.resolve()
    # Keep evidence away from source and protected release files.
    if out == ROOT or ROOT in out.parents and not out.is_relative_to(ROOT / 'artifacts'):
        parser.error('Use artifacts/ or an output directory outside the checkout')
    out.mkdir(parents=True, exist_ok=True)
    if args.discover_only:
        presence = {key: bool(os.environ.get(key)) for key in KEYS}
        discovery = {'source_commit': head, 'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'credential_presence': presence, 'cloud_ready': presence[KEYS[0]],
                     'account_id_source': 'configured' if presence[KEYS[1]] else 'existing_pages_project_account',
                     'admin_session_present': presence[KEYS[2]], 'original_signing_inputs_present': all(presence[key] for key in KEYS[3:]),
                     'credential_validity_verified': False, 'release_acceptance': 'NOT_EXECUTED'}
        write(out / 'credential-presence.json', discovery)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
                stream.write('cloud_ready=' + str(discovery['cloud_ready']).lower() + '\n')
                stream.write('admin_ready=' + str(discovery['admin_session_present']).lower() + '\n')
        print(json.dumps(discovery, indent=2))
        return
    discovery = json.loads((out / 'credential-presence.json').read_text())
    if discovery['source_commit'] != head:
        parser.error('Credential discovery belongs to a different source')
    stable = json.loads((ROOT / 'android/release-metadata.json').read_text())
    if stable['versionName'] != '1.3.33' or stable['versionCode'] != 46:
        parser.error('Stable baseline changed; stop preflight')
    report = {'source_commit': head, 'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'preview_origin': origin, 'readiness_execution': 'COMPLETED', 'release_acceptance': 'BLOCKED',
              'credential_presence': discovery['credential_presence'], 'production_migration': 'NOT_EXECUTED',
              'production_deployment': 'NOT_EXECUTED', 'signed_candidate': 'NOT_EXECUTED',
              'physical_device_acceptance': 'NOT_EXECUTED', 'stable_pointer_modified': False,
              'real_user_data_modified': False, 'gates': {}}
    prod = {route: public_json('https://thewyj.uk', route) for route in
            ('/api/status', '/api/app/config', '/api/features', '/api/release-channel')}
    app = (prod['/api/app/config']['body'] or {}).get('app', {})
    expected = {'application_id': stable['applicationId'], 'latest_version_name': stable['versionName'],
                'latest_version_code': stable['versionCode'], 'minimum_version_code': stable['minimumVersionCode'],
                'apk_file_name': stable['apkFileName'], 'apk_sha256': stable['apkSha256'], 'apk_size_bytes': stable['apkSizeBytes'],
                'release_date': stable['releaseDate'], 'release_notes_build': stable['releaseBuild'],
                'release_notes': stable['releaseNotes'], 'download_url': 'https://thewyj.uk/api/app/download'}
    preserved = prod['/api/status']['http_status'] == 200 and (prod['/api/status']['body'] or {}).get('environment') == 'production' and all(app.get(k) == v for k, v in expected.items())
    write(out / 'production-public-readonly.json', {'observations': prod, 'stable_baseline_matches': preserved})
    report['gates']['production_existing_readonly'] = 'PASS' if preserved else 'BLOCKED_BASELINE_NOT_ESTABLISHED'
    result = command([sys.executable, 'qa/task25/remote-download-smoke.py', '--environment', 'preview',
                      '--origin', origin, '--output', str(out / 'preview-download.json')], timeout=480)
    report['gates']['preview_apk_download'] = 'PASS' if result and result.returncode == 0 else 'BLOCKED_DOWNLOAD'
    preview_boundary = True
    cloud = child_env(KEYS[:2])
    cloud['CLOUDFLARE_ACCOUNT_ID'] = cloud.get('CLOUDFLARE_ACCOUNT_ID') or PAGES_ACCOUNT
    account = cloud['CLOUDFLARE_ACCOUNT_ID']
    account_valid = bool(re.fullmatch(r'[a-f0-9]{32}', account))
    if discovery['cloud_ready'] and account_valid:
        with tempfile.TemporaryDirectory(prefix='task25-cloudflare-headers-') as directory:
            headers = Path(directory) / 'headers'
            headers.touch(mode=0o600)
            headers.write_text('Authorization: Bearer ' + cloud['CLOUDFLARE_API_TOKEN'] + '\n')
            result = command(['curl', '--silent', '--show-error', '--max-time', '40', '--header', '@' + str(headers),
                              'https://api.cloudflare.com/client/v4/accounts/' + account + '/pages/projects/thewyj-uk'], env=child_env())
            try:
                data = json.loads(result.stdout) if result and result.returncode == 0 else {}
                project = data.get('result') if data.get('success') else None
                if not project or project.get('name') != 'thewyj-uk':
                    raise ValueError('Project not established')
                configs = {}
                for environment in ('production', 'preview'):
                    config = project.get('deployment_configs', {}).get(environment, {})
                    configs[environment] = {'d1_bindings': config.get('d1_databases', {}),
                        'r2_bindings': config.get('r2_buckets', {}),
                        'public_release_vars': {key: value.get('value') for key, value in config.get('env_vars', {}).items()
                            if key in ('ANDROID_APK_KEY', 'ANDROID_APK_SHA256', 'ANDROID_APK_SIZE_BYTES',
                                       'ANDROID_LATEST_VERSION_CODE', 'ANDROID_LATEST_VERSION_NAME', 'TASK25_FEATURE_FLAGS_ENABLED')
                            and value.get('type') == 'plain_text'}}
                deployment = project.get('canonical_deployment') or {}
                production_db = configs['production']['d1_bindings'].get('WYJ_DB', {}).get('id')
                preview_db = configs['preview']['d1_bindings'].get('WYJ_DB', {}).get('id')
                production_bucket = configs['production']['r2_bindings'].get('WYJ_STORAGE', {}).get('name')
                preview_bucket = configs['preview']['r2_bindings'].get('WYJ_STORAGE', {}).get('name')
                preview_boundary = not ((production_db and production_db == preview_db) or
                                        (production_bucket and production_bucket == preview_bucket))
                write(out / 'cloudflare-project-readonly.json', {'account_id': account, 'project': project['name'],
                    'active_production_deployment_id': deployment.get('id'), 'deployment_configs': configs,
                    'active_source_commit': deployment.get('deployment_trigger', {}).get('metadata', {}).get('commit_hash'),
                    'secret_values_persisted': False, 'review_required': True})
                report['gates']['cloudflare_project_configuration'] = 'EXECUTED_REVIEW_REQUIRED' if preview_boundary else 'BLOCKED_PREVIEW_PRODUCTION_BINDING_COLLISION'
            except (ValueError, TypeError, AttributeError):
                report['gates']['cloudflare_project_configuration'] = 'BLOCKED_PROJECT_READ'
        for name, cmd in [('production_d1_schema', ['d1', 'execute', 'WYJ_DB', '--env', 'production', '--remote',
                            '--file', 'cloudflare/task25-production-preflight.sql', '--json']),
                          ('production_d1_migration_ledger', ['d1', 'migrations', 'list', 'WYJ_DB', '--env', 'production', '--remote'])]:
            result = command(['npx', '--no-install', 'wrangler'] + cmd, env=cloud)
            # These commands return only schema/ledger metadata, never business records.
            if result and result.returncode == 0:
                write(out / (name + '.json'), {'output': result.stdout, 'review_required': True})
                report['gates'][name] = 'EXECUTED_REVIEW_REQUIRED'
            else:
                report['gates'][name] = 'BLOCKED_REMOTE_READ'
        with tempfile.TemporaryDirectory(prefix='task25-r2-readonly-') as directory:
            apk = Path(directory) / 'preview-stable.apk'
            result = command(['npx', '--no-install', 'wrangler', 'r2', 'object', 'get',
                              'wyj-cloud-preview/' + stable['apkKey'], '--remote', '--file', str(apk)], env=cloud)
            r2 = {'acceptance': 'BLOCKED_REMOTE_READ', 'object_key': stable['apkKey'], 'bucket': 'wyj-cloud-preview',
                  'upload_performed': False, 'private_object_metadata_verified': False}
            if result and result.returncode == 0 and apk.is_file():
                r2.update(size_bytes=apk.stat().st_size, sha256=hashlib.sha256(apk.read_bytes()).hexdigest())
                r2['bytes_match_existing_stable'] = r2['size_bytes'] == stable['apkSizeBytes'] and r2['sha256'] == stable['apkSha256']
                r2['acceptance'] = 'BYTES_READ_REVIEW_REQUIRED' if r2['bytes_match_existing_stable'] else 'BLOCKED_METADATA_MISMATCH'
                if r2['bytes_match_existing_stable']:
                    sys.path.insert(0, str(ROOT))
                    from scripts.stage_android_candidate import android_tool, EXPECTED_CERTIFICATE
                    try:
                        badging = command([android_tool('aapt2'), 'dump', 'badging', str(apk)])
                        signature = command([android_tool('apksigner'), 'verify', '--print-certs', str(apk)])
                        certificates = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$', signature.stdout, re.MULTILINE) if signature else []
                        r2['signature_original_verified'] = bool(signature and signature.returncode == 0 and certificates == [EXPECTED_CERTIFICATE])
                        r2['package_version_verified'] = bool(badging and badging.returncode == 0 and
                            "name='uk.thewyj.app' versionCode='46' versionName='1.3.33'" in badging.stdout.splitlines()[0])
                        r2['acceptance'] = 'PASS_EXISTING_STABLE_READBACK' if r2['signature_original_verified'] and r2['package_version_verified'] else 'BLOCKED_SIGNATURE_OR_PACKAGE'
                    except (ValueError, OSError, IndexError):
                        r2['acceptance'] = 'BLOCKED_ANDROID_VERIFIER_UNAVAILABLE'
            write(out / 'preview-r2-readback.json', r2)
            report['gates']['preview_r2_object'] = r2['acceptance']
    else:
        report['gates']['cloudflare_d1_r2'] = 'BLOCKED_CLOUDFLARE_ACCOUNT_CONFIG' if discovery['cloud_ready'] else 'BLOCKED: CLOUDFLARE ADMIN TOKEN'
    if discovery['admin_session_present'] and preserved and preview_boundary:
        admin_env = child_env((KEYS[2],))
        result = command([sys.executable, 'qa/task25/remote-admin-smoke.py', '--environment', 'preview',
                          '--origin', origin, '--output', str(out / 'preview-admin-api.json')], env=admin_env, timeout=600)
        report['gates']['preview_admin_api'] = 'PASS' if result and result.returncode == 0 else 'BLOCKED_ADMIN_API'
        chrome = next((shutil.which(name) for name in ('google-chrome', 'chromium', 'chromium-browser') if shutil.which(name)), None)
        report['gates']['preview_admin_ui'] = 'BLOCKED_BROWSER_UNAVAILABLE'
        if chrome:
            with tempfile.TemporaryDirectory(prefix='task25-hosted-chrome-') as directory:
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
                process = subprocess.Popen([chrome, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
                    '--no-first-run', '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
                    '--remote-debugging-port=' + str(port), '--user-data-dir=' + directory, 'about:blank'],
                    env=child_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    cdp = 'http://127.0.0.1:' + str(port)
                    for _ in range(40):
                        ready = command(['curl', '--silent', '--fail', '--max-time', '1', cdp + '/json/version'])
                        if ready and ready.returncode == 0: break
                        time.sleep(0.25)
                    result = command(['node', 'qa/task25/remote-admin-ui-smoke.mjs', '--environment', 'preview',
                                      '--origin', origin, '--output', str(out / 'preview-admin-ui.json')],
                                     env={**admin_env, 'WYJ_CDP_URL': cdp}, timeout=600)
                    report['gates']['preview_admin_ui'] = 'PASS' if result and result.returncode == 0 else 'BLOCKED_ADMIN_UI'
                finally:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)
    else:
        report['gates']['preview_admin_api'] = report['gates']['preview_admin_ui'] = ('BLOCKED: ADMIN SESSION' if not discovery['admin_session_present'] else
            'BLOCKED_PREVIEW_PRODUCTION_BINDING_COLLISION' if not preview_boundary else 'BLOCKED_BASELINE_NOT_ESTABLISHED')
    report['gates']['production_signing'] = 'INPUTS_PRESENT_NOT_VERIFIED' if discovery['original_signing_inputs_present'] else 'BLOCKED: PRODUCTION SIGNING CREDENTIALS'
    sdk = os.environ.get('ANDROID_SDK_ROOT') or os.environ.get('ANDROID_HOME', '/workspace/android-sdk')
    adb = shutil.which('adb') or str(Path(sdk) / 'platform-tools/adb')
    result = command([adb, 'devices', '-l'], timeout=30)
    report['adb_observation'] = {'command_exit': result.returncode if result else None,
                                 'output': result.stdout.strip() if result else 'ADB_UNAVAILABLE',
                                 'physical_identity_verified': False}
    report['gates']['physical_samsung'] = 'BLOCKED / NOT EXECUTED'
    report['ordering_dependency'] = 'PRODUCTION_FLAGS_CHANNELS_REQUIRED_BEFORE_FULL_PHYSICAL_ACCEPTANCE' if all(prod[r]['http_status'] == 404 for r in ('/api/features', '/api/release-channel')) else 'REQUIRES_RELEASE_PLAN_REVIEW'
    write(out / 'hosted-preflight.json', report)
    print(json.dumps(report, indent=2))
    if not preserved:
        raise SystemExit('Production baseline not established; report saved, no Production write performed')


if __name__ == '__main__':
    main()
