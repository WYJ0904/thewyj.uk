"""Failure gates for candidate signing and version validation; no keys generated."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from scripts.stage_android_candidate import (
    EXPECTED_CERTIFICATE, ROOT, STABLE_PATH, validate_origin, validate_version, verify_artifacts,
)


class CandidateGateTests(unittest.TestCase):
    def test_upgrade_only_accepts_advancing_name_and_code(self):
        # This is an isolated pre-release version vector, not today's pointer.
        # Publishing 49 must not turn a historical 46 -> 47 test into a failure.
        stable = {'versionName': '1.3.33', 'versionCode': 46}
        validate_version('1.3.34', 47, stable)
        for name, code in [('1.3.34', 46), ('1.3.33', 47), ('1.3.32', 48), ('1.3.34-debug', 47)]:
            with self.subTest(name=name, code=code), self.assertRaises(ValueError):
                validate_version(name, code, stable)

    def test_backend_rejects_non_origin_and_injection(self):
        validate_origin('https://thewyj.uk')
        for origin in ['http://thewyj.uk', 'https://user:secret@thewyj.uk', 'https://thewyj.uk/path',
                       'https://thewyj.uk/?x=1', 'https://thewyj.uk/"', 'https://thewyj.uk/#frag']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                validate_origin(origin)

    def signed_outputs(self, apk_cert=EXPECTED_CERTIFICATE, bundle_cert=EXPECTED_CERTIFICATE, jar='jar verified.'):
        def run(command):
            name = Path(command[0]).name
            if name == 'aapt2': return "package: name='uk.thewyj.app' versionCode='47' versionName='1.3.34'"
            if name == 'apksigner': return f'Signer #1 certificate SHA-256 digest: {apk_cert}\n'
            if name == 'jarsigner': return jar
            if name == 'keytool': return f'SHA256: {bundle_cert}\n'
            raise AssertionError(name)
        return run

    @patch('scripts.stage_android_candidate.android_tool', side_effect=lambda name: name)
    def test_only_both_original_signatures_can_claim_verified(self, _):
        result = verify_artifacts(Path('candidate.apk'), Path('candidate.aab'), '1.3.34', 47, 'verified', self.signed_outputs())
        self.assertTrue(result['apkSignatureVerified'] and result['aabSignatureVerified'])
        for options in [{'apk_cert': '0' * 64}, {'bundle_cert': '0' * 64}, {'jar': 'jar is unsigned.'},
                        {'jar': 'jar verified. This jar contains unsigned entries.'}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                verify_artifacts(Path('candidate.apk'), Path('candidate.aab'), '1.3.34', 47, 'verified', self.signed_outputs(**options))

    @patch('scripts.stage_android_candidate.android_tool', side_effect=lambda name: name)
    def test_manifest_mismatch_blocks_artifact(self, _):
        for field in ["name='uk.thewyj.app.debug'", "versionCode='46'", "versionName='1.3.33'"]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                verify_artifacts(Path('candidate.apk'), Path('candidate.aab'), '1.3.34', 47, 'unsigned', lambda _: field)

    def test_protected_output_rejected_before_any_write_or_signing(self):
        for path in [STABLE_PATH, ROOT / 'wrangler.jsonc']:
            before = path.read_bytes()
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/stage_android_candidate.py'),
                '--apk', 'does-not-exist.apk', '--aab', 'does-not-exist.aab', '--version-name', '1.3.34',
                '--version-code', '47', '--signing-status', 'verified', '--output', str(path)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('must not replace Stable metadata', result.stderr)
            self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
