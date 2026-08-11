import tempfile
import unittest
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest import mock
from datetime import datetime, timedelta
from pathlib import Path

from account_store import (
    ADMIN_SECRET,
    MAX_SESSIONS_PER_USER,
    AccountError,
    AccountStore,
    iso_now,
    membership_time_value,
    parse_time,
    utc_now,
)
from membership import MEMBERSHIP_PLANS, public_plan_payload


class AccountStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.store = AccountStore(root / "data" / "users.sqlite3", root / "users.txt")
        self.text_path = root / "users.txt"
        self.admin = self.store.get_user_by_name("wyj")

    def tearDown(self):
        self.temporary.cleanup()

    def register(self, username="user001", secret="ABC1234"):
        return self.store.register(username, secret)

    def test_fixed_admin_is_created_and_strict(self):
        self.assertTrue(self.store.is_super_admin(self.admin))
        token, user = self.store.login("wyj", ADMIN_SECRET)
        self.assertTrue(token)
        self.assertEqual(user["role"], "super_admin")
        for username in ("WYJ", "Wyj"):
            with self.assertRaises(AccountError):
                self.store.login(username, ADMIN_SECRET)

    def test_existing_admin_secret_survives_restart(self):
        local_secret = "LOCAL-ADMIN-ONLY"
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE users SET secret = ? WHERE username_normalized = ?",
                (local_secret, "wyj"),
            )
        restarted = AccountStore(self.store.database_path, self.text_path)
        token, user = restarted.login("wyj", local_secret)
        self.assertTrue(token)
        self.assertTrue(restarted.is_super_admin(user))
        with self.assertRaises(AccountError):
            restarted.login("wyj", ADMIN_SECRET)

    def test_registration_and_case_insensitive_uniqueness(self):
        user = self.register("UserOne")
        self.assertEqual(user["membership"], "free")
        with self.assertRaises(AccountError):
            self.register("userone", "SECOND")
        for reserved in ("wyj", "WYJ", "WyJ"):
            with self.assertRaises(AccountError):
                self.register(reserved, "SECRET")

    def test_new_secrets_require_seven_characters(self):
        with self.assertRaises(AccountError) as raised:
            self.register("short-secret", "123456")
        self.assertEqual(raised.exception.code, "secret_too_short")

    def test_existing_short_secret_still_logs_in_and_can_be_replaced(self):
        user = self.register("legacy-short", "LONG123")
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE users SET secret = ? WHERE id = ?",
                ("123456", user["id"]),
            )
        token, logged_in = self.store.login("legacy-short", "123456")
        self.assertTrue(token)
        self.store.change_own_secret(logged_in["id"], "123456", "REPLACED7")
        self.store.login("legacy-short", "REPLACED7")
        with self.assertRaises(AccountError):
            self.store.login("legacy-short", "123456")

    def test_txt_is_atomically_synchronized_without_plaintext_secrets(self):
        self.register()
        text = self.text_path.read_text(encoding="utf-8")
        self.assertIn("username=user001", text)
        self.assertIn("secret=protected", text)
        self.assertNotIn("ABC1234", text)
        self.assertIn("username=wyj", text)
        with self.store.connect() as connection:
            encoded = connection.execute(
                "SELECT secret FROM users WHERE username_normalized = ?", ("user001",)
            ).fetchone()[0]
        self.assertTrue(encoded.startswith("pbkdf2_sha256$"))
        self.assertNotIn("ABC1234", encoded)

    def test_txt_failure_reports_committed_database_write(self):
        with mock.patch("account_store.os.replace", side_effect=OSError("file is locked")):
            with self.assertRaises(AccountError) as raised:
                self.store.register("committed-user", "VISIBLE7")
        self.assertTrue(raised.exception.committed)
        self.assertEqual(raised.exception.code, "users_txt_sync_failed")
        with self.store.connect() as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE username_normalized = ?", ("committed-user",)
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertFalse(self.text_path.with_name(self.text_path.name + ".tmp").exists())

    def test_login_and_persistent_session(self):
        self.register()
        token, user = self.store.login("USER001", "ABC1234")
        self.assertEqual(user["username"], "user001")
        with self.store.connect() as connection:
            stored_token = connection.execute(
                "SELECT token FROM sessions WHERE user_id = ?", (user["id"],)
            ).fetchone()["token"]
        self.assertNotEqual(stored_token, token)
        self.assertTrue(stored_token.startswith("sha256$"))
        self.assertIsNone(self.store.resolve_session(stored_token))
        self.assertIsNotNone(self.store.resolve_session(token))
        with self.assertRaises(AccountError):
            self.store.login("user001", "WRONG")

    def test_legacy_plaintext_session_is_migrated_without_logging_out(self):
        user = self.register()
        legacy_token = "legacy-session-token"
        now = iso_now()
        with self.store.connect() as connection:
            connection.execute(
                "INSERT INTO sessions (token, user_id, session_version, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
                (legacy_token, user["id"], user["session_version"], now, now),
            )
        restarted = AccountStore(self.store.database_path, self.text_path)
        self.assertIsNotNone(restarted.resolve_session(legacy_token))
        with restarted.connect() as connection:
            stored = connection.execute(
                "SELECT token FROM sessions WHERE user_id = ?", (user["id"],)
            ).fetchone()["token"]
        self.assertNotEqual(stored, legacy_token)
        self.assertTrue(stored.startswith("sha256$"))

    def test_login_prunes_old_and_excess_sessions(self):
        user = self.register()
        tokens = [self.store.login("user001", "ABC1234")[0] for _ in range(MAX_SESSIONS_PER_USER + 4)]
        with self.store.connect() as connection:
            count = connection.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ?", (user["id"],)).fetchone()[0]
        self.assertEqual(count, MAX_SESSIONS_PER_USER)
        self.assertIsNone(self.store.resolve_session(tokens[0]))
        self.assertIsNotNone(self.store.resolve_session(tokens[-1]))

    def test_free_limit_allows_15_and_blocks_16(self):
        user = self.register()
        self.assertEqual(self.store.quiz_limit(user, "english"), 15)
        self.assertEqual(self.store.quiz_limit(user, "japanese"), 15)

    def test_trial_is_unlimited_for_one_language_only(self):
        user = self.register()
        updated = self.store.admin_set_membership(
            self.admin, user["id"], "trial_single_language", trial_language="english"
        )
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "english"))
        self.assertEqual(self.store.quiz_limit(self.store.get_user(user["id"]), "japanese"), 15)
        self.assertEqual(updated["trial_language"], "english")

    def test_single_language_monthly_plan_costs_eight_cny_and_keeps_languages_separate(self):
        plan = MEMBERSHIP_PLANS["trial_single_language"]
        self.assertEqual(plan["price_cents"], 800)
        self.assertTrue(plan["purchasable"])
        self.assertNotIn("tools_access", plan["entitlements"])
        self.assertIn("trial_single_language", {item["code"] for item in public_plan_payload()})

        user = self.register()
        with self.assertRaises(AccountError) as missing_language:
            self.store.create_recharge_request(user, "trial_single_language", "wechat")
        self.assertEqual(missing_language.exception.code, "trial_language_invalid")

        request, created = self.store.create_recharge_request(
            user, "trial_single_language", "alipay", "japanese"
        )
        self.assertTrue(created)
        self.assertEqual(request["amount_cents"], 800)
        self.assertEqual(request["trial_language"], "japanese")
        self.assertEqual(request["payment_method"], "alipay")
        self.assertIn("日语", request["payment_note"])
        self.store.confirm_recharge_payment(user, request["id"])
        self.assertEqual(self.store.process_recharge_request(self.admin, request["id"], "approve"), "approved")
        current = self.store.get_user(user["id"])
        self.assertIsNone(self.store.quiz_limit(current, "japanese"))
        self.assertEqual(self.store.quiz_limit(current, "english"), 15)
        self.assertNotIn("tools_access", self.store.entitlements_for(current))

    def test_repeated_payment_confirmation_never_returns_legacy_contact(self):
        user = self.register("repeat-confirm")
        request, _created = self.store.create_recharge_request(
            user, "all_access_monthly", "wechat"
        )
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE payment_requests SET contact = ? WHERE id = ?",
                ("legacy-contact-must-not-leak", request["id"]),
            )
        first = self.store.confirm_recharge_payment(user, request["id"])
        repeated = self.store.confirm_recharge_payment(user, request["id"])
        for payload in (first, repeated):
            self.assertEqual(payload["status"], "user_paid")
            self.assertNotIn("contact", payload)
            self.assertNotIn("handled_by", payload)

    def test_each_payment_method_persists_until_explicit_confirmation(self):
        for method in ("wechat", "alipay"):
            with self.subTest(method=method):
                user = self.register(f"persist-{method}")
                request, created = self.store.create_recharge_request(
                    user, "tools_monthly", method
                )
                self.assertTrue(created)
                self.assertEqual(request["payment_method"], method)
                self.assertEqual(request["status"], "pending_payment")
                self.assertEqual(request["user_confirmed_at"], "")

                restarted = AccountStore(self.store.database_path, self.text_path)
                restored_user = restarted.get_user(user["id"])
                restored = next(
                    item
                    for item in restarted.list_user_payment_requests(restored_user)
                    if item["id"] == request["id"]
                )
                self.assertEqual(restored["payment_method"], method)
                self.assertEqual(restored["status"], "pending_payment")
                self.assertEqual(
                    restored["qr_resource_id"],
                    f"qr-v1:{method}:tools_monthly",
                )

                confirmed = restarted.confirm_recharge_payment(
                    restored_user, restored["id"]
                )
                self.assertEqual(confirmed["status"], "user_paid")
                self.assertTrue(confirmed["user_confirmed_at"])

    def test_payment_consistency_migration_closes_invalid_legacy_open_order(self):
        user = self.register("legacy-missing-method")
        request, _created = self.store.create_recharge_request(
            user, "all_access_monthly", "wechat"
        )
        self.store.confirm_recharge_payment(user, request["id"])
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE payment_requests SET payment_method = '', qr_resource_id = '' WHERE id = ?",
                (request["id"],),
            )
            connection.execute(
                "DELETE FROM schema_migrations WHERE version = ?",
                ("005_payment_method_consistency",),
            )

        restarted = AccountStore(self.store.database_path, self.text_path)
        restored_user = restarted.get_user(user["id"])
        restored = next(
            item
            for item in restarted.list_user_payment_requests(restored_user)
            if item["id"] == request["id"]
        )
        self.assertEqual(restored["status"], "cancelled")
        self.assertEqual(restored["payment_method"], "")
        replacement, created = restarted.create_recharge_request(
            restored_user, "all_access_monthly", "alipay"
        )
        self.assertTrue(created)
        self.assertEqual(replacement["payment_method"], "alipay")
        self.assertEqual(replacement["status"], "pending_payment")
        with restarted.connect() as connection:
            events = connection.execute(
                "SELECT COUNT(*) FROM payment_request_events WHERE id = ?",
                (f"migration-005-payment-{request['id']}",),
            ).fetchone()[0]
        self.assertEqual(events, 1)

    def test_payment_confirmation_rejects_corrupted_method_binding(self):
        user = self.register("corrupt-payment")
        request, _created = self.store.create_recharge_request(
            user, "tools_monthly", "wechat"
        )
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE payment_requests SET payment_method = '', qr_resource_id = '' WHERE id = ?",
                (request["id"],),
            )
        with self.assertRaises(AccountError) as invalid:
            self.store.confirm_recharge_payment(user, request["id"])
        self.assertEqual(invalid.exception.code, "payment_method_invalid")

    def test_cancelled_membership_can_be_granted_again_without_duplicate_record(self):
        user = self.register()
        self.store.admin_manage_membership(
            self.admin, user["id"], "grant", "trial_single_language", trial_language="english"
        )
        self.store.admin_manage_membership(
            self.admin, user["id"], "cancel", "trial_single_language"
        )
        updated = self.store.admin_manage_membership(
            self.admin, user["id"], "grant", "trial_single_language", trial_language="japanese"
        )
        active = [item for item in updated["memberships"] if item["plan_code"] == "trial_single_language"]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["metadata"]["language"], "japanese")

    def test_monthly_and_lifetime_are_unlimited(self):
        user = self.register()
        self.store.admin_set_membership(self.admin, user["id"], "monthly")
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "english"))

    def test_membership_dates_accept_common_separators_and_end_at_day_end(self):
        local_zone = datetime.now().astimezone().tzinfo
        for value in ("2099/01/02", "2099.01.02", "2099。01。02", "2099 01 02"):
            parsed = parse_time(membership_time_value(value, end_of_day=True)).astimezone(local_zone)
            self.assertEqual((parsed.year, parsed.month, parsed.day), (2099, 1, 2))
            self.assertEqual((parsed.hour, parsed.minute, parsed.second), (23, 59, 59))

        user = self.register()
        updated = self.store.admin_set_membership(
            self.admin,
            user["id"],
            "monthly",
            start="2099/01/01",
            expires="2099。02。01",
        )
        start_local = parse_time(updated["membership_start"]).astimezone(local_zone)
        expiry_local = parse_time(updated["membership_expires"]).astimezone(local_zone)
        current_local = datetime.now().astimezone(local_zone)
        self.assertEqual((start_local.year, start_local.month, start_local.day), (2099, 1, 1))
        self.assertLessEqual(
            abs((start_local.hour * 3600 + start_local.minute * 60 + start_local.second)
                - (current_local.hour * 3600 + current_local.minute * 60 + current_local.second)),
            3,
        )
        self.assertEqual((expiry_local.year, expiry_local.month, expiry_local.day), (2099, 2, 1))
        self.assertEqual((expiry_local.hour, expiry_local.minute, expiry_local.second), (23, 59, 59))

        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "japanese"))
        self.store.admin_set_membership(self.admin, user["id"], "lifetime")
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "english"))

    def test_expired_memberships_revert_to_free(self):
        user = self.register()
        expired = (utc_now() - timedelta(seconds=5)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        self.store.admin_set_membership(
            self.admin,
            user["id"],
            "trial_single_language",
            start=iso_now(),
            expires=expired,
            trial_language="english",
        )
        current = self.store.get_user(user["id"])
        self.assertEqual(current["membership"], "free")
        self.assertEqual(self.store.quiz_limit(current, "english"), 15)

    def test_secret_change_invalidates_old_sessions_and_updates_txt(self):
        user = self.register()
        token, _ = self.store.login("user001", "ABC1234")
        self.store.change_own_secret(user["id"], "ABC1234", "NEW4567")
        self.assertIsNone(self.store.resolve_session(token))
        text = self.text_path.read_text(encoding="utf-8")
        self.assertIn("secret=protected", text)
        self.assertNotIn("NEW4567", text)
        self.store.login("user001", "NEW4567")

    def test_admin_secret_reset_is_hash_only_and_never_exposed(self):
        user = self.register()
        token, _ = self.store.login("user001", "ABC1234")
        replacement = "Admin-Reset-789!"
        self.store.admin_change_secret(self.admin, user["id"], replacement)
        self.assertIsNone(self.store.resolve_session(token))
        with self.store.connect() as connection:
            encoded = connection.execute("SELECT secret FROM users WHERE id = ?", (user["id"],)).fetchone()[0]
        self.assertTrue(encoded.startswith("pbkdf2_sha256$"))
        self.assertNotEqual(encoded, replacement)
        listed_user = next(item for item in self.store.list_users() if item["id"] == user["id"])
        self.assertNotIn("secret", listed_user)
        self.assertNotIn(replacement, str(self.store.list_audit_logs(self.admin)))
        with self.assertRaises(AccountError):
            self.store.login("user001", "ABC1234")
        self.store.login("user001", replacement)

    def test_ban_invalidates_session_and_unban_restores_login(self):
        user = self.register()
        token, _ = self.store.login("user001", "ABC1234")
        self.store.admin_set_ban(self.admin, user["id"], True)
        self.assertIsNone(self.store.resolve_session(token))
        with self.assertRaises(AccountError):
            self.store.login("user001", "ABC1234")
        self.store.admin_set_ban(self.admin, user["id"], False)
        token, _ = self.store.login("user001", "ABC1234")
        self.assertTrue(token)

    def test_self_delete_removes_database_txt_and_sessions(self):
        user = self.register()
        token, _ = self.store.login("user001", "ABC1234")
        self.store.delete_own_account(user["id"], "ABC1234")
        self.assertIsNone(self.store.get_user(user["id"]))
        self.assertIsNone(self.store.resolve_session(token))
        self.assertNotIn("username=user001", self.text_path.read_text(encoding="utf-8"))
        replacement = self.register("user001", "REUSED7")
        self.assertIsNotNone(replacement)

    def test_admin_cannot_be_deleted_banned_downgraded_or_changed(self):
        protected_calls = (
            lambda: self.store.admin_delete_user(self.admin, self.admin["id"]),
            lambda: self.store.admin_set_ban(self.admin, self.admin["id"], True),
            lambda: self.store.admin_set_membership(self.admin, self.admin["id"], "free"),
            lambda: self.store.admin_change_secret(self.admin, self.admin["id"], "NEW"),
        )
        for call in protected_calls:
            with self.assertRaises(AccountError):
                call()

    def test_recharge_request_is_locked_manual_and_requires_cancel_to_change(self):
        user = self.register()
        first, created = self.store.create_recharge_request(
            user, "all_access_monthly", "wechat"
        )
        second, created_again = self.store.create_recharge_request(
            user, "all_access_monthly", "wechat"
        )
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(self.store.get_user(user["id"])["membership"], "free")
        with self.assertRaises(AccountError) as pending:
            self.store.process_recharge_request(self.admin, first["id"], "approve")
        self.assertEqual(pending.exception.code, "request_already_processed")
        with self.assertRaises(AccountError) as conflict:
            self.store.create_recharge_request(user, "all_access_lifetime", "alipay")
        self.assertEqual(conflict.exception.code, "payment_order_conflict")
        cancelled = self.store.cancel_recharge_request(user, first["id"])
        self.assertEqual(cancelled["status"], "cancelled")
        replacement, replacement_created = self.store.create_recharge_request(
            user, "all_access_lifetime", "alipay"
        )
        self.assertTrue(replacement_created)
        self.store.confirm_recharge_payment(user, replacement["id"])
        status = self.store.process_recharge_request(self.admin, replacement["id"], "approve")
        self.assertEqual(status, "approved")
        self.assertEqual(self.store.get_user(user["id"])["membership"], "lifetime")
        with self.assertRaises(AccountError):
            self.store.create_recharge_request(user, "monthly", "wechat")

    def test_all_six_purchasable_plans_require_manual_approval_and_grant_expected_rights(self):
        cases = {
            "trial_single_language": {
                "language": "english",
                "included": {"language_english_access"},
                "excluded": {"language_japanese_access", "language_all_access", "tools_access"},
            },
            "dual_language_monthly": {
                "included": {"language_english_access", "language_japanese_access", "language_all_access"},
                "excluded": {"tools_access"},
            },
            "tools_monthly": {
                "included": {"tools_access", "tools_batch_access", "temporary_share_access", "save_tool_config"},
                "excluded": {"language_english_access", "language_japanese_access", "language_all_access"},
            },
            "all_access_monthly": {
                "included": {"language_english_access", "language_japanese_access", "language_all_access", "tools_access"},
                "excluded": set(),
            },
            "japanese_lifetime": {
                "included": {"language_english_access", "language_japanese_access", "language_all_access"},
                "excluded": {"tools_access"},
            },
            "all_access_lifetime": {
                "included": {"language_english_access", "language_japanese_access", "language_all_access", "tools_access"},
                "excluded": set(),
            },
        }
        self.assertEqual(set(cases), {code for code, plan in MEMBERSHIP_PLANS.items() if plan["purchasable"]})

        for index, (plan_code, expected) in enumerate(cases.items()):
            with self.subTest(plan=plan_code):
                user = self.register(f"plan-user-{index}")
                request, created = self.store.create_recharge_request(
                    user,
                    plan_code,
                    "wechat" if index % 2 == 0 else "alipay",
                    expected.get("language", ""),
                )
                self.assertTrue(created)
                self.assertEqual(request["amount_cents"], MEMBERSHIP_PLANS[plan_code]["price_cents"])
                self.assertEqual(self.store.user_payload(self.store.get_user(user["id"]))["entitlements"], [])

                confirmed = self.store.confirm_recharge_payment(user, request["id"])
                self.assertEqual(confirmed["status"], "user_paid")
                self.assertEqual(self.store.user_payload(self.store.get_user(user["id"]))["entitlements"], [])

                status = self.store.process_recharge_request(self.admin, request["id"], "approve")
                self.assertEqual(status, "approved")
                payload = self.store.user_payload(self.store.get_user(user["id"]))
                self.assertTrue(expected["included"].issubset(payload["entitlements"]))
                self.assertTrue(expected["excluded"].isdisjoint(payload["entitlements"]))
                active_codes = {item["plan_code"] for item in payload["memberships"] if item["status"] == "active"}
                self.assertIn(plan_code, active_codes)
                approved = next(
                    item for item in self.store.list_recharge_requests(self.admin)
                    if item["id"] == request["id"]
                )
                self.assertEqual(approved["status"], "approved")
                self.assertEqual([item["to_status"] for item in approved["history"]], [
                    "pending_payment", "user_paid", "processing", "approved",
                ])

    def test_new_memberships_merge_entitlements_without_granting_tools_to_bilingual_lifetime(self):
        user = self.register()
        japanese = self.store.admin_manage_membership(
            self.admin, user["id"], "grant", "japanese_lifetime"
        )
        self.assertIn("language_japanese_access", japanese["entitlements"])
        self.assertIn("language_english_access", japanese["entitlements"])
        self.assertIn("language_all_access", japanese["entitlements"])
        self.assertNotIn("tools_access", japanese["entitlements"])
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "japanese"))
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "english"))
        self.assertEqual(self.store.get_user(user["id"])["membership"], "lifetime")

        full = self.store.admin_manage_membership(
            self.admin, user["id"], "grant", "all_access_monthly"
        )
        self.assertIn("tools_access", full["entitlements"])
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(user["id"]), "english"))
        self.store.admin_manage_membership(
            self.admin, user["id"], "cancel", "all_access_monthly"
        )
        remaining = self.store.user_payload(self.store.get_user(user["id"]))
        self.assertNotIn("tools_access", remaining["entitlements"])
        self.assertIn("language_japanese_access", remaining["entitlements"])
        self.assertIn("language_english_access", remaining["entitlements"])

    def test_tools_and_dual_language_monthly_plans_keep_rights_separate(self):
        tools_user = self.register("tools-only")
        tools_payload = self.store.admin_manage_membership(
            self.admin, tools_user["id"], "grant", "tools_monthly"
        )
        self.assertIn("tools_access", tools_payload["entitlements"])
        self.assertNotIn("language_all_access", tools_payload["entitlements"])
        self.assertEqual(self.store.quiz_limit(self.store.get_user(tools_user["id"]), "english"), 15)
        self.assertEqual(self.store.quiz_limit(self.store.get_user(tools_user["id"]), "japanese"), 15)

        dual_user = self.register("dual-only")
        dual_payload = self.store.admin_manage_membership(
            self.admin, dual_user["id"], "grant", "dual_language_monthly"
        )
        self.assertIn("language_all_access", dual_payload["entitlements"])
        self.assertNotIn("tools_access", dual_payload["entitlements"])
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(dual_user["id"]), "english"))
        self.assertIsNone(self.store.quiz_limit(self.store.get_user(dual_user["id"]), "japanese"))
        self.assertEqual(self.store.get_user(dual_user["id"])["membership"], "monthly")

    def test_admin_membership_changes_survive_restarts_without_false_migration_failure(self):
        user = self.register("restart-membership")
        now = iso_now()
        with self.store.connect() as connection:
            connection.execute(
                """
                INSERT INTO user_memberships (
                    id, user_id, plan_code, starts_at, expires_at, is_lifetime,
                    status, source, source_ref, created_by, metadata_json, created_at, updated_at
                ) VALUES (?, ?, 'dual_language_lifetime', ?, '', 1, 'active',
                    'legacy_import', 'legacy-dual-record', 'migration', '{}', ?, ?)
                """,
                ("legacy-dual-membership", user["id"], now, now, now),
            )

        restarted = AccountStore(self.store.database_path, self.text_path)
        payload = restarted.user_payload(restarted.get_user(user["id"]))
        self.assertIn("language_all_access", payload["entitlements"])
        self.assertNotIn("tools_access", payload["entitlements"])

        restarted_admin = restarted.get_user(self.admin["id"])
        restarted.admin_manage_membership(
            restarted_admin, user["id"], "cancel", "dual_language_lifetime"
        )
        restarted_again = AccountStore(self.store.database_path, self.text_path)
        payload = restarted_again.user_payload(restarted_again.get_user(user["id"]))
        self.assertEqual(payload["membership"], "free")
        self.assertNotIn("language_all_access", payload["entitlements"])

    def test_retired_membership_cannot_be_granted_or_extended_but_can_be_cancelled(self):
        user = self.register("retired-membership")
        for action in ("grant", "extend"):
            with self.assertRaises(AccountError) as raised:
                self.store.admin_manage_membership(
                    self.admin, user["id"], action, "dual_language_lifetime"
                )
            self.assertEqual(raised.exception.code, "plan_retired")

        now = iso_now()
        with self.store.connect() as connection:
            connection.execute(
                """
                INSERT INTO user_memberships (
                    id, user_id, plan_code, starts_at, expires_at, is_lifetime,
                    status, source, source_ref, created_by, metadata_json, created_at, updated_at
                ) VALUES (?, ?, 'dual_language_lifetime', ?, '', 1, 'active',
                    'legacy_import', 'retired-cancel-record', 'migration', '{}', ?, ?)
                """,
                ("retired-cancel-membership", user["id"], now, now, now),
            )
        cancelled = self.store.admin_manage_membership(
            self.admin, user["id"], "cancel", "dual_language_lifetime"
        )
        self.assertNotIn("language_all_access", cancelled["entitlements"])

    def test_login_audit_is_bounded_protected_and_contains_no_secrets(self):
        user = self.register("audit-user", "AuditSecret1")
        context = {
            "ip_address": "203.0.113.18",
            "country": "CN",
            "region": "Guangdong",
            "city": "Shenzhen",
            "user_agent": "Test Browser",
            "source": "cloudflare_pages",
        }
        with mock.patch("account_store.LOGIN_AUDIT_MAX_RECORDS", 3):
            for index in range(5):
                self.store.record_login_event(
                    user["username"],
                    index % 2 == 0,
                    "success" if index % 2 == 0 else "invalid_credentials",
                    context=context,
                    user=user,
                )
        logs = self.store.list_login_audit_logs(self.admin)
        self.assertEqual(len(logs), 3)
        self.assertEqual(logs[0]["ip_address"], "203.0.113.18")
        self.assertEqual(logs[0]["city"], "Shenzhen")
        self.assertNotIn("AuditSecret1", str(logs))
        with self.assertRaises(AccountError):
            self.store.list_login_audit_logs(user)

    def test_legacy_membership_migration_is_idempotent_and_does_not_add_tools(self):
        user = self.register()
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE users SET membership = 'lifetime', membership_start = ? WHERE id = ?",
                (iso_now(), user["id"]),
            )
        restarted = AccountStore(self.store.database_path, self.text_path)
        restarted_again = AccountStore(self.store.database_path, self.text_path)
        payload = restarted_again.user_payload(restarted_again.get_user(user["id"]))
        legacy = [item for item in payload["memberships"] if item["plan_code"] == "legacy_all_lifetime"]
        self.assertEqual(len(legacy), 1)
        self.assertIn("language_all_access", payload["entitlements"])
        self.assertNotIn("tools_access", payload["entitlements"])

    def test_pre_migration_database_is_backed_up_once(self):
        root = Path(self.temporary.name) / "legacy"
        database = root / "data" / "users.sqlite3"
        text_path = root / "users.txt"
        database.parent.mkdir(parents=True)
        schema = (Path(__file__).with_name("migrations") / "pre-001-schema.sql").read_text(encoding="utf-8")
        now = iso_now()
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript(schema)
            connection.execute(
                """
                INSERT INTO users (
                    id, username, username_normalized, secret, role, membership,
                    membership_start, registered_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'user', 'lifetime', ?, ?, ?, ?)
                """,
                ("legacy-user", "legacy", "legacy", "OLD-SECRET", now, now, now, now),
            )
            connection.commit()
        migrated = AccountStore(database, text_path)
        backup = database.with_name("users.pre-entitlements-001.sqlite3")
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(backup)) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            self.assertNotIn("user_memberships", tables)
            self.assertEqual(connection.execute("SELECT secret FROM users WHERE id = 'legacy-user'").fetchone()[0], "OLD-SECRET")
        payload = migrated.user_payload(migrated.get_user("legacy-user"))
        self.assertIn("language_all_access", payload["entitlements"])
        self.assertNotIn("tools_access", payload["entitlements"])
        migrated.login("legacy", "OLD-SECRET")
        backup_bytes = backup.read_bytes()
        AccountStore(database, text_path)
        self.assertEqual(backup.read_bytes(), backup_bytes)

    def test_single_language_order_migration_is_backed_up_once(self):
        root = Path(self.temporary.name) / "entitlements-v1"
        database = root / "data" / "users.sqlite3"
        text_path = root / "users.txt"
        database.parent.mkdir(parents=True)
        migrations = Path(__file__).with_name("migrations")
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript((migrations / "pre-001-schema.sql").read_text(encoding="utf-8"))
            connection.executescript((migrations / "001_entitlements_up.sql").read_text(encoding="utf-8"))
        migrated = AccountStore(database, text_path)
        backup = database.with_name("users.pre-single-language-002.sqlite3")
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(backup)) as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")}
            self.assertNotIn("trial_language", columns)
        with migrated.connect() as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")}
            self.assertIn("trial_language", columns)
        backup_bytes = backup.read_bytes()
        AccountStore(database, text_path)
        self.assertEqual(backup.read_bytes(), backup_bytes)

    def test_legacy_pending_orders_keep_original_price_and_rights(self):
        user = self.register()
        now = iso_now()
        with self.store.connect() as connection:
            connection.execute(
                """
                INSERT INTO recharge_requests (
                    id, user_id, username, plan, status, requested_at, updated_at
                ) VALUES (?, ?, ?, 'monthly', 'pending', ?, ?)
                """,
                ("legacy-order", user["id"], user["username"], now, now),
            )
        restarted = AccountStore(self.store.database_path, self.text_path)
        request = next(item for item in restarted.list_recharge_requests(self.admin) if item["id"] == "legacy-order")
        self.assertEqual(request["plan_code"], "legacy_all_monthly")
        self.assertEqual(request["amount_cents"], 1000)
        restarted.process_recharge_request(self.admin, request["id"], "approve")
        payload = restarted.user_payload(restarted.get_user(user["id"]))
        self.assertIn("language_all_access", payload["entitlements"])
        self.assertNotIn("tools_access", payload["entitlements"])

    def test_legacy_single_language_order_keeps_old_price_and_language(self):
        user = self.register()
        now = iso_now()
        with self.store.connect() as connection:
            connection.execute(
                """
                INSERT INTO recharge_requests (
                    id, user_id, username, plan, trial_language, status, requested_at, updated_at
                ) VALUES (?, ?, ?, 'trial_single_language', 'english', 'pending', ?, ?)
                """,
                ("legacy-trial-order", user["id"], user["username"], now, now),
            )
        restarted = AccountStore(self.store.database_path, self.text_path)
        request = next(
            item for item in restarted.list_recharge_requests(self.admin)
            if item["id"] == "legacy-trial-order"
        )
        self.assertEqual(request["amount_cents"], 500)
        self.assertEqual(request["trial_language"], "english")

    def test_expired_all_access_monthly_loses_tools_but_keeps_japanese(self):
        user = self.register()
        self.store.admin_manage_membership(self.admin, user["id"], "grant", "japanese_lifetime")
        expired = (utc_now() - timedelta(seconds=5)).isoformat().replace("+00:00", "Z")
        self.store.admin_manage_membership(
            self.admin,
            user["id"],
            "grant",
            "all_access_monthly",
            expires=expired,
        )
        payload = self.store.user_payload(self.store.get_user(user["id"]))
        self.assertNotIn("tools_access", payload["entitlements"])
        self.assertIn("language_japanese_access", payload["entitlements"])
        monthly = [item for item in self.store.memberships_for(self.store.get_user(user["id"]), include_inactive=True) if item["plan_code"] == "all_access_monthly"]
        self.assertEqual(monthly[0]["status"], "expired")

    def test_admin_actions_create_audit_logs(self):
        user = self.register()
        self.store.admin_manage_membership(
            self.admin, user["id"], "grant", "all_access_lifetime", note="test grant"
        )
        self.store.admin_set_entitlement_override(
            self.admin, user["id"], "tools_access", False, note="test override"
        )
        logs = self.store.list_audit_logs(self.admin)
        self.assertEqual(logs[0]["action"], "entitlement_override")
        self.assertEqual(logs[1]["action"], "membership_grant")
        self.assertEqual(logs[0]["target_user_id"], user["id"])

    def test_concurrent_payment_approval_only_succeeds_once(self):
        user = self.register()
        request, _created = self.store.create_recharge_request(
            user, "all_access_lifetime", "wechat"
        )
        self.store.confirm_recharge_payment(user, request["id"])

        def approve():
            try:
                return self.store.process_recharge_request(self.admin, request["id"], "approve")
            except AccountError as exc:
                return exc.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _item: approve(), range(2)))

        self.assertEqual(results.count("approved"), 1)
        self.assertEqual(results.count("request_already_processed"), 1)
        memberships = [
            item
            for item in self.store.memberships_for(self.store.get_user(user["id"]), include_inactive=True)
            if item["plan_code"] == "all_access_lifetime" and item["status"] == "active"
        ]
        self.assertEqual(len(memberships), 1)
        with self.store.connect() as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM payment_fulfillments WHERE payment_request_id = ?",
                    (request["id"],),
                ).fetchone()[0],
                1,
            )

    def test_payment_approval_rolls_back_processing_and_history_on_failure(self):
        user = self.register("rollback-user")
        request, _created = self.store.create_recharge_request(
            user, "all_access_monthly", "wechat"
        )
        self.store.confirm_recharge_payment(user, request["id"])
        injected = AccountError("injected fulfillment failure", 500, "injected_failure")
        with mock.patch.object(
            self.store,
            "_fulfill_payment_in_transaction",
            side_effect=injected,
        ):
            with self.assertRaises(AccountError) as raised:
                self.store.process_recharge_request(
                    self.admin, request["id"], "approve", admin_note="rollback test"
                )
        self.assertEqual(raised.exception.code, "injected_failure")
        current = next(
            item
            for item in self.store.list_recharge_requests(self.admin)
            if item["id"] == request["id"]
        )
        self.assertEqual(current["status"], "user_paid")
        self.assertEqual(
            [event["to_status"] for event in current["history"]],
            ["pending_payment", "user_paid"],
        )
        with self.store.connect() as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM payment_fulfillments WHERE payment_request_id = ?",
                    (request["id"],),
                ).fetchone()[0],
                0,
            )

    def test_monthly_payment_renews_from_remaining_expiry_by_calendar_month(self):
        user = self.register("renew-user")
        original_expiry = utc_now() + timedelta(days=12)
        original_expiry_text = original_expiry.replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )
        self.store.admin_manage_membership(
            self.admin,
            user["id"],
            "grant",
            "all_access_monthly",
            expires=original_expiry_text,
        )
        request, _created = self.store.create_recharge_request(
            user, "all_access_monthly", "alipay"
        )
        self.store.confirm_recharge_payment(user, request["id"])
        self.store.process_recharge_request(self.admin, request["id"], "approve")
        with self.store.connect() as connection:
            renewed = connection.execute(
                """
                SELECT membership.expires_at
                FROM payment_fulfillments AS fulfillment
                JOIN user_memberships AS membership
                  ON membership.id = fulfillment.user_membership_id
                WHERE fulfillment.payment_request_id = ?
                """,
                (request["id"],),
            ).fetchone()
        self.assertIsNotNone(renewed)
        renewed_expiry = parse_time(renewed["expires_at"])
        self.assertGreater(renewed_expiry, original_expiry + timedelta(days=27))

    def test_repeated_japanese_lifetime_payment_reuses_membership_without_duplicate_rights(self):
        user = self.register("repeat-lifetime")
        request_ids = []
        for method in ("wechat", "alipay"):
            request, _created = self.store.create_recharge_request(
                user, "japanese_lifetime", method
            )
            request_ids.append(request["id"])
            self.store.confirm_recharge_payment(user, request["id"])
            self.store.process_recharge_request(self.admin, request["id"], "approve")
        active = [
            item
            for item in self.store.memberships_for(
                self.store.get_user(user["id"]), include_inactive=True
            )
            if item["plan_code"] == "japanese_lifetime"
            and item["status"] == "active"
        ]
        self.assertEqual(len(active), 1)
        payload = self.store.user_payload(self.store.get_user(user["id"]))
        self.assertIn("language_japanese_access", payload["entitlements"])
        self.assertIn("language_english_access", payload["entitlements"])
        self.assertIn("language_all_access", payload["entitlements"])
        self.assertNotIn("tools_access", payload["entitlements"])
        with self.store.connect() as connection:
            fulfillments = connection.execute(
                """
                SELECT payment_request_id, user_membership_id
                FROM payment_fulfillments
                WHERE payment_request_id IN (?, ?)
                ORDER BY payment_request_id
                """,
                request_ids,
            ).fetchall()
        self.assertEqual(len(fulfillments), 2)
        self.assertEqual(len({row["user_membership_id"] for row in fulfillments}), 1)

        restarted = AccountStore(self.store.database_path, self.text_path)
        restarted_payload = restarted.user_payload(restarted.get_user(user["id"]))
        self.assertIn("language_english_access", restarted_payload["entitlements"])
        self.assertIn("language_japanese_access", restarted_payload["entitlements"])
        self.assertNotIn("tools_access", restarted_payload["entitlements"])

    def test_old_lifetime_payment_snapshot_uses_current_public_name_without_rewriting_db(self):
        user = self.register("old-plan-name")
        request, _created = self.store.create_recharge_request(
            user, "japanese_lifetime", "wechat"
        )
        with self.store.connect() as connection:
            connection.execute(
                "UPDATE payment_requests SET plan_name_snapshot = ?, payment_note = ? WHERE id = ?",
                (
                    "日语单项永久会员",
                    f"{user['username']} {request['order_number']} 日语单项永久会员",
                    request["id"],
                ),
            )
        public_request = self.store.list_user_payment_requests(user)[0]
        self.assertEqual(public_request["plan_name"], "双语言双项永久会员")
        self.assertIn("双语言双项永久会员", public_request["payment_note"])
        with self.store.connect() as connection:
            stored = connection.execute(
                "SELECT plan_name_snapshot FROM payment_requests WHERE id = ?",
                (request["id"],),
            ).fetchone()
        self.assertEqual(stored["plan_name_snapshot"], "日语单项永久会员")

    def test_payment_history_records_the_complete_state_machine(self):
        user = self.register("history-user")
        request, _created = self.store.create_recharge_request(
            user, "tools_monthly", "wechat"
        )
        self.store.confirm_recharge_payment(user, request["id"])
        self.store.process_recharge_request(
            self.admin, request["id"], "reject", admin_note="receipt mismatch"
        )
        current = next(
            item
            for item in self.store.list_recharge_requests(self.admin)
            if item["id"] == request["id"]
        )
        self.assertEqual(current["status"], "rejected")
        self.assertEqual(
            [event["to_status"] for event in current["history"]],
            ["pending_payment", "user_paid", "processing", "rejected"],
        )
        self.assertEqual(current["history"][-1]["note"], "receipt mismatch")
        self.assertNotIn(
            "tools_access",
            self.store.user_payload(self.store.get_user(user["id"]))["entitlements"],
        )

    def test_payment_flow_migration_is_backed_up_once(self):
        root = Path(self.temporary.name) / "payment-v3"
        database = root / "data" / "users.sqlite3"
        text_path = root / "users.txt"
        database.parent.mkdir(parents=True)
        migrations = Path(__file__).with_name("migrations")
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript(
                (migrations / "pre-001-schema.sql").read_text(encoding="utf-8")
            )
            for migration in (
                "001_entitlements_up.sql",
                "002_single_language_orders_up.sql",
                "003_login_audit_up.sql",
            ):
                connection.executescript(
                    (migrations / migration).read_text(encoding="utf-8")
                )
        migrated = AccountStore(database, text_path)
        backup = database.with_name("users.pre-payment-004.sqlite3")
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(backup)) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
        self.assertNotIn("payment_method", columns)
        self.assertNotIn("payment_fulfillments", tables)
        with migrated.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
        self.assertIn("payment_method", columns)
        self.assertIn("payment_fulfillments", tables)
        backup_bytes = backup.read_bytes()
        AccountStore(database, text_path)
        self.assertEqual(backup.read_bytes(), backup_bytes)

    def test_feedback_is_private_validated_and_vote_is_one_per_user(self):
        first = self.register("feedback-first")
        second = self.register("feedback-second")
        created = self.store.create_feedback(
            first,
            {
                "type": "feature_suggestion",
                "title": "Add a compact review mode",
                "content": "Please add a compact review mode for small screens.",
                "route": "/language/english",
                "tool_id": "",
                "app_version": "2026.08.11",
                "browser_info": "TestBrowser/1.0",
                "error_code": "",
            },
        )
        self.assertEqual([item["id"] for item in self.store.list_user_feedback(first)], [created["id"]])
        self.assertEqual(self.store.list_user_feedback(second), [])

        with self.assertRaises(AccountError) as unknown_field:
            self.store.create_feedback(
                first,
                {
                    "type": "other",
                    "title": "Unexpected field",
                    "content": "This must be rejected.",
                    "session": "must-not-be-collected",
                },
            )
        self.assertEqual(unknown_field.exception.code, "feedback_fields_forbidden")
        with self.assertRaises(AccountError) as sensitive_content:
            self.store.create_feedback(
                first,
                {
                    "type": "account_issue",
                    "title": "Sensitive content",
                    "content": "password=SecretValue123",
                },
            )
        self.assertEqual(sensitive_content.exception.code, "feedback_sensitive_data")

        for local_path in (
            "C:" + "\\" + "Users" + "\\someone\\Desktop\\private.txt",
            "/" + "home" + "/someone/private.txt",
            "/" + "Users" + "/someone/private.txt",
        ):
            with self.subTest(local_path=local_path), self.assertRaises(AccountError) as local_path_error:
                self.store.create_feedback(
                    first,
                    {
                        "type": "page_issue",
                        "title": "Local path",
                        "content": local_path,
                    },
                )
            self.assertEqual(local_path_error.exception.code, "feedback_sensitive_data")

        accepted = self.store.admin_update_feedback(
            self.admin,
            created["id"],
            "update",
            status="accepted",
            admin_note="Accepted for planning",
        )
        self.assertEqual(accepted["status"], "accepted")
        suggestions = self.store.list_feature_votes(second)
        self.assertEqual([item["id"] for item in suggestions], [created["id"]])
        self.assertNotIn("content", suggestions[0])
        self.assertNotIn("username", suggestions[0])

        first_vote = self.store.set_feedback_vote(second, created["id"], True)
        repeated_vote = self.store.set_feedback_vote(second, created["id"], True)
        self.assertEqual(first_vote["vote_count"], 1)
        self.assertEqual(repeated_vote["vote_count"], 1)
        self.assertTrue(repeated_vote["voted"])
        cancelled = self.store.set_feedback_vote(second, created["id"], False)
        self.assertEqual(cancelled["vote_count"], 0)
        self.assertFalse(cancelled["voted"])

    def test_feedback_admin_merge_delete_and_audit(self):
        first = self.register("feedback-merge-a")
        second = self.register("feedback-merge-b")
        source = self.store.create_feedback(
            first,
            {"type": "new_tool", "title": "CSV preview", "content": "Add a CSV preview tool."},
        )
        destination = self.store.create_feedback(
            second,
            {"type": "feature_suggestion", "title": "Table preview", "content": "Preview tabular files."},
        )
        self.store.admin_update_feedback(self.admin, source["id"], "update", status="accepted")
        self.store.admin_update_feedback(self.admin, destination["id"], "update", status="accepted")
        self.store.set_feedback_vote(first, source["id"], True)
        self.store.set_feedback_vote(first, destination["id"], True)
        self.store.set_feedback_vote(second, source["id"], True)

        merged = self.store.admin_update_feedback(
            self.admin,
            source["id"],
            "merge",
            admin_note="Duplicate suggestion",
            merged_into_id=destination["id"],
        )
        self.assertEqual(merged["status"], "rejected")
        self.assertEqual(merged["merged_into_id"], destination["id"])
        voting = self.store.list_feature_votes(first)
        target = next(item for item in voting if item["id"] == destination["id"])
        self.assertEqual(target["vote_count"], 2)

        deleted = self.store.admin_update_feedback(
            self.admin,
            source["id"],
            "delete_spam",
        )
        self.assertTrue(deleted["deleted"])
        actions = [item["action"] for item in self.store.list_audit_logs(self.admin)]
        self.assertIn("feedback_update", actions)
        self.assertIn("feedback_merge", actions)
        self.assertIn("feedback_delete_spam", actions)
        with self.assertRaises(AccountError):
            self.store.admin_list_feedback(first)

    def test_feedback_migration_is_backed_up_once(self):
        root = Path(self.temporary.name) / "feedback-v6"
        database = root / "data" / "users.sqlite3"
        text_path = root / "users.txt"
        database.parent.mkdir(parents=True)
        migrations = Path(__file__).with_name("migrations")
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript((migrations / "pre-001-schema.sql").read_text(encoding="utf-8"))
            for migration in (
                "001_entitlements_up.sql",
                "002_single_language_orders_up.sql",
                "003_login_audit_up.sql",
                "004_payment_flow_up.sql",
                "005_payment_method_consistency_up.sql",
            ):
                connection.executescript((migrations / migration).read_text(encoding="utf-8"))
        migrated = AccountStore(database, text_path)
        backup = database.with_name("users.pre-feedback-006.sqlite3")
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(backup)) as connection:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
        self.assertNotIn("feedback_items", tables)
        with migrated.connect() as connection:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
        self.assertIn("feedback_items", tables)
        self.assertIn("feedback_votes", tables)
        backup_bytes = backup.read_bytes()
        AccountStore(database, text_path)
        self.assertEqual(backup.read_bytes(), backup_bytes)

    def test_learning_sync_merges_two_devices_and_preserves_tombstones(self):
        user = self.register("sync-user")
        base_time = (utc_now() - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
        later_time = (utc_now() - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        latest_time = iso_now()
        wrong_id = "v1|wrong|cHJvZmls|aGlzdG9yeQ|d29yZA"

        first = self.store.sync_learning_data(user, {
            "schema_version": 1,
            "client_id": "client-device-a",
            "client_version": "test-a",
            "since_version": 0,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": wrong_id,
                "payload": {"wrong_count": 1, "accepted": ["电话"], "correct_answer": "电话"},
                "updated_at": base_time,
                "deleted": False,
                "base_server_version": 0,
            }],
        })
        first_version = first["results"][0]["server_version"]

        second = self.store.sync_learning_data(user, {
            "schema_version": 1,
            "client_id": "client-device-b",
            "client_version": "test-b",
            "since_version": 0,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": wrong_id,
                "payload": {"wrong_count": 4, "accepted": ["电话机"], "last_answer": "手机"},
                "updated_at": later_time,
                "deleted": False,
                "base_server_version": 0,
            }],
        })
        merged = second["results"][0]
        self.assertEqual(merged["payload"]["wrong_count"], 4)
        self.assertEqual(set(merged["payload"]["accepted"]), {"电话", "电话机"})
        self.assertEqual(merged["payload"]["correct_answer"], "电话")
        self.assertGreaterEqual(second["merged_count"], 1)

        stale_delete = self.store.sync_learning_data(user, {
            "schema_version": 1,
            "client_id": "client-device-a",
            "client_version": "test-a",
            "since_version": first_version,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": wrong_id,
                "payload": {},
                "updated_at": latest_time,
                "deleted": True,
                "base_server_version": first_version,
            }],
        })
        self.assertFalse(stale_delete["results"][0]["deleted"])

        current_version = stale_delete["results"][0]["server_version"]
        deleted = self.store.sync_learning_data(user, {
            "schema_version": 1,
            "client_id": "client-device-b",
            "client_version": "test-b",
            "since_version": current_version,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": wrong_id,
                "payload": {},
                "updated_at": latest_time,
                "deleted": True,
                "base_server_version": current_version,
            }],
        })
        tombstone = deleted["results"][0]
        self.assertTrue(tombstone["deleted"])

        stale_restore = self.store.sync_learning_data(user, {
            "schema_version": 1,
            "client_id": "client-device-a",
            "client_version": "test-a",
            "since_version": first_version,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": wrong_id,
                "payload": {"wrong_count": 99, "correct_answer": "旧设备"},
                "updated_at": latest_time,
                "deleted": False,
                "base_server_version": first_version,
            }],
        })
        self.assertTrue(stale_restore["results"][0]["deleted"])

    def test_learning_sync_achievement_history_latest_and_user_isolation(self):
        first_user = self.register("sync-first")
        second_user = self.register("sync-second")
        older = (utc_now() - timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
        newer = iso_now()
        records = [
            ("achievement", "v1|achievement|cHJvZmls|Zmlyc3Q", {"unlocked_at": older, "points": 1}),
            ("test_history", "v1|history|cHJvZmls|cm91bmQtMQ", {"id": "round-1", "total": 10, "correct": 7}),
            ("daily_goal", "v1|goal|cHJvZmls|ZW5nbGlzaA", {"goal": 20}),
        ]
        initial = self.store.sync_learning_data(first_user, {
            "schema_version": 1,
            "client_id": "client-primary",
            "client_version": "test-primary",
            "since_version": 0,
            "changes": [{
                "data_type": data_type,
                "record_id": record_id,
                "payload": payload,
                "updated_at": older,
                "deleted": False,
                "base_server_version": 0,
            } for data_type, record_id, payload in records],
        })
        versions = {
            (item["data_type"], item["record_id"]): item["server_version"]
            for item in initial["results"]
        }
        updated = self.store.sync_learning_data(first_user, {
            "schema_version": 1,
            "client_id": "client-secondary",
            "client_version": "test-secondary",
            "since_version": 0,
            "changes": [
                {
                    "data_type": "achievement",
                    "record_id": records[0][1],
                    "payload": {"points": 5, "badges": ["steady"]},
                    "updated_at": newer,
                    "deleted": False,
                    "base_server_version": 0,
                },
                {
                    "data_type": "test_history",
                    "record_id": records[1][1],
                    "payload": {"id": "round-1", "total": 10, "correct": 9},
                    "updated_at": newer,
                    "deleted": False,
                    "base_server_version": versions[("test_history", records[1][1])],
                },
                {
                    "data_type": "daily_goal",
                    "record_id": records[2][1],
                    "payload": {"goal": 35},
                    "updated_at": newer,
                    "deleted": False,
                    "base_server_version": versions[("daily_goal", records[2][1])],
                },
            ],
        })
        by_type = {item["data_type"]: item for item in updated["results"]}
        self.assertEqual(by_type["achievement"]["payload"]["points"], 5)
        self.assertEqual(by_type["achievement"]["payload"]["unlocked_at"], older)
        self.assertEqual(by_type["test_history"]["payload"]["correct"], 9)
        self.assertEqual(by_type["daily_goal"]["payload"]["goal"], 35)
        with self.store.connect() as connection:
            history_count = connection.execute(
                "SELECT COUNT(*) FROM learning_sync_records WHERE user_id = ? AND data_type = 'test_history'",
                (first_user["id"],),
            ).fetchone()[0]
        self.assertEqual(history_count, 1)
        isolated = self.store.sync_learning_data(second_user, {
            "schema_version": 1,
            "client_id": "client-other-user",
            "client_version": "test-other",
            "since_version": 0,
            "changes": [],
        })
        self.assertEqual(isolated["changes"], [])
        self.assertEqual(isolated["server_version"], 0)

    def test_learning_sync_unknown_tombstones_respect_record_limits(self):
        user = self.register("sync-tombstone-limit")
        payload = {
            "schema_version": 1,
            "client_id": "client-tombstone-limit",
            "client_version": "test-limit",
            "since_version": 0,
            "changes": [{
                "data_type": "wrong_book",
                "record_id": "v1|wrong|cHJvZmls|aGlzdG9yeQ|Zmlyc3Q",
                "payload": {},
                "updated_at": iso_now(),
                "deleted": True,
                "base_server_version": 0,
            }],
        }
        with mock.patch.dict("account_store.LEARNING_SYNC_TYPE_LIMITS", {"wrong_book": 1}, clear=False):
            first = self.store.sync_learning_data(user, payload)
            self.assertTrue(first["results"][0]["deleted"])
            payload["changes"][0]["record_id"] = "v1|wrong|cHJvZmls|aGlzdG9yeQ|c2Vjb25k"
            with self.assertRaises(AccountError) as raised:
                self.store.sync_learning_data(user, payload)
        self.assertEqual(raised.exception.code, "learning_sync_type_limit")

    def test_learning_sync_migration_is_backed_up_once(self):
        root = Path(self.temporary.name) / "learning-sync-v7"
        database = root / "data" / "users.sqlite3"
        text_path = root / "users.txt"
        database.parent.mkdir(parents=True)
        migrations = Path(__file__).with_name("migrations")
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript((migrations / "pre-001-schema.sql").read_text(encoding="utf-8"))
            for migration in (
                "001_entitlements_up.sql",
                "002_single_language_orders_up.sql",
                "003_login_audit_up.sql",
                "004_payment_flow_up.sql",
                "005_payment_method_consistency_up.sql",
                "006_feedback_voting_up.sql",
            ):
                connection.executescript((migrations / migration).read_text(encoding="utf-8"))
        migrated = AccountStore(database, text_path)
        backup = database.with_name("users.pre-learning-sync-007.sqlite3")
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(backup)) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertNotIn("learning_sync_records", tables)
        with migrated.connect() as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"learning_sync_records", "learning_sync_heads", "learning_sync_changes"}.issubset(tables))
        backup_bytes = backup.read_bytes()
        AccountStore(database, text_path)
        self.assertEqual(backup.read_bytes(), backup_bytes)


if __name__ == "__main__":
    unittest.main()
