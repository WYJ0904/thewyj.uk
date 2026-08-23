import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "task13_migration", ROOT / "scripts" / "migrate_task13_memberships_payments.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


NOW = "2026-08-20T00:00:00Z"
ONE_PIXEL_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def write_qr_fixtures(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for code, plan in MIGRATION.MEMBERSHIP_PLANS.items():
        if not plan["purchasable"]:
            continue
        for method in MIGRATION.PAYMENT_METHODS:
            (directory / f"{method}_{code}.png").write_bytes(ONE_PIXEL_PNG)
    (directory / "alipay_legacy_all_lifetime.png").write_bytes(ONE_PIXEL_PNG)


def fixture_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (
            id TEXT PRIMARY KEY, username TEXT, role TEXT
        );
        CREATE TABLE user_memberships (
            id TEXT PRIMARY KEY, user_id TEXT, plan_code TEXT, starts_at TEXT,
            expires_at TEXT, is_lifetime INTEGER, status TEXT, source TEXT,
            source_ref TEXT, created_by TEXT, metadata_json TEXT,
            created_at TEXT, updated_at TEXT
        );
        CREATE TABLE user_entitlement_overrides (
            user_id TEXT, entitlement_code TEXT, allowed INTEGER, note TEXT,
            updated_by TEXT, updated_at TEXT
        );
        CREATE TABLE payment_requests (
            id TEXT PRIMARY KEY, order_number TEXT, user_id TEXT, username TEXT,
            plan_code TEXT, amount_cents INTEGER, currency TEXT, payment_note TEXT,
            status TEXT, requested_at TEXT, expires_at TEXT, user_confirmed_at TEXT,
            processing_at TEXT, handled_at TEXT, handled_by TEXT, admin_note TEXT,
            updated_at TEXT, trial_language TEXT, plan_name_snapshot TEXT,
            payment_method TEXT, qr_resource_id TEXT, lifetime_snapshot INTEGER,
            duration_months_snapshot INTEGER, entitlements_snapshot_json TEXT,
            description_snapshot TEXT
        );
        CREATE TABLE payment_request_events (
            id TEXT PRIMARY KEY, payment_request_id TEXT, from_status TEXT,
            to_status TEXT, actor_user_id TEXT, actor_username TEXT,
            note TEXT, created_at TEXT
        );
        CREATE TABLE payment_fulfillments (
            id TEXT PRIMARY KEY, payment_request_id TEXT, user_id TEXT,
            plan_code TEXT, user_membership_id TEXT, source TEXT,
            source_ref TEXT, fulfilled_at TEXT
        );
        CREATE TABLE admin_audit_logs (
            id TEXT PRIMARY KEY, actor_user_id TEXT, actor_username TEXT,
            target_user_id TEXT, target_username TEXT, action TEXT,
            before_json TEXT, after_json TEXT, note TEXT, created_at TEXT
        );
        """
    )
    connection.executemany(
        "INSERT INTO users VALUES (?, ?, ?)",
        (("user-1", "learner", "user"), ("admin-1", "admin", "super_admin")),
    )
    connection.executemany(
        "INSERT INTO user_memberships VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            (
                "membership-1", "user-1", "monthly", NOW, "2026-09-20T23:59:59Z",
                0, "active", "legacy_migration", "legacy-1", "system", "{}", NOW, NOW,
            ),
            (
                "membership-2", "user-1", "japanese_lifetime", NOW, "", 1,
                "active", "payment", "payment:payment-approved", "admin", "{}", NOW, NOW,
            ),
        ),
    )
    connection.execute(
        "INSERT INTO user_entitlement_overrides VALUES (?, ?, ?, ?, ?, ?)",
        ("user-1", "tools_access", 0, "fixture", "admin", NOW),
    )
    connection.executemany(
        """
        INSERT INTO payment_requests VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        (
            (
                "payment-open", "WYJ-OPEN", "user-1", "learner", "dual_language_monthly",
                2000, "CNY", "private payment note", "pending_payment", NOW,
                "2026-08-21T00:00:00Z", "", "", "", "", "", NOW, "",
                "双语言包月", "wechat", "qr-v1:wechat:dual_language_monthly",
                None, None, "", "",
            ),
            (
                "payment-approved", "LEGACY-APPROVED", "user-1", "learner", "lifetime",
                6500, "CNY", "historical private note", "approved", NOW, "", NOW, NOW,
                NOW, "admin", "approved", NOW, "", "历史永久套餐快照", "alipay",
                "qr-v1:alipay:legacy_all_lifetime", 1, 0,
                '["language_english_access"]', "历史权益快照",
            ),
        ),
    )
    connection.execute(
        "INSERT INTO payment_request_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("event-1", "payment-open", "", "pending_payment", "user-1", "learner", "created", NOW),
    )
    connection.execute(
        "INSERT INTO payment_fulfillments VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "fulfillment-1", "payment-approved", "user-1", "lifetime", "membership-2",
            "payment", "payment:payment-approved", NOW,
        ),
    )
    connection.execute(
        "INSERT INTO admin_audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "audit-1", "admin-1", "admin", "user-1", "learner", "payment_approve",
            "{}", "{}", "fixture", NOW,
        ),
    )
    connection.commit()
    connection.close()


class Task13MigrationTests(unittest.TestCase):
    def build_fixture(self, directory: str):
        database = Path(directory) / "source.sqlite3"
        qr_directory = Path(directory) / "qrcodes"
        fixture_database(database)
        write_qr_fixtures(qr_directory)
        return database, qr_directory

    def test_dry_run_preserves_ids_snapshots_and_inventory_without_sensitive_content(self):
        with tempfile.TemporaryDirectory() as directory:
            database, qr_directory = self.build_fixture(directory)
            data, counts, qr_assets = MIGRATION.analyze_source(database, qr_directory)
            MIGRATION.validate_source(counts)

            self.assertEqual(counts["users"], 2)
            self.assertEqual(counts["memberships"], 2)
            self.assertEqual(counts["payment_orders"], 2)
            self.assertEqual(counts["qr_inventory"], {"expected": 13, "valid": 13, "missing": 0, "invalid": 0})
            self.assertEqual(len(qr_assets), 13)
            self.assertEqual(data["memberships"][0]["plan_code"], "legacy_all_monthly")
            approved = next(item for item in data["payment_orders"] if item["id"] == "payment-approved")
            self.assertEqual(approved["plan_code"], "legacy_all_lifetime")
            self.assertEqual(approved["amount_cents"], 6500)
            self.assertEqual(approved["plan_name_snapshot"], "历史永久套餐快照")
            self.assertEqual(approved["entitlements_snapshot"], ["language_english_access"])
            self.assertEqual(approved["description_snapshot"], "历史权益快照")

            report = json.dumps(counts, ensure_ascii=False)
            self.assertNotIn("private payment note", report)
            self.assertNotIn("historical private note", report)
            self.assertNotIn("PNG", report)

    def test_integrity_error_blocks_apply_but_does_not_log_record_values(self):
        with tempfile.TemporaryDirectory() as directory:
            database, qr_directory = self.build_fixture(directory)
            connection = sqlite3.connect(database)
            connection.execute(
                "UPDATE user_memberships SET user_id = 'missing-private-user' WHERE id = 'membership-1'"
            )
            connection.commit()
            connection.close()
            _, counts, _ = MIGRATION.analyze_source(database, qr_directory)
            self.assertEqual(counts["missing_user_ids"], 1)
            with self.assertRaisesRegex(RuntimeError, "integrity checks") as captured:
                MIGRATION.validate_source(counts)
            self.assertNotIn("missing-private-user", str(captured.exception))

    def test_apply_is_batched_idempotent_and_production_needs_backup_confirmation(self):
        with tempfile.TemporaryDirectory() as directory:
            database, qr_directory = self.build_fixture(directory)
            data, counts, qr_assets = MIGRATION.analyze_source(database, qr_directory)
            MIGRATION.validate_source(counts)
            args = SimpleNamespace(
                endpoint="https://preview.example",
                environment="preview",
                session_token_env="WYJ_TASK13_TEST_SESSION",
                backup_confirmed=False,
                backup_dir="",
                confirm_production="",
                upload_r2=False,
                r2_bucket="",
                wrangler_env="preview",
                source_db=str(database),
            )
            kinds = []

            def fake_request(url, token, payload, production):
                self.assertEqual(token, "masked-test-token")
                self.assertFalse(production)
                if payload is None:
                    return {"ok": True, "counts": {"memberships": 2, "payment_orders": 2}}
                kinds.append(payload["kind"])
                return {"ok": True, "received": len(payload["records"]), "changed": len(payload["records"])}

            with mock.patch.dict(os.environ, {"WYJ_TASK13_TEST_SESSION": "masked-test-token"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=fake_request
            ):
                first = MIGRATION.apply_import(args, data, qr_assets)
                second = MIGRATION.apply_import(args, data, qr_assets)
            self.assertEqual(kinds, list(MIGRATION.IMPORT_ORDER) * 2)
            self.assertEqual(first["after_counts"], second["after_counts"])

            args.environment = "production"
            with mock.patch.dict(os.environ, {"WYJ_TASK13_TEST_SESSION": "masked-test-token"}):
                with self.assertRaisesRegex(RuntimeError, "Production requires"):
                    MIGRATION.apply_import(args, data, qr_assets)

    def test_r2_upload_uses_private_fixed_keys_without_printing_content(self):
        with tempfile.TemporaryDirectory() as directory:
            _, qr_directory = self.build_fixture(directory)
            assets = {"payments/qrcodes/v1/wechat_trial_single_language.png": qr_directory / "wechat_trial_single_language.png"}
            with mock.patch.object(MIGRATION.shutil, "which", return_value="C:/tools/npx.cmd"), mock.patch(
                "subprocess.run"
            ) as run:
                run.return_value = SimpleNamespace(returncode=0)
                uploaded = MIGRATION.upload_qr_assets(assets, "preview-private-bucket", "preview")
            self.assertEqual(uploaded, 1)
            command = run.call_args.args[0]
            self.assertEqual(command[0], "C:/tools/npx.cmd")
            self.assertIn("preview-private-bucket/payments/qrcodes/v1/wechat_trial_single_language.png", command)
            self.assertIn("private, no-store", command)
            self.assertIn("--remote", command)
            self.assertNotIn(ONE_PIXEL_PNG, command)

    def test_request_uses_same_origin_and_production_confirmation_header(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok":true}'
        with mock.patch("urllib.request.urlopen", return_value=response) as opened:
            MIGRATION.request_json(
                "https://example.test/api/admin/task13/import",
                "masked-test-token",
                {"schema_version": "1", "kind": "memberships", "records": []},
                True,
            )
        request = opened.call_args.args[0]
        self.assertEqual(request.get_header("Origin"), "https://example.test")
        self.assertEqual(request.get_header("User-agent"), "WYJ-Task13-Migration/1.0")
        self.assertEqual(
            request.get_header("X-wyj-task13-production-confirm"),
            MIGRATION.PRODUCTION_CONFIRMATION,
        )


if __name__ == "__main__":
    unittest.main()
