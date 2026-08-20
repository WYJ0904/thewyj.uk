"""Safely inspect and migrate legacy SQLite accounts to the Task 12 D1 API."""

from __future__ import annotations

import argparse
import base64
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 1
PRODUCTION_CONFIRMATION = "TASK12-PRODUCTION-ACCOUNT-MIGRATION"
PBKDF2_PREFIX = "pbkdf2_sha256"
MAX_BATCH = 50
TASK11_USER_COLUMNS = (
    ("feedback_items", "user_id"),
    ("feedback_votes", "user_id"),
    ("learning_sync_records", "user_id"),
    ("learning_sync_heads", "user_id"),
    ("learning_sync_changes", "user_id"),
)
LEGACY_HASH_PATTERN = re.compile(r"^(?:\$2[aby]\$|argon2|scrypt|sha(?:256|512)?\$|[A-Za-z0-9_]+\$)", re.I)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone() is not None


def table_rows(connection: sqlite3.Connection, table: str, columns: str) -> list[dict]:
    if not table_exists(connection, table):
        return []
    return [dict(row) for row in connection.execute(f"SELECT {columns} FROM {table}").fetchall()]


def decode_urlsafe(value: str) -> bytes:
    text = str(value or "")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def valid_pbkdf2(value: str) -> tuple[bool, int]:
    try:
        prefix, iterations_text, salt_text, digest_text = str(value or "").split("$", 3)
        iterations = int(iterations_text)
        valid = (
            prefix == PBKDF2_PREFIX
            and 100_000 <= iterations <= 2_000_000
            and 8 <= len(decode_urlsafe(salt_text)) <= 64
            and len(decode_urlsafe(digest_text)) == 32
        )
        return valid, iterations if valid else 0
    except (ValueError, TypeError, base64.binascii.Error):
        return False, 0


def classify_secret(value: str) -> tuple[str, int]:
    text = str(value or "")
    valid, iterations = valid_pbkdf2(text)
    if valid:
        return "pbkdf2_sha256", iterations
    if not text:
        return "invalid", 0
    if text.startswith(f"{PBKDF2_PREFIX}$"):
        return "invalid", 0
    if LEGACY_HASH_PATTERN.match(text) or "$" in text:
        return "legacy_hash", 0
    return "plaintext", 0


def account_records(connection: sqlite3.Connection) -> tuple[list[dict], Counter]:
    rows = table_rows(
        connection,
        "users",
        "id, username, username_normalized, secret, role, banned, permanent_ban, "
        "ban_reason, deleted, session_version, registered_at, last_login_at, created_at, updated_at",
    )
    records: list[dict] = []
    hash_counts: Counter = Counter()
    for row in rows:
        classification, iterations = classify_secret(row.get("secret", ""))
        hash_counts[classification] += 1
        active_hash = classification == "pbkdf2_sha256"
        records.append(
            {
                "id": str(row["id"]),
                "username": str(row["username"]),
                "username_normalized": str(row["username_normalized"]),
                "password_hash": str(row["secret"]) if active_hash else "",
                "password_scheme": "pbkdf2_sha256" if active_hash else (
                    "invalid" if classification == "invalid" else "reset_required"
                ),
                "password_iterations": iterations,
                "role": "super_admin" if row.get("role") == "super_admin" else "user",
                "banned": bool(row.get("banned")),
                "permanent_ban": bool(row.get("permanent_ban")),
                "ban_reason": str(row.get("ban_reason") or ""),
                "deleted": bool(row.get("deleted")),
                "session_version": max(1, int(row.get("session_version") or 1)),
                "registered_at": str(row.get("registered_at") or row.get("created_at") or iso_now()),
                "last_login_at": str(row.get("last_login_at") or ""),
                "created_at": str(row.get("created_at") or row.get("registered_at") or iso_now()),
                "updated_at": str(row.get("updated_at") or row.get("created_at") or iso_now()),
            }
        )
    return records, hash_counts


def login_audit_records(connection: sqlite3.Connection) -> list[dict]:
    return table_rows(
        connection,
        "login_audit_logs",
        "id, user_id, username, success, reason, ip_address, country, region, city, "
        "user_agent, source, created_at",
    )


def referenced_task11_users(connection: sqlite3.Connection) -> set[str]:
    result: set[str] = set()
    for table, column in TASK11_USER_COLUMNS:
        if not table_exists(connection, table):
            continue
        for row in connection.execute(f"SELECT DISTINCT {column} FROM {table} WHERE {column} != ''"):
            result.add(str(row[0]))
    return result


def analyze_source(database_path: Path) -> tuple[dict[str, list[dict]], dict]:
    if not database_path.is_file():
        raise FileNotFoundError(f"Source SQLite database not found: {database_path}")
    source_uri = database_path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(source_uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN")
        if not table_exists(connection, "users"):
            raise RuntimeError("Source database does not contain a users table")
        accounts, hash_counts = account_records(connection)
        login_audit = login_audit_records(connection)
        source_sessions = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] if table_exists(connection, "sessions") else 0
        references = referenced_task11_users(connection)

    ids = [record["id"] for record in accounts]
    normalized = [record["username_normalized"] for record in accounts]
    id_set = set(ids)
    duplicate_ids = len(ids) - len(id_set)
    duplicate_names = len(normalized) - len(set(normalized))
    missing_references = references - id_set
    if duplicate_ids or duplicate_names:
        raise RuntimeError("Source account identifiers are not unique")
    counts = {
        "users": len(accounts),
        "active": sum(not row["deleted"] and not row["banned"] for row in accounts),
        "banned": sum(not row["deleted"] and row["banned"] for row in accounts),
        "deleted": sum(row["deleted"] for row in accounts),
        "admins": sum(row["role"] == "super_admin" for row in accounts),
        "password_hash_types": dict(sorted(hash_counts.items())),
        "legacy_sessions_detected": int(source_sessions),
        "legacy_sessions_migrated": 0,
        "login_audit": len(login_audit),
        "stable_user_ids": len(id_set),
        "duplicate_user_ids": duplicate_ids,
        "duplicate_normalized_usernames": duplicate_names,
        "task11_referenced_user_ids": len(references),
        "task11_missing_user_ids": len(missing_references),
    }
    return {"accounts": accounts, "login_audit": login_audit}, counts


def endpoint_url(base: str, path: str) -> str:
    parsed = urllib.parse.urlsplit(base.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--endpoint must be an http(s) site URL")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("A remote migration endpoint must use HTTPS")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def request_json(url: str, token: str, payload: dict | None, production: bool) -> dict:
    headers = {"Accept": "application/json", "X-Session-Token": token}
    body = None
    method = "GET"
    if payload is not None:
        method = "POST"
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if production:
        headers["X-WYJ-Task12-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            code = str(json.loads(error.read().decode("utf-8")).get("code") or "http_error")
        except (json.JSONDecodeError, UnicodeDecodeError):
            code = "http_error"
        raise RuntimeError(f"Migration request failed: HTTP {error.code}, code={code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("Migration endpoint is unreachable") from error
    if not result.get("ok"):
        raise RuntimeError(f"Migration endpoint rejected the request: {result.get('code', 'unknown')}")
    return result


def chunks(records: list[dict], size: int = MAX_BATCH):
    for index in range(0, len(records), size):
        yield records[index : index + size]


def apply_import(args, data: dict[str, list[dict]]) -> dict:
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Set {args.session_token_env} without printing its value before --apply")
    production = args.environment == "production"
    if production and (not args.backup_confirmed or args.confirm_production != PRODUCTION_CONFIRMATION):
        raise RuntimeError(
            "Production requires --backup-confirmed and "
            f"--confirm-production {PRODUCTION_CONFIRMATION}"
        )
    imported = {}
    for kind in ("accounts", "login_audit"):
        received = changed = 0
        for batch in chunks(data[kind]):
            result = request_json(
                endpoint_url(args.endpoint, "/api/admin/task12/import"),
                token,
                {"schema_version": SCHEMA_VERSION, "kind": kind, "records": batch},
                production,
            )
            received += int(result.get("received") or 0)
            changed += int(result.get("changed") or 0)
        imported[kind] = {"received": received, "changed": changed}
    target = request_json(
        endpoint_url(args.endpoint, "/api/admin/task12/import/status"), token, None, production
    ).get("counts", {})
    return {"batches": imported, "target_counts": target}


def validate_task11_ownership(counts: dict) -> None:
    if int(counts.get("task11_missing_user_ids") or 0):
        raise RuntimeError("Task 11 contains ownership references without a matching source user")


def write_report(path: str, report: dict) -> None:
    if not path:
        return
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    default_db = os.environ.get("VOCAB_USERS_DB") or str(ROOT / "local-backend" / "data" / "users.sqlite3")
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source-db", default=default_db)
    result.add_argument("--environment", choices=("preview", "production"), default="preview")
    result.add_argument("--endpoint", default="")
    result.add_argument("--session-token-env", default="WYJ_TASK12_ADMIN_SESSION")
    result.add_argument("--report", default="")
    result.add_argument("--apply", action="store_true")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--backup-confirmed", action="store_true")
    result.add_argument("--confirm-production", default="")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.apply and args.dry_run:
        raise SystemExit("Choose either --apply or --dry-run")
    if not args.apply:
        args.dry_run = True
    if args.apply and not args.endpoint:
        raise SystemExit("--endpoint is required with --apply")
    data, counts = analyze_source(Path(args.source_db).expanduser().resolve())
    report = {
        "schema_version": SCHEMA_VERSION,
        "environment": args.environment,
        "mode": "apply" if args.apply else "dry-run",
        "generated_at": iso_now(),
        "source_counts": counts,
        "session_strategy": "invalidate_legacy_sessions",
        "user_id_preservation": counts["users"] == counts["stable_user_ids"],
        "task11_ownership_ready": counts["task11_missing_user_ids"] == 0,
        "sensitive_values_included_in_report": False,
    }
    if args.apply:
        validate_task11_ownership(counts)
        report["result"] = apply_import(args, data)
    write_report(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError, sqlite3.Error) as error:
        print(f"Task 12 migration failed: {error}", file=os.sys.stderr)
        raise SystemExit(1) from error
