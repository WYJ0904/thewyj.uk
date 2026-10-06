"""Record an unreleased candidate; never writes Stable configuration or objects."""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--apk', type=Path, required=True)
parser.add_argument('--aab', type=Path, required=True)
parser.add_argument('--version-name', required=True)
parser.add_argument('--version-code', type=int, required=True)
parser.add_argument('--signing-status', choices=['unsigned', 'verified'], required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
stable_path = Path(__file__).resolve().parent.parent / 'android/release-metadata.json'
stable = json.loads(stable_path.read_text())
if args.output.resolve() in {stable_path.resolve(), (stable_path.parent.parent / 'wrangler.jsonc').resolve()}:
    parser.error('Candidate output must not replace Stable metadata')
if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}', args.version_name) or args.version_code <= stable['versionCode']:
    parser.error('Candidate version must advance beyond Stable')

def artifact(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'fileName': path.name, 'sha256': digest, 'sizeBytes': path.stat().st_size}

result = {
    'applicationId': 'uk.thewyj.app', 'versionName': args.version_name, 'versionCode': args.version_code,
    'status': 'unreleased', 'channel': 'candidate', 'signingStatus': args.signing_status,
    'expectedCertificateSha256': '2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03',
    'physicalDeviceAcceptance': 'NOT_EXECUTED', 'stablePromotionAllowed': False,
    'stableVersionCode': stable['versionCode'], 'stableApkSha256': stable['apkSha256'],
    'apk': artifact(args.apk), 'aab': artifact(args.aab),
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2) + '\n')
print('Unreleased candidate metadata:', args.output)
