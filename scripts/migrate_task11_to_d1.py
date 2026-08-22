"""Migrate Task 11 low-risk data through the parameter-bound Pages import API."""

from __future__ import annotations

import argparse
from contextlib import closing
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 1
PRODUCTION_CONFIRMATION = "TASK11-PRODUCTION-MIGRATION"
IMPORT_ORDER = (
    "changelog",
    "feedback",
    "feedback_votes",
    "feedback_audit",
    "learning_records",
    "learning_heads",
    "learning_changes",
    "metadata",
)
IMPORT_IDENTITIES = {
    "changelog": ("version",),
    "feedback": ("id",),
    "feedback_votes": ("feedback_id", "user_id"),
    "feedback_audit": ("id",),
    "learning_records": ("user_id", "data_type", "record_id"),
    "learning_heads": ("user_id",),
    "learning_changes": ("user_id", "user_version"),
    "metadata": ("key",),
}
AUDIT_ACTIONS = {
    "feedback_update",
    "feedback_merge",
    "feedback_delete_spam",
}
AUDIT_SNAPSHOT_FIELDS = {
    "id",
    "type",
    "status",
    "merged_into_id",
    "admin_note",
    "deleted",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_object(value) -> dict:
    try:
        parsed = json.loads(value or "{}") if isinstance(value, str) else value
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def rows(connection: sqlite3.Connection, table: str, columns: str = "*") -> list[dict]:
    if not table_exists(connection, table):
        return []
    return [dict(row) for row in connection.execute(f"SELECT {columns} FROM {table}").fetchall()]


def changelog_records() -> list[dict]:
    command = ["node", str(ROOT / "scripts" / "task11_changelog_seed.mjs")]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    payload = json.loads(result.stdout)
    if payload.get("schema_version") != SCHEMA_VERSION or not isinstance(payload.get("records"), list):
        raise RuntimeError("The changelog seed has an unsupported format.")
    return payload["records"]


def feedback_records(connection: sqlite3.Connection) -> list[dict]:
    return rows(
        connection,
        "feedback_items",
        "id, user_id, username, feedback_type, title, content, route, tool_id, "
        "app_version, browser_info, error_code, status, admin_note, merged_into_id, "
        "created_at, updated_at",
    )


def vote_records(connection: sqlite3.Connection) -> list[dict]:
    return rows(connection, "feedback_votes", "feedback_id, user_id, created_at")


def feedback_audit_records(connection: sqlite3.Connection) -> tuple[list[dict], int]:
    output = []
    invalid = 0
    for row in rows(connection, "admin_audit_logs"):
        if row.get("action") not in AUDIT_ACTIONS:
            continue
        before = {
            key: value
            for key, value in parse_object(row.get("before_json")).items()
            if key in AUDIT_SNAPSHOT_FIELDS
        }
        after = {
            key: value
            for key, value in parse_object(row.get("after_json")).items()
            if key in AUDIT_SNAPSHOT_FIELDS
        }
        feedback_id = str(before.get("id") or after.get("id") or "").strip()
        if not feedback_id:
            invalid += 1
            continue
        output.append(
            {
                "id": row["id"],
                "actor_user_id": row["actor_user_id"],
                "actor_username": row["actor_username"],
                "action": row["action"],
                "feedback_id": feedback_id,
                "target_user_id": row.get("target_user_id") or "",
                "before": before,
                "after": after,
                "note": row["action"].replace("_", " "),
                "created_at": row["created_at"],
            }
        )
    return output, invalid


def learning_records(connection: sqlite3.Connection) -> list[dict]:
    output = []
    for row in rows(connection, "learning_sync_records"):
        output.append(
            {
                "user_id": row["user_id"],
                "data_type": row["data_type"],
                "record_id": row["record_id"],
                "payload": parse_object(row.get("payload_json")),
                "updated_at": row["updated_at"],
                "deleted": bool(row["deleted"]),
                "client_id": row["client_id"],
                "client_version": row["client_version"],
                "server_version": int(row["server_version"]),
                "created_at": row["created_at"],
                "server_updated_at": row["server_updated_at"],
            }
        )
    return output


def learning_heads(connection: sqlite3.Connection) -> list[dict]:
    return rows(connection, "learning_sync_heads", "user_id, version, updated_at")


def learning_changes(connection: sqlite3.Connection) -> list[dict]:
    output = []
    for row in rows(connection, "learning_sync_changes"):
        output.append(
            {
                "user_id": row["user_id"],
                "user_version": int(row["user_version"]),
                "data_type": row["data_type"],
                "record_id": row["record_id"],
                "payload": parse_object(row.get("payload_json")),
                "updated_at": row["updated_at"],
                "deleted": bool(row["deleted"]),
                "client_id": row["client_id"],
                "client_version": row["client_version"],
                "created_at": row["created_at"],
            }
        )
    return output


def collect_source(database_path: Path) -> tuple[dict[str, list[dict]], dict[str, int]]:
    if not database_path.is_file():
        raise FileNotFoundError(f"Source SQLite database not found: {database_path}")
    with closing(sqlite3.connect(database_path)) as connection:
        connection.row_factory = sqlite3.Row
        audit, invalid_audit = feedback_audit_records(connection)
        data = {
            "changelog": changelog_records(),
            "feedback": feedback_records(connection),
            "feedback_votes": vote_records(connection),
            "feedback_audit": audit,
            "learning_records": learning_records(connection),
            "learning_heads": learning_heads(connection),
            "learning_changes": learning_changes(connection),
            "metadata": [
                {
                    "key": "legacy_import_version",
                    "value": "task11-v1",
                    "updated_at": iso_now(),
                }
            ],
        }
    invalid = {key: 0 for key in data}
    invalid["feedback_audit"] = invalid_audit
    return data, invalid


def validate_records(kind: str, records: list[dict]) -> tuple[list[dict], int]:
    valid = []
    invalid = 0
    batch_size = 200 if kind in {"feedback_votes", "learning_changes"} else 100
    command = ["node", str(ROOT / "scripts" / "task11_validate_import.mjs")]
    for batch in chunks(records, batch_size):
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            input=json.dumps(
                {"schema_version": SCHEMA_VERSION, "kind": kind, "records": batch},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        outcome = json.loads(result.stdout)
        indexes = outcome.get("valid_indexes")
        if not isinstance(indexes, list) or any(not isinstance(index, int) for index in indexes):
            raise RuntimeError(f"Task 11 validator returned an invalid result for {kind}")
        valid.extend(batch[index] for index in indexes if 0 <= index < len(batch))
        invalid += int(outcome.get("invalid_count") or 0)
    return valid, invalid


def deduplicate_records(kind: str, records: list[dict]) -> tuple[list[dict], int]:
    fields = IMPORT_IDENTITIES[kind]
    output = []
    seen = set()
    duplicates = 0
    for record in records:
        identity = tuple(str(record.get(field, "")) for field in fields)
        if identity in seen:
            duplicates += 1
            continue
        seen.add(identity)
        output.append(record)
    return output, duplicates


def prepare_source(database_path: Path) -> tuple[dict[str, list[dict]], dict[str, int], dict[str, int], dict[str, int]]:
    raw, extraction_invalid = collect_source(database_path)
    source_counts = {kind: len(records) for kind, records in raw.items()}
    prepared = {}
    invalid_counts = {}
    duplicate_counts = {}
    for kind in IMPORT_ORDER:
        valid, validation_invalid = validate_records(kind, raw[kind])
        unique, duplicates = deduplicate_records(kind, valid)
        prepared[kind] = unique
        invalid_counts[kind] = int(extraction_invalid.get(kind, 0)) + validation_invalid
        duplicate_counts[kind] = duplicates
    return prepared, source_counts, invalid_counts, duplicate_counts


def endpoint_url(base: str, path: str) -> str:
    parsed = urllib.parse.urlsplit(base.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--endpoint must be an http(s) site URL")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("A remote migration endpoint must use HTTPS")
    clean = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    return f"{clean}{path}"


def request_json(url: str, session_token: str, payload: dict | None, production: bool) -> dict:
    parsed = urllib.parse.urlsplit(url)
    headers = {
        "Accept": "application/json",
        "Origin": urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")),
        "User-Agent": "WYJ-Cloud-Migration/1.0",
        "X-Session-Token": session_token,
    }
    body = None
    method = "GET"
    if payload is not None:
        method = "POST"
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if production:
        headers["X-WYJ-Task11-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
            code = str(result.get("code") or "http_error")
        except (json.JSONDecodeError, UnicodeDecodeError):
            code = "http_error"
        raise RuntimeError(f"Import request failed: HTTP {error.code}, code={code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("Import endpoint is unreachable") from error
    if not result.get("ok"):
        raise RuntimeError(f"Import endpoint rejected the request: {result.get('code', 'unknown')}")
    return result


def chunks(records: list[dict], size: int):
    for index in range(0, len(records), size):
        yield records[index : index + size]


def apply_import(args, data: dict[str, list[dict]]) -> dict:
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Set {args.session_token_env} without printing its value before --apply")
    production = args.environment == "production"
    if production and (
        args.confirm_production != PRODUCTION_CONFIRMATION or not args.backup_confirmed
    ):
        raise RuntimeError(
            "Production requires --backup-confirmed and "
            f"--confirm-production {PRODUCTION_CONFIRMATION}"
        )
    import_url = endpoint_url(args.endpoint, "/api/admin/task11/import")
    status_url = endpoint_url(args.endpoint, "/api/admin/task11/import/status")
    applied = {}
    for kind in IMPORT_ORDER:
        batch_size = 100 if kind in {"feedback_votes", "learning_changes"} else 50
        received = 0
        changed = 0
        for batch in chunks(data[kind], batch_size):
            result = request_json(
                import_url,
                token,
                {"schema_version": SCHEMA_VERSION, "kind": kind, "records": batch},
                production,
            )
            received += int(result.get("received") or 0)
            changed += int(result.get("changed") or 0)
        applied[kind] = {"received": received, "changed": changed}
    target = request_json(status_url, token, None, production).get("counts", {})
    return {"batches": applied, "target_counts": target}


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
    result.add_argument("--session-token-env", default="WYJ_TASK11_ADMIN_SESSION")
    result.add_argument("--report", default="")
    result.add_argument("--apply", action="store_true", help="Write through the protected import API")
    result.add_argument("--dry-run", action="store_true", help="Validate and count without network writes")
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

    data, source_counts, invalid, duplicates = prepare_source(
        Path(args.source_db).expanduser().resolve()
    )
    report = {
        "schema_version": SCHEMA_VERSION,
        "environment": args.environment,
        "mode": "apply" if args.apply else "dry-run",
        "generated_at": iso_now(),
        "source_counts": source_counts,
        "target_expected_counts": {kind: len(records) for kind, records in data.items()},
        "invalid_counts": invalid,
        "duplicate_counts": duplicates,
        "sensitive_content_included_in_report": False,
    }
    if args.apply:
        report["result"] = apply_import(args, data)
    write_report(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(f"Task 11 migration failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
