"""Verify and record an unreleased candidate without changing Stable."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
STABLE_PATH = ROOT / 'android/release-metadata.json'
EXPECTED_CERTIFICATE = '2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03'


def validate_version(name, code, stable):
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}', name):
        raise ValueError('Invalid candidate versionName')
    parts = lambda value: tuple(map(int, value.split('.'))) + (0,) * (4 - len(value.split('.')))
    if code <= stable['versionCode'] or parts(name) <= parts(stable['versionName']):
        raise ValueError('Candidate versionName and versionCode must both advance beyond Stable')


def validate_origin(origin):
    value = urlsplit(origin)
    if (value.scheme != 'https' or not value.hostname or value.username or value.password or
            value.path not in ('', '/') or value.query or value.fragment or value.netloc != value.hostname or
            not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', value.hostname) or
            origin not in ('https://' + value.hostname, 'https://' + value.hostname + '/')):
        raise ValueError('Candidate backend must be a plain HTTPS origin')


def run_tool(command):
    completed = subprocess.run(command, capture_output=True, text=True, env={**os.environ, 'LC_ALL': 'C'})
    if completed.returncode:
        raise ValueError(f'{Path(command[0]).name} rejected candidate')
    return completed.stdout + completed.stderr


def android_tool(name):
    sdk = os.environ.get('ANDROID_SDK_ROOT') or os.environ.get('ANDROID_HOME')
    if sdk:
        candidates = list((Path(sdk) / 'build-tools').glob('*/' + name))
        if candidates:
            return str(max(candidates, key=lambda p: tuple(map(int, re.findall(r'\d+', p.parent.name)))))
    found = shutil.which(name)
    if not found:
        raise ValueError(f'Android build-tools {name} unavailable')
    return found


def verify_artifacts(apk, aab, name, code, signing_status, runner=run_tool):
    lines = runner([android_tool('aapt2'), 'dump', 'badging', str(apk)]).splitlines()
    if not lines:
        raise ValueError('Candidate APK manifest unavailable')
    badging = lines[0]
    for field in ("name='uk.thewyj.app'", f"versionCode='{code}'", f"versionName='{name}'"):
        if field not in badging:
            raise ValueError('Candidate APK package/version mismatch')
    if signing_status != 'verified':
        return {'actualPackageBadging': badging}
    certificates = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$',
        runner([android_tool('apksigner'), 'verify', '--print-certs', str(apk)]), re.MULTILINE)
    if certificates != [EXPECTED_CERTIFICATE]:
        raise ValueError('APK signing identity differs from original Stable identity')
    jar_result = runner(['jarsigner', '-verify', '-verbose', '-certs', str(aab)])
    if 'jar verified.' not in jar_result or 'unsigned entries' in jar_result:
        raise ValueError('AAB is unsigned or contains unsigned entries')
    bundle_certificates = [value.replace(':', '').lower() for value in re.findall(
        r'SHA256:\s*([0-9A-Fa-f:]+)', runner(['keytool', '-printcert', '-jarfile', str(aab)]))]
    if bundle_certificates != [EXPECTED_CERTIFICATE]:
        raise ValueError('AAB signing identity differs from original Stable identity')
    return {'actualPackageBadging': badging, 'certificateSha256': EXPECTED_CERTIFICATE,
            'apkSignatureVerified': True, 'aabSignatureVerified': True}


def artifact(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'fileName': path.name, 'sha256': digest, 'sizeBytes': path.stat().st_size}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--aab', type=Path, required=True)
    parser.add_argument('--version-name', required=True)
    parser.add_argument('--version-code', type=int, required=True)
    parser.add_argument('--signing-status', choices=['unsigned', 'verified'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stable = json.loads(STABLE_PATH.read_text())
    if args.output.resolve() in {STABLE_PATH.resolve(), (ROOT / 'wrangler.jsonc').resolve()}:
        parser.error('Candidate output must not replace Stable metadata')
    try:
        validate_version(args.version_name, args.version_code, stable)
        verification = verify_artifacts(args.apk, args.aab, args.version_name, args.version_code, args.signing_status)
    except ValueError as error:
        parser.error(str(error))
    source = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    result = {
        'applicationId': 'uk.thewyj.app', 'versionName': args.version_name, 'versionCode': args.version_code,
        'status': 'unreleased', 'channel': 'candidate', 'signingStatus': args.signing_status,
        'expectedCertificateSha256': EXPECTED_CERTIFICATE, 'source_commit': source,
        'physicalDeviceAcceptance': 'NOT_EXECUTED', 'stablePromotionAllowed': False,
        'stableVersionCode': stable['versionCode'], 'stableApkSha256': stable['apkSha256'],
        'apk': artifact(args.apk), 'aab': artifact(args.aab), **verification,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print('Unreleased candidate metadata:', args.output)


if __name__ == '__main__':
    main()
