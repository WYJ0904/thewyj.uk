#!/usr/bin/env python3
"""Task 24 final release consistency gate.

The Android release must be identical everywhere it is published, otherwise the
site can announce one build while the APK (or the update API) serves another:

* ``android/app/build.gradle.kts`` - what the built APK really is
* ``android/release-metadata.json`` - what the download page advertises
* ``wrangler.jsonc`` - root/default, preview and production ``ANDROID_*`` vars
* an optional APK manifest (``--apk``) - the artifact that gets uploaded

Usage:
    python scripts/check_android_release_consistency.py
    python scripts/check_android_release_consistency.py --apk dist/thewyj-android-1.3.3.apk \
        --verify-apk-integrity --expect-certificate 2B:32:20:...
    # CI debug acceptance build:
    python scripts/check_android_release_consistency.py \
        --apk android/app/build/outputs/apk/debug/app-debug.apk --allow-debug-suffix
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The 1.3.2 artifact must never be published as 1.3.3.
SUPERSEDED_APK_SHA256 = "9708a7608177419f961fbf7cdb3bdb2114e79673976acac415c6a1c14e429b36"
SUPERSEDED_APK_NAME = "thewyj-android-1.3.2.apk"
EXPECTED_APPLICATION_ID = "uk.thewyj.app"
EXPECTED_MIN_SDK = 30
EXPECTED_TARGET_SDK = 36

FAILURES: list[str] = []
SUMMARY: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        SUMMARY.append(f"ok   {message}")
    else:
        FAILURES.append(message)


def gradle_version(root: pathlib.Path) -> tuple[int, str]:
    text = (root / "android" / "app" / "build.gradle.kts").read_text(encoding="utf-8")
    code = re.search(r"versionCode\s*=\s*(\d+)", text)
    name = re.search(r'versionName\s*=\s*"([^"]+)"', text)
    if not code or not name:
        raise SystemExit("[release-consistency] FAIL android/app/build.gradle.kts has no versionCode/versionName")
    return int(code.group(1)), name.group(1)


def metadata(root: pathlib.Path) -> dict:
    return json.loads((root / "android" / "release-metadata.json").read_text(encoding="utf-8"))


def wrangler_android_vars(root: pathlib.Path) -> dict[str, dict[str, str]]:
    config = json.loads((root / "wrangler.jsonc").read_text(encoding="utf-8"))
    blocks: dict[str, dict[str, str]] = {"default": config.get("vars", {})}
    env = config.get("env", {})
    for name in ("preview", "production"):
        blocks[name] = env.get(name, {}).get("vars", {})
    return {
        block: {key: value for key, value in values.items() if key.startswith("ANDROID_")}
        for block, values in blocks.items()
    }


def sha256_of(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def aapt2_badging(apk: pathlib.Path) -> str:
    import os

    candidates: list[pathlib.Path] = []
    for env_name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        root = os.environ.get(env_name)
        if not root:
            continue
        build_tools = pathlib.Path(root) / "build-tools"
        if build_tools.is_dir():
            candidates.extend(sorted(build_tools.glob("*/aapt2*"), reverse=True))
    aapt2 = next((c for c in candidates if c.is_file()), None)
    if aapt2 is None:
        fallback = shutil.which("aapt2") or shutil.which("aapt")
        if fallback is None:
            raise SystemExit("[release-consistency] FAIL aapt2/aapt is required for --apk")
        aapt2 = pathlib.Path(fallback)
    completed = subprocess.run(
        [str(aapt2), "dump", "badging", str(apk)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit(f"[release-consistency] FAIL aapt2 dump badging failed: {completed.stderr.strip()}")
    return completed.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="", help="repository root (defaults to this script's parent)")
    parser.add_argument("--apk", default="")
    parser.add_argument("--verify-apk-integrity", action="store_true")
    parser.add_argument("--allow-debug-suffix", action="store_true")
    parser.add_argument("--expect-certificate", default="")
    args = parser.parse_args()

    root = pathlib.Path(args.root).resolve() if args.root else ROOT
    version_code, version_name = gradle_version(root)
    meta = metadata(root)
    blocks = wrangler_android_vars(root)

    check(meta.get("applicationId") == EXPECTED_APPLICATION_ID, f"metadata applicationId == {EXPECTED_APPLICATION_ID}")
    check(meta.get("versionName") == version_name, f"metadata versionName == build.gradle ({version_name})")
    check(int(meta.get("versionCode", -1)) == version_code, f"metadata versionCode == build.gradle ({version_code})")

    expected_apk = f"thewyj-android-{version_name}.apk"
    check(meta.get("apkFileName") == expected_apk, f"metadata apkFileName == {expected_apk}")
    check(
        meta.get("apkKey") == f"app/android/{expected_apk}",
        f"metadata apkKey == app/android/{expected_apk}",
    )
    check(
        meta.get("apkSha256", "").lower() != SUPERSEDED_APK_SHA256,
        "metadata apkSha256 is not the superseded 1.3.2 digest",
    )
    check(
        meta.get("apkFileName") != SUPERSEDED_APK_NAME,
        f"metadata apkFileName is not {SUPERSEDED_APK_NAME}",
    )
    sha = str(meta.get("apkSha256", "")).lower()
    check(bool(re.fullmatch(r"[0-9a-f]{64}", sha)), "metadata apkSha256 is a sha256 hex digest")
    check(int(meta.get("apkSizeBytes", 0)) > 0, "metadata apkSizeBytes is present")

    for block, values in blocks.items():
        check(
            values.get("ANDROID_LATEST_VERSION_NAME") == version_name,
            f"wrangler {block} ANDROID_LATEST_VERSION_NAME == {version_name}",
        )
        check(
            str(values.get("ANDROID_LATEST_VERSION_CODE")) == str(version_code),
            f"wrangler {block} ANDROID_LATEST_VERSION_CODE == {version_code}",
        )
        check(
            values.get("ANDROID_APK_FILE_NAME") == meta.get("apkFileName"),
            f"wrangler {block} ANDROID_APK_FILE_NAME == {meta.get('apkFileName')}",
        )
        check(
            values.get("ANDROID_APK_KEY") == meta.get("apkKey"),
            f"wrangler {block} ANDROID_APK_KEY == {meta.get('apkKey')}",
        )
        check(
            str(values.get("ANDROID_APK_SHA256", "")).lower() == sha,
            f"wrangler {block} ANDROID_APK_SHA256 == metadata",
        )
        check(
            str(values.get("ANDROID_APK_SIZE_BYTES")) == str(meta.get("apkSizeBytes")),
            f"wrangler {block} ANDROID_APK_SIZE_BYTES == metadata",
        )
        check(
            values.get("ANDROID_RELEASE_BUILD") == meta.get("releaseBuild"),
            f"wrangler {block} ANDROID_RELEASE_BUILD == metadata",
        )
        check(
            values.get("ANDROID_RELEASE_DATE") == meta.get("releaseDate"),
            f"wrangler {block} ANDROID_RELEASE_DATE == metadata",
        )
        check(
            values.get("ANDROID_RELEASE_NOTES") == meta.get("releaseNotes"),
            f"wrangler {block} ANDROID_RELEASE_NOTES == metadata",
        )

    if args.apk:
        apk = pathlib.Path(args.apk)
        if not apk.is_absolute():
            # The Android CI step runs inside `android/`, callers from the repo
            # root pass a repo-relative path: accept whichever one exists.
            from_cwd = pathlib.Path.cwd() / apk
            apk = from_cwd if from_cwd.exists() else root / apk
        check(apk.is_file(), f"apk exists: {apk}")
        if apk.is_file():
            badging = aapt2_badging(apk)
            package_line = next((line for line in badging.splitlines() if line.startswith("package:")), "")
            apk_name = re.search(r"versionName='([^']*)'", package_line)
            apk_code = re.search(r"versionCode='(\d+)'", package_line)
            apk_package = re.search(r"name='([^']*)'", package_line)
            actual_name = apk_name.group(1) if apk_name else ""
            expected_name = version_name + ("-debug" if args.allow_debug_suffix and actual_name.endswith("-debug") else "")
            check(actual_name == expected_name, f"apk versionName == {expected_name} (got {actual_name})")
            check(
                (apk_code.group(1) if apk_code else "") == str(version_code),
                f"apk versionCode == {version_code}",
            )
            actual_package = apk_package.group(1) if apk_package else ""
            expected_package = EXPECTED_APPLICATION_ID + (
                ".debug" if args.allow_debug_suffix and actual_package.endswith(".debug") else ""
            )
            check(actual_package == expected_package, f"apk package == {expected_package} (got {actual_package})")
            check(f"minSdkVersion:'{EXPECTED_MIN_SDK}'" in badging, f"apk minSdk == {EXPECTED_MIN_SDK}")
            check(f"targetSdkVersion:'{EXPECTED_TARGET_SDK}'" in badging, f"apk targetSdk == {EXPECTED_TARGET_SDK}")
            if args.verify_apk_integrity:
                check(sha256_of(apk) == sha, "apk sha256 == metadata")
                check(apk.stat().st_size == int(meta.get("apkSizeBytes", -1)), "apk size == metadata")
            if args.expect_certificate:
                apksigner = shutil.which("apksigner")
                if apksigner is None:
                    import os

                    for env_name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
                        root = os.environ.get(env_name)
                        if not root:
                            continue
                        found = sorted((pathlib.Path(root) / "build-tools").glob("*/apksigner*"), reverse=True)
                        apksigner = str(found[0]) if found else None
                        if apksigner:
                            break
                check(apksigner is not None, "apksigner is available for the certificate check")
                if apksigner:
                    completed = subprocess.run(
                        [apksigner, "verify", "--print-certs", str(apk)],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    digest = ""
                    for line in completed.stdout.splitlines():
                        if "certificate SHA-256 digest" in line:
                            digest = line.rsplit(":", 1)[-1].strip().replace(":", "").lower()
                            break
                    expected = args.expect_certificate.replace(":", "").lower()
                    check(digest == expected, f"apk signing certificate == {args.expect_certificate}")

    print("[release-consistency] values: " + json.dumps({
        "versionName": version_name,
        "versionCode": version_code,
        "apkFileName": meta.get("apkFileName"),
        "apkSha256": sha,
        "apkSizeBytes": meta.get("apkSizeBytes"),
        "releaseBuild": meta.get("releaseBuild"),
    }, ensure_ascii=False))
    for line in SUMMARY:
        print(f"[release-consistency] {line}")
    if FAILURES:
        for line in FAILURES:
            print(f"[release-consistency] FAIL {line}")
        print(f"[release-consistency] {len(FAILURES)} mismatch(es) - release metadata is inconsistent")
        return 1
    print(f"[release-consistency] all {len(SUMMARY)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
