#!/usr/bin/env python3
"""Fail closed when the Task 20 Android security contract drifts."""

from __future__ import annotations

import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    build = (ANDROID / "app" / "build.gradle.kts").read_text(encoding="utf-8")
    manifest_path = ANDROID / "app" / "src" / "main" / "AndroidManifest.xml"
    manifest_source = manifest_path.read_text(encoding="utf-8")
    manifest = ET.fromstring(manifest_source)
    kotlin = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ANDROID / "app" / "src" / "main" / "java").rglob("*.kt"))
    )
    frontend_session = (ROOT / "js" / "core" / "session.js").read_text(encoding="utf-8")
    task20_api = (ROOT / "functions" / "_lib" / "task20-api.mjs").read_text(encoding="utf-8")
    android_api = (
        ANDROID / "app" / "src" / "main" / "java" / "uk" / "thewyj" / "app"
        / "core" / "network" / "ThewyjApiClient.kt"
    ).read_text(encoding="utf-8")
    app_view_model = (
        ANDROID / "app" / "src" / "main" / "java" / "uk" / "thewyj" / "app"
        / "ui" / "AppViewModel.kt"
    ).read_text(encoding="utf-8")
    migration = (ROOT / "cloudflare" / "migrations" / "0015_android_device_sessions.sql").read_text(encoding="utf-8")
    wrangler = json.loads((ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))

    require('applicationId = "uk.thewyj.app"' in build, "formal applicationId changed")
    require('namespace = "uk.thewyj.app"' in build, "Android namespace changed")
    require('minSdk = 26' in build, "minimum supported Android API changed without review")

    permissions = {
        node.attrib.get(f"{ANDROID_NS}name", "")
        for node in manifest.findall("uses-permission")
    }
    require(
        permissions == {
            "android.permission.INTERNET",
            "android.permission.ACCESS_NETWORK_STATE",
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
            # Task 21 final closure: the app posts its own payment recognition
            # notifications and reads newly received bank SMS.
            "android.permission.POST_NOTIFICATIONS",
            "android.permission.RECEIVE_SMS",
            # In-app updater: the downloaded APK is handed to the official
            # Android package installer (never installed silently).
            "android.permission.REQUEST_INSTALL_PACKAGES",
            # Task 24.1 R4: screenshot archive. Samsung replaces its single
            # screenshot notification in place, so MediaStore is the
            # authoritative screenshot source:
            #   READ_MEDIA_IMAGES                  = full image read (Android 13+)
            #   READ_MEDIA_VISUAL_USER_SELECTED    = Android 14 Selected Photos
            #                                        (limited; never treated as
            #                                        readable screenshots)
            #   READ_EXTERNAL_STORAGE (<= API 32)  = legacy full read
            "android.permission.READ_MEDIA_IMAGES",
            "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
            "android.permission.READ_EXTERNAL_STORAGE",
        },
        f"Task 20 permission surface changed: {sorted(permissions)}",
    )
    require(
        "android.service.notification.NotificationListenerService" in manifest_source
        and "ThewyjNotificationListenerService" in manifest_source,
        "Task 21 notification listener service is missing or misconfigured",
    )
    require(
        'android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"' in manifest_source,
        "Task 21 notification listener service lost its system binding permission",
    )
    require(
        "ThewyjPaymentAccessibilityService" in manifest_source
        and 'android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"' in manifest_source
        and '@xml/thewyj_accessibility_service' in manifest_source,
        "Task 21 payment accessibility service must be declared with the system binding permission and its config",
    )
    require(
        "RECEIVE_SMS" in manifest_source and "READ_SMS" not in manifest_source,
        "Task 21 SMS capture may only receive new SMS and must never request READ_SMS",
    )
    require(
        "BankSmsReceiver" in manifest_source
        and "android.provider.Telephony.SMS_RECEIVED" in manifest_source,
        "Task 21 bank SMS receiver is missing or misconfigured",
    )
    require("addJavascriptInterface" not in kotlin, "unsafe universal JavaScript bridge is forbidden")
    for contract in ("NOTIFICATION_ACCESS", "SMS_PERMISSION", "ACCESSIBILITY_SERVICE"):
        require(contract in kotlin, f"missing Task 21 capability boundary {contract}")
    require("setAcceptThirdPartyCookies(this, false)" in kotlin, "third-party WebView cookies must stay disabled")
    require("MIXED_CONTENT_NEVER_ALLOW" in kotlin, "mixed WebView content must stay blocked")
    require("AndroidKeyStore" in kotlin and "AES/GCM/NoPadding" in kotlin, "long-term credential storage is not Keystore protected")
    require("CredentialStorageException" in kotlin, "credential read failures must preserve encrypted data for recovery")
    require("resetInvalidatedKey" not in kotlin, "a generic storage failure must not erase credentials or the Keystore key")
    require("refresh_token" not in (ANDROID / "gradle.properties").read_text(encoding="utf-8"), "credential material entered Gradle config")

    require("NATIVE_ACCOUNT_SESSION" in frontend_session, "native HttpOnly cookie bridge is missing")
    require("local.removeItem(ACCOUNT_SESSION_KEY)" in frontend_session, "native WebView can persist a long-term session token")
    for route in ("/api/app/login", "/api/app/session/refresh", "/api/app/session/logout", "/api/app/session"):
        require(route in task20_api, f"missing Android session endpoint {route}")
    require("requireTask20AndroidClient" in task20_api, "long-term app session routes accept ordinary browser clients")
    require(
        '.put("confirm_secret", secret)' in android_api,
        "Android registration does not satisfy the existing Task 12 confirmation contract",
    )
    require(
        "networkRecoveryJob?.isActive == true" in app_view_model,
        "Android network recovery can launch duplicate session restores",
    )
    for variable in (
        "THEWYJ_ANDROID_KEYSTORE_FILE",
        "THEWYJ_ANDROID_KEYSTORE_PASSWORD",
        "THEWYJ_ANDROID_KEY_ALIAS",
        "THEWYJ_ANDROID_KEY_PASSWORD",
    ):
        require(variable in build, f"missing secure release signing input {variable}")
    for table in ("task20_device_sessions", "task20_used_refresh_tokens"):
        require(table in migration, f"missing D1 table {table}")
    require("refresh_token_digest" in migration and "access_token_digest" in migration, "D1 schema does not store token digests")

    preview = wrangler["env"]["preview"]["vars"]
    production = wrangler["env"]["production"]["vars"]
    require(preview.get("TASK20_ANDROID_APP_ENABLED") == "true", "Preview Android flag must be enabled")
    require(production.get("TASK20_ANDROID_APP_ENABLED") == "true", "Production Android flag must remain enabled after Task 20 rollout")

    tracked = subprocess.run(
        ["git", "ls-files", "android"],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.splitlines()
    forbidden = [
        path for path in tracked
        if re.search(r"(?:^|/)(?:build|\.gradle)/|\.(?:apk|aab|jks|keystore)$", path)
    ]
    require(not forbidden, f"generated Android artifacts are tracked: {forbidden}")

    print("Task 20 Android contract check passed: identity, permissions, Keystore, WebView, D1 and rollout gate.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"Task 20 Android contract check failed: {error}")
        raise SystemExit(1)
