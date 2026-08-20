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
    "task12_migration", ROOT / "scripts" / "migrate_task12_accounts_to_d1.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


def fixture_database(path):
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (
            id TEXT PRIMARY KEY, username TEXT, username_normalized TEXT, secret TEXT,
            role TEXT, banned INTEGER, permanent_ban INTEGER, ban_reason TEXT,
            deleted INTEGER, session_version INTEGER, registered_at TEXT,
            last_login_at TEXT, created_at TEXT, updated_at TEXT
        );
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT);
        CREATE TABLE login_audit_logs (
            id TEXT PRIMARY KEY, user_id TEXT, username TEXT, success INTEGER,
            reason TEXT, ip_address TEXT, country TEXT, region TEXT, city TEXT,
            user_agent TEXT, source TEXT, created_at TEXT
        );
        CREATE TABLE feedback_items (id TEXT PRIMARY KEY, user_id TEXT);
        CREATE TABLE feedback_votes (feedback_id TEXT, user_id TEXT);
        CREATE TABLE learning_sync_records (user_id TEXT);
        CREATE TABLE learning_sync_heads (user_id TEXT);
        CREATE TABLE learning_sync_changes (user_id TEXT);
        """
    )
    now = "2026-08-20T00:00:00Z"
    standard = "pbkdf2_sha256$310000$MDEyMzQ1Njc4OWFiY2RlZg$" + "A" * 43
    rows = [
        ("user-standard", "standard", "standard", standard, "user", 0, 0, "", 0, 2, now, now, now, now),
        ("user-plaintext", "plaintext", "plaintext", "historical plaintext", "user", 0, 0, "", 0, 1, now, "", now, now),
        ("user-legacy", "legacy", "legacy", "scrypt$legacy-value", "user", 1, 1, "legacy ban", 0, 3, now, "", now, now),
        ("user-invalid", "invalid", "invalid", "", "user", 0, 0, "", 1, 4, now, "", now, now),
    ]
    connection.executemany(
        "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows
    )
    connection.execute("INSERT INTO sessions VALUES ('sha256$fixture', 'user-standard')")
    connection.execute(
        "INSERT INTO login_audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("audit-1", "user-standard", "standard", 1, "success", "", "", "", "", "fixture", "test", now),
    )
    connection.execute("INSERT INTO feedback_items VALUES ('feedback-1', 'user-standard')")
    connection.commit()
    connection.close()


class Task12MigrationTests(unittest.TestCase):
    def test_dry_run_classifies_secrets_without_leaking_values(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            data, counts = MIGRATION.analyze_source(database)
            self.assertEqual(counts["users"], 4)
            self.assertEqual(counts["legacy_sessions_detected"], 1)
            self.assertEqual(counts["legacy_sessions_migrated"], 0)
            self.assertEqual(
                counts["password_hash_types"],
                {"invalid": 1, "legacy_hash": 1, "pbkdf2_sha256": 1, "plaintext": 1},
            )
            by_id = {item["id"]: item for item in data["accounts"]}
            self.assertEqual(by_id["user-plaintext"]["password_scheme"], "reset_required")
            self.assertEqual(by_id["user-plaintext"]["password_hash"], "")
            self.assertEqual(by_id["user-legacy"]["password_scheme"], "reset_required")
            report_text = json.dumps(counts, ensure_ascii=False)
            self.assertNotIn("historical plaintext", report_text)
            self.assertNotIn("scrypt$legacy-value", report_text)
            self.assertNotIn("pbkdf2_sha256$", report_text)

    def test_task11_orphan_is_reported_and_blocks_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            connection = sqlite3.connect(database)
            connection.execute("INSERT INTO learning_sync_records VALUES ('missing-user')")
            connection.commit()
            connection.close()
            _, counts = MIGRATION.analyze_source(database)
            self.assertEqual(counts["task11_missing_user_ids"], 1)
            with self.assertRaisesRegex(RuntimeError, "ownership"):
                MIGRATION.validate_task11_ownership(counts)

    def test_apply_is_batched_and_production_requires_explicit_confirmation(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            data, _ = MIGRATION.analyze_source(database)
            args = SimpleNamespace(
                endpoint="https://preview.example",
                environment="preview",
                session_token_env="WYJ_TASK12_TEST_SESSION",
                backup_confirmed=False,
                confirm_production="",
            )
            replies = []

            def fake_request(url, token, payload, production):
                self.assertEqual(token, "masked-test-token")
                self.assertFalse(production)
                if payload is None:
                    return {"ok": True, "counts": {"users": 4, "task11_orphaned_user_ids": 0}}
                replies.append(payload["kind"])
                return {"ok": True, "received": len(payload["records"]), "changed": len(payload["records"])}

            with mock.patch.dict(os.environ, {"WYJ_TASK12_TEST_SESSION": "masked-test-token"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=fake_request
            ):
                result = MIGRATION.apply_import(args, data)
            self.assertEqual(replies, ["accounts", "login_audit"])
            self.assertEqual(result["target_counts"]["users"], 4)

            args.environment = "production"
            with mock.patch.dict(os.environ, {"WYJ_TASK12_TEST_SESSION": "masked-test-token"}):
                with self.assertRaisesRegex(RuntimeError, "Production requires"):
                    MIGRATION.apply_import(args, data)


if __name__ == "__main__":
    unittest.main()
