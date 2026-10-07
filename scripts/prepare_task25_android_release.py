"""Prepare consistent release files OUTSIDE the checkout after real release gates.

No upload, deployment, git commit or Stable pointer change is performed. The
acceptance receipt must be backed by reviewed external evidence; this tool
cannot establish physical Samsung acceptance from a JSON declaration.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import sys
import tempfile

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.stage_android_candidate import artifact, ROOT, STABLE_PATH, verify_artifacts

REQUIRED_GATES = ('production_migration', 'production_deployment', 'production_smoke',
    'original_signing', 'samsung_physical', 'ci', 'final_review', 'main_ci')


def validate_receipt(receipt, candidate, readback):
    if not re.fullmatch(r'[0-9a-f]{40}', candidate.get('source_commit', '')):
        raise ValueError('Candidate source SHA missing')
    if receipt.get('source_commit') != candidate['source_commit']:
        raise ValueError('Acceptance receipt is for a different candidate source')
    if candidate.get('signingStatus') != 'verified' or candidate.get('versionName') != '1.3.34' or candidate.get('versionCode') != 47:
        raise ValueError('Only original-signed Task 25 1.3.34/47 is eligible')
    for gate in REQUIRED_GATES:
        item = receipt.get(gate, {})
        if item.get('status') != 'PASS' or not item.get('evidence'):
            raise ValueError(f'Release gate missing actual PASS/evidence: {gate}')
    device = receipt.get('samsung', {})
    if (device.get('manufacturer', '').lower() != 'samsung' or device.get('android_sdk') != 36 or
        device.get('from_version_code') != 46 or device.get('to_version_code') != 47 or
        any(device.get(key) is not True for key in ['physical', 'in_place', 'data_preserved', 'session_preserved'])):
        raise ValueError('Physical Samsung Android 16 in-place upgrade evidence incomplete')
    r2 = receipt.get('r2', {})
    if (r2.get('bucket') != 'wyj-cloud-production' or r2.get('key') != 'app/android/thewyj-android-1.3.34.apk' or
        r2.get('readback_sha256') != readback['sha256'] or r2.get('readback_size_bytes') != readback['sizeBytes'] or
        readback['sha256'] != candidate['apk']['sha256'] or readback['sizeBytes'] != candidate['apk']['sizeBytes']):
        raise ValueError('New immutable Production R2 object readback is not the exact signed candidate')


def proposed_configuration(stable, config, candidate, date, build, notes):
    result = {**stable, 'versionName': '1.3.34', 'versionCode': 47, 'releaseDate': date,
        'releaseBuild': build, 'releaseNotes': notes, 'apkFileName': 'thewyj-android-1.3.34.apk',
        'apkKey': 'app/android/thewyj-android-1.3.34.apk', 'apkSha256': candidate['apk']['sha256'],
        'apkSizeBytes': candidate['apk']['sizeBytes']}
    fields = {'ANDROID_LATEST_VERSION_CODE': 'versionCode', 'ANDROID_LATEST_VERSION_NAME': 'versionName',
        'ANDROID_RELEASE_DATE': 'releaseDate', 'ANDROID_RELEASE_BUILD': 'releaseBuild', 'ANDROID_RELEASE_NOTES': 'releaseNotes',
        'ANDROID_APK_FILE_NAME': 'apkFileName', 'ANDROID_APK_KEY': 'apkKey', 'ANDROID_APK_SHA256': 'apkSha256', 'ANDROID_APK_SIZE_BYTES': 'apkSizeBytes'}
    updated = json.loads(json.dumps(config))
    for values in [updated['vars'], updated['env']['preview']['vars'], updated['env']['production']['vars']]:
        for key, field in fields.items(): values[key] = str(result[field])
    return result, updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['candidate-metadata', 'acceptance', 'apk', 'aab', 'r2-readback', 'release-notes-file', 'output-dir']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--release-date', required=True)
    parser.add_argument('--release-build', required=True)
    args = parser.parse_args()
    destination = args.output_dir.resolve()
    if destination == ROOT or ROOT in destination.parents or destination.exists():
        parser.error('Output must be a new directory outside the checkout')
    try:
        datetime.date.fromisoformat(args.release_date)
        if not re.fullmatch(r'[a-zA-Z0-9._-]{1,80}', args.release_build): raise ValueError('Invalid release build')
        notes = args.release_notes_file.read_text().strip()
        if not notes or len(notes) > 400: raise ValueError('Release notes must fit the API contract')
        candidate = json.loads(args.candidate_metadata.read_text())
        validate_receipt(json.loads(args.acceptance.read_text()), candidate, artifact(args.r2_readback))
        for field in ['apk', 'aab']:
            actual = artifact(getattr(args, field))
            if any(actual[key] != candidate[field][key] for key in ['sha256', 'sizeBytes']):
                raise ValueError('Artifact differs from candidate metadata')
        verify_artifacts(args.apk, args.aab, '1.3.34', 47, 'verified')
        stable = json.loads(STABLE_PATH.read_text())
        if stable['versionName'] != '1.3.33' or stable['versionCode'] != 46:
            raise ValueError('Stable baseline drift; reconcile before preparing release')
        metadata, config = proposed_configuration(stable, json.loads((ROOT / 'wrangler.jsonc').read_text()), candidate,
            args.release_date, args.release_build, notes)
        gradle, code_count = re.subn(r'versionCode\s*=\s*46\b', 'versionCode = 47', (ROOT / 'android/app/build.gradle.kts').read_text(), count=1)
        gradle, name_count = re.subn(r'versionName\s*=\s*"1\.3\.33"', 'versionName = "1.3.34"', gradle, count=1)
        if code_count != 1 or name_count != 1: raise ValueError('Gradle Stable baseline drift')
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='task25-proposal-', dir=destination.parent) as directory:
        staging = Path(directory) / 'proposal'
        (staging / 'android/app').mkdir(parents=True)
        (staging / 'android/release-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
        (staging / 'wrangler.jsonc').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
        (staging / 'android/app/build.gradle.kts').write_text(gradle)
        staging.rename(destination)
    print('Reviewable release proposal only:', destination)
    print('No R2 upload/deployment/Stable pointer change performed. Preview requires independent bucket readback before applying its proposal.')


if __name__ == '__main__':
    main()
