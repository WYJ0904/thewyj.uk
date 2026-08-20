import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import closing
from pathlib import Path
from unittest import mock

from scripts import migrate_task11_to_d1 as migration


class Task11MigrationTests(unittest.TestCase):
    def create_source(self, target: Path):
        with closing(sqlite3.connect(target)) as connection:
            connection.executescript(
                """
                CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, secret_hash TEXT);
                INSERT INTO users VALUES ('private-user', 'private-name', 'must-never-enter-report');

                CREATE TABLE feedback_items (
                    id TEXT PRIMARY KEY, user_id TEXT, username TEXT, feedback_type TEXT,
                    title TEXT, content TEXT, route TEXT, tool_id TEXT, app_version TEXT,
                    browser_info TEXT, error_code TEXT, status TEXT, admin_note TEXT,
                    merged_into_id TEXT, created_at TEXT, updated_at TEXT
                );
                INSERT INTO feedback_items VALUES (
                    'feedback-1', 'user-1', 'tester', 'feature_suggestion',
                    'Cloud migration', 'private feedback body', '/select', '', 'test',
                    '', '', 'accepted', '', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'
                );

                CREATE TABLE feedback_votes (
                    feedback_id TEXT, user_id TEXT, created_at TEXT,
                    PRIMARY KEY (feedback_id, user_id)
                );
                INSERT INTO feedback_votes VALUES ('feedback-1', 'user-2', '2026-08-20T00:00:00Z');

                CREATE TABLE admin_audit_logs (
                    id TEXT, actor_user_id TEXT, actor_username TEXT, action TEXT,
                    target_user_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT
                );
                INSERT INTO admin_audit_logs VALUES (
                    'audit-1', 'admin-1', 'admin', 'feedback_update', 'user-1',
                    '{"id":"feedback-1","status":"pending","content":"must be removed"}',
                    '{"id":"feedback-1","status":"accepted","content":"must be removed"}',
                    '2026-08-20T00:01:00Z'
                );

                CREATE TABLE learning_sync_records (
                    user_id TEXT, data_type TEXT, record_id TEXT, payload_json TEXT,
                    updated_at TEXT, deleted INTEGER, client_id TEXT, client_version TEXT,
                    server_version INTEGER, created_at TEXT, server_updated_at TEXT
                );
                INSERT INTO learning_sync_records VALUES (
                    'user-1', 'daily_goal', 'goal:english', '{"target":10}',
                    '2026-08-20T00:00:00Z', 0, 'client-test-1', 'test', 1,
                    '2026-08-20T00:00:00Z', '2026-08-20T00:00:01Z'
                );

                CREATE TABLE learning_sync_heads (user_id TEXT, version INTEGER, updated_at TEXT);
                INSERT INTO learning_sync_heads VALUES ('user-1', 1, '2026-08-20T00:00:01Z');

                CREATE TABLE learning_sync_changes (
                    user_id TEXT, user_version INTEGER, data_type TEXT, record_id TEXT,
                    payload_json TEXT, updated_at TEXT, deleted INTEGER, client_id TEXT,
                    client_version TEXT, created_at TEXT
                );
                INSERT INTO learning_sync_changes VALUES (
                    'user-1', 1, 'daily_goal', 'goal:english', '{"target":10}',
                    '2026-08-20T00:00:00Z', 0, 'client-test-1', 'test',
                    '2026-08-20T00:00:01Z'
                );
                """
            )

    def test_dry_run_validates_and_writes_only_sanitized_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.sqlite3"
            report = root / "report.json"
            self.create_source(source)
            result = subprocess.run(
                [
                    sys.executable,
                    str(migration.ROOT / "scripts" / "migrate_task11_to_d1.py"),
                    "--source-db",
                    str(source),
                    "--dry-run",
                    "--report",
                    str(report),
                ],
                cwd=migration.ROOT,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            payload = json.loads(result.stdout)
            saved = report.read_text(encoding="utf-8")
            self.assertEqual(payload["mode"], "dry-run")
            self.assertEqual(payload["source_counts"]["feedback"], 1)
            self.assertEqual(payload["target_expected_counts"]["learning_records"], 1)
            self.assertTrue(all(value == 0 for value in payload["invalid_counts"].values()))
            self.assertTrue(all(value == 0 for value in payload["duplicate_counts"].values()))
            self.assertFalse(payload["sensitive_content_included_in_report"])
            self.assertNotIn("private feedback body", saved)
            self.assertNotIn("must-never-enter-report", saved)
            self.assertNotIn("must be removed", saved)

    def test_prepare_source_excludes_accounts_and_redacts_audit_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sqlite3"
            self.create_source(source)
            data, source_counts, invalid, duplicates = migration.prepare_source(source)
            self.assertNotIn("users", data)
            self.assertNotIn("sessions", data)
            self.assertNotIn("payments", data)
            self.assertEqual(source_counts["feedback"], 1)
            self.assertEqual(invalid["feedback_audit"], 0)
            self.assertEqual(duplicates["feedback_audit"], 0)
            audit = data["feedback_audit"][0]
            self.assertNotIn("content", audit["before"])
            self.assertNotIn("content", audit["after"])

    def test_duplicate_detection_is_real(self):
        records = [{"id": "same"}, {"id": "same"}, {"id": "other"}]
        unique, count = migration.deduplicate_records("feedback", records)
        self.assertEqual(count, 1)
        self.assertEqual([record["id"] for record in unique], ["same", "other"])

    def test_production_apply_requires_separate_confirmation(self):
        args = Namespace(
            environment="production",
            session_token_env="WYJ_TASK11_TEST_SESSION",
            confirm_production="",
            backup_confirmed=False,
            endpoint="https://preview.example",
        )
        with mock.patch.dict(os.environ, {"WYJ_TASK11_TEST_SESSION": "masked-test-token"}):
            with self.assertRaisesRegex(RuntimeError, "Production requires"):
                migration.apply_import(args, {kind: [] for kind in migration.IMPORT_ORDER})

    def test_remote_endpoint_requires_https(self):
        self.assertEqual(
            migration.endpoint_url("http://127.0.0.1:8788/path", "/api/test"),
            "http://127.0.0.1:8788/api/test",
        )
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            migration.endpoint_url("http://example.com", "/api/test")


if __name__ == "__main__":
    unittest.main()
