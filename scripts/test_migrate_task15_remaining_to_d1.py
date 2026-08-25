import importlib.util
import json
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "task15_remaining_migration", ROOT / "scripts" / "migrate_task15_remaining_to_d1.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
NOW = "2026-08-24T00:00:00Z"


def fixture_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
        CREATE TABLE tool_favorites (
          user_id TEXT, tool_id TEXT, pinned INTEGER, created_at TEXT, updated_at TEXT,
          PRIMARY KEY(user_id, tool_id)
        );
        CREATE TABLE tool_recent_usage (id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, used_at TEXT);
        CREATE TABLE saved_tool_configs (
          id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, name TEXT,
          config_json TEXT, created_at TEXT, updated_at TEXT
        );
        """
    )
    connection.execute("INSERT INTO users VALUES (?, ?)", ("user-stable-1", "private-user"))
    connection.execute(
        "INSERT INTO tool_favorites VALUES (?, ?, ?, ?, ?)",
        ("user-stable-1", "text-stats", 1, NOW, NOW),
    )
    connection.execute(
        "INSERT INTO tool_recent_usage VALUES (?, ?, ?, ?)",
        ("recent-record-1", "user-stable-1", "text-stats", NOW),
    )
    connection.execute(
        "INSERT INTO saved_tool_configs VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "config-record-1", "user-stable-1", "text-stats", "private-name",
            json.dumps({"private_text": "must-not-enter-report"}), NOW, NOW,
        ),
    )
    connection.commit()
    connection.close()


class Task15RemainingMigrationTests(unittest.TestCase):
    def test_dry_run_preserves_stable_ids_without_leaking_config_or_username(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            records, counts = MIGRATION.analyze_source(database)
            MIGRATION.validate_source(counts)
            self.assertEqual(counts["source"], {"favorites": 1, "recent": 1, "configs": 1})
            self.assertEqual(counts["eligible"], counts["source"])
            self.assertEqual(records["recent"][0]["id"], "recent-record-1")
            self.assertEqual(records["configs"][0]["user_id"], "user-stable-1")
            report = json.dumps(counts, ensure_ascii=False)
            self.assertNotIn("private-user", report)
            self.assertNotIn("private-name", report)
            self.assertNotIn("must-not-enter-report", report)
            self.assertRegex(counts["canonical_sha256"], r"^[a-f0-9]{64}$")

    def test_invalid_owner_is_isolated_and_blocks_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            connection = sqlite3.connect(database)
            connection.execute("UPDATE tool_recent_usage SET user_id = 'missing-private-owner'")
            connection.commit()
            connection.close()
            _, counts = MIGRATION.analyze_source(database)
            self.assertEqual(counts["missing_user_count"], 1)
            self.assertEqual(counts["invalid_records"][0]["error_code"], "owner_missing")
            self.assertNotIn("missing-private-owner", json.dumps(counts))
            with self.assertRaisesRegex(RuntimeError, "integrity checks"):
                MIGRATION.validate_source(counts)

    def test_canonical_digest_covers_normalized_record_content(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            _, before = MIGRATION.analyze_source(database)
            connection = sqlite3.connect(database)
            connection.execute(
                "UPDATE saved_tool_configs SET config_json = ? WHERE id = ?",
                (json.dumps({"private_text": "changed-but-still-private"}), "config-record-1"),
            )
            connection.commit()
            connection.close()
            _, after = MIGRATION.analyze_source(database)
            self.assertNotEqual(before["canonical_sha256"], after["canonical_sha256"])
            self.assertNotIn("changed-but-still-private", json.dumps(after))

    def test_apply_batches_all_kinds_and_production_requires_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            records, counts = MIGRATION.analyze_source(database)
            MIGRATION.validate_source(counts)
            args = SimpleNamespace(
                endpoint="https://preview.example",
                environment="preview",
                session_token_env="WYJ_TASK15_TEST_SESSION",
                source_key="task15-test-source",
                source_db=database,
                backup_dir="",
                confirm_production="",
            )
            calls = []

            def fake_request(url, token, payload, production):
                self.assertEqual(token, "masked-session")
                self.assertFalse(production)
                calls.append((url, payload))
                if payload is None:
                    return {
                        "ok": True,
                        "counts": {"favorites": 1, "recent": 1, "configs": 1},
                        "imports": [
                            {
                                "source_key": "task15-test-source",
                                "kind": kind,
                                "source_count": 1,
                                "received_count": 1,
                                "applied_count": 1,
                                "complete": True,
                            }
                            for kind in MIGRATION.KINDS
                        ],
                    }
                return {"ok": True, "received": len(payload["records"]), "applied": len(payload["records"])}

            with mock.patch.dict(os.environ, {"WYJ_TASK15_TEST_SESSION": "masked-session"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=fake_request
            ):
                result = MIGRATION.apply_import(args, records)
            self.assertEqual(result["batches"], 3)
            self.assertEqual(len(result["imports"]), 3)
            self.assertEqual([item[1]["kind"] for item in calls[:3]], list(MIGRATION.KINDS))
            self.assertIsNone(calls[-1][1])

            args.environment = "production"
            with self.assertRaisesRegex(RuntimeError, "confirmation phrase"):
                MIGRATION.apply_import(args, records)

    def test_rollback_uses_fixed_endpoint_and_confirmation_header(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok":true}'
        with mock.patch("urllib.request.urlopen", return_value=response) as opened:
            MIGRATION.request_json(
                "https://example.test/api/admin/task15/import/rollback",
                "masked-session",
                {"source_key": "task15-test-source"},
                True,
            )
        request = opened.call_args.args[0]
        self.assertEqual(request.headers["X-wyj-task15-production-confirm"], MIGRATION.PRODUCTION_CONFIRMATION)
        self.assertNotIn("masked-session", str(request.data))

    def test_apply_rejects_incomplete_cloud_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite3"
            fixture_database(database)
            records, _ = MIGRATION.analyze_source(database)
            args = SimpleNamespace(
                endpoint="https://preview.example",
                environment="preview",
                session_token_env="WYJ_TASK15_TEST_SESSION",
                source_key="task15-test-source",
                source_db=database,
                backup_dir="",
                confirm_production="",
            )

            def incomplete_status(_url, _token, payload, _production):
                if payload is not None:
                    return {"ok": True, "received": len(payload["records"]), "applied": len(payload["records"])}
                return {
                    "ok": True,
                    "counts": {},
                    "imports": [{
                        "source_key": "task15-test-source",
                        "kind": "favorites",
                        "source_count": 1,
                        "received_count": 0,
                        "applied_count": 0,
                        "complete": False,
                    }],
                }

            with mock.patch.dict(os.environ, {"WYJ_TASK15_TEST_SESSION": "masked-session"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=incomplete_status
            ), self.assertRaisesRegex(RuntimeError, "verification failed"):
                MIGRATION.apply_import(args, records)

    def test_production_report_and_backup_must_be_outside_repository(self):
        with self.assertRaisesRegex(RuntimeError, "outside the Git repository"):
            MIGRATION.ensure_outside_repository(ROOT / "artifacts" / "task15.json")

    def test_production_backup_includes_committed_wal_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "source.sqlite3"
            writer = sqlite3.connect(database)
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("CREATE TABLE sample (value TEXT NOT NULL)")
            writer.commit()
            writer.execute("INSERT INTO sample VALUES ('committed-in-wal')")
            writer.commit()
            args = SimpleNamespace(
                environment="production",
                confirm_production=MIGRATION.PRODUCTION_CONFIRMATION,
                backup_dir=str(root / "backups"),
                source_db=database,
            )
            try:
                backup = MIGRATION.production_backup(args)
            finally:
                writer.close()
            with closing(sqlite3.connect(backup)) as restored:
                self.assertEqual(restored.execute("SELECT value FROM sample").fetchone()[0], "committed-in-wal")
                self.assertEqual(restored.execute("PRAGMA quick_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
