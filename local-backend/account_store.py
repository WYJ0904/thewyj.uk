import base64
import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from membership import (
    ALL_ACCESS_ENTITLEMENTS,
    ENTITLEMENT_LABELS,
    LEGACY_PLAN_MAP,
    MEMBERSHIP_PLANS,
    PURCHASABLE_PLAN_CODES,
    default_plan_expiry,
    public_plan_payload,
)
from payment_assets import (
    PAYMENT_METHODS,
    PaymentAssetError,
    normalize_payment_method,
    qr_resource_id_for,
)


ADMIN_USERNAME = "wyj"
ADMIN_SECRET = os.environ.get("VOCAB_ADMIN_SECRET", "").strip() or secrets.token_urlsafe(12)
# Values still accepted by the legacy users.membership column and its admin
# compatibility endpoint. New plans and purchases must use membership.py.
LEGACY_MEMBERSHIP_CODES = {"free", "trial_single_language", "monthly", "lifetime"}
LANGUAGES = {"english", "japanese"}
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_SESSIONS_PER_USER = 12
MIN_SECRET_LENGTH = 7
PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 310_000
SESSION_TOKEN_PREFIX = "sha256"
OPEN_PAYMENT_STATUSES = {"pending_payment", "user_paid", "processing"}
PAYMENT_QR_STATUSES = {"pending_payment", "user_paid", "processing"}
PAYMENT_ORDER_TTL_HOURS = 24
LOGIN_AUDIT_RETENTION_DAYS = 90
LOGIN_AUDIT_MAX_RECORDS = 5000
FEEDBACK_TYPES = {
    "feature_suggestion",
    "tool_error",
    "page_issue",
    "account_issue",
    "new_tool",
    "other",
}
FEEDBACK_PUBLIC_TYPES = {"feature_suggestion", "new_tool"}
FEEDBACK_STATUSES = {"pending", "viewed", "accepted", "completed", "rejected"}
FEEDBACK_ALLOWED_FIELDS = {
    "type",
    "title",
    "content",
    "route",
    "tool_id",
    "app_version",
    "browser_info",
    "error_code",
}
PRIVATE_POSIX_PATH_PATTERN = "/" + r"(?:Users|home)/[^/\s]+/"
FEEDBACK_SENSITIVE_PATTERN = re.compile(
    r"(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|file://|"
    + PRIVATE_POSIX_PATH_PATTERN
    + r"|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{10,}|"
    r"\bsk-[A-Za-z0-9_-]{12,}|\b(?:session|token|password)\s*[:=]\s*\S{6,})",
    re.IGNORECASE,
)
LEARNING_SYNC_SCHEMA_VERSION = 1
LEARNING_SYNC_TYPES = {
    "wrong_book",
    "achievement",
    "test_history",
    "daily_goal",
    "language_settings",
    "learning_config",
}
LEARNING_SYNC_TYPE_LIMITS = {
    "wrong_book": 2000,
    "achievement": 500,
    "test_history": 5000,
    "daily_goal": 200,
    "language_settings": 20,
    "learning_config": 500,
}
LEARNING_SYNC_MAX_CHANGES = 200
LEARNING_SYNC_PULL_LIMIT = 500
LEARNING_SYNC_MAX_RECORD_ID = 700
LEARNING_SYNC_MAX_PAYLOAD_BYTES = 384 * 1024
LEARNING_SYNC_MAX_TOTAL_RECORDS = sum(LEARNING_SYNC_TYPE_LIMITS.values())
LEARNING_SYNC_CLIENT_PATTERN = re.compile(r"^[A-Za-z0-9._~:-]{8,80}$")
LEARNING_SYNC_RECORD_PATTERN = re.compile(r"^[A-Za-z0-9._~|:-]{1,700}$")
WORKFLOW_SCHEMA_VERSION = 1
WORKFLOW_MAX_BYTES = 48 * 1024
WORKFLOW_MAX_STEPS = 20
WORKFLOW_MAX_SAVED = 50
WORKFLOW_ID_PATTERN = re.compile(r"^(?:wf|step)_[a-z0-9][a-z0-9_-]{5,63}$")
WORKFLOW_TOOL_TYPES = {
    "text-encoding": ({"text-file"}, {"text"}, False),
    "remove-empty-lines": ({"text"}, {"text"}, False),
    "dedupe-lines": ({"text"}, {"text"}, False),
    "sort-lines": ({"text"}, {"text"}, False),
    "csv-json": ({"text"}, {"json"}, False),
    "json-csv": ({"json"}, {"text"}, False),
    "text-split": ({"text"}, {"archive"}, False),
    "image-resize": ({"image", "image-list"}, {"image", "image-list"}, True),
    "image-format": ({"image", "image-list"}, {"image", "image-list"}, True),
    "text-watermark": ({"image", "image-list"}, {"image", "image-list"}, True),
    "exif-remove": ({"image", "image-list"}, {"image", "image-list"}, True),
    "files-zip": ({"file-list", "image-list"}, {"archive"}, False),
}
WORKFLOW_CONFIG_KEYS = {
    "text-encoding": {"encoding"},
    "remove-empty-lines": set(),
    "dedupe-lines": set(),
    "sort-lines": {"order"},
    "csv-json": set(),
    "json-csv": set(),
    "text-split": {"lines"},
    "image-resize": {"width", "height"},
    "image-format": {"format", "quality"},
    "text-watermark": {"text", "color"},
    "exif-remove": set(),
    "files-zip": set(),
}


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso_now():
    return utc_now().isoformat().replace("+00:00", "Z")


def parse_time(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def membership_time_value(value, end_of_day=False, now=None):
    text = str(value or "").strip()
    if not text:
        return ""
    local_now = (now or datetime.now().astimezone()).astimezone()
    normalized = re.sub(r"[\u5e74\u6708\u65e5./\u3002\-]+", " ", text)
    date_parts = normalized.split()
    if len(date_parts) == 3 and all(part.isdigit() for part in date_parts):
        try:
            year, month, day = (int(part) for part in date_parts)
            if end_of_day:
                local_value = datetime(year, month, day, 23, 59, 59, tzinfo=local_now.tzinfo)
            else:
                local_value = datetime(
                    year,
                    month,
                    day,
                    local_now.hour,
                    local_now.minute,
                    local_now.second,
                    tzinfo=local_now.tzinfo,
                )
            return local_value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except ValueError:
            return ""
    parsed = parse_time(text)
    if not parsed:
        return ""
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_membership_expiry(now=None):
    local_now = (now or datetime.now().astimezone()).astimezone()
    expiry_date = (local_now + timedelta(days=30)).date()
    local_expiry = datetime(
        expiry_date.year,
        expiry_date.month,
        expiry_date.day,
        23,
        59,
        59,
        tzinfo=local_now.tzinfo,
    )
    return local_expiry.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def hash_secret(value):
    raw = str(value or "").encode("utf-8")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", raw, salt, PASSWORD_HASH_ITERATIONS)
    return "$".join(
        (
            PASSWORD_HASH_PREFIX,
            str(PASSWORD_HASH_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
            base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="),
        )
    )


def secret_is_hashed(value):
    return str(value or "").startswith(f"{PASSWORD_HASH_PREFIX}$")


def verify_secret(value, encoded):
    stored = str(encoded or "")
    candidate = str(value or "")
    if not secret_is_hashed(stored):
        return secrets.compare_digest(candidate, stored)
    try:
        _, iterations, salt_text, digest_text = stored.split("$", 3)
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = base64.urlsafe_b64decode(digest_text + "=" * (-len(digest_text) % 4))
        actual = hashlib.pbkdf2_hmac("sha256", candidate.encode("utf-8"), salt, int(iterations))
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def session_storage_key(value):
    raw = str(value or "").encode("utf-8")
    return f"{SESSION_TOKEN_PREFIX}${hashlib.sha256(raw).hexdigest()}"


class AccountError(Exception):
    def __init__(self, message, status=400, code="account_error", committed=False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.committed = committed


class AccountStore:
    def __init__(self, database_path, text_path):
        self.database_path = Path(database_path)
        self.text_path = Path(text_path)
        self.lock = threading.RLock()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.text_path.parent.mkdir(parents=True, exist_ok=True)
        self._backup_before_membership_migration()
        self._backup_before_single_language_migration()
        self._backup_before_payment_migration()
        self._backup_before_payment_method_consistency_migration()
        self._backup_before_feedback_migration()
        self._backup_before_learning_sync_migration()
        self.initialize()

    def _backup_before_membership_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-entitlements-001.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "users" not in tables:
                    return
                if "schema_migrations" in tables:
                    applied = source.execute(
                        "SELECT 1 FROM schema_migrations WHERE version = ?",
                        ("001_entitlements",),
                    ).fetchone()
                    if applied:
                        return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _backup_before_single_language_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-single-language-002.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "payment_requests" not in tables or "schema_migrations" not in tables:
                    return
                applied = source.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    ("002_single_language_orders",),
                ).fetchone()
                if applied:
                    return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _backup_before_payment_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-payment-004.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "payment_requests" not in tables or "schema_migrations" not in tables:
                    return
                applied = source.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    ("004_payment_flow",),
                ).fetchone()
                if applied:
                    return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _backup_before_payment_method_consistency_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-payment-method-005.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "payment_requests" not in tables or "schema_migrations" not in tables:
                    return
                applied = source.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    ("005_payment_method_consistency",),
                ).fetchone()
                if applied:
                    return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _backup_before_feedback_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-feedback-006.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "users" not in tables or "schema_migrations" not in tables:
                    return
                applied = source.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    ("006_feedback_voting",),
                ).fetchone()
                if applied:
                    return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _backup_before_learning_sync_migration(self):
        if not self.database_path.exists() or self.database_path.stat().st_size == 0:
            return
        backup_path = self.database_path.with_name(
            f"{self.database_path.stem}.pre-learning-sync-007.sqlite3"
        )
        if backup_path.exists():
            return
        try:
            with closing(sqlite3.connect(str(self.database_path), timeout=15)) as source:
                tables = {
                    row[0]
                    for row in source.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                if "users" not in tables or "schema_migrations" not in tables:
                    return
                applied = source.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    ("007_learning_sync",),
                ).fetchone()
                if applied:
                    return
                with closing(sqlite3.connect(str(backup_path), timeout=15)) as destination:
                    source.backup(destination)
        except sqlite3.Error:
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(str(self.database_path), timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.lock, self.connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    username_normalized TEXT NOT NULL UNIQUE,
                    secret TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    membership TEXT NOT NULL DEFAULT 'free',
                    membership_start TEXT NOT NULL DEFAULT '',
                    membership_expires TEXT NOT NULL DEFAULT '',
                    trial_language TEXT NOT NULL DEFAULT '',
                    registered_at TEXT NOT NULL,
                    last_login_at TEXT NOT NULL DEFAULT '',
                    banned INTEGER NOT NULL DEFAULT 0,
                    permanent_ban INTEGER NOT NULL DEFAULT 0,
                    ban_reason TEXT NOT NULL DEFAULT '',
                    deleted INTEGER NOT NULL DEFAULT 0,
                    session_version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    session_version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
                CREATE TABLE IF NOT EXISTS recharge_requests (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    plan TEXT NOT NULL,
                    trial_language TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    requested_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    handled_at TEXT NOT NULL DEFAULT '',
                    handled_by TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS recharge_user_idx ON recharge_requests(user_id);
                CREATE UNIQUE INDEX IF NOT EXISTS recharge_one_pending_per_user
                    ON recharge_requests(user_id) WHERE status = 'pending';
                """
            )
            now = iso_now()
            admin = connection.execute(
                "SELECT id FROM users WHERE username_normalized = ?", (ADMIN_USERNAME,)
            ).fetchone()
            if admin:
                connection.execute(
                    """
                    UPDATE users SET username = ?, role = 'super_admin',
                        membership = 'lifetime', membership_start = '', membership_expires = '',
                        trial_language = '', banned = 0, permanent_ban = 0, deleted = 0,
                        ban_reason = '', updated_at = ? WHERE id = ?
                    """,
                    (ADMIN_USERNAME, now, admin["id"]),
                )
            else:
                admin_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO users (
                        id, username, username_normalized, secret, role, membership,
                        registered_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'super_admin', 'lifetime', ?, ?, ?)
                    """,
                    (admin_id, ADMIN_USERNAME, ADMIN_USERNAME, hash_secret(ADMIN_SECRET), now, now, now),
                )
            migration_path = Path(__file__).with_name("migrations") / "001_entitlements_up.sql"
            connection.executescript(migration_path.read_text(encoding="utf-8"))
            self._apply_migration(
                connection,
                "002_single_language_orders",
                "002_single_language_orders_up.sql",
            )
            self._apply_migration(
                connection,
                "003_login_audit",
                "003_login_audit_up.sql",
            )
            self._apply_migration(
                connection,
                "004_payment_flow",
                "004_payment_flow_up.sql",
            )
            self._apply_migration(
                connection,
                "005_payment_method_consistency",
                "005_payment_method_consistency_up.sql",
            )
            self._apply_migration(
                connection,
                "006_feedback_voting",
                "006_feedback_voting_up.sql",
            )
            self._apply_migration(
                connection,
                "007_learning_sync",
                "007_learning_sync_up.sql",
            )
            self._seed_membership_plans(connection, now)
            self._migrate_legacy_memberships(connection, now)
            self._migrate_legacy_recharge_requests(connection, now)
            self._sync_all_legacy_membership_snapshots(connection, now)
            self._hash_plaintext_secrets(connection)
            self._hash_plaintext_session_tokens(connection)
            self._validate_membership_migration(connection)
        self.sync_text()

    @staticmethod
    def _apply_migration(connection, version, filename):
        applied = connection.execute(
            "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
        ).fetchone()
        if applied:
            return
        if version == "002_single_language_orders":
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(payment_requests)").fetchall()
            }
            if "trial_language" in columns:
                connection.execute(
                    """
                    UPDATE payment_requests
                    SET trial_language = COALESCE(
                        (SELECT legacy.trial_language FROM recharge_requests AS legacy
                         WHERE legacy.id = payment_requests.id), trial_language, ''
                    )
                    WHERE plan_code = 'trial_single_language' AND trial_language = ''
                    """
                )
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, iso_now()),
                )
                return
        migration_path = Path(__file__).with_name("migrations") / filename
        connection.executescript(migration_path.read_text(encoding="utf-8"))

    @staticmethod
    def _seed_membership_plans(connection, now):
        for code, plan in MEMBERSHIP_PLANS.items():
            connection.execute(
                """
                INSERT INTO membership_plans (
                    code, name, price_cents, currency, lifetime, duration_months,
                    purchasable, priority, description, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    name = excluded.name,
                    price_cents = excluded.price_cents,
                    currency = excluded.currency,
                    lifetime = excluded.lifetime,
                    duration_months = excluded.duration_months,
                    purchasable = excluded.purchasable,
                    priority = excluded.priority,
                    description = excluded.description,
                    updated_at = excluded.updated_at
                """,
                (
                    code,
                    plan["name"],
                    plan["price_cents"],
                    plan["currency"],
                    int(plan["lifetime"]),
                    plan["duration_months"],
                    int(plan["purchasable"]),
                    plan["priority"],
                    plan["description"],
                    now,
                ),
            )
            connection.execute("DELETE FROM membership_entitlements WHERE plan_code = ?", (code,))
            connection.executemany(
                "INSERT INTO membership_entitlements (plan_code, entitlement_code) VALUES (?, ?)",
                [(code, entitlement) for entitlement in plan["entitlements"]],
            )

    @staticmethod
    def _migrate_legacy_memberships(connection, now):
        rows = connection.execute(
            """
            SELECT * FROM users
            WHERE deleted = 0 AND role != 'super_admin' AND membership != 'free'
              AND NOT EXISTS (
                  SELECT 1 FROM user_memberships
                  WHERE user_memberships.user_id = users.id
              )
            """
        ).fetchall()
        for row in rows:
            plan_code = LEGACY_PLAN_MAP.get(row["membership"])
            if not plan_code:
                continue
            metadata = {}
            if row["membership"] == "trial_single_language":
                metadata["language"] = row["trial_language"]
            plan = MEMBERSHIP_PLANS[plan_code]
            starts_at = row["membership_start"] or row["registered_at"] or now
            expires_at = "" if plan["lifetime"] else row["membership_expires"]
            status = "active"
            parsed_expiry = parse_time(expires_at)
            if not plan["lifetime"] and (not parsed_expiry or parsed_expiry <= utc_now()):
                status = "expired"
            connection.execute(
                """
                INSERT OR IGNORE INTO user_memberships (
                    id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
                    source, source_ref, created_by, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'legacy_migration', 'users.membership',
                          'system', ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    row["id"],
                    plan_code,
                    starts_at,
                    expires_at,
                    int(plan["lifetime"]),
                    status,
                    json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                    now,
                    now,
                ),
            )

    @staticmethod
    def _migrate_legacy_recharge_requests(connection, now):
        mappings = {
            "trial_single_language": "trial_single_language",
            "monthly": "legacy_all_monthly",
            "lifetime": "legacy_all_lifetime",
        }
        legacy_prices = {
            "trial_single_language": 500,
            "monthly": 1000,
            "lifetime": 7000,
        }
        for row in connection.execute("SELECT * FROM recharge_requests").fetchall():
            plan_code = mappings.get(row["plan"])
            if not plan_code:
                continue
            plan = MEMBERSHIP_PLANS[plan_code]
            status = {
                "pending": "user_paid",
                "activated": "approved",
                "rejected": "rejected",
            }.get(row["status"], "rejected")
            order_number = f"LEGACY-{row['id'][:12].upper()}"
            trial_language = row["trial_language"] if plan_code == "trial_single_language" else ""
            language_label = {"english": "英语", "japanese": "日语"}.get(trial_language, "")
            plan_label = f"{plan['name']}（{language_label}）" if language_label else plan["name"]
            payment_note = f"{row['username']} {order_number} {plan_label}"
            connection.execute(
                """
                INSERT OR IGNORE INTO payment_requests (
                    id, order_number, user_id, username, plan_code, amount_cents, currency,
                    contact, payment_note, status, requested_at, user_confirmed_at,
                    handled_at, handled_by, updated_at, trial_language, plan_name_snapshot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    order_number,
                    row["user_id"],
                    row["username"],
                    plan_code,
                    legacy_prices[row["plan"]],
                    plan["currency"],
                    "",
                    payment_note,
                    status,
                    row["requested_at"],
                    row["requested_at"] if row["status"] != "pending" else "",
                    row["handled_at"],
                    row["handled_by"],
                    row["updated_at"] or now,
                    trial_language,
                    plan["name"],
                ),
            )

    @staticmethod
    def _hash_plaintext_secrets(connection):
        rows = connection.execute("SELECT id, secret FROM users WHERE secret != ''").fetchall()
        for row in rows:
            if not secret_is_hashed(row["secret"]):
                connection.execute("UPDATE users SET secret = ? WHERE id = ?", (hash_secret(row["secret"]), row["id"]))

    @staticmethod
    def _hash_plaintext_session_tokens(connection):
        rows = connection.execute("SELECT token FROM sessions").fetchall()
        for row in rows:
            token = str(row["token"] or "")
            if token and not token.startswith(f"{SESSION_TOKEN_PREFIX}$"):
                connection.execute(
                    "UPDATE sessions SET token = ? WHERE token = ?",
                    (session_storage_key(token), token),
                )

    @staticmethod
    def _sync_all_legacy_membership_snapshots(connection, now):
        rows = connection.execute(
            "SELECT id FROM users WHERE deleted = 0 AND role != 'super_admin'"
        ).fetchall()
        for row in rows:
            AccountStore._sync_legacy_membership_snapshot_in_connection(connection, row["id"], now)

    @staticmethod
    def _validate_membership_migration(connection):
        missing = connection.execute(
            """
            SELECT COUNT(*) FROM users u
            WHERE u.deleted = 0 AND u.role != 'super_admin' AND u.membership != 'free'
              AND NOT EXISTS (
                  SELECT 1 FROM user_memberships m
                  WHERE m.user_id = u.id AND m.status = 'active'
              )
            """
        ).fetchone()[0]
        if missing:
            raise RuntimeError(f"membership migration validation failed for {missing} user(s)")

    @staticmethod
    def normalize_username(username):
        return str(username or "").strip().casefold()

    @staticmethod
    def validate_username(username):
        value = str(username or "").strip()
        if not value:
            raise AccountError("用户名不能为空", 400, "username_required")
        if len(value) > 40:
            raise AccountError("用户名不能超过 40 个字符", 400, "username_too_long")
        if any(char in value for char in "\r\n\t=\\/"):
            raise AccountError("用户名包含不允许的字符", 400, "username_invalid")
        return value

    @staticmethod
    def validate_secret(secret):
        value = str(secret or "")
        if not value:
            raise AccountError("登录密钥不能为空", 400, "secret_required")
        if len(value) < MIN_SECRET_LENGTH:
            raise AccountError(f"登录密钥不能少于 {MIN_SECRET_LENGTH} 个字符", 400, "secret_too_short")
        if len(value) > 128:
            raise AccountError("登录密钥不能超过 128 个字符", 400, "secret_too_long")
        if "\n" in value or "\r" in value:
            raise AccountError("登录密钥不能包含换行", 400, "secret_invalid")
        return value

    def sync_text(self):
        with self.lock, self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM users WHERE deleted = 0 OR permanent_ban = 1 ORDER BY registered_at, username_normalized"
            ).fetchall()
        blocks = []
        for row in rows:
            blocks.append(
                "\n".join(
                    [
                        f"user_id={row['id']}",
                        f"username={row['username']}",
                        "secret=protected",
                        f"role={row['role']}",
                        f"membership={row['membership']}",
                        f"membership_start={row['membership_start']}",
                        f"membership_expires={row['membership_expires']}",
                        f"trial_language={row['trial_language']}",
                        f"banned={str(bool(row['banned'])).lower()}",
                        f"permanent_ban={str(bool(row['permanent_ban'])).lower()}",
                        f"registered_at={row['registered_at']}",
                        f"last_login_at={row['last_login_at']}",
                        f"created_at={row['created_at']}",
                        f"updated_at={row['updated_at']}",
                    ]
                )
            )
        content = "\n\n".join(blocks) + ("\n" if blocks else "")
        temporary = self.text_path.with_name(
            f"{self.text_path.name}.tmp.{os.getpid()}.{secrets.token_hex(4)}"
        )
        try:
            temporary.write_text(content, encoding="utf-8")
            os.replace(str(temporary), str(self.text_path))
        except OSError as exc:
            try:
                temporary.unlink(missing_ok=True)
            except (OSError, TypeError):
                if temporary.exists():
                    try:
                        temporary.unlink()
                    except OSError:
                        pass
            raise AccountError(
                f"数据库已保存，但 users.txt 同步失败: {exc}",
                500,
                "users_txt_sync_failed",
                committed=True,
            ) from exc

    def _sync_after_write(self):
        self.sync_text()

    @staticmethod
    def _effective_membership(row):
        if row["role"] == "super_admin":
            return "lifetime"
        membership = row["membership"] if row["membership"] in LEGACY_MEMBERSHIP_CODES else "free"
        if membership in {"trial_single_language", "monthly"}:
            expires = parse_time(row["membership_expires"])
            if not expires or expires <= utc_now():
                return "free"
        return membership

    def _expire_if_needed(self, row):
        if not row or row["role"] == "super_admin":
            return row
        effective = self._effective_membership(row)
        if effective != "free" or row["membership"] == "free":
            return row
        with self.lock, self.connect() as connection:
            now = iso_now()
            connection.execute(
                """
                UPDATE users SET membership = 'free', membership_start = '', membership_expires = '',
                    trial_language = '', updated_at = ? WHERE id = ?
                """,
                (now, row["id"]),
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        self._sync_after_write()
        return row

    def user_payload(self, row):
        row = self._expire_if_needed(row)
        membership = self._effective_membership(row)
        memberships = self.memberships_for(row)
        entitlements = sorted(self.entitlements_for(row))
        summary = self.membership_summary(row)
        payload = {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "membership": membership,
            "membership_start": row["membership_start"] if membership != "free" else "",
            "membership_expires": row["membership_expires"] if membership not in {"free", "lifetime"} else "",
            "trial_language": row["trial_language"] if membership == "trial_single_language" else "",
            "registered_at": row["registered_at"],
            "last_login_at": row["last_login_at"],
            "banned": bool(row["banned"]),
            "permanent_ban": bool(row["permanent_ban"]),
            "deleted": bool(row["deleted"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "is_super_admin": row["username_normalized"] == ADMIN_USERNAME and row["role"] == "super_admin",
            "memberships": memberships,
            "entitlements": entitlements,
            "membership_summary": summary,
            "tools_access": "tools_access" in entitlements,
        }
        return payload

    def register(self, username, secret):
        username = self.validate_username(username)
        secret = self.validate_secret(secret)
        normalized = self.normalize_username(username)
        if normalized == ADMIN_USERNAME:
            raise AccountError("该用户名禁止注册", 409, "reserved_username")
        now = iso_now()
        user_id = str(uuid.uuid4())
        with self.lock:
            try:
                with self.connect() as connection:
                    existing = connection.execute(
                        "SELECT id FROM users WHERE username_normalized = ?", (normalized,)
                    ).fetchone()
                    if existing:
                        raise AccountError("用户名已存在", 409, "username_exists")
                    connection.execute(
                        """
                        INSERT INTO users (
                            id, username, username_normalized, secret, role, membership,
                            registered_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'user', 'free', ?, ?, ?)
                        """,
                        (user_id, username, normalized, hash_secret(secret), now, now, now),
                    )
            except sqlite3.IntegrityError as exc:
                raise AccountError("用户名已存在", 409, "username_exists") from exc
        self._sync_after_write()
        return self.get_user(user_id)

    def get_user(self, user_id, include_deleted=False):
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or (row["deleted"] and not include_deleted):
            return None
        return self._expire_if_needed(row)

    def resolve_cloud_identity_user(self, user_id, username, entitlements=None):
        """Resolve a D1-authenticated identity without creating a legacy session."""
        user_id = str(user_id or "").strip()
        username = self.validate_username(username)
        normalized = self.normalize_username(username)
        if not user_id or len(user_id) > 80:
            raise AccountError("云端账户身份无效", 403, "cloud_identity_invalid")
        created = False
        with self.lock, self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            by_name = connection.execute(
                "SELECT id FROM users WHERE username_normalized = ?", (normalized,)
            ).fetchone()
            if row and row["username_normalized"] != normalized:
                raise AccountError("云端账户身份映射冲突", 409, "cloud_identity_conflict")
            if by_name and by_name["id"] != user_id:
                raise AccountError("云端账户用户名映射冲突", 409, "cloud_identity_conflict")
            if not row:
                now = iso_now()
                disabled_secret = hash_secret(secrets.token_urlsafe(48))
                connection.execute(
                    """
                    INSERT INTO users (
                        id, username, username_normalized, secret, role, membership,
                        registered_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'user', 'free', ?, ?, ?)
                    """,
                    (user_id, username, normalized, disabled_secret, now, now, now),
                )
                row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                created = True
        if created:
            self._sync_after_write()
        # D1 already checked ban/deletion/session_version before signing the assertion.
        # A mapping copy avoids stale legacy account-state flags overriding that decision.
        payload = dict(row)
        payload["banned"] = 0
        payload["deleted"] = 0
        if entitlements is not None:
            payload["_cloud_entitlements"] = tuple(sorted(set(entitlements)))
        return payload

    def verify_legacy_secret(self, user_id, username, candidate):
        """Verify one imported PBKDF2 secret without creating or changing legacy state."""
        user_id = str(user_id or "").strip()
        normalized = self.normalize_username(username)
        if not user_id or len(user_id) > 80 or not normalized:
            return False
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if (
            not row
            or row["deleted"]
            or row["banned"]
            or row["username_normalized"] != normalized
            or not secret_is_hashed(row["secret"])
        ):
            return False
        return verify_secret(candidate, row["secret"])

    def get_user_by_name(self, username, include_deleted=False):
        normalized = self.normalize_username(username)
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username_normalized = ?", (normalized,)
            ).fetchone()
        if not row or (row["deleted"] and not include_deleted):
            return None
        return self._expire_if_needed(row)

    def login(self, username, secret):
        username_text = str(username or "").strip()
        secret_text = str(secret or "")
        row = self.get_user_by_name(username_text, include_deleted=True)
        if not row or row["deleted"]:
            raise AccountError("用户名或登录密钥错误", 403, "invalid_credentials")
        if row["banned"]:
            raise AccountError("账户已被封禁", 403, "account_banned")
        if row["username_normalized"] == ADMIN_USERNAME:
            valid = username_text == ADMIN_USERNAME and verify_secret(secret_text, row["secret"]) and row["role"] == "super_admin"
        else:
            valid = verify_secret(secret_text, row["secret"])
        if not valid:
            raise AccountError("用户名或登录密钥错误", 403, "invalid_credentials")
        now = iso_now()
        token = secrets.token_urlsafe(32)
        stored_token = session_storage_key(token)
        with self.lock, self.connect() as connection:
            cutoff = (utc_now() - timedelta(seconds=SESSION_TTL_SECONDS)).isoformat().replace("+00:00", "Z")
            connection.execute("DELETE FROM sessions WHERE last_seen_at < ?", (cutoff,))
            connection.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now, now, row["id"]))
            current = connection.execute("SELECT session_version FROM users WHERE id = ?", (row["id"],)).fetchone()
            connection.execute(
                "INSERT INTO sessions (token, user_id, session_version, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
                (stored_token, row["id"], current["session_version"], now, now),
            )
            connection.execute(
                """
                DELETE FROM sessions WHERE token IN (
                    SELECT token FROM sessions WHERE user_id = ?
                    ORDER BY rowid DESC LIMIT -1 OFFSET ?
                )
                """,
                (row["id"], MAX_SESSIONS_PER_USER),
            )
        self._sync_after_write()
        return token, self.get_user(row["id"])

    def resolve_session(self, token, touch=True):
        raw_token = str(token or "")
        if not raw_token:
            return None
        stored_token = session_storage_key(raw_token)
        with self.lock, self.connect() as connection:
            record = connection.execute(
                """
                SELECT s.token, s.session_version AS session_generation, s.last_seen_at, u.*
                FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
                """,
                (stored_token,),
            ).fetchone()
            if not record and not raw_token.startswith(f"{SESSION_TOKEN_PREFIX}$"):
                record = connection.execute(
                    """
                    SELECT s.token, s.session_version AS session_generation, s.last_seen_at, u.*
                    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
                    """,
                    (raw_token,),
                ).fetchone()
                if record:
                    connection.execute("UPDATE sessions SET token = ? WHERE token = ?", (stored_token, raw_token))
            if not record:
                return None
            last_seen = parse_time(record["last_seen_at"])
            invalid = (
                not last_seen
                or (utc_now() - last_seen).total_seconds() > SESSION_TTL_SECONDS
                or record["deleted"]
                or record["banned"]
                or record["session_generation"] != record["session_version"]
            )
            if invalid:
                connection.execute("DELETE FROM sessions WHERE token = ?", (stored_token,))
                return None
            if touch:
                connection.execute("UPDATE sessions SET last_seen_at = ? WHERE token = ?", (iso_now(), stored_token))
        return self.get_user(record["id"])

    def logout(self, token):
        raw_token = str(token or "")
        stored_token = session_storage_key(raw_token)
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token = ?", (stored_token,))
            if raw_token and not raw_token.startswith(f"{SESSION_TOKEN_PREFIX}$"):
                connection.execute("DELETE FROM sessions WHERE token = ?", (raw_token,))

    def revoke_user_sessions(self, user_id):
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    @staticmethod
    def is_super_admin(row):
        return bool(row and row["username_normalized"] == ADMIN_USERNAME and row["role"] == "super_admin")

    @staticmethod
    def membership_plans(include_hidden=False):
        return public_plan_payload(include_hidden=include_hidden)

    @staticmethod
    def payment_methods():
        return list(PAYMENT_METHODS)

    @staticmethod
    def payment_request_payload(row):
        if not row:
            return {}
        value = dict(row)
        plan_code = value.get("plan_code", "")
        plan = MEMBERSHIP_PLANS.get(plan_code, {})
        plan_name = plan.get("name") or value.get("plan_name_snapshot", "") or plan_code
        payment_note = value.get("payment_note", "")
        if plan_code in {"japanese_lifetime", "dual_language_lifetime"}:
            for stale_name in ("日语单项永久会员", "历史双语言双项永久会员"):
                payment_note = payment_note.replace(stale_name, plan_name)
        return {
            "id": value.get("id", ""),
            "order_number": value.get("order_number", ""),
            "user_id": value.get("user_id", ""),
            "username": value.get("username", ""),
            "plan_code": plan_code,
            "plan_name": plan_name,
            "amount_cents": int(value.get("amount_cents", 0) or 0),
            "currency": value.get("currency", "CNY"),
            "payment_method": value.get("payment_method", ""),
            "qr_resource_id": value.get("qr_resource_id", ""),
            "trial_language": value.get("trial_language", ""),
            "payment_note": payment_note,
            "status": value.get("status", ""),
            "requested_at": value.get("requested_at", ""),
            "expires_at": value.get("expires_at", ""),
            "user_confirmed_at": value.get("user_confirmed_at", ""),
            "processing_at": value.get("processing_at", ""),
            "handled_at": value.get("handled_at", ""),
            "admin_note": value.get("admin_note", ""),
            "updated_at": value.get("updated_at", ""),
        }

    @staticmethod
    def _record_payment_event(
        connection,
        request_id,
        from_status,
        to_status,
        actor=None,
        note="",
        created_at=None,
    ):
        connection.execute(
            """
            INSERT INTO payment_request_events (
                id, payment_request_id, from_status, to_status,
                actor_user_id, actor_username, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                request_id,
                str(from_status or ""),
                str(to_status or ""),
                actor["id"] if actor else "",
                actor["username"] if actor else "",
                str(note or "")[:500],
                created_at or iso_now(),
            ),
        )

    @staticmethod
    def _expire_pending_payment_requests(connection, user_id=""):
        now = iso_now()
        query = """
            SELECT id FROM payment_requests
            WHERE status = 'pending_payment' AND expires_at != '' AND expires_at <= ?
        """
        parameters = [now]
        if user_id:
            query += " AND user_id = ?"
            parameters.append(user_id)
        expired = connection.execute(query, parameters).fetchall()
        for item in expired:
            connection.execute(
                """
                UPDATE payment_requests
                SET status = 'expired', handled_at = ?, updated_at = ?
                WHERE id = ? AND status = 'pending_payment'
                """,
                (now, now, item["id"]),
            )
            AccountStore._record_payment_event(
                connection,
                item["id"],
                "pending_payment",
                "expired",
                note="订单超过有效期自动关闭",
                created_at=now,
            )

    def _expire_user_memberships(self, user_id):
        now = utc_now()
        with self.lock, self.connect() as connection:
            rows = connection.execute(
                "SELECT id, expires_at, is_lifetime FROM user_memberships WHERE user_id = ? AND status = 'active'",
                (user_id,),
            ).fetchall()
            expired_ids = [
                row["id"]
                for row in rows
                if not row["is_lifetime"]
                and (not parse_time(row["expires_at"]) or parse_time(row["expires_at"]) <= now)
            ]
            if expired_ids:
                connection.executemany(
                    "UPDATE user_memberships SET status = 'expired', updated_at = ? WHERE id = ?",
                    [(iso_now(), membership_id) for membership_id in expired_ids],
                )

    def memberships_for(self, row, include_inactive=False):
        if not row:
            return []
        self._expire_user_memberships(row["id"])
        query = "SELECT * FROM user_memberships WHERE user_id = ?"
        parameters = [row["id"]]
        if not include_inactive:
            query += " AND status = 'active'"
        query += " ORDER BY created_at DESC"
        with self.connect() as connection:
            rows = connection.execute(query, parameters).fetchall()
        result = []
        for item in rows:
            payload = dict(item)
            try:
                payload["metadata"] = json.loads(payload.pop("metadata_json") or "{}")
            except (json.JSONDecodeError, TypeError):
                payload["metadata"] = {}
                payload.pop("metadata_json", None)
            plan = MEMBERSHIP_PLANS.get(payload["plan_code"], {})
            payload["plan_name"] = plan.get("name", payload["plan_code"])
            payload["priority"] = plan.get("priority", 0)
            payload["entitlements"] = list(plan.get("entitlements", ()))
            result.append(payload)
        return result

    def entitlements_for(self, row):
        if not row:
            return set()
        if self.is_super_admin(row):
            return set(ALL_ACCESS_ENTITLEMENTS) | {"language_english_access"}
        if isinstance(row, dict) and "_cloud_entitlements" in row:
            return set(row["_cloud_entitlements"])
        entitlements = set()
        for membership in self.memberships_for(row):
            entitlements.update(membership["entitlements"])
            if membership["plan_code"] == "trial_single_language":
                language = membership.get("metadata", {}).get("language")
                if language == "japanese":
                    entitlements.add("language_japanese_access")
                elif language == "english":
                    entitlements.add("language_english_access")
        with self.connect() as connection:
            overrides = connection.execute(
                "SELECT entitlement_code, allowed FROM user_entitlement_overrides WHERE user_id = ?",
                (row["id"],),
            ).fetchall()
        for override in overrides:
            if override["allowed"]:
                entitlements.add(override["entitlement_code"])
            else:
                entitlements.discard(override["entitlement_code"])
        return entitlements

    def has_entitlement(self, row, entitlement):
        return str(entitlement or "") in self.entitlements_for(row)

    def membership_summary(self, row):
        if self.is_super_admin(row):
            return {
                "code": "super_admin",
                "name": "超级管理员",
                "permanent": True,
                "expires_at": "",
                "tools_access": True,
            }
        memberships = self.memberships_for(row)
        top = max(memberships, key=lambda item: item.get("priority", 0), default=None)
        entitlements = self.entitlements_for(row)
        if not top:
            return {
                "code": "free",
                "name": "普通注册用户",
                "permanent": False,
                "expires_at": "",
                "tools_access": False,
            }
        return {
            "code": top["plan_code"],
            "name": top["plan_name"],
            "permanent": bool(top["is_lifetime"]),
            "starts_at": top["starts_at"],
            "expires_at": top["expires_at"],
            "tools_access": "tools_access" in entitlements,
        }

    @staticmethod
    def _sync_legacy_membership_snapshot_in_connection(connection, user_id, now=None):
        current_time = now or iso_now()
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or (row["username_normalized"] == ADMIN_USERNAME and row["role"] == "super_admin"):
            return
        active_rows = connection.execute(
            """
            SELECT id, expires_at, is_lifetime
            FROM user_memberships
            WHERE user_id = ? AND status = 'active'
            """,
            (user_id,),
        ).fetchall()
        for item in active_rows:
            expiry = parse_time(item["expires_at"])
            if not item["is_lifetime"] and (not expiry or expiry <= utc_now()):
                connection.execute(
                    "UPDATE user_memberships SET status = 'expired', updated_at = ? WHERE id = ?",
                    (current_time, item["id"]),
                )
        memberships = connection.execute(
            """
            SELECT * FROM user_memberships
            WHERE user_id = ? AND status = 'active'
            ORDER BY is_lifetime DESC, expires_at DESC, created_at DESC
            """,
            (user_id,),
        ).fetchall()
        by_plan = {}
        for item in memberships:
            by_plan.setdefault(item["plan_code"], item)
        membership = "free"
        start = expires = language = ""
        selected = None
        if "all_access_lifetime" in by_plan:
            membership, selected = "lifetime", by_plan["all_access_lifetime"]
        elif "dual_language_lifetime" in by_plan:
            membership, selected = "lifetime", by_plan["dual_language_lifetime"]
        elif "legacy_all_lifetime" in by_plan:
            membership, selected = "lifetime", by_plan["legacy_all_lifetime"]
        elif "all_access_monthly" in by_plan:
            membership, selected = "monthly", by_plan["all_access_monthly"]
        elif "japanese_lifetime" in by_plan:
            membership, selected = "lifetime", by_plan["japanese_lifetime"]
        elif "dual_language_monthly" in by_plan:
            membership, selected = "monthly", by_plan["dual_language_monthly"]
        elif "legacy_all_monthly" in by_plan:
            membership, selected = "monthly", by_plan["legacy_all_monthly"]
        elif "trial_single_language" in by_plan:
            membership, selected = "trial_single_language", by_plan["trial_single_language"]
            try:
                language = json.loads(selected["metadata_json"] or "{}").get("language", "")
            except (json.JSONDecodeError, TypeError):
                language = ""
        if selected:
            start = selected["starts_at"]
            if membership not in {"lifetime"} and not expires:
                expires = selected["expires_at"]
        connection.execute(
            """
            UPDATE users SET membership = ?, membership_start = ?, membership_expires = ?,
                trial_language = ?, updated_at = ? WHERE id = ?
            """,
            (membership, start, expires, language, current_time, user_id),
        )

    def _sync_legacy_membership_snapshot(self, user_id):
        with self.lock, self.connect() as connection:
            self._sync_legacy_membership_snapshot_in_connection(connection, user_id)

    def quiz_limit(self, row, language):
        if self.is_super_admin(row):
            return None
        entitlements = self.entitlements_for(row)
        if "language_all_access" in entitlements:
            return None
        if language == "japanese" and "language_japanese_access" in entitlements:
            return None
        if language == "english" and "language_english_access" in entitlements:
            return None
        return 15

    def change_own_secret(self, user_id, current_secret, new_secret):
        row = self.get_user(user_id)
        if not row:
            raise AccountError("账户不存在", 404, "user_not_found")
        if self.is_super_admin(row):
            raise AccountError("固定管理员密钥不能在此修改", 403, "admin_protected")
        if not verify_secret(current_secret, row["secret"]):
            raise AccountError("当前登录密钥错误", 403, "invalid_secret")
        new_secret = self.validate_secret(new_secret)
        with self.lock, self.connect() as connection:
            connection.execute(
                "UPDATE users SET secret = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
                (hash_secret(new_secret), iso_now(), user_id),
            )
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        self._sync_after_write()

    def delete_own_account(self, user_id, secret):
        row = self.get_user(user_id)
        if not row:
            raise AccountError("账户不存在", 404, "user_not_found")
        if self.is_super_admin(row):
            raise AccountError("固定管理员账户不能注销", 403, "admin_protected")
        if not verify_secret(secret, row["secret"]):
            raise AccountError("当前登录密钥错误", 403, "invalid_secret")
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM recharge_requests WHERE user_id = ?", (user_id,))
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        self._sync_after_write()

    def list_users(self, query="", match="partial", page=1, limit=30, include_pagination=False):
        query = str(query or "").strip()
        if len(query) > 80:
            raise AccountError("用户搜索内容过长", 400, "admin_user_query_too_long")
        match = "exact" if match == "exact" else "partial"
        try:
            page = max(1, min(int(page or 1), 10000))
            limit = max(10, min(int(limit or 30), 100))
        except (TypeError, ValueError) as exc:
            raise AccountError("用户分页参数无效", 400, "admin_user_pagination_invalid") from exc
        offset = (page - 1) * limit
        where = "deleted = 0"
        values = []
        if query:
            normalized = self.normalize_username(query)
            if match == "exact":
                where += " AND (id = ? OR username_normalized = ?)"
                values.extend((query, normalized))
            else:
                escaped = query.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                where += " AND (LOWER(id) LIKE ? ESCAPE '\\' OR username_normalized LIKE ? ESCAPE '\\')"
                values.extend((f"%{escaped}%", f"%{escaped}%"))
        with self.connect() as connection:
            total = int(connection.execute(f"SELECT COUNT(*) FROM users WHERE {where}", values).fetchone()[0])
            rows = connection.execute(
                f"SELECT * FROM users WHERE {where} ORDER BY registered_at DESC, username_normalized, id LIMIT ? OFFSET ?",
                (*values, limit, offset),
            ).fetchall()
            pending = {}
            user_ids = [row["id"] for row in rows]
            if user_ids:
                placeholders = ",".join("?" for _ in user_ids)
                for item in connection.execute(
                    f"SELECT user_id, status FROM recharge_requests WHERE user_id IN ({placeholders}) ORDER BY requested_at DESC",
                    user_ids,
                ).fetchall():
                    pending.setdefault(item["user_id"], item["status"])
        result = []
        for row in rows:
            item = self.user_payload(row)
            item["recharge_status"] = pending.get(row["id"], "")
            result.append(item)
        page_result = {
            "users": result,
            "total": total,
            "page": page,
            "limit": limit,
            "has_more": offset + len(result) < total,
            "query": query,
            "match": match,
        }
        return page_result if include_pagination else result

    @staticmethod
    def _public_snapshot(payload):
        if not payload:
            return {}
        return {
            "id": payload.get("id", ""),
            "username": payload.get("username", ""),
            "role": payload.get("role", ""),
            "banned": bool(payload.get("banned")),
            "memberships": payload.get("memberships", []),
            "entitlements": payload.get("entitlements", []),
            "membership_summary": payload.get("membership_summary", {}),
        }

    def _audit(self, connection, actor, action, target=None, before=None, after=None, note=""):
        connection.execute(
            """
            INSERT INTO admin_audit_logs (
                id, actor_user_id, actor_username, target_user_id, target_username,
                action, before_json, after_json, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                actor["id"],
                actor["username"],
                target["id"] if target else "",
                target["username"] if target else "",
                action,
                json.dumps(before or {}, ensure_ascii=False, separators=(",", ":")),
                json.dumps(after or {}, ensure_ascii=False, separators=(",", ":")),
                str(note or "")[:500],
                iso_now(),
            ),
        )

    def list_audit_logs(self, actor, limit=200):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        safe_limit = max(1, min(int(limit or 200), 500))
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM admin_audit_logs ORDER BY created_at DESC, rowid DESC LIMIT ?", (safe_limit,)
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            for field in ("before_json", "after_json"):
                output_field = field[:-5] if field.endswith("_json") else field
                try:
                    item[output_field] = json.loads(item.pop(field) or "{}")
                except (json.JSONDecodeError, TypeError):
                    item[output_field] = {}
                    item.pop(field, None)
            result.append(item)
        return result

    def record_login_event(self, attempted_username, success, reason, context=None, user=None):
        details = context if isinstance(context, dict) else {}
        target = user
        if target is None and attempted_username:
            target = self.get_user_by_name(attempted_username, include_deleted=True)
        username = target["username"] if target else str(attempted_username or "").strip()[:40]
        now = iso_now()
        cutoff = (utc_now() - timedelta(days=LOGIN_AUDIT_RETENTION_DAYS)).replace(
            microsecond=0
        ).isoformat().replace("+00:00", "Z")
        values = (
            str(uuid.uuid4()),
            target["id"] if target else "",
            username,
            int(bool(success)),
            str(reason or ("success" if success else "failed"))[:80],
            str(details.get("ip_address") or "")[:80],
            str(details.get("country") or "")[:80],
            str(details.get("region") or "")[:120],
            str(details.get("city") or "")[:120],
            str(details.get("user_agent") or "")[:400],
            str(details.get("source") or "direct")[:40],
            now,
        )
        with self.lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO login_audit_logs (
                    id, user_id, username, success, reason, ip_address,
                    country, region, city, user_agent, source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            connection.execute("DELETE FROM login_audit_logs WHERE created_at < ?", (cutoff,))
            connection.execute(
                """
                DELETE FROM login_audit_logs WHERE id IN (
                    SELECT id FROM login_audit_logs
                    ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
                )
                """,
                (LOGIN_AUDIT_MAX_RECORDS,),
            )

    def list_login_audit_logs(self, actor, limit=300):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        safe_limit = max(1, min(int(limit or 300), 500))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, user_id, username, success, reason, ip_address,
                       country, region, city, user_agent, source, created_at
                FROM login_audit_logs
                ORDER BY created_at DESC, rowid DESC LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _feedback_field(value, field, maximum, required=False, single_line=False):
        text = str(value or "").strip()
        if required and not text:
            raise AccountError(f"{field}不能为空", 400, "feedback_field_required")
        if len(text) > maximum:
            raise AccountError(f"{field}最多 {maximum} 个字符", 400, "feedback_field_too_long")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", text):
            raise AccountError(f"{field}包含无效控制字符", 400, "feedback_field_invalid")
        if single_line:
            text = re.sub(r"\s+", " ", text)
        return text

    @classmethod
    def _validated_feedback_input(cls, payload):
        if not isinstance(payload, dict):
            raise AccountError("反馈格式无效", 400, "feedback_invalid")
        unexpected = set(payload) - FEEDBACK_ALLOWED_FIELDS
        if unexpected:
            raise AccountError("反馈包含不允许提交的字段", 400, "feedback_fields_forbidden")
        feedback_type = str(payload.get("type") or "").strip()
        if feedback_type not in FEEDBACK_TYPES:
            raise AccountError("反馈类型无效", 400, "feedback_type_invalid")
        result = {
            "feedback_type": feedback_type,
            "title": cls._feedback_field(payload.get("title"), "标题", 120, True, True),
            "content": cls._feedback_field(payload.get("content"), "反馈内容", 2000, True),
            "route": cls._feedback_field(payload.get("route"), "当前页面", 180, False, True),
            "tool_id": cls._feedback_field(payload.get("tool_id"), "工具 ID", 80, False, True),
            "app_version": cls._feedback_field(payload.get("app_version"), "应用版本", 80, False, True),
            "browser_info": cls._feedback_field(payload.get("browser_info"), "浏览器信息", 240, False, True),
            "error_code": cls._feedback_field(payload.get("error_code"), "错误代码", 80, False, True),
        }
        if result["route"] and (not result["route"].startswith("/") or "://" in result["route"]):
            raise AccountError("当前页面必须是站内路径", 400, "feedback_route_invalid")
        if result["tool_id"] and not re.fullmatch(r"[a-z0-9][a-z0-9._:-]{0,79}", result["tool_id"]):
            raise AccountError("工具 ID 格式无效", 400, "feedback_tool_invalid")
        if result["app_version"] and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", result["app_version"]):
            raise AccountError("应用版本格式无效", 400, "feedback_version_invalid")
        if result["error_code"] and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", result["error_code"]):
            raise AccountError("错误代码格式无效", 400, "feedback_error_code_invalid")
        combined = "\n".join(result.values())
        if FEEDBACK_SENSITIVE_PATTERN.search(combined) or re.search(
            r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)", combined
        ):
            raise AccountError(
                "反馈不能包含密钥、令牌、支付信息或本机文件路径",
                400,
                "feedback_sensitive_data",
            )
        return result

    @staticmethod
    def _feedback_payload(row, include_content=True, include_admin=False):
        item = dict(row)
        payload = {
            "id": item.get("id", ""),
            "type": item.get("feedback_type", ""),
            "title": item.get("title", ""),
            "status": item.get("status", "pending"),
            "merged_into_id": item.get("merged_into_id", ""),
            "vote_count": int(item.get("vote_count") or 0),
            "voted": bool(item.get("own_vote")),
            "created_at": item.get("created_at", ""),
            "updated_at": item.get("updated_at", ""),
        }
        if include_content:
            payload.update(
                {
                    "content": item.get("content", ""),
                    "route": item.get("route", ""),
                    "tool_id": item.get("tool_id", ""),
                    "app_version": item.get("app_version", ""),
                    "browser_info": item.get("browser_info", ""),
                    "error_code": item.get("error_code", ""),
                }
            )
        if include_admin:
            payload.update(
                {
                    "user_id": item.get("user_id", ""),
                    "username": item.get("username", ""),
                    "admin_note": item.get("admin_note", ""),
                }
            )
        return payload

    @staticmethod
    def _feedback_audit_snapshot(row):
        item = dict(row)
        return {
            "id": item.get("id", ""),
            "type": item.get("feedback_type", ""),
            "status": item.get("status", ""),
            "merged_into_id": item.get("merged_into_id", ""),
            "admin_note": item.get("admin_note", ""),
        }

    def create_feedback(self, user, payload):
        values = self._validated_feedback_input(payload)
        feedback_id = str(uuid.uuid4())
        now = iso_now()
        with self.lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO feedback_items (
                    id, user_id, username, feedback_type, title, content,
                    route, tool_id, app_version, browser_info, error_code,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (
                    feedback_id,
                    user["id"],
                    user["username"],
                    values["feedback_type"],
                    values["title"],
                    values["content"],
                    values["route"],
                    values["tool_id"],
                    values["app_version"],
                    values["browser_info"],
                    values["error_code"],
                    now,
                    now,
                ),
            )
            row = connection.execute(
                """
                SELECT item.*, 0 AS vote_count, 0 AS own_vote
                FROM feedback_items AS item WHERE item.id = ?
                """,
                (feedback_id,),
            ).fetchone()
        return self._feedback_payload(row)

    def list_user_feedback(self, user, limit=100):
        safe_limit = max(1, min(int(limit or 100), 200))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT item.*,
                       (SELECT COUNT(*) FROM feedback_votes AS vote
                        WHERE vote.feedback_id = item.id) AS vote_count,
                       EXISTS(SELECT 1 FROM feedback_votes AS own
                              WHERE own.feedback_id = item.id AND own.user_id = ?) AS own_vote
                FROM feedback_items AS item
                WHERE item.user_id = ?
                ORDER BY item.created_at DESC, item.rowid DESC LIMIT ?
                """,
                (user["id"], user["id"], safe_limit),
            ).fetchall()
        return [self._feedback_payload(row) for row in rows]

    def list_feature_votes(self, user, limit=100):
        safe_limit = max(1, min(int(limit or 100), 200))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT item.*,
                       (SELECT COUNT(*) FROM feedback_votes AS vote
                        WHERE vote.feedback_id = item.id) AS vote_count,
                       EXISTS(SELECT 1 FROM feedback_votes AS own
                              WHERE own.feedback_id = item.id AND own.user_id = ?) AS own_vote
                FROM feedback_items AS item
                WHERE item.feedback_type IN ('feature_suggestion', 'new_tool')
                  AND item.status IN ('accepted', 'completed')
                  AND item.merged_into_id = ''
                ORDER BY vote_count DESC, item.updated_at DESC, item.rowid DESC
                LIMIT ?
                """,
                (user["id"], safe_limit),
            ).fetchall()
        return [self._feedback_payload(row, include_content=False) for row in rows]

    def set_feedback_vote(self, user, feedback_id, voted=True):
        target_id = str(feedback_id or "").strip()
        if not target_id:
            raise AccountError("缺少功能建议 ID", 400, "feedback_id_required")
        if not isinstance(voted, bool):
            raise AccountError("投票状态无效", 400, "feedback_vote_invalid")
        with self.lock, self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM feedback_items WHERE id = ?",
                (target_id,),
            ).fetchone()
            if (
                not row
                or row["feedback_type"] not in FEEDBACK_PUBLIC_TYPES
                or row["status"] not in {"accepted", "completed"}
                or row["merged_into_id"]
            ):
                raise AccountError("该建议暂不开放投票", 404, "feedback_vote_unavailable")
            if voted:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO feedback_votes(feedback_id, user_id, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (target_id, user["id"], iso_now()),
                )
            else:
                connection.execute(
                    "DELETE FROM feedback_votes WHERE feedback_id = ? AND user_id = ?",
                    (target_id, user["id"]),
                )
            result = connection.execute(
                """
                SELECT item.*,
                       (SELECT COUNT(*) FROM feedback_votes AS vote
                        WHERE vote.feedback_id = item.id) AS vote_count,
                       EXISTS(SELECT 1 FROM feedback_votes AS own
                              WHERE own.feedback_id = item.id AND own.user_id = ?) AS own_vote
                FROM feedback_items AS item WHERE item.id = ?
                """,
                (user["id"], target_id),
            ).fetchone()
        return self._feedback_payload(result, include_content=False)

    def admin_list_feedback(self, actor, query="", status="", feedback_type="", limit=200):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        safe_query = self._feedback_field(query, "搜索内容", 80, False, True)
        safe_status = str(status or "").strip()
        safe_type = str(feedback_type or "").strip()
        if safe_status and safe_status not in FEEDBACK_STATUSES:
            raise AccountError("反馈状态无效", 400, "feedback_status_invalid")
        if safe_type and safe_type not in FEEDBACK_TYPES:
            raise AccountError("反馈类型无效", 400, "feedback_type_invalid")
        safe_limit = max(1, min(int(limit or 200), 500))
        clauses = []
        parameters = []
        if safe_query:
            pattern = f"%{safe_query}%"
            clauses.append("(item.title LIKE ? OR item.username LIKE ? OR item.id LIKE ?)")
            parameters.extend((pattern, pattern, pattern))
        if safe_status:
            clauses.append("item.status = ?")
            parameters.append(safe_status)
        if safe_type:
            clauses.append("item.feedback_type = ?")
            parameters.append(safe_type)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.append(safe_limit)
        with self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT item.*,
                       (SELECT COUNT(*) FROM feedback_votes AS vote
                        WHERE vote.feedback_id = item.id) AS vote_count,
                       0 AS own_vote
                FROM feedback_items AS item
                {where}
                ORDER BY item.updated_at DESC, item.rowid DESC LIMIT ?
                """,
                tuple(parameters),
            ).fetchall()
        return [self._feedback_payload(row, include_content=True, include_admin=True) for row in rows]

    def admin_update_feedback(
        self,
        actor,
        feedback_id,
        action,
        status="",
        admin_note="",
        merged_into_id="",
    ):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target_id = str(feedback_id or "").strip()
        operation = str(action or "update").strip()
        note = self._feedback_field(admin_note, "管理员备注", 1000, False)
        if FEEDBACK_SENSITIVE_PATTERN.search(note):
            raise AccountError("管理员备注不能包含密钥、令牌或本机路径", 400, "feedback_sensitive_data")
        with self.lock, self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM feedback_items WHERE id = ?",
                (target_id,),
            ).fetchone()
            if not row:
                raise AccountError("反馈不存在", 404, "feedback_not_found")
            target_user = {"id": row["user_id"], "username": row["username"]}
            before = self._feedback_audit_snapshot(row)
            now = iso_now()
            if operation == "update":
                next_status = str(status or row["status"]).strip()
                if next_status not in FEEDBACK_STATUSES:
                    raise AccountError("反馈状态无效", 400, "feedback_status_invalid")
                connection.execute(
                    """
                    UPDATE feedback_items SET status = ?, admin_note = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (next_status, note, now, target_id),
                )
                audit_action = "feedback_update"
                audit_note = f"状态：{next_status}"
            elif operation == "merge":
                merge_target = str(merged_into_id or "").strip()
                if not merge_target or merge_target == target_id:
                    raise AccountError("请选择另一个建议作为合并目标", 400, "feedback_merge_invalid")
                destination = connection.execute(
                    "SELECT * FROM feedback_items WHERE id = ?",
                    (merge_target,),
                ).fetchone()
                if (
                    not destination
                    or row["feedback_type"] not in FEEDBACK_PUBLIC_TYPES
                    or destination["feedback_type"] not in FEEDBACK_PUBLIC_TYPES
                ):
                    raise AccountError("只能合并功能建议或新工具建议", 400, "feedback_merge_invalid")
                connection.execute(
                    """
                    INSERT OR IGNORE INTO feedback_votes(feedback_id, user_id, created_at)
                    SELECT ?, user_id, created_at FROM feedback_votes WHERE feedback_id = ?
                    """,
                    (merge_target, target_id),
                )
                connection.execute("DELETE FROM feedback_votes WHERE feedback_id = ?", (target_id,))
                connection.execute(
                    """
                    UPDATE feedback_items
                    SET status = 'rejected', admin_note = ?, merged_into_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (note, merge_target, now, target_id),
                )
                audit_action = "feedback_merge"
                audit_note = f"合并至 {merge_target}"
            elif operation == "delete_spam":
                connection.execute("DELETE FROM feedback_items WHERE id = ?", (target_id,))
                self._audit(
                    connection,
                    actor,
                    "feedback_delete_spam",
                    target=target_user,
                    before=before,
                    after={"id": target_id, "deleted": True},
                    note="删除垃圾反馈",
                )
                return {"id": target_id, "deleted": True}
            else:
                raise AccountError("反馈操作无效", 400, "feedback_action_invalid")
            updated = connection.execute(
                "SELECT * FROM feedback_items WHERE id = ?",
                (target_id,),
            ).fetchone()
            self._audit(
                connection,
                actor,
                audit_action,
                target=target_user,
                before=before,
                after=self._feedback_audit_snapshot(updated),
                note=audit_note,
            )
            result = connection.execute(
                """
                SELECT item.*,
                       (SELECT COUNT(*) FROM feedback_votes AS vote
                        WHERE vote.feedback_id = item.id) AS vote_count,
                       0 AS own_vote
                FROM feedback_items AS item WHERE item.id = ?
                """,
                (target_id,),
            ).fetchone()
        return self._feedback_payload(result, include_content=True, include_admin=True)

    def admin_manage_membership(
        self,
        actor,
        user_id,
        action,
        plan_code="",
        start="",
        expires="",
        note="",
        preserve_japanese=False,
        trial_language="",
    ):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能修改固定管理员的等级", 403, "admin_protected")
        action = str(action or "").strip().lower()
        plan_code = str(plan_code or "").strip()
        language_value = str(trial_language or "").strip().lower()
        if action in {"grant", "extend", "cancel"} and plan_code not in MEMBERSHIP_PLANS:
            raise AccountError("会员方案无效", 400, "plan_invalid")
        if action in {"grant", "extend"} and not MEMBERSHIP_PLANS[plan_code]["purchasable"]:
            raise AccountError(
                "该历史会员方案不能新开通，请选择当前在售方案",
                400,
                "plan_retired",
            )
        before = self._public_snapshot(self.user_payload(target))
        now = iso_now()
        with self.lock, self.connect() as connection:
            if action in {"grant", "extend"}:
                plan = MEMBERSHIP_PLANS[plan_code]
                raw_start = str(start or "").strip()
                raw_expires = str(expires or "").strip()
                start_value = membership_time_value(raw_start) if raw_start else now
                if raw_start and not start_value:
                    raise AccountError("会员开始日期格式无效，请使用年/月/日", 400, "membership_start_invalid")
                compatible_codes = ("japanese_lifetime", "dual_language_lifetime") if plan_code == "japanese_lifetime" else (plan_code,)
                placeholders = ",".join("?" for _ in compatible_codes)
                existing = connection.execute(
                    f"""
                    SELECT * FROM user_memberships
                    WHERE user_id = ? AND plan_code IN ({placeholders})
                    ORDER BY CASE WHEN plan_code = ? THEN 0 ELSE 1 END,
                        expires_at DESC, created_at DESC LIMIT 1
                    """,
                    (user_id, *compatible_codes, plan_code),
                ).fetchone()
                if plan_code == "trial_single_language":
                    if not language_value and existing:
                        try:
                            language_value = json.loads(existing["metadata_json"] or "{}").get("language", "")
                        except (json.JSONDecodeError, TypeError):
                            language_value = ""
                    if language_value not in LANGUAGES:
                        raise AccountError("单语言包月体验必须选择英语或日语", 400, "trial_language_invalid")
                    metadata_json = json.dumps(
                        {"language": language_value}, ensure_ascii=False, separators=(",", ":")
                    )
                else:
                    metadata_json = "{}"
                if action == "extend" and not plan["lifetime"]:
                    current_expiry = parse_time(existing["expires_at"]) if existing and existing["status"] == "active" else None
                    base = current_expiry if current_expiry and current_expiry > utc_now() else utc_now()
                    expires_value = membership_time_value(raw_expires, end_of_day=True) if raw_expires else default_plan_expiry(plan_code, base)
                    start_value = existing["starts_at"] if existing else start_value
                elif plan["lifetime"]:
                    expires_value = ""
                else:
                    expires_value = membership_time_value(raw_expires, end_of_day=True) if raw_expires else default_plan_expiry(plan_code, parse_time(start_value) or utc_now())
                if raw_expires and not expires_value:
                    raise AccountError("会员截止日期格式无效，请使用年/月/日", 400, "membership_expires_invalid")
                if existing:
                    connection.execute(
                        """
                        UPDATE user_memberships SET starts_at = ?, expires_at = ?, is_lifetime = ?,
                            status = 'active', source = 'admin', created_by = ?, metadata_json = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            start_value,
                            expires_value,
                            int(plan["lifetime"]),
                            actor["username"],
                            metadata_json,
                            now,
                            existing["id"],
                        ),
                    )
                else:
                    connection.execute(
                        """
                        INSERT INTO user_memberships (
                            id, user_id, plan_code, starts_at, expires_at, is_lifetime,
                            status, source, source_ref, created_by, metadata_json, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'admin', ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            user_id,
                            plan_code,
                            start_value,
                            expires_value,
                            int(plan["lifetime"]),
                            f"admin:{plan_code}",
                            actor["username"],
                            metadata_json,
                            now,
                            now,
                        ),
                    )
            elif action == "cancel":
                if plan_code == "japanese_lifetime":
                    connection.execute(
                        "UPDATE user_memberships SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND plan_code IN ('japanese_lifetime', 'dual_language_lifetime') AND status = 'active'",
                        (now, user_id),
                    )
                else:
                    connection.execute(
                        "UPDATE user_memberships SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND plan_code = ? AND status = 'active'",
                        (now, user_id, plan_code),
                    )
            elif action == "cancel_all":
                if preserve_japanese:
                    connection.execute(
                        """
                        UPDATE user_memberships SET status = 'cancelled', updated_at = ?
                        WHERE user_id = ? AND status = 'active' AND plan_code NOT IN ('japanese_lifetime', 'dual_language_lifetime')
                        """,
                        (now, user_id),
                    )
                else:
                    connection.execute(
                        "UPDATE user_memberships SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status = 'active'",
                        (now, user_id),
                    )
            else:
                raise AccountError("会员操作无效", 400, "membership_action_invalid")
        self._sync_legacy_membership_snapshot(user_id)
        current = self.get_user(user_id)
        after_payload = self.user_payload(current)
        with self.lock, self.connect() as connection:
            self._audit(
                connection,
                actor,
                f"membership_{action}",
                target=current,
                before=before,
                after=self._public_snapshot(after_payload),
                note=note,
            )
        self._sync_after_write()
        return after_payload

    def admin_set_entitlement_override(self, actor, user_id, entitlement, allowed, note=""):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能修改固定管理员的权限", 403, "admin_protected")
        entitlement = str(entitlement or "").strip()
        if entitlement not in ENTITLEMENT_LABELS:
            raise AccountError("权益代码无效", 400, "entitlement_invalid")
        before = self._public_snapshot(self.user_payload(target))
        with self.lock, self.connect() as connection:
            if allowed is None:
                connection.execute(
                    "DELETE FROM user_entitlement_overrides WHERE user_id = ? AND entitlement_code = ?",
                    (user_id, entitlement),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO user_entitlement_overrides (
                        user_id, entitlement_code, allowed, note, updated_by, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, entitlement_code) DO UPDATE SET
                        allowed = excluded.allowed, note = excluded.note,
                        updated_by = excluded.updated_by, updated_at = excluded.updated_at
                    """,
                    (user_id, entitlement, int(bool(allowed)), str(note or "")[:500], actor["username"], iso_now()),
                )
        after_payload = self.user_payload(self.get_user(user_id))
        with self.lock, self.connect() as connection:
            self._audit(
                connection,
                actor,
                "entitlement_override_clear" if allowed is None else "entitlement_override",
                target=target,
                before=before,
                after=self._public_snapshot(after_payload),
                note=note,
            )
        return after_payload

    def admin_set_membership(self, actor, user_id, membership, start="", expires="", trial_language=""):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能修改固定管理员的等级", 403, "admin_protected")
        before = self._public_snapshot(self.user_payload(target))
        membership = str(membership or "free")
        if membership not in LEGACY_MEMBERSHIP_CODES:
            raise AccountError("会员等级无效", 400, "membership_invalid")
        raw_start = str(start or "").strip()
        raw_expires = str(expires or "").strip()
        start_value = membership_time_value(raw_start) if raw_start else ""
        expires_value = membership_time_value(raw_expires, end_of_day=True) if raw_expires else ""
        language_value = str(trial_language or "").strip().lower()
        if membership == "free":
            start_value = expires_value = language_value = ""
        elif membership == "lifetime":
            if raw_start and not start_value:
                raise AccountError("会员开始日期格式无效，请使用年/月/日", 400, "membership_start_invalid")
            start_value = start_value or iso_now()
            expires_value = ""
            language_value = ""
        else:
            if raw_start and not start_value:
                raise AccountError("会员开始日期格式无效，请使用年/月/日", 400, "membership_start_invalid")
            if raw_expires and not expires_value:
                raise AccountError("会员截止日期格式无效，请使用年/月/日", 400, "membership_expires_invalid")
            start_value = start_value or iso_now()
            expires_value = expires_value or default_membership_expiry()
            if membership == "trial_single_language":
                if language_value not in LANGUAGES:
                    raise AccountError("体验版必须选择英语或日语", 400, "trial_language_invalid")
            else:
                language_value = ""
        with self.lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE users SET membership = ?, membership_start = ?, membership_expires = ?,
                    trial_language = ?, updated_at = ? WHERE id = ?
                """,
                (membership, start_value, expires_value, language_value, iso_now(), user_id),
            )
            connection.execute(
                """
                UPDATE user_memberships SET status = 'cancelled', updated_at = ?
                WHERE user_id = ? AND status = 'active'
                  AND plan_code IN ('trial_single_language', 'legacy_all_monthly', 'legacy_all_lifetime')
                """,
                (iso_now(), user_id),
            )
            plan_code = LEGACY_PLAN_MAP.get(membership)
            if plan_code:
                plan = MEMBERSHIP_PLANS[plan_code]
                metadata = {"language": language_value} if membership == "trial_single_language" else {}
                existing = connection.execute(
                    "SELECT id FROM user_memberships WHERE user_id = ? AND source = 'legacy_admin' AND source_ref = 'users.membership'",
                    (user_id,),
                ).fetchone()
                values = (
                    plan_code,
                    start_value,
                    expires_value,
                    int(plan["lifetime"]),
                    json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                    actor["username"],
                    iso_now(),
                )
                if existing:
                    connection.execute(
                        """
                        UPDATE user_memberships SET plan_code = ?, starts_at = ?, expires_at = ?,
                            is_lifetime = ?, status = 'active', metadata_json = ?, created_by = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        values + (existing["id"],),
                    )
                else:
                    connection.execute(
                        """
                        INSERT INTO user_memberships (
                            id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
                            source, source_ref, created_by, metadata_json, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'legacy_admin', 'users.membership', ?, ?, ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            user_id,
                            plan_code,
                            start_value,
                            expires_value,
                            int(plan["lifetime"]),
                            actor["username"],
                            json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                            iso_now(),
                            iso_now(),
                        ),
                    )
        self._sync_after_write()
        after = self.user_payload(self.get_user(user_id))
        with self.lock, self.connect() as connection:
            self._audit(
                connection,
                actor,
                "legacy_membership_set",
                target=target,
                before=before,
                after=self._public_snapshot(after),
            )
        return after

    def admin_change_secret(self, actor, user_id, secret):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("固定管理员密钥不能修改", 403, "admin_protected")
        secret = self.validate_secret(secret)
        before = self._public_snapshot(self.user_payload(target))
        with self.lock, self.connect() as connection:
            connection.execute(
                "UPDATE users SET secret = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
                (hash_secret(secret), iso_now(), user_id),
            )
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._audit(
                connection,
                actor,
                "secret_reset",
                target=target,
                before=before,
                after=before,
                note="管理员重置登录密钥并注销全部会话",
            )
        self._sync_after_write()

    def admin_set_ban(self, actor, user_id, banned):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能封禁固定管理员", 403, "admin_protected")
        before = self._public_snapshot(self.user_payload(target))
        value = 1 if banned else 0
        with self.lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE users SET banned = ?, permanent_ban = ?, session_version = session_version + 1,
                    updated_at = ? WHERE id = ?
                """,
                (value, value, iso_now(), user_id),
            )
            if value:
                connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        after = self._public_snapshot(self.user_payload(self.get_user(user_id)))
        with self.lock, self.connect() as connection:
            self._audit(
                connection,
                actor,
                "ban" if value else "unban",
                target=target,
                before=before,
                after=after,
            )
        self._sync_after_write()

    def admin_force_logout(self, actor, user_id):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能强制退出固定管理员", 403, "admin_protected")
        self.revoke_user_sessions(user_id)
        with self.lock, self.connect() as connection:
            snapshot = self._public_snapshot(self.user_payload(target))
            self._audit(
                connection,
                actor,
                "force_logout",
                target=target,
                before=snapshot,
                after=snapshot,
            )

    def admin_delete_user(self, actor, user_id):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        target = self.get_user(user_id)
        if not target:
            raise AccountError("用户不存在", 404, "user_not_found")
        if self.is_super_admin(target):
            raise AccountError("不能删除固定管理员", 403, "admin_protected")
        before = self._public_snapshot(self.user_payload(target))
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM recharge_requests WHERE user_id = ?", (user_id,))
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            if target["permanent_ban"]:
                connection.execute(
                    """
                    UPDATE users SET secret = '', membership = 'free', membership_start = '',
                        membership_expires = '', trial_language = '', deleted = 1, updated_at = ? WHERE id = ?
                    """,
                    (iso_now(), user_id),
                )
            else:
                connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self._audit(
                connection,
                actor,
                "delete_user",
                target=target,
                before=before,
                after={},
            )
        self._sync_after_write()

    @staticmethod
    def _payment_asset_account_error(exc):
        status = 400 if exc.code in {
            "payment_method_invalid",
            "payment_qr_not_configured",
            "payment_qr_mismatch",
        } else 503
        return AccountError(str(exc), status, exc.code)

    @classmethod
    def _validated_payment_request_method(cls, request):
        try:
            method = normalize_payment_method(request["payment_method"])
            expected_resource_id = qr_resource_id_for(method, request["plan_code"])
        except PaymentAssetError as exc:
            raise cls._payment_asset_account_error(exc) from exc
        if request["qr_resource_id"] != expected_resource_id:
            raise AccountError(
                "订单支付方式与二维码不一致，请取消订单后重新创建",
                409,
                "payment_qr_mismatch",
            )
        return method

    def create_recharge_request(self, user, plan, payment_method="", trial_language=""):
        if not user or user["deleted"] or user["banned"]:
            raise AccountError("账户不可用", 403, "account_unavailable")
        plan_code = str(plan or "").strip()
        if plan_code not in PURCHASABLE_PLAN_CODES:
            if plan_code in MEMBERSHIP_PLANS:
                raise AccountError(
                    "该会员方案已停止销售，请刷新页面后选择当前可购买方案",
                    400,
                    "plan_retired",
                )
            raise AccountError("充值套餐无效", 400, "plan_invalid")
        plan_data = MEMBERSHIP_PLANS[plan_code]
        try:
            method = normalize_payment_method(payment_method)
            resource_id = qr_resource_id_for(method, plan_code)
        except PaymentAssetError as exc:
            raise self._payment_asset_account_error(exc) from exc
        language_value = str(trial_language or "").strip().lower()
        if plan_code == "trial_single_language":
            if language_value not in LANGUAGES:
                raise AccountError("单语言包月体验必须选择英语或日语", 400, "trial_language_invalid")
        else:
            language_value = ""
        now = iso_now()
        expires_at = (
            utc_now() + timedelta(hours=PAYMENT_ORDER_TTL_HOURS)
        ).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        request_id = str(uuid.uuid4())
        order_number = f"WYJ-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"
        language_label = {"english": "英语", "japanese": "日语"}.get(language_value, "")
        plan_label = f"{plan_data['name']}（{language_label}）" if language_label else plan_data["name"]
        payment_note = f"{user['username']} {order_number} {plan_label}"
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_pending_payment_requests(connection, user["id"])
            existing = connection.execute(
                """
                SELECT * FROM payment_requests WHERE user_id = ?
                AND status IN ('pending_payment', 'user_paid', 'processing')
                ORDER BY requested_at DESC LIMIT 1
                """,
                (user["id"],),
            ).fetchone()
            if existing:
                same_order = (
                    existing["plan_code"] == plan_code
                    and existing["payment_method"] == method
                    and existing["trial_language"] == language_value
                )
                if same_order:
                    return self.payment_request_payload(existing), False
                raise AccountError(
                    "已有未完成订单，请先取消原订单；已确认付款的订单不能更换支付方式",
                    409,
                    "payment_order_conflict",
                )
            connection.execute(
                """
                INSERT INTO payment_requests (
                    id, order_number, user_id, username, plan_code, amount_cents, currency,
                    contact, payment_note, status, requested_at, updated_at, trial_language,
                    plan_name_snapshot, payment_method, qr_resource_id, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    request_id,
                    order_number,
                    user["id"],
                    user["username"],
                    plan_code,
                    plan_data["price_cents"],
                    plan_data["currency"],
                    payment_note,
                    now,
                    now,
                    language_value,
                    plan_data["name"],
                    method,
                    resource_id,
                    expires_at,
                ),
            )
            self._record_payment_event(
                connection,
                request_id,
                "",
                "pending_payment",
                actor=user,
                note="用户确认套餐与支付方式，订单金额已锁定",
                created_at=now,
            )
            record = connection.execute("SELECT * FROM payment_requests WHERE id = ?", (request_id,)).fetchone()
        return self.payment_request_payload(record), True

    def confirm_recharge_payment(self, user, request_id):
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_pending_payment_requests(connection, user["id"])
            request = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ? AND user_id = ?",
                (str(request_id or ""), user["id"]),
            ).fetchone()
            if not request:
                raise AccountError("充值订单不存在", 404, "payment_not_found")
            self._validated_payment_request_method(request)
            if request["status"] == "user_paid":
                return self.payment_request_payload(request)
            if request["status"] != "pending_payment":
                raise AccountError("该订单不能再确认付款", 409, "payment_status_invalid")
            now = iso_now()
            connection.execute(
                """
                UPDATE payment_requests SET status = 'user_paid', user_confirmed_at = ?,
                    updated_at = ? WHERE id = ? AND status = 'pending_payment'
                """,
                (now, now, request["id"]),
            )
            self._record_payment_event(
                connection,
                request["id"],
                "pending_payment",
                "user_paid",
                actor=user,
                note="用户声明已完成付款",
                created_at=now,
            )
            record = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ?", (request["id"],)
            ).fetchone()
            return self.payment_request_payload(record)

    def cancel_recharge_request(self, user, request_id):
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_pending_payment_requests(connection, user["id"])
            request = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ? AND user_id = ?",
                (str(request_id or ""), user["id"]),
            ).fetchone()
            if not request:
                raise AccountError("充值订单不存在", 404, "payment_not_found")
            if request["status"] == "cancelled":
                return self.payment_request_payload(request)
            if request["status"] != "pending_payment":
                raise AccountError("该订单已确认付款，不能取消或更换支付方式", 409, "payment_status_invalid")
            now = iso_now()
            changed = connection.execute(
                """
                UPDATE payment_requests
                SET status = 'cancelled', cancelled_at = ?, handled_at = ?, updated_at = ?
                WHERE id = ? AND status = 'pending_payment'
                """,
                (now, now, now, request["id"]),
            ).rowcount
            if changed != 1:
                raise AccountError("订单状态已变化，请刷新后重试", 409, "payment_status_invalid")
            self._record_payment_event(
                connection,
                request["id"],
                "pending_payment",
                "cancelled",
                actor=user,
                note="用户取消订单",
                created_at=now,
            )
            record = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ?", (request["id"],)
            ).fetchone()
            return self.payment_request_payload(record)

    def payment_request_for_qr(self, user, request_id):
        with self.lock, self.connect() as connection:
            self._expire_pending_payment_requests(connection, user["id"])
            request = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ? AND user_id = ?",
                (str(request_id or ""), user["id"]),
            ).fetchone()
            if not request:
                raise AccountError("充值订单不存在", 404, "payment_not_found")
            if request["status"] not in PAYMENT_QR_STATUSES:
                raise AccountError("该订单当前不能查看收款二维码", 409, "payment_qr_status_invalid")
            self._validated_payment_request_method(request)
            return self.payment_request_payload(request)

    def list_user_payment_requests(self, user):
        with self.lock, self.connect() as connection:
            self._expire_pending_payment_requests(connection, user["id"])
            return [
                self.payment_request_payload(row)
                for row in connection.execute(
                    "SELECT * FROM payment_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 50",
                    (user["id"],),
                ).fetchall()
            ]

    def list_recharge_requests(self, actor):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        with self.lock, self.connect() as connection:
            self._expire_pending_payment_requests(connection)
            requests = [
                self.payment_request_payload(row)
                for row in connection.execute(
                    "SELECT * FROM payment_requests ORDER BY requested_at DESC"
                ).fetchall()
            ]
            history = {}
            for row in connection.execute(
                """
                SELECT payment_request_id, from_status, to_status,
                       actor_username, note, created_at
                FROM payment_request_events
                ORDER BY created_at, rowid
                """
            ).fetchall():
                history.setdefault(row["payment_request_id"], []).append(
                    {
                        "from_status": row["from_status"],
                        "to_status": row["to_status"],
                        "actor_username": row["actor_username"],
                        "note": row["note"],
                        "created_at": row["created_at"],
                    }
                )
        for item in requests:
            item["history"] = history.get(item["id"], [])
        return requests

    def _fulfill_payment_in_transaction(self, connection, request, target, actor, now):
        plan_code = request["plan_code"]
        plan = MEMBERSHIP_PLANS.get(plan_code)
        if not plan:
            raise AccountError("订单会员方案已不存在", 409, "plan_invalid")
        existing_fulfillment = connection.execute(
            "SELECT id FROM payment_fulfillments WHERE payment_request_id = ?",
            (request["id"],),
        ).fetchone()
        if existing_fulfillment:
            raise AccountError("充值申请已履约", 409, "request_already_processed")
        language_value = str(request["trial_language"] or "").strip().lower()
        if plan_code == "trial_single_language" and language_value not in LANGUAGES:
            raise AccountError("订单缺少有效的单语言选择", 409, "trial_language_invalid")

        memberships = connection.execute(
            """
            SELECT * FROM user_memberships
            WHERE user_id = ? AND plan_code = ? AND status = 'active'
            ORDER BY is_lifetime DESC, expires_at DESC, created_at DESC
            """,
            (target["id"], plan_code),
        ).fetchall()
        if plan_code == "trial_single_language":
            matching = []
            for membership in memberships:
                try:
                    metadata = json.loads(membership["metadata_json"] or "{}")
                except (json.JSONDecodeError, TypeError):
                    metadata = {}
                if metadata.get("language") == language_value:
                    matching.append(membership)
            memberships = matching

        source_ref = f"payment:{request['id']}"
        membership_id = ""
        starts_at = now
        expires_at = ""
        if plan["lifetime"] and memberships:
            membership_id = memberships[0]["id"]
        else:
            if not plan["lifetime"]:
                base = utc_now()
                for membership in memberships:
                    current_expiry = parse_time(membership["expires_at"])
                    if current_expiry and current_expiry > base:
                        base = current_expiry
                expires_at = default_plan_expiry(plan_code, base)
            membership_id = str(uuid.uuid4())
            metadata_json = (
                json.dumps({"language": language_value}, ensure_ascii=False, separators=(",", ":"))
                if plan_code == "trial_single_language"
                else "{}"
            )
            connection.execute(
                """
                INSERT INTO user_memberships (
                    id, user_id, plan_code, starts_at, expires_at, is_lifetime,
                    status, source, source_ref, created_by, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'payment', ?, ?, ?, ?, ?)
                """,
                (
                    membership_id,
                    target["id"],
                    plan_code,
                    starts_at,
                    expires_at,
                    int(plan["lifetime"]),
                    source_ref,
                    actor["username"],
                    metadata_json,
                    now,
                    now,
                ),
            )
        connection.execute(
            """
            INSERT INTO payment_fulfillments (
                id, payment_request_id, user_id, plan_code, user_membership_id,
                source, source_ref, fulfilled_at
            ) VALUES (?, ?, ?, ?, ?, 'payment', ?, ?)
            """,
            (
                str(uuid.uuid4()),
                request["id"],
                target["id"],
                plan_code,
                membership_id,
                source_ref,
                now,
            ),
        )
        self._sync_legacy_membership_snapshot_in_connection(connection, target["id"], now)
        return {
            "membership_id": membership_id,
            "plan_code": plan_code,
            "starts_at": starts_at,
            "expires_at": expires_at,
            "source": "payment",
            "source_ref": source_ref,
        }

    def process_recharge_request(self, actor, request_id, action, admin_note=""):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        action = str(action or "").strip().lower()
        if action not in {"approve", "reject"}:
            raise AccountError("处理操作无效", 400, "action_invalid")
        admin_note = str(admin_note or "").strip()[:500]
        should_sync = False
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            request = connection.execute(
                "SELECT * FROM payment_requests WHERE id = ?", (str(request_id or ""),)
            ).fetchone()
            if not request:
                raise AccountError("充值申请不存在", 404, "request_not_found")
            if request["status"] != "user_paid":
                raise AccountError("只有用户已确认付款的订单可以处理", 409, "request_already_processed")
            target = connection.execute(
                "SELECT * FROM users WHERE id = ?", (request["user_id"],)
            ).fetchone()
            if not target or target["deleted"] or target["banned"]:
                raise AccountError("订单用户不存在或账户不可用", 409, "payment_user_invalid")
            if target["username_normalized"] == ADMIN_USERNAME and target["role"] == "super_admin":
                raise AccountError("管理员账户不能购买会员", 409, "payment_user_invalid")
            if request["plan_code"] not in MEMBERSHIP_PLANS:
                raise AccountError("订单会员方案无效", 409, "plan_invalid")
            if not request["order_number"].startswith("LEGACY-"):
                try:
                    method = normalize_payment_method(request["payment_method"])
                    expected_resource = qr_resource_id_for(method, request["plan_code"])
                except PaymentAssetError as exc:
                    raise self._payment_asset_account_error(exc) from exc
                if request["qr_resource_id"] != expected_resource:
                    raise AccountError("订单二维码资源不匹配", 409, "payment_qr_mismatch")
            now = iso_now()
            changed = connection.execute(
                """
                UPDATE payment_requests
                SET status = 'processing', processing_at = ?, updated_at = ?,
                    handled_by = ?, admin_note = ?
                WHERE id = ? AND status = 'user_paid'
                """,
                (now, now, actor["username"], admin_note, request["id"]),
            ).rowcount
            if changed != 1:
                raise AccountError("充值申请已处理", 409, "request_already_processed")
            self._record_payment_event(
                connection,
                request["id"],
                "user_paid",
                "processing",
                actor=actor,
                note=admin_note or "管理员开始核对订单",
                created_at=now,
            )
            fulfillment = {}
            if action == "approve":
                fulfillment = self._fulfill_payment_in_transaction(
                    connection, request, target, actor, now
                )
                should_sync = True
            status = "approved" if action == "approve" else "rejected"
            connection.execute(
                """
                UPDATE payment_requests
                SET status = ?, updated_at = ?, handled_at = ?, handled_by = ?, admin_note = ?
                WHERE id = ? AND status = 'processing'
                """,
                (status, now, now, actor["username"], admin_note, request["id"]),
            )
            self._record_payment_event(
                connection,
                request["id"],
                "processing",
                status,
                actor=actor,
                note=admin_note or ("付款核对通过" if action == "approve" else "付款核对未通过"),
                created_at=now,
            )
            self._audit(
                connection,
                actor,
                "payment_approve" if action == "approve" else "payment_reject",
                target=target,
                before={"order_number": request["order_number"], "status": request["status"]},
                after={
                    "order_number": request["order_number"],
                    "status": status,
                    "fulfillment": fulfillment,
                },
                note=admin_note,
            )
        if should_sync:
            self._sync_after_write()
        return status

    @staticmethod
    def _learning_sync_json(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @classmethod
    def _validate_learning_sync_value(cls, value, depth=0):
        if depth > 8:
            raise AccountError("学习数据嵌套层级过深", 400, "learning_sync_payload_invalid")
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if isinstance(value, float) and not math.isfinite(value):
                raise AccountError("学习数据包含无效数字", 400, "learning_sync_payload_invalid")
            return value
        if isinstance(value, str):
            if len(value) > 120_000:
                raise AccountError("单项学习数据文本过长", 413, "learning_sync_record_too_large")
            return value
        if isinstance(value, list):
            if len(value) > 2000:
                raise AccountError("单项学习数据列表过长", 413, "learning_sync_record_too_large")
            return [cls._validate_learning_sync_value(item, depth + 1) for item in value]
        if isinstance(value, dict):
            if len(value) > 300:
                raise AccountError("单项学习数据字段过多", 413, "learning_sync_record_too_large")
            cleaned = {}
            for key, item in value.items():
                key_text = str(key)
                if not key_text or len(key_text) > 100:
                    raise AccountError("学习数据字段名称无效", 400, "learning_sync_payload_invalid")
                cleaned[key_text] = cls._validate_learning_sync_value(item, depth + 1)
            return cleaned
        raise AccountError("学习数据包含不支持的类型", 400, "learning_sync_payload_invalid")

    @classmethod
    def _validated_learning_sync_request(cls, payload):
        if not isinstance(payload, dict):
            raise AccountError("同步请求格式无效", 400, "learning_sync_request_invalid")
        allowed = {"schema_version", "client_id", "client_version", "since_version", "changes"}
        if set(payload) - allowed:
            raise AccountError("同步请求包含不允许的字段", 400, "learning_sync_fields_forbidden")
        schema_version = payload.get("schema_version")
        if isinstance(schema_version, bool) or schema_version != LEARNING_SYNC_SCHEMA_VERSION:
            raise AccountError("学习数据版本不受支持", 409, "learning_sync_schema_unsupported")
        client_id = str(payload.get("client_id") or "").strip()
        if not LEARNING_SYNC_CLIENT_PATTERN.fullmatch(client_id):
            raise AccountError("同步客户端标识无效", 400, "learning_sync_client_invalid")
        client_version = str(payload.get("client_version") or "").strip()
        if not client_version or len(client_version) > 80:
            raise AccountError("客户端版本无效", 400, "learning_sync_client_version_invalid")
        since_version = payload.get("since_version", 0)
        if isinstance(since_version, bool) or not isinstance(since_version, int) or since_version < 0:
            raise AccountError("服务器同步版本无效", 400, "learning_sync_version_invalid")
        changes = payload.get("changes", [])
        if not isinstance(changes, list) or len(changes) > LEARNING_SYNC_MAX_CHANGES:
            raise AccountError("单次同步记录数量超出限制", 413, "learning_sync_changes_limit")

        cleaned_changes = []
        identities = set()
        maximum_time = utc_now() + timedelta(minutes=5)
        for raw in changes:
            if not isinstance(raw, dict):
                raise AccountError("同步记录格式无效", 400, "learning_sync_change_invalid")
            allowed_change = {
                "data_type",
                "record_id",
                "payload",
                "updated_at",
                "deleted",
                "base_server_version",
            }
            if set(raw) - allowed_change:
                raise AccountError("同步记录包含不允许的字段", 400, "learning_sync_change_fields_forbidden")
            data_type = str(raw.get("data_type") or "").strip()
            if data_type not in LEARNING_SYNC_TYPES:
                raise AccountError("学习数据类型无效", 400, "learning_sync_type_invalid")
            record_id = str(raw.get("record_id") or "").strip()
            if (
                len(record_id) > LEARNING_SYNC_MAX_RECORD_ID
                or not LEARNING_SYNC_RECORD_PATTERN.fullmatch(record_id)
            ):
                raise AccountError("学习记录标识无效", 400, "learning_sync_record_id_invalid")
            identity = (data_type, record_id)
            if identity in identities:
                raise AccountError("单次请求包含重复学习记录", 400, "learning_sync_duplicate_change")
            identities.add(identity)
            updated_time = parse_time(raw.get("updated_at"))
            if not updated_time or updated_time > maximum_time:
                raise AccountError("学习记录更新时间无效", 400, "learning_sync_updated_at_invalid")
            deleted = raw.get("deleted", False)
            if not isinstance(deleted, bool):
                raise AccountError("学习记录删除状态无效", 400, "learning_sync_deleted_invalid")
            if data_type == "achievement" and deleted:
                raise AccountError("成就记录只能增加", 400, "learning_sync_achievement_monotonic")
            base_server_version = raw.get("base_server_version", 0)
            if (
                isinstance(base_server_version, bool)
                or not isinstance(base_server_version, int)
                or base_server_version < 0
            ):
                raise AccountError("学习记录基础版本无效", 400, "learning_sync_base_version_invalid")
            raw_payload = raw.get("payload", {})
            if not isinstance(raw_payload, dict):
                raise AccountError("学习记录内容必须是对象", 400, "learning_sync_payload_invalid")
            record_payload = {} if deleted else cls._validate_learning_sync_value(raw_payload)
            encoded = cls._learning_sync_json(record_payload).encode("utf-8")
            if len(encoded) > LEARNING_SYNC_MAX_PAYLOAD_BYTES:
                raise AccountError("单项学习数据超出大小限制", 413, "learning_sync_record_too_large")
            cleaned_changes.append(
                {
                    "data_type": data_type,
                    "record_id": record_id,
                    "payload": record_payload,
                    "updated_at": updated_time.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    "deleted": deleted,
                    "base_server_version": base_server_version,
                    "client_id": client_id,
                    "client_version": client_version,
                }
            )
        return {
            "schema_version": schema_version,
            "client_id": client_id,
            "client_version": client_version,
            "since_version": since_version,
            "changes": cleaned_changes,
        }

    @staticmethod
    def _learning_sync_row_payload(row):
        try:
            value = json.loads(row["payload_json"] or "{}")
            return value if isinstance(value, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    @classmethod
    def _learning_sync_record_payload(cls, row):
        keys = set(row.keys())
        version = row["user_version"] if "user_version" in keys else row["server_version"]
        server_updated_at = row["created_at"] if "user_version" in keys else row["server_updated_at"]
        return {
            "data_type": row["data_type"],
            "record_id": row["record_id"],
            "payload": {} if row["deleted"] else cls._learning_sync_row_payload(row),
            "updated_at": row["updated_at"],
            "deleted": bool(row["deleted"]),
            "client_id": row["client_id"],
            "client_version": row["client_version"],
            "server_version": int(version),
            "server_updated_at": server_updated_at,
        }

    @classmethod
    def _merge_monotonic_value(cls, current, incoming):
        if isinstance(current, bool) and isinstance(incoming, bool):
            return current or incoming
        if (
            isinstance(current, (int, float))
            and not isinstance(current, bool)
            and isinstance(incoming, (int, float))
            and not isinstance(incoming, bool)
        ):
            return max(current, incoming)
        if isinstance(current, dict) and isinstance(incoming, dict):
            merged = dict(current)
            for key, value in incoming.items():
                merged[key] = cls._merge_monotonic_value(merged[key], value) if key in merged else value
            return merged
        if isinstance(current, list) and isinstance(incoming, list):
            values = []
            seen = set()
            for item in [*current, *incoming]:
                marker = cls._learning_sync_json(item)
                if marker not in seen:
                    seen.add(marker)
                    values.append(item)
            return values[:2000]
        return current if current not in (None, "") else incoming

    @classmethod
    def _merge_wrong_payload(cls, current, incoming, incoming_newer):
        merged = {**current, **incoming} if incoming_newer else {**incoming, **current}
        merged["wrong_count"] = max(
            int(current.get("wrong_count") or 0),
            int(incoming.get("wrong_count") or 0),
        )
        accepted = []
        seen = set()
        for item in [*(current.get("accepted") or []), *(incoming.get("accepted") or [])]:
            text = str(item or "").strip()
            marker = text.casefold()
            if text and marker not in seen:
                seen.add(marker)
                accepted.append(text)
        if accepted:
            merged["accepted"] = accepted[:50]
        current_rubric = current.get("rubric") if isinstance(current.get("rubric"), dict) else {}
        incoming_rubric = incoming.get("rubric") if isinstance(incoming.get("rubric"), dict) else {}
        if current_rubric or incoming_rubric:
            merged["rubric"] = (
                {**current_rubric, **incoming_rubric}
                if incoming_newer
                else {**incoming_rubric, **current_rubric}
            )
            rubric_accepted = []
            rubric_seen = set()
            for item in [
                *(current_rubric.get("accepted") or []),
                *(incoming_rubric.get("accepted") or []),
            ]:
                text = str(item or "").strip()
                marker = text.casefold()
                if text and marker not in rubric_seen:
                    rubric_seen.add(marker)
                    rubric_accepted.append(text)
            if rubric_accepted:
                merged["rubric"]["accepted"] = rubric_accepted[:50]
        return merged

    @staticmethod
    def _learning_sync_incoming_is_newer(existing, incoming):
        existing_time = parse_time(existing["updated_at"]) or datetime.min.replace(tzinfo=timezone.utc)
        incoming_time = parse_time(incoming["updated_at"]) or datetime.min.replace(tzinfo=timezone.utc)
        if incoming_time != existing_time:
            return incoming_time > existing_time
        return incoming["client_id"] > str(existing["client_id"] or "")

    @classmethod
    def _merge_learning_sync_record(cls, existing, incoming):
        if existing is None:
            return dict(incoming), True, False
        existing_payload = cls._learning_sync_row_payload(existing)
        existing_output = cls._learning_sync_record_payload(existing)
        incoming_newer = cls._learning_sync_incoming_is_newer(existing, incoming)
        base_is_current = incoming["base_server_version"] >= int(existing["server_version"])

        if incoming["deleted"]:
            if not base_is_current:
                return existing_output, False, True
            canonical = dict(incoming)
            canonical["payload"] = {}
            return canonical, not bool(existing["deleted"]), not base_is_current

        if existing["deleted"]:
            if not base_is_current or not incoming_newer:
                return existing_output, False, True
            return dict(incoming), True, False

        data_type = incoming["data_type"]
        if data_type == "achievement":
            payload = cls._merge_monotonic_value(existing_payload, incoming["payload"])
            newer = incoming_newer
        elif data_type == "wrong_book":
            payload = cls._merge_wrong_payload(existing_payload, incoming["payload"], incoming_newer)
            newer = incoming_newer
        else:
            if not incoming_newer:
                return existing_output, False, existing_payload != incoming["payload"]
            payload = incoming["payload"]
            newer = True

        canonical = dict(incoming)
        canonical["payload"] = payload
        if data_type in {"achievement", "wrong_book"}:
            existing_time = parse_time(existing["updated_at"])
            incoming_time = parse_time(incoming["updated_at"])
            if existing_time and incoming_time and existing_time > incoming_time:
                canonical["updated_at"] = existing["updated_at"]
                canonical["client_id"] = existing["client_id"]
                canonical["client_version"] = existing["client_version"]
            elif not newer and existing_time == incoming_time:
                canonical["client_id"] = existing["client_id"]
                canonical["client_version"] = existing["client_version"]
        same = (
            not existing["deleted"]
            and existing_payload == canonical["payload"]
            and existing["updated_at"] == canonical["updated_at"]
            and existing["client_id"] == canonical["client_id"]
            and existing["client_version"] == canonical["client_version"]
        )
        merged = (
            incoming["base_server_version"] < int(existing["server_version"])
            or canonical["payload"] != incoming["payload"]
        )
        return canonical, not same, merged

    @classmethod
    def _write_learning_sync_record(cls, connection, user_id, record, existing=None):
        now = iso_now()
        connection.execute(
            """
            INSERT INTO learning_sync_heads(user_id, version, updated_at)
            VALUES (?, 0, ?)
            ON CONFLICT(user_id) DO NOTHING
            """,
            (user_id, now),
        )
        connection.execute(
            "UPDATE learning_sync_heads SET version = version + 1, updated_at = ? WHERE user_id = ?",
            (now, user_id),
        )
        version = connection.execute(
            "SELECT version FROM learning_sync_heads WHERE user_id = ?",
            (user_id,),
        ).fetchone()["version"]
        payload_json = cls._learning_sync_json({} if record["deleted"] else record["payload"])
        connection.execute(
            """
            INSERT INTO learning_sync_changes (
                user_id, user_version, data_type, record_id, payload_json, updated_at,
                deleted, client_id, client_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                version,
                record["data_type"],
                record["record_id"],
                payload_json,
                record["updated_at"],
                int(record["deleted"]),
                record["client_id"],
                record["client_version"],
                now,
            ),
        )
        created_at = existing["created_at"] if existing is not None else now
        connection.execute(
            """
            INSERT INTO learning_sync_records (
                user_id, data_type, record_id, payload_json, updated_at, deleted,
                client_id, client_version, server_version, created_at, server_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, data_type, record_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at,
                deleted = excluded.deleted,
                client_id = excluded.client_id,
                client_version = excluded.client_version,
                server_version = excluded.server_version,
                server_updated_at = excluded.server_updated_at
            """,
            (
                user_id,
                record["data_type"],
                record["record_id"],
                payload_json,
                record["updated_at"],
                int(record["deleted"]),
                record["client_id"],
                record["client_version"],
                version,
                created_at,
                now,
            ),
        )
        return connection.execute(
            """
            SELECT * FROM learning_sync_records
            WHERE user_id = ? AND data_type = ? AND record_id = ?
            """,
            (user_id, record["data_type"], record["record_id"]),
        ).fetchone()

    def sync_learning_data(self, user, payload):
        if not user or user["deleted"] or user["banned"]:
            raise AccountError("账户不可用", 403, "account_unavailable")
        request = self._validated_learning_sync_request(payload)
        user_id = user["id"]
        results = []
        merged_count = 0
        accepted_count = 0
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for incoming in request["changes"]:
                existing = connection.execute(
                    """
                    SELECT * FROM learning_sync_records
                    WHERE user_id = ? AND data_type = ? AND record_id = ?
                    """,
                    (user_id, incoming["data_type"], incoming["record_id"]),
                ).fetchone()
                canonical, changed, merged = self._merge_learning_sync_record(existing, incoming)
                if changed and existing is None:
                    type_count = connection.execute(
                        """
                        SELECT COUNT(*) FROM learning_sync_records
                        WHERE user_id = ? AND data_type = ?
                        """,
                        (user_id, incoming["data_type"]),
                    ).fetchone()[0]
                    total_count = connection.execute(
                        "SELECT COUNT(*) FROM learning_sync_records WHERE user_id = ?",
                        (user_id,),
                    ).fetchone()[0]
                    if type_count >= LEARNING_SYNC_TYPE_LIMITS[incoming["data_type"]]:
                        raise AccountError("该类学习记录数量超出限制", 413, "learning_sync_type_limit")
                    if total_count >= LEARNING_SYNC_MAX_TOTAL_RECORDS:
                        raise AccountError("学习记录总数超出限制", 413, "learning_sync_total_limit")
                elif changed and not canonical["deleted"] and existing["deleted"]:
                    active_type_count = connection.execute(
                        """
                        SELECT COUNT(*) FROM learning_sync_records
                        WHERE user_id = ? AND data_type = ? AND deleted = 0
                        """,
                        (user_id, incoming["data_type"]),
                    ).fetchone()[0]
                    if active_type_count >= LEARNING_SYNC_TYPE_LIMITS[incoming["data_type"]]:
                        raise AccountError("该类学习记录数量超出限制", 413, "learning_sync_type_limit")
                if changed:
                    row = self._write_learning_sync_record(connection, user_id, canonical, existing)
                    accepted_count += 1
                else:
                    row = existing
                if row is not None:
                    results.append(self._learning_sync_record_payload(row))
                if merged:
                    merged_count += 1

            head = connection.execute(
                "SELECT version FROM learning_sync_heads WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            server_version = int(head["version"]) if head else 0
            since_version = request["since_version"]
            reset_required = since_version > server_version
            if reset_required:
                since_version = 0
            rows = connection.execute(
                """
                SELECT * FROM learning_sync_changes
                WHERE user_id = ? AND user_version > ?
                ORDER BY user_version ASC
                LIMIT ?
                """,
                (user_id, since_version, LEARNING_SYNC_PULL_LIMIT + 1),
            ).fetchall()
            has_more = len(rows) > LEARNING_SYNC_PULL_LIMIT
            visible_rows = rows[:LEARNING_SYNC_PULL_LIMIT]
            changes = [self._learning_sync_record_payload(row) for row in visible_rows]
            next_since_version = (
                int(visible_rows[-1]["user_version"])
                if has_more and visible_rows
                else server_version
            )
        return {
            "schema_version": LEARNING_SYNC_SCHEMA_VERSION,
            "server_version": server_version,
            "next_since_version": next_since_version,
            "has_more": has_more,
            "reset_required": reset_required,
            "accepted_count": accepted_count,
            "merged_count": merged_count,
            "results": results,
            "changes": changes,
        }

    @staticmethod
    def _validate_tool_id(tool_id):
        value = str(tool_id or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", value):
            raise AccountError("工具标识无效", 400, "tool_id_invalid")
        return value

    @staticmethod
    def _validate_workflow_config(config):
        if not isinstance(config, dict):
            raise AccountError("工作流配置必须是对象", 400, "workflow_invalid")
        if len(json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > WORKFLOW_MAX_BYTES:
            raise AccountError("工作流配置不能超过 48 KB", 413, "workflow_too_large")
        allowed = {"schema_version", "id", "name", "created_at", "updated_at", "steps"}
        if set(config) != allowed:
            raise AccountError("工作流字段不完整或包含未知字段", 400, "workflow_fields_invalid")
        if config.get("schema_version") != WORKFLOW_SCHEMA_VERSION:
            raise AccountError("工作流版本不受支持", 400, "workflow_version_invalid")
        workflow_id = str(config.get("id") or "")
        if not WORKFLOW_ID_PATTERN.fullmatch(workflow_id) or not workflow_id.startswith("wf_"):
            raise AccountError("工作流 ID 无效", 400, "workflow_id_invalid")
        name = str(config.get("name") or "").strip()
        if not name or len(name) > 80:
            raise AccountError("工作流名称无效", 400, "workflow_name_invalid")
        created_at = str(config.get("created_at") or "")
        updated_at = str(config.get("updated_at") or "")
        if not parse_time(created_at) or not parse_time(updated_at):
            raise AccountError("工作流时间格式无效", 400, "workflow_time_invalid")
        steps = config.get("steps")
        if not isinstance(steps, list) or len(steps) > WORKFLOW_MAX_STEPS:
            raise AccountError("工作流步骤数量无效", 400, "workflow_steps_invalid")

        normalized_steps = []
        seen_ids = set()
        possible_types = None
        for index, raw_step in enumerate(steps):
            if not isinstance(raw_step, dict) or set(raw_step) != {"id", "tool_id", "enabled", "config"}:
                raise AccountError(f"第 {index + 1} 步字段无效", 400, "workflow_step_fields_invalid")
            step_id = str(raw_step.get("id") or "")
            if not WORKFLOW_ID_PATTERN.fullmatch(step_id) or not step_id.startswith("step_") or step_id in seen_ids:
                raise AccountError(f"第 {index + 1} 步 ID 无效或重复", 400, "workflow_step_id_invalid")
            seen_ids.add(step_id)
            tool_id = str(raw_step.get("tool_id") or "")
            if tool_id not in WORKFLOW_TOOL_TYPES:
                raise AccountError(f"第 {index + 1} 步工具未注册", 400, "workflow_tool_invalid")
            enabled = raw_step.get("enabled")
            if not isinstance(enabled, bool):
                raise AccountError(f"第 {index + 1} 步启用状态无效", 400, "workflow_enabled_invalid")
            raw_config = raw_step.get("config")
            if not isinstance(raw_config, dict) or set(raw_config) != WORKFLOW_CONFIG_KEYS[tool_id]:
                raise AccountError(f"第 {index + 1} 步参数无效", 400, "workflow_config_invalid")
            clean = dict(raw_config)
            if tool_id == "text-encoding" and clean["encoding"] not in {"utf-8", "gbk", "big5", "shift_jis"}:
                raise AccountError("文本编码参数无效", 400, "workflow_config_invalid")
            if tool_id == "sort-lines" and clean["order"] not in {"asc", "desc"}:
                raise AccountError("排序参数无效", 400, "workflow_config_invalid")
            if tool_id == "text-split" and (
                isinstance(clean["lines"], bool) or not isinstance(clean["lines"], int) or not 1 <= clean["lines"] <= 100000
            ):
                raise AccountError("文本分割行数无效", 400, "workflow_config_invalid")
            if tool_id == "image-resize" and any(
                isinstance(clean[key], bool) or not isinstance(clean[key], int) or not 1 <= clean[key] <= 4096
                for key in ("width", "height")
            ):
                raise AccountError("图片尺寸参数无效", 400, "workflow_config_invalid")
            if tool_id == "image-format":
                if clean["format"] not in {"image/png", "image/jpeg", "image/webp"}:
                    raise AccountError("图片格式参数无效", 400, "workflow_config_invalid")
                if isinstance(clean["quality"], bool) or not isinstance(clean["quality"], (int, float)) or not 0.1 <= clean["quality"] <= 1:
                    raise AccountError("图片质量参数无效", 400, "workflow_config_invalid")
            if tool_id == "text-watermark":
                if not isinstance(clean["text"], str) or not 1 <= len(clean["text"]) <= 100:
                    raise AccountError("水印文字参数无效", 400, "workflow_config_invalid")
                if not isinstance(clean["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", clean["color"]):
                    raise AccountError("水印颜色参数无效", 400, "workflow_config_invalid")

            if enabled:
                input_types, output_types, preserve_collection = WORKFLOW_TOOL_TYPES[tool_id]
                compatible = set(input_types) if possible_types is None else possible_types & input_types
                if not compatible:
                    raise AccountError(f"第 {index + 1} 步与上一步类型不兼容", 400, "workflow_type_mismatch")
                possible_types = (
                    {"image-list" if item == "image-list" else "image" for item in compatible}
                    if preserve_collection
                    else set(output_types)
                )
            normalized_steps.append({"id": step_id, "tool_id": tool_id, "enabled": enabled, "config": clean})

        normalized = {
            "schema_version": WORKFLOW_SCHEMA_VERSION,
            "id": workflow_id,
            "name": name,
            "created_at": created_at,
            "updated_at": updated_at,
            "steps": normalized_steps,
        }
        encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > WORKFLOW_MAX_BYTES:
            raise AccountError("工作流配置不能超过 48 KB", 413, "workflow_too_large")
        return normalized

    def list_tool_preferences(self, user):
        with self.connect() as connection:
            favorites = [
                dict(row)
                for row in connection.execute(
                    "SELECT tool_id, pinned, created_at, updated_at FROM tool_favorites WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC",
                    (user["id"],),
                ).fetchall()
            ]
            recent = [
                dict(row)
                for row in connection.execute(
                    "SELECT tool_id, MAX(used_at) AS used_at FROM tool_recent_usage WHERE user_id = ? GROUP BY tool_id ORDER BY used_at DESC LIMIT 30",
                    (user["id"],),
                ).fetchall()
            ]
            configs = [
                dict(row)
                for row in connection.execute(
                    "SELECT id, tool_id, name, config_json, created_at, updated_at FROM saved_tool_configs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100",
                    (user["id"],),
                ).fetchall()
            ]
        for config in configs:
            try:
                config["config"] = json.loads(config.pop("config_json") or "{}")
            except (json.JSONDecodeError, TypeError):
                config["config"] = {}
                config.pop("config_json", None)
        return {"favorites": favorites, "recent": recent, "configs": configs}

    def set_tool_favorite(self, user, tool_id, favorite=True, pinned=False):
        tool_id = self._validate_tool_id(tool_id)
        now = iso_now()
        with self.lock, self.connect() as connection:
            if favorite:
                connection.execute(
                    """
                    INSERT INTO tool_favorites (user_id, tool_id, pinned, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, tool_id) DO UPDATE SET
                        pinned = excluded.pinned, updated_at = excluded.updated_at
                    """,
                    (user["id"], tool_id, int(bool(pinned)), now, now),
                )
            else:
                connection.execute(
                    "DELETE FROM tool_favorites WHERE user_id = ? AND tool_id = ?",
                    (user["id"], tool_id),
                )

    def record_tool_usage(self, user, tool_id):
        tool_id = self._validate_tool_id(tool_id)
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO tool_recent_usage (id, user_id, tool_id, used_at) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), user["id"], tool_id, iso_now()),
            )
            connection.execute(
                """
                DELETE FROM tool_recent_usage WHERE id IN (
                    SELECT id FROM tool_recent_usage WHERE user_id = ?
                    ORDER BY used_at DESC LIMIT -1 OFFSET 200
                )
                """,
                (user["id"],),
            )

    def clear_tool_history(self, user):
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM tool_recent_usage WHERE user_id = ?", (user["id"],))

    def save_tool_config(self, user, tool_id, name, config, config_id=""):
        tool_id = self._validate_tool_id(tool_id)
        name = str(name or "").strip()[:80]
        if not name:
            raise AccountError("配置名称不能为空", 400, "config_name_required")
        if tool_id == "workflow":
            config = self._validate_workflow_config(config)
            if config["name"] != name:
                raise AccountError("工作流名称与配置名称不一致", 400, "workflow_name_mismatch")
        encoded = json.dumps(config if isinstance(config, (dict, list)) else {}, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 50 * 1024:
            raise AccountError("工具配置不能超过 50 KB", 413, "config_too_large")
        now = iso_now()
        config_id = str(config_id or "").strip()
        with self.lock, self.connect() as connection:
            if config_id:
                existing = connection.execute(
                    "SELECT tool_id FROM saved_tool_configs WHERE id = ? AND user_id = ?",
                    (config_id, user["id"]),
                ).fetchone()
                if existing and "workflow" in {tool_id, existing["tool_id"]} and existing["tool_id"] != tool_id:
                    raise AccountError("工作流配置不能与其他工具配置互相覆盖", 409, "workflow_config_collision")
                changed = connection.execute(
                    """
                    UPDATE saved_tool_configs SET tool_id = ?, name = ?, config_json = ?, updated_at = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (tool_id, name, encoded, now, config_id, user["id"]),
                ).rowcount
                if not changed:
                    raise AccountError("工具配置不存在", 404, "config_not_found")
            else:
                if tool_id == "workflow":
                    count = connection.execute(
                        "SELECT COUNT(*) AS value FROM saved_tool_configs WHERE user_id = ? AND tool_id = 'workflow'",
                        (user["id"],),
                    ).fetchone()["value"]
                    if count >= WORKFLOW_MAX_SAVED:
                        raise AccountError("每个账号最多保存 50 个云端工作流", 409, "workflow_limit_reached")
                config_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO saved_tool_configs (
                        id, user_id, tool_id, name, config_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (config_id, user["id"], tool_id, name, encoded, now, now),
                )
        return config_id

    def delete_tool_config(self, user, config_id):
        with self.lock, self.connect() as connection:
            connection.execute(
                "DELETE FROM saved_tool_configs WHERE id = ? AND user_id = ?",
                (str(config_id or ""), user["id"]),
            )

    def admin_tool_usage_stats(self, actor):
        if not self.is_super_admin(actor):
            raise AccountError("无管理员权限", 403, "forbidden")
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT tool_id, COUNT(*) AS uses, COUNT(DISTINCT user_id) AS users,
                    MAX(used_at) AS last_used_at
                FROM tool_recent_usage GROUP BY tool_id ORDER BY uses DESC LIMIT 200
                """
            ).fetchall()
        return [dict(row) for row in rows]
