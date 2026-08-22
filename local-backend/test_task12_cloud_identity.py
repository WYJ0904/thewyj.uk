import base64
import hashlib
import hmac
import tempfile
import time
import unittest
import urllib.parse
from pathlib import Path

from account_store import AccountError, AccountStore, secret_is_hashed
from cloud_identity import CloudIdentityError, verify_cloud_identity


BRIDGE_SECRET = "task12-python-bridge-secret-0123456789"


def signed_headers(
    user_id="stable-user-id",
    username="测试用户",
    issued_at=None,
    path="/api/tools/preferences",
    entitlements=None,
):
    timestamp = int(time.time() if issued_at is None else issued_at)
    request_id = "task12-python-request-001"
    version = "2" if entitlements is not None else "1"
    normalized_entitlements = tuple(sorted(set(entitlements or ())))
    canonical_lines = [
            f"wyj-legacy-identity-v{version}",
            str(timestamp),
            request_id,
            "GET",
            path,
            user_id,
            username,
    ]
    if version == "2":
        canonical_lines.append(",".join(normalized_entitlements))
    canonical = "\n".join(canonical_lines)
    signature = base64.urlsafe_b64encode(
        hmac.new(BRIDGE_SECRET.encode(), canonical.encode(), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    headers = {
        "X-WYJ-Proxy": "pages",
        "X-WYJ-Identity-Version": version,
        "X-WYJ-Identity-User-ID": urllib.parse.quote(user_id),
        "X-WYJ-Identity-Username": urllib.parse.quote(username),
        "X-WYJ-Identity-Issued-At": str(timestamp),
        "X-WYJ-Identity-Request-ID": request_id,
        "X-WYJ-Identity-Signature": signature,
    }
    if version == "2":
        headers["X-WYJ-Identity-Entitlements"] = urllib.parse.quote(
            ",".join(normalized_entitlements)
        )
    return headers


class CloudIdentityTests(unittest.TestCase):
    def test_valid_assertion_round_trips_unicode_identity(self):
        result = verify_cloud_identity(
            signed_headers(), "GET", "/api/tools/preferences", secret=BRIDGE_SECRET
        )
        self.assertEqual(result, {"id": "stable-user-id", "username": "测试用户"})

    def test_tampered_expired_and_untrusted_assertions_are_rejected(self):
        tampered = signed_headers()
        tampered["X-WYJ-Identity-User-ID"] = "another-user"
        with self.assertRaises(CloudIdentityError):
            verify_cloud_identity(tampered, "GET", "/api/tools/preferences", secret=BRIDGE_SECRET)
        with self.assertRaises(CloudIdentityError):
            verify_cloud_identity(
                signed_headers(issued_at=time.time() - 120),
                "GET",
                "/api/tools/preferences",
                secret=BRIDGE_SECRET,
            )
        direct = signed_headers()
        direct.pop("X-WYJ-Proxy")
        with self.assertRaises(CloudIdentityError):
            verify_cloud_identity(direct, "GET", "/api/tools/preferences", secret=BRIDGE_SECRET)

    def test_v2_entitlements_are_signed_validated_and_returned(self):
        entitlements = ("tools_access", "language_japanese_access")
        result = verify_cloud_identity(
            signed_headers(entitlements=entitlements),
            "GET",
            "/api/tools/preferences",
            secret=BRIDGE_SECRET,
        )
        self.assertEqual(result["entitlements"], tuple(sorted(entitlements)))
        tampered = signed_headers(entitlements=entitlements)
        tampered["X-WYJ-Identity-Entitlements"] = urllib.parse.quote("all_features_access")
        with self.assertRaises(CloudIdentityError):
            verify_cloud_identity(
                tampered, "GET", "/api/tools/preferences", secret=BRIDGE_SECRET
            )
        unknown = signed_headers(entitlements=("not_a_real_entitlement",))
        with self.assertRaises(CloudIdentityError):
            verify_cloud_identity(
                unknown, "GET", "/api/tools/preferences", secret=BRIDGE_SECRET
            )

    def test_cloud_shadow_has_stable_id_and_no_usable_plaintext_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = AccountStore(root / "accounts.sqlite3", root / "users.txt")
            created = store.resolve_cloud_identity_user("cloud-stable-id", "cloud-user")
            self.assertEqual(created["id"], "cloud-stable-id")
            self.assertEqual(created["membership"], "free")
            stored = store.get_user("cloud-stable-id", include_deleted=True)
            self.assertTrue(secret_is_hashed(stored["secret"]))
            with self.assertRaises(AccountError):
                store.login("cloud-user", "cloud_managed$")
            again = store.resolve_cloud_identity_user("cloud-stable-id", "cloud-user")
            self.assertEqual(again["id"], "cloud-stable-id")
            cloud_entitlements = store.resolve_cloud_identity_user(
                "cloud-stable-id", "cloud-user", ("tools_access",)
            )
            self.assertEqual(store.entitlements_for(cloud_entitlements), {"tools_access"})
            with self.assertRaises(AccountError):
                store.resolve_cloud_identity_user("different-id", "cloud-user")


if __name__ == "__main__":
    unittest.main()
