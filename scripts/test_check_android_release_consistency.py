"""Self-test for the Task 24 release consistency gate.

A gate that only ever passes is useless: this drives the real script against a
temporary copy of the release metadata and proves that (a) consistent metadata
passes and (b) every mismatch class is rejected.
"""

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_android_release_consistency.py"
REPO_FILES = (
    pathlib.Path("android") / "app" / "build.gradle.kts",
    pathlib.Path("android") / "release-metadata.json",
    pathlib.Path("wrangler.jsonc"),
)


def run_gate(root: pathlib.Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root)],
        capture_output=True,
        text=True,
        check=False,
    )


class AndroidReleaseConsistencyTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        for relative in REPO_FILES:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, target)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def patch_metadata(self, **changes) -> None:
        path = self.root / "android" / "release-metadata.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(changes)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def test_consistent_metadata_passes(self) -> None:
        result = run_gate(self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("checks passed", result.stdout)

    def test_version_name_mismatch_is_rejected(self) -> None:
        self.patch_metadata(versionName="1.3.2")
        result = run_gate(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("metadata versionName", result.stdout)

    def test_version_code_mismatch_is_rejected(self) -> None:
        self.patch_metadata(versionCode=15)
        result = run_gate(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("metadata versionCode", result.stdout)

    def test_superseded_apk_digest_is_rejected(self) -> None:
        self.patch_metadata(apkSha256="9708a7608177419f961fbf7cdb3bdb2114e79673976acac415c6a1c14e429b36")
        result = run_gate(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("superseded 1.3.2 digest", result.stdout)

    def test_wrangler_version_drift_is_rejected(self) -> None:
        path = self.root / "wrangler.jsonc"
        config = json.loads(path.read_text(encoding="utf-8"))
        config["env"]["production"]["vars"]["ANDROID_LATEST_VERSION_CODE"] = "15"
        path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        result = run_gate(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("wrangler production ANDROID_LATEST_VERSION_CODE", result.stdout)

    def test_apk_file_name_and_key_convention_is_rejected(self) -> None:
        self.patch_metadata(apkFileName="thewyj-android-1.3.2.apk", apkKey="app/android/thewyj-android-1.3.2.apk")
        result = run_gate(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("apkFileName", result.stdout)


if __name__ == "__main__":
    unittest.main()
