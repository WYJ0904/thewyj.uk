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
from scripts.stage_android_candidate import artifact, ROOT, STABLE_PATH, verify_artifacts, validate_version

PREDEPLOY_GATES = ('preview_admin_api', 'preview_admin_ui', 'preview_apk_download', 'cloudflare_d1_preflight')
REQUIRED_GATES = (*PREDEPLOY_GATES, 'production_migration', 'production_deployment', 'production_smoke',
    'original_signing', 'samsung_physical', 'ci', 'final_review', 'main_ci')
# Task 25 ships its own signed APK. Payment/accessibility/OCR and ledger-specific
# hardware investigations are a separate Android patch release, before Task 26.
# Keep these names explicit for that follow-up; never mark them PASS by deferral.
DEFERRED_ANDROID_ACCOUNTING_CHECKS = ('pending_recovery_identity', 'finance_pending',
    'legacy_local_only_recovery', 'notification_finance_sync', 'amount_notification_accounting')
SAMSUNG_CHECKS = ('package_version', 'signing_continuity', 'session_preservation', 'room_data_preservation',
    'back', 'resume', 'cold_start', 'warm_start', 'webview_native_consistency',
    'account_targeting_rollout', 'stable_beta_experimental', 'kill_switch', 'offline_flag_fallback',
    'offline_startup', 'online_to_offline', 'flag_service_unavailable', 'foreground_background', 'webview_reload',
    'process_restoration', 'network_recovery', 'apk_update_metadata', 'release_channel_recognition', 'haptic', 'system_install_permissions')
PRODUCTION_ENTRY_GATES = (*PREDEPLOY_GATES, 'original_signing', 'samsung_physical', 'ci')
COMPATIBLE_SERVER_ENTRY_GATES = (*PREDEPLOY_GATES, 'original_signing', 'samsung_predeployment', 'ci')
SAMSUNG_PREDEPLOY_CHECKS = tuple(check for check in SAMSUNG_CHECKS if check not in (
    'webview_native_consistency', 'account_targeting_rollout', 'stable_beta_experimental', 'kill_switch',
    'offline_flag_fallback', 'flag_service_unavailable', 'release_channel_recognition'))


def production_entry_gates(receipt):
    order = receipt.get('production_gate_order')
    if order is None:
        return PRODUCTION_ENTRY_GATES
    if (order.get('authorization') != 'human_approved_compatible_server_before_channel_acceptance' or
        not order.get('evidence') or order.get('initial_feature_definitions_off') is not True or
        order.get('stable_pointer_unchanged') is not True):
        raise ValueError('Changed Production gate order needs the explicit human authorization and safe defaults')
    return COMPATIBLE_SERVER_ENTRY_GATES


# Freeze Release A to the reviewed Task 25 candidate. The installed local
# bugfix is 1.3.35/48, while the publicly advertised Stable stays 1.3.33/46.
# Never silently fall back to obsolete 1.3.34/47 if a receipt omits its target.
TASK25_RELEASE_TARGET = {'versionName': '1.3.36', 'versionCode': 49,
    'installedVersionName': '1.3.35', 'installedVersionCode': 48}


def release_target(receipt):
    target = receipt.get('release_target')
    if not isinstance(target, dict) or target != TASK25_RELEASE_TARGET:
        raise ValueError('Task 25 needs explicit reviewed 1.3.36/49 from installed 1.3.35/48; no legacy default')
    stable = json.loads(STABLE_PATH.read_text(encoding='utf-8'))
    validate_version(target['versionName'], target['versionCode'], stable)
    if (not isinstance(target['installedVersionCode'], int) or isinstance(target['installedVersionCode'], bool) or
        target['installedVersionCode'] < stable['versionCode'] or target['installedVersionCode'] >= target['versionCode'] or
        not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}', target['installedVersionName'])):
        raise ValueError('Reviewed installed baseline must advance in place to the release target')
    return target


def validate_acceptance(receipt, candidate, gates):
    target = release_target(receipt)
    if not re.fullmatch(r'[0-9a-f]{40}', candidate.get('source_commit', '')):
        raise ValueError('Candidate source SHA missing')
    if receipt.get('source_commit') != candidate['source_commit']:
        raise ValueError('Acceptance receipt is for a different candidate source')
    if candidate.get('signingStatus') != 'verified' or candidate.get('versionName') != target['versionName'] or candidate.get('versionCode') != target['versionCode']:
        raise ValueError('Only the original-signed reviewed Task 25 release target is eligible')
    for gate in gates:
        item = receipt.get(gate, {})
        if item.get('status') != 'PASS' or not item.get('evidence'):
            raise ValueError(f'Release gate missing actual PASS/evidence: {gate}')
    device = receipt.get('samsung', {})
    if (device.get('manufacturer', '').lower() != 'samsung' or device.get('android_sdk') != 36 or
        device.get('from_version_code') != target['installedVersionCode'] or device.get('to_version_code') != target['versionCode'] or
        device.get('before_version') != f"{target['installedVersionName']}/{target['installedVersionCode']}" or
        device.get('after_version') != f"{target['versionName']}/{target['versionCode']}" or
        any(not device.get(key) for key in ['model', 'android_version', 'adb_identity']) or
        any(device.get(key) is not True for key in ['physical', 'in_place', 'data_preserved', 'session_preserved'])):
        raise ValueError('Physical Samsung Android 16 in-place upgrade evidence incomplete')
    checks = SAMSUNG_PREDEPLOY_CHECKS if tuple(gates) == COMPATIBLE_SERVER_ENTRY_GATES else SAMSUNG_CHECKS
    for check in checks:
        item = device.get('checks', {}).get(check, {})
        if item.get('status') != 'PASS' or not item.get('evidence'):
            raise ValueError(f'Physical Samsung observation missing PASS/evidence: {check}')


def validate_receipt(receipt, candidate, readback):
    validate_acceptance(receipt, candidate, REQUIRED_GATES)
    r2 = receipt.get('r2', {})
    if (r2.get('bucket') != 'wyj-cloud-production' or r2.get('key') != f"app/android/thewyj-android-{candidate['versionName']}.apk" or
        r2.get('readback_sha256') != readback['sha256'] or r2.get('readback_size_bytes') != readback['sizeBytes'] or
        readback['sha256'] != candidate['apk']['sha256'] or readback['sizeBytes'] != candidate['apk']['sizeBytes']):
        raise ValueError('New immutable Production R2 object readback is not the exact signed candidate')


def proposed_configuration(stable, config, candidate, date, build, notes):
    result = {**stable, 'versionName': candidate['versionName'], 'versionCode': candidate['versionCode'], 'releaseDate': date,
        'releaseBuild': build, 'releaseNotes': notes, 'apkFileName': f"thewyj-android-{candidate['versionName']}.apk",
        'apkKey': f"app/android/thewyj-android-{candidate['versionName']}.apk", 'apkSha256': candidate['apk']['sha256'],
        'apkSizeBytes': candidate['apk']['sizeBytes']}
    fields = {'ANDROID_LATEST_VERSION_CODE': 'versionCode', 'ANDROID_LATEST_VERSION_NAME': 'versionName',
        'ANDROID_RELEASE_DATE': 'releaseDate', 'ANDROID_RELEASE_BUILD': 'releaseBuild', 'ANDROID_RELEASE_NOTES': 'releaseNotes',
        'ANDROID_APK_FILE_NAME': 'apkFileName', 'ANDROID_APK_KEY': 'apkKey', 'ANDROID_APK_SHA256': 'apkSha256', 'ANDROID_APK_SIZE_BYTES': 'apkSizeBytes'}
    updated = json.loads(json.dumps(config))
    for values in [updated['vars'], updated['env']['preview']['vars'], updated['env']['production']['vars']]:
        for key, field in fields.items(): values[key] = str(result[field])
    return result, updated


def proposed_changelog(source, metadata):
    entry = {'version': metadata['versionName'], 'build': metadata['releaseBuild'], 'date': metadata['releaseDate'],
        'title': '体验通道与版本更新', 'features': [line.lstrip('- ').strip() for line in metadata['releaseNotes'].splitlines() if line.strip()],
        'improvements': [], 'fixes': [], 'security': []}
    marker = 'const entries = ['
    if source.count(marker) != 1 or metadata['releaseBuild'] in source:
        raise ValueError('Changelog baseline drift or duplicate build')
    return source.replace(marker, marker + '\n' + json.dumps(entry, ensure_ascii=False, indent=2) + ',', 1)


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
        verify_artifacts(args.apk, args.aab, candidate['versionName'], candidate['versionCode'], 'verified')
        stable = json.loads(STABLE_PATH.read_text())
        if stable['versionName'] != '1.3.33' or stable['versionCode'] != 46:
            raise ValueError('Stable baseline drift; reconcile before preparing release')
        metadata, config = proposed_configuration(stable, json.loads((ROOT / 'wrangler.jsonc').read_text()), candidate,
            args.release_date, args.release_build, notes)
        changelog = proposed_changelog((ROOT / 'changelog.js').read_text(), metadata)
        gradle, code_count = re.subn(r'versionCode\s*=\s*46\b', f"versionCode = {candidate['versionCode']}", (ROOT / 'android/app/build.gradle.kts').read_text(), count=1)
        gradle, name_count = re.subn(r'versionName\s*=\s*"1\.3\.33"', f'versionName = "{candidate["versionName"]}"', gradle, count=1)
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
        (staging / 'changelog.js').write_text(changelog)
        staging.rename(destination)
    print('Reviewable release proposal only:', destination)
    print('No R2 upload/deployment/Stable pointer change performed. Preview requires independent bucket readback before applying its proposal.')


if __name__ == '__main__':
    main()
