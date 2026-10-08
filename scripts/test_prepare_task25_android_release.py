import copy
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

from scripts.prepare_task25_android_release import REQUIRED_GATES, SAMSUNG_CHECKS, SAMSUNG_PREDEPLOY_CHECKS, DEFERRED_ANDROID_ACCOUNTING_CHECKS, PRODUCTION_ENTRY_GATES, production_entry_gates, proposed_changelog, proposed_configuration, validate_acceptance, validate_receipt
from scripts.stage_android_candidate import ROOT, STABLE_PATH


class ReleaseProposalTests(unittest.TestCase):
    def test_authorized_server_order_keeps_every_final_physical_gate(self):
        self.receipt['production_gate_order'] = {
            'authorization': 'human_approved_compatible_server_before_channel_acceptance',
            'evidence': 'isolated-human-authorization-fixture',
            'initial_feature_definitions_off': True, 'stable_pointer_unchanged': True}
        self.receipt['samsung_predeployment'] = {'status': 'PASS', 'evidence': 'isolated-device-fixture'}
        gates = production_entry_gates(self.receipt)
        for check in set(SAMSUNG_CHECKS) - set(SAMSUNG_PREDEPLOY_CHECKS):
            changed = copy.deepcopy(self.receipt)
            changed['samsung']['checks'][check]['status'] = 'NOT_EXECUTED'
            validate_acceptance(changed, self.candidate, gates)
            with self.subTest(final_check=check), self.assertRaises(ValueError):
                validate_receipt(changed, self.candidate, self.readback)
        for check in SAMSUNG_PREDEPLOY_CHECKS:
            changed = copy.deepcopy(self.receipt)
            changed['samsung']['checks'][check]['status'] = 'NOT_EXECUTED'
            with self.subTest(predeployment_check=check), self.assertRaises(ValueError):
                validate_acceptance(changed, self.candidate, gates)
        for key in ['authorization', 'evidence', 'initial_feature_definitions_off', 'stable_pointer_unchanged']:
            changed = copy.deepcopy(self.receipt)
            del changed['production_gate_order'][key]
            with self.subTest(authorization=key), self.assertRaises(ValueError):
                production_entry_gates(changed)

    def test_integrated_candidate_advances_from_installed_bugfix_without_weakening_gates(self):
        self.candidate.update(versionName='1.3.36', versionCode=49)
        self.receipt['release_target'] = {'versionName': '1.3.36', 'versionCode': 49,
            'installedVersionName': '1.3.35', 'installedVersionCode': 48}
        self.receipt['samsung'].update(from_version_code=48, to_version_code=49,
            before_version='1.3.35/48', after_version='1.3.36/49')
        self.receipt['r2']['key'] = 'app/android/thewyj-android-1.3.36.apk'
        validate_receipt(self.receipt, self.candidate, self.readback)
        for gate in REQUIRED_GATES:
            changed = copy.deepcopy(self.receipt)
            changed[gate]['status'] = 'NOT_EXECUTED'
            with self.subTest(gate=gate), self.assertRaises(ValueError):
                validate_receipt(changed, self.candidate, self.readback)
        for code in (47, 48):
            with self.subTest(downgrade=code), self.assertRaises(ValueError):
                validate_receipt(self.receipt, {**self.candidate, 'versionCode': code}, self.readback)

    def setUp(self):
        self.candidate = {'source_commit': 'a' * 40, 'signingStatus': 'verified', 'versionName': '1.3.36', 'versionCode': 49,
            'apk': {'sha256': 'b' * 64, 'sizeBytes': 1234}}
        self.readback = {'sha256': 'b' * 64, 'sizeBytes': 1234}
        self.receipt = {'source_commit': 'a' * 40,
            'release_target': {'versionName': '1.3.36', 'versionCode': 49,
                'installedVersionName': '1.3.35', 'installedVersionCode': 48},
            **{key: {'status': 'PASS', 'evidence': 'isolated-test-receipt-only'} for key in REQUIRED_GATES},
            'samsung': {'manufacturer': 'Samsung', 'android_sdk': 36, 'from_version_code': 48, 'to_version_code': 49,
                'model': 'isolated-receipt-fixture', 'android_version': '16', 'adb_identity': 'isolated-not-a-device',
                'before_version': '1.3.35/48', 'after_version': '1.3.36/49',
                'checks': {key: {'status': 'PASS', 'evidence': 'isolated-guard-test-only'} for key in SAMSUNG_CHECKS},
                'physical': True, 'in_place': True, 'data_preserved': True, 'session_preserved': True},
            'r2': {'bucket': 'wyj-cloud-production', 'key': 'app/android/thewyj-android-1.3.36.apk',
                'readback_sha256': 'b' * 64, 'readback_size_bytes': 1234}}

    def test_target_must_be_explicit_and_cannot_revert_to_old_candidate(self):
        validate_receipt(self.receipt, self.candidate, self.readback)
        invalid = [None, {}, {'versionName': '1.3.34', 'versionCode': 47,
            'installedVersionName': '1.3.33', 'installedVersionCode': 46},
            {'versionName': '1.3.36', 'versionCode': 49,
             'installedVersionName': '1.3.33', 'installedVersionCode': 46}]
        for target in invalid:
            receipt = copy.deepcopy(self.receipt)
            if target is None:
                del receipt['release_target']
            else:
                receipt['release_target'] = target
            with self.subTest(release_target=target), self.assertRaises(ValueError):
                validate_receipt(receipt, self.candidate, self.readback)

    def test_android_accounting_followup_does_not_block_task25_release(self):
        # The next signed APK will own these regression checks. Deferral does
        # not certify them or relax Task 25 signature/data/channel requirements.
        self.assertEqual(len(DEFERRED_ANDROID_ACCOUNTING_CHECKS), 5)
        self.assertFalse(set(DEFERRED_ANDROID_ACCOUNTING_CHECKS) & set(SAMSUNG_CHECKS))
        for check in DEFERRED_ANDROID_ACCOUNTING_CHECKS:
            self.receipt['samsung']['checks'][check] = {
                'status': 'NOT_EXECUTED', 'evidence': ''}
        validate_receipt(self.receipt, self.candidate, self.readback)
        for check in ('package_version', 'signing_continuity', 'room_data_preservation',
                      'stable_beta_experimental', 'kill_switch', 'apk_update_metadata'):
            changed = copy.deepcopy(self.receipt)
            changed['samsung']['checks'][check]['status'] = 'NOT_EXECUTED'
            with self.subTest(required_task25_check=check), self.assertRaises(ValueError):
                validate_receipt(changed, self.candidate, self.readback)

    def test_every_unexecuted_gate_blocks_proposal(self):
        validate_receipt(self.receipt, self.candidate, self.readback)
        for key in REQUIRED_GATES:
            receipt = copy.deepcopy(self.receipt)
            receipt[key]['status'] = 'NOT_EXECUTED'
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_receipt(receipt, self.candidate, self.readback)

    def test_pass_label_without_evidence_is_rejected(self):
        self.receipt['samsung_physical']['evidence'] = ''
        with self.assertRaises(ValueError): validate_receipt(self.receipt, self.candidate, self.readback)

    def test_production_entry_cannot_skip_preview_signing_device_or_ci_gates(self):
        validate_acceptance(self.receipt, self.candidate, PRODUCTION_ENTRY_GATES)
        for key in PRODUCTION_ENTRY_GATES:
            receipt = copy.deepcopy(self.receipt)
            receipt[key]['status'] = 'BLOCKED'
            with self.subTest(gate=key), self.assertRaises(ValueError):
                validate_acceptance(receipt, self.candidate, PRODUCTION_ENTRY_GATES)

    def test_unsigned_or_stale_source_never_promotes(self):
        for patch in [{'signingStatus': 'unsigned'}, {'source_commit': 'c' * 40}, {'versionCode': 46}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_receipt(self.receipt, {**self.candidate, **patch}, self.readback)

    def test_emulator_uninstall_or_data_loss_is_rejected(self):
        for key, value in [('physical', False), ('in_place', False), ('data_preserved', False),
                           ('session_preserved', False), ('manufacturer', 'emulator'), ('android_sdk', 35)]:
            receipt = copy.deepcopy(self.receipt)
            receipt['samsung'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): validate_receipt(receipt, self.candidate, self.readback)

    def test_missing_physical_observation_or_device_identity_is_rejected(self):
        for key in SAMSUNG_CHECKS:
            receipt = copy.deepcopy(self.receipt)
            receipt['samsung']['checks'][key]['status'] = 'NOT_EXECUTED'
            with self.subTest(check=key), self.assertRaises(ValueError): validate_receipt(receipt, self.candidate, self.readback)
        for key in ['model', 'android_version', 'adb_identity', 'before_version', 'after_version']:
            receipt = copy.deepcopy(self.receipt)
            receipt['samsung'][key] = ''
            with self.subTest(identity=key), self.assertRaises(ValueError): validate_receipt(receipt, self.candidate, self.readback)

    def test_wrong_bucket_pointer_or_readback_blocks_metadata(self):
        for patch in [{'bucket': 'wyj-cloud-preview'}, {'key': 'app/android/thewyj-android-1.3.33.apk'},
                      {'readback_sha256': 'c' * 64}, {'readback_size_bytes': 4321}]:
            receipt = copy.deepcopy(self.receipt)
            receipt['r2'].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError): validate_receipt(receipt, self.candidate, self.readback)
        with self.assertRaises(ValueError): validate_receipt(self.receipt, self.candidate, {**self.readback, 'sha256': 'd' * 64})

    def test_metadata_all_channels_and_pointer_are_one_consistent_proposal(self):
        stable, config = json.loads(STABLE_PATH.read_text()), json.loads((ROOT / 'wrangler.jsonc').read_text())
        original_stable, original_config = copy.deepcopy(stable), copy.deepcopy(config)
        meta, proposal = proposed_configuration(stable, config, self.candidate, '2026-10-07', 'task25-release-49', 'Task 25 release')
        for values in [proposal['vars'], proposal['env']['preview']['vars'], proposal['env']['production']['vars']]:
            self.assertEqual(values['ANDROID_APK_KEY'], meta['apkKey'])
            self.assertEqual(values['ANDROID_APK_SHA256'], meta['apkSha256'])
            self.assertEqual(values['ANDROID_APK_SIZE_BYTES'], str(meta['apkSizeBytes']))
            self.assertEqual(values['ANDROID_LATEST_VERSION_CODE'], '49')
        for env in ['preview', 'production']:
            self.assertEqual(proposal['env'][env]['d1_databases'], config['env'][env]['d1_databases'])
            self.assertEqual(proposal['env'][env]['r2_buckets'], config['env'][env]['r2_buckets'])
            self.assertEqual(proposal['env'][env]['vars']['TASK25_FEATURE_FLAGS_ENABLED'], config['env'][env]['vars']['TASK25_FEATURE_FLAGS_ENABLED'])
        self.assertEqual(stable, original_stable)
        self.assertEqual(config, original_config)

    def test_proposal_passes_both_existing_release_guards_with_history_preserved(self):
        stable = json.loads(STABLE_PATH.read_text())
        meta, config = proposed_configuration(stable, json.loads((ROOT / 'wrangler.jsonc').read_text()),
            self.candidate, '2026-10-07', 'task25-release-49', '- 体验通道与版本更新。')
        original_changelog = (ROOT / 'changelog.js').read_text()
        changelog = proposed_changelog(original_changelog, meta)
        self.assertIn(stable['releaseBuild'], changelog)
        with self.assertRaises(ValueError): proposed_changelog(changelog, meta)
        with tempfile.TemporaryDirectory(prefix='task25-release-guard-') as directory:
            root = Path(directory)
            (root / 'android/app').mkdir(parents=True)
            (root / 'scripts').mkdir()
            gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
            gradle = re.sub(r'versionCode\s*=\s*46\b', 'versionCode = 49', gradle, count=1)
            gradle = gradle.replace('versionName = "1.3.33"', 'versionName = "1.3.36"', 1)
            (root / 'android/app/build.gradle.kts').write_text(gradle)
            (root / 'android/release-metadata.json').write_text(json.dumps(meta))
            (root / 'wrangler.jsonc').write_text(json.dumps(config))
            (root / 'changelog.js').write_text(changelog)
            shutil.copyfile(ROOT / 'index.html', root / 'index.html')
            for script in ['check_android_release_consistency.py', 'check_android_release.mjs']:
                shutil.copyfile(ROOT / 'scripts' / script, root / 'scripts' / script)
            for command in [[sys.executable, str(root / 'scripts/check_android_release_consistency.py')],
                            ['node', str(root / 'scripts/check_android_release.mjs')]]:
                result = subprocess.run(command, cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
