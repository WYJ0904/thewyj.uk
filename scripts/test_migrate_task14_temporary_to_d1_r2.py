import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "task14_migration", ROOT / "scripts" / "migrate_task14_temporary_to_d1_r2.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
NOW = "2026-08-23T00:00:00Z"
FUTURE = "2026-08-24T00:00:00Z"
PAST = "2026-08-22T00:00:00Z"
PNG = b"\x89PNG\r\n\x1a\nfixture"


def password_hash():
    salt = base64.urlsafe_b64encode(b"0123456789abcdef").decode().rstrip("=")
    digest = base64.urlsafe_b64encode(b"d" * 32).decode().rstrip("=")
    return f"pbkdf2_sha256$310000${salt}${digest}"


def fixture_database(path: Path):
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (
            id TEXT PRIMARY KEY, username TEXT, secret TEXT,
            registered_at TEXT, role TEXT
        );
        """
    )
    connection.executescript((ROOT / "local-backend" / "migrations" / "001_entitlements_up.sql").read_text(encoding="utf-8"))
    connection.execute("INSERT INTO users (id, username, secret, registered_at, role) VALUES (?, ?, ?, ?, ?)",
                       ("task14-user-one", "task14", "reset", NOW, "user"))
    connection.execute(
        "INSERT INTO temporary_texts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("temporary-text-001", "task14-user-one", "text", "private text", password_hash(), FUTURE, 3, 1, 0, NOW),
    )
    connection.execute(
        "INSERT INTO temporary_texts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("temporary-expired-1", "task14-user-one", "text", "expired private", "", PAST, 3, 0, 0, NOW),
    )
    connection.execute(
        "INSERT INTO temporary_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("temporary-file-0001", "task14-user-one", "sample.png", "image/png", len(PNG), PNG,
         "", FUTURE, 2, 0, 0, NOW),
    )
    connection.execute(
        "INSERT INTO temporary_clipboards VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("temporary-clip-0001", "a" * 64, "task14-user-one", "clipboard private", FUTURE, 0, 1, NOW),
    )
    connection.execute(
        "INSERT INTO temporary_rooms VALUES (?, ?, ?, ?, ?, ?)",
        ("temporary-room-0001", "task14-user-one", "", 10, FUTURE, NOW),
    )
    connection.execute(
        "INSERT INTO temporary_room_messages VALUES (?, ?, ?, ?, ?)",
        ("temporary-msg-00001", "temporary-room-0001", "tester", "room private", NOW),
    )
    connection.commit()
    connection.close()


class Task14MigrationTests(unittest.TestCase):
    def test_dry_run_inventory_is_safe_and_expired_records_are_not_migrated(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            data, counts = MIGRATION.analyze_source(
                database, "preview", datetime(2026, 8, 23, tzinfo=timezone.utc)
            )
            MIGRATION.validate_source(counts)
            self.assertEqual(counts["eligible_shares"], 4)
            self.assertEqual(counts["file_count"], 1)
            self.assertEqual(counts["file_bytes"], len(PNG))
            self.assertEqual(counts["expired_skipped"], 1)
            self.assertEqual(len(data["room_messages"]), 1)
            report = json.dumps(MIGRATION.safe_report(counts), ensure_ascii=False)
            for private in ("private text", "clipboard private", "room private", password_hash()):
                self.assertNotIn(private, report)
            self.assertNotIn(str(database), report)

    def test_invalid_file_is_reported_only_by_id_and_error_code(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            connection = sqlite3.connect(database)
            connection.execute("UPDATE temporary_files SET content = ? WHERE id = ?", (b"secret-invalid", "temporary-file-0001"))
            connection.commit()
            connection.close()
            _, counts = MIGRATION.analyze_source(database, "preview", datetime(2026, 8, 23, tzinfo=timezone.utc))
            self.assertEqual(counts["invalid_files"], [{"id": "temporary-file-0001", "error_code": "file_validation_failed"}])
            with self.assertRaisesRegex(RuntimeError, "blocker_count=1"):
                MIGRATION.validate_source(counts)
            self.assertNotIn("secret-invalid", json.dumps(counts))

    def test_apply_is_batched_repeatable_and_uses_distinct_source_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            data, counts = MIGRATION.analyze_source(database, "preview", datetime(2026, 8, 23, tzinfo=timezone.utc))
            args = SimpleNamespace(
                endpoint="https://preview.example", environment="preview",
                session_token_env="WYJ_TASK14_TEST_SESSION", confirm_production="",
                backup_confirmed=False, source_key="legacy-temporary",
            )
            calls = []

            def fake_request(url, token, payload, production):
                self.assertEqual(token, "masked-token")
                self.assertFalse(production)
                if payload is None:
                    return {"ok": True, "counts": {"shares": 4, "files": 1, "file_bytes": len(PNG)}}
                calls.append(payload["source_key"])
                return {"received": len(payload["records"]), "changed": len(payload["records"])}

            with mock.patch.dict(os.environ, {"WYJ_TASK14_TEST_SESSION": "masked-token"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=fake_request
            ):
                first = MIGRATION.apply_import(args, data, counts)
                second = MIGRATION.apply_import(args, data, counts)
            self.assertEqual(first["status"], second["status"])
            self.assertEqual(calls, ["legacy-temporary:shares", "legacy-temporary:room_messages"] * 2)

    def test_r2_upload_is_private_fixed_key_and_resume_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "source.sqlite3"
            state = root / "resume.json"
            fixture_database(database)
            data, _ = MIGRATION.analyze_source(database, "preview", datetime(2026, 8, 23, tzinfo=timezone.utc))
            with mock.patch.object(MIGRATION, "_npx", return_value="C:/tools/npx.cmd"), mock.patch(
                "subprocess.run", return_value=SimpleNamespace(returncode=0)
            ) as run:
                first = MIGRATION.upload_file_assets(database, data["shares"], "private-preview", "preview", state)
                second = MIGRATION.upload_file_assets(database, data["shares"], "private-preview", "preview", state)
            self.assertEqual(first, {"uploaded": 1, "resumed": 0})
            self.assertEqual(second, {"uploaded": 0, "resumed": 1})
            command = run.call_args.args[0]
            self.assertIn("private-preview/temporary/v1/preview/files/temporary-file-0001", command)
            self.assertIn("private, no-store", command)
            self.assertNotIn(PNG, command)

    def test_production_apply_requires_backup_confirmation(self):
        args = SimpleNamespace(
            environment="production", confirm_production="", backup_confirmed=False,
            session_token_env="WYJ_TASK14_TEST_SESSION", source_key="legacy-temporary", endpoint="https://example.test",
        )
        with self.assertRaisesRegex(RuntimeError, "Production requires"):
            MIGRATION.apply_import(args, {"shares": [], "room_messages": []}, {"file_bytes": 0})


if __name__ == "__main__":
    unittest.main()
