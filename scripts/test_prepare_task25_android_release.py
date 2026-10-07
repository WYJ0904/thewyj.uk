import copy
import json
import unittest

from scripts.prepare_task25_android_release import REQUIRED_GATES, proposed_configuration, validate_receipt
from scripts.stage_android_candidate import ROOT, STABLE_PATH


class ReleaseProposalTests(unittest.TestCase):
    def setUp(self):
        self.candidate = {'source_commit': 'a' * 40, 'signingStatus': 'verified', 'versionName': '1.3.34', 'versionCode': 47,
            'apk': {'sha256': 'b' * 64, 'sizeBytes': 1234}}
        self.readback = {'sha256': 'b' * 64, 'sizeBytes': 1234}
        self.receipt = {'source_commit': 'a' * 40,
            **{key: {'status': 'PASS', 'evidence': 'isolated-test-receipt-only'} for key in REQUIRED_GATES},
            'samsung': {'manufacturer': 'Samsung', 'android_sdk': 36, 'from_version_code': 46, 'to_version_code': 47,
                'physical': True, 'in_place': True, 'data_preserved': True, 'session_preserved': True},
            'r2': {'bucket': 'wyj-cloud-production', 'key': 'app/android/thewyj-android-1.3.34.apk',
                'readback_sha256': 'b' * 64, 'readback_size_bytes': 1234}}

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
        meta, proposal = proposed_configuration(stable, config, self.candidate, '2026-10-07', 'task25-release-47', 'Task 25 release')
        for values in [proposal['vars'], proposal['env']['preview']['vars'], proposal['env']['production']['vars']]:
            self.assertEqual(values['ANDROID_APK_KEY'], meta['apkKey'])
            self.assertEqual(values['ANDROID_APK_SHA256'], meta['apkSha256'])
            self.assertEqual(values['ANDROID_APK_SIZE_BYTES'], str(meta['apkSizeBytes']))
            self.assertEqual(values['ANDROID_LATEST_VERSION_CODE'], '47')
        for env in ['preview', 'production']:
            self.assertEqual(proposal['env'][env]['d1_databases'], config['env'][env]['d1_databases'])
            self.assertEqual(proposal['env'][env]['r2_buckets'], config['env'][env]['r2_buckets'])
            self.assertEqual(proposal['env'][env]['vars']['TASK25_FEATURE_FLAGS_ENABLED'], config['env'][env]['vars']['TASK25_FEATURE_FLAGS_ENABLED'])
        self.assertEqual(stable, original_stable)
        self.assertEqual(config, original_config)


if __name__ == '__main__':
    unittest.main()
