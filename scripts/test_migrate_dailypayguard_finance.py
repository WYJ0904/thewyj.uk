import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "task16_migration", ROOT / "scripts" / "migrate_dailypayguard_finance.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
USER_ID = "user-stable-16"


def records_text() -> str:
    return (
        "1760000000001\t28.0\t微信支付\t消费\t10:00\n"
        "1760000000002\t50.50\t银行短信\t收款\t10:01\n"
        "1760000000003\t8.8\t支付宝\t退款\t10:02"
    )


class DailyPayGuardMigrationTests(unittest.TestCase):
    def test_plain_export_maps_stable_ids_and_directions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(records_text(), encoding="utf-8")
            records, report = MIGRATION.analyze_source(path, USER_ID)
            MIGRATION.validate_source(report)
            source_key = MIGRATION.resolve_source_key("", USER_ID)
            self.assertEqual(report["source_key"], source_key)
            self.assertEqual([item["id"] for item in records], [
                MIGRATION.stable_record_id(1760000000001, USER_ID, source_key),
                MIGRATION.stable_record_id(1760000000002, USER_ID, source_key),
                MIGRATION.stable_record_id(1760000000003, USER_ID, source_key),
            ])
            self.assertEqual([item["direction"] for item in records], ["expense", "income", "refund"])
            self.assertEqual(records[1]["amount_minor"], 5050)
            self.assertEqual(report["direction_counts"], {"expense": 1, "income": 1, "refund": 1})
            serialized = json.dumps(report, ensure_ascii=False)
            self.assertNotIn("微信支付", serialized)
            self.assertNotIn("银行短信", serialized)
            self.assertNotIn(USER_ID, report["source_key"])

    def test_record_ids_are_stable_and_isolated_by_user_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(records_text(), encoding="utf-8")
            same_first, first_report = MIGRATION.analyze_source(path, USER_ID, "source-alpha-v1")
            same_second, second_report = MIGRATION.analyze_source(path, USER_ID, "source-alpha-v1")
            other_source, _ = MIGRATION.analyze_source(path, USER_ID, "source-beta-v1")
            other_user, other_user_report = MIGRATION.analyze_source(path, "user-stable-17", "source-alpha-v1")
            self.assertEqual(same_first, same_second)
            self.assertEqual(first_report["canonical_sha256"], second_report["canonical_sha256"])
            self.assertTrue(set(item["id"] for item in same_first).isdisjoint(item["id"] for item in other_source))
            self.assertTrue(set(item["id"] for item in same_first).isdisjoint(item["id"] for item in other_user))
            self.assertNotEqual(first_report["canonical_sha256"], other_user_report["canonical_sha256"])

    def test_shared_preferences_xml_is_parsed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "daily_pay_guard_store.xml"
            escaped = records_text().replace("&", "&amp;").replace("<", "&lt;")
            path.write_text(f'<map><string name="records">{escaped}</string><float name="daily_limit" value="80" /></map>', encoding="utf-8")
            records, report = MIGRATION.analyze_source(path, USER_ID, "task16-test-source")
            self.assertEqual(len(records), 3)
            self.assertEqual(report["invalid_count"], 0)

    def test_invalid_and_duplicate_legacy_rows_are_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(
                records_text() + "\n1760000000001\t28\t微信\t消费\t10:03\n1760000000004\t500000\t推广\t额度\t10:04",
                encoding="utf-8",
            )
            _, report = MIGRATION.analyze_source(path, USER_ID)
            self.assertEqual(report["invalid_count"], 2)
            self.assertEqual(
                {item["error_code"] for item in report["invalid_records"]},
                {"duplicate_legacy_timestamp", "legacy_type_unsupported"},
            )
            with self.assertRaisesRegex(RuntimeError, "integrity checks"):
                MIGRATION.validate_source(report)

    def test_digest_is_deterministic_and_changes_with_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(records_text(), encoding="utf-8")
            _, first = MIGRATION.analyze_source(path, USER_ID)
            _, second = MIGRATION.analyze_source(path, USER_ID)
            self.assertEqual(first["canonical_sha256"], second["canonical_sha256"])
            path.write_text(records_text().replace("28.0", "29.0"), encoding="utf-8")
            _, changed = MIGRATION.analyze_source(path, USER_ID)
            self.assertNotEqual(first["canonical_sha256"], changed["canonical_sha256"])

    def test_apply_batches_and_verifies_cloud_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(records_text(), encoding="utf-8")
            records, report = MIGRATION.analyze_source(path, USER_ID, "task16-test-source")
            args = SimpleNamespace(
                environment="preview", source=path, endpoint="https://preview.example",
                session_token_env="WYJ_TASK16_TEST_SESSION", source_key="task16-test-source",
                user_id=USER_ID, backup_dir="", confirm_production="",
            )

            def fake_request(_url, token, payload, production):
                self.assertEqual(token, "masked-session")
                self.assertFalse(production)
                if payload is not None:
                    return {"ok": True, "received": len(payload["records"]), "applied": len(payload["records"])}
                return {"ok": True, "counts": {"transactions": 3}, "imports": [{
                    "source_key": "task16-test-source", "source_count": 3,
                    "received_count": 3, "applied_count": 3, "complete": True,
                    "canonical_sha256": report["canonical_sha256"],
                }]}

            with mock.patch.dict(os.environ, {"WYJ_TASK16_TEST_SESSION": "masked-session"}), mock.patch.object(
                MIGRATION, "request_json", side_effect=fake_request
            ):
                result = MIGRATION.apply_import(args, records, report)
            self.assertEqual(result["received_count"], 3)
            self.assertEqual(result["applied_count"], 3)

    def test_production_requires_confirmation_and_outside_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.txt"
            path.write_text(records_text(), encoding="utf-8")
            args = SimpleNamespace(
                environment="production", source=path, confirm_production="", backup_dir="",
            )
            with self.assertRaisesRegex(RuntimeError, "confirmation phrase"):
                MIGRATION.production_backup(args)
            with self.assertRaisesRegex(RuntimeError, "outside the Git repository"):
                MIGRATION.ensure_outside_repository(ROOT / "artifacts" / "task16.json")

    def test_production_header_never_places_token_in_body(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok":true}'
        with mock.patch("urllib.request.urlopen", return_value=response) as opened:
            MIGRATION.request_json(
                "https://example.test/api/admin/task16/import/rollback",
                "masked-session",
                {"source_key": "task16-test-source"},
                True,
            )
        request = opened.call_args.args[0]
        self.assertEqual(request.headers["X-wyj-task16-production-confirm"], MIGRATION.PRODUCTION_CONFIRMATION)
        self.assertNotIn(b"masked-session", request.data)

    def test_preview_rollback_does_not_require_archived_source_file(self):
        args = SimpleNamespace(
            environment="preview", source="", endpoint="https://preview.example",
            session_token_env="WYJ_TASK16_TEST_SESSION", source_key="task16-test-source",
            backup_dir="", confirm_production="",
        )
        with mock.patch.dict(os.environ, {"WYJ_TASK16_TEST_SESSION": "masked-session"}), mock.patch.object(
            MIGRATION, "request_json", return_value={"ok": True, "rollback": {"rolled_back": 3}}
        ) as requested:
            result = MIGRATION.rollback_import(args)
        self.assertEqual(result["rollback"]["rolled_back"], 3)
        self.assertEqual(requested.call_args.args[2], {"source_key": "task16-test-source"})


if __name__ == "__main__":
    unittest.main()
