"""Audit and migrate the remaining tool preferences from SQLite to Task 15 D1.

Reports contain counts, opaque error references, and an aggregate digest only.
They never contain usernames, tool configuration bodies, session tokens, secrets,
or local filesystem paths.
"""

from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "local-backend"))

from account_store import AccountError, AccountStore  # noqa: E402


PRODUCTION_CONFIRMATION = "TASK15-PRODUCTION-REMAINING-DATA-MIGRATION"
DEFAULT_SOURCE_KEY = "task15-legacy-tools"
MAX_BATCH = 200
MAX_CONFIG_BYTES = 50 * 1024
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$")
TOOL_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
SOURCE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$")
KINDS = ("favorites", "recent", "configs")


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def valid_timestamp(value: object) -> bool:
    try:
        datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        return True
    except (TypeError, ValueError):
        return False


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone() is not None


def table_rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    if not table_exists(connection, table):
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"').fetchall()]


def safe_reference(kind: str, row: dict, index: int) -> str:
    identifier = str(row.get("id") or "")
    if ID_PATTERN.fullmatch(identifier):
        return identifier
    digest = hashlib.sha256(f"{kind}\0{index}".encode()).hexdigest()[:16]
    return f"row-{digest}"


def parse_config(value: object, tool_id: str, name: str):
    try:
        config = value if isinstance(value, (dict, list)) else json.loads(str(value or "{}"))
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise RuntimeError("config_json_invalid") from exc
    if not isinstance(config, (dict, list)):
        raise RuntimeError("config_type_invalid")
    encoded = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_CONFIG_BYTES:
        raise RuntimeError("config_too_large")
    if tool_id == "workflow":
        if not isinstance(config, dict):
            raise RuntimeError("workflow_invalid")
        try:
            config = AccountStore._validate_workflow_config(config)
        except AccountError as exc:
            raise RuntimeError(str(exc.code or "workflow_invalid")) from exc
        if config["name"] != name:
            raise RuntimeError("workflow_name_mismatch")
    return config


def analyze_source(database_path: Path):
    if not database_path.is_file():
        raise FileNotFoundError("Source SQLite database was not found")
    uri = database_path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        users = {str(row.get("id") or "") for row in table_rows(connection, "users")}
        source = {
            "favorites": table_rows(connection, "tool_favorites"),
            "recent": table_rows(connection, "tool_recent_usage"),
            "configs": table_rows(connection, "saved_tool_configs"),
        }

    records = {kind: [] for kind in KINDS}
    invalid = []
    missing_users = set()
    duplicate_keys = 0
    seen = {kind: set() for kind in KINDS}
    canonical = []

    for kind in KINDS:
        for index, row in enumerate(source[kind]):
            reference = safe_reference(kind, row, index)
            try:
                user_id = str(row.get("user_id") or "")
                tool_id = str(row.get("tool_id") or "")
                if user_id not in users:
                    missing_users.add(user_id)
                    raise RuntimeError("owner_missing")
                if not TOOL_ID_PATTERN.fullmatch(tool_id):
                    raise RuntimeError("tool_id_invalid")
                if kind == "favorites":
                    key = (user_id, tool_id)
                    created_at = str(row.get("created_at") or "")
                    updated_at = str(row.get("updated_at") or "")
                    if not valid_timestamp(created_at) or not valid_timestamp(updated_at):
                        raise RuntimeError("timestamp_invalid")
                    record = {
                        "user_id": user_id,
                        "tool_id": tool_id,
                        "pinned": bool(row.get("pinned")),
                        "created_at": created_at,
                        "updated_at": updated_at,
                    }
                elif kind == "recent":
                    identifier = str(row.get("id") or "")
                    used_at = str(row.get("used_at") or "")
                    if not ID_PATTERN.fullmatch(identifier):
                        raise RuntimeError("record_id_invalid")
                    if not valid_timestamp(used_at):
                        raise RuntimeError("timestamp_invalid")
                    key = identifier
                    record = {"id": identifier, "user_id": user_id, "tool_id": tool_id, "used_at": used_at}
                else:
                    identifier = str(row.get("id") or "")
                    name = str(row.get("name") or "").strip()
                    created_at = str(row.get("created_at") or "")
                    updated_at = str(row.get("updated_at") or "")
                    if not ID_PATTERN.fullmatch(identifier):
                        raise RuntimeError("record_id_invalid")
                    if not name or len(name) > 80:
                        raise RuntimeError("config_name_invalid")
                    if not valid_timestamp(created_at) or not valid_timestamp(updated_at):
                        raise RuntimeError("timestamp_invalid")
                    config = parse_config(row.get("config_json"), tool_id, name)
                    key = identifier
                    record = {
                        "id": identifier,
                        "user_id": user_id,
                        "tool_id": tool_id,
                        "name": name,
                        "config": config,
                        "created_at": created_at,
                        "updated_at": updated_at,
                    }
                if key in seen[kind]:
                    duplicate_keys += 1
                    raise RuntimeError("duplicate_record")
                seen[kind].add(key)
                records[kind].append(record)
                canonical.append({"kind": kind, "record": record})
            except RuntimeError as exc:
                invalid.append({"kind": kind, "id": reference, "error_code": str(exc)})

    canonical_digest = hashlib.sha256(
        json.dumps(
            sorted(
                canonical,
                key=lambda item: (
                    item["kind"],
                    str(item["record"].get("id") or ""),
                    str(item["record"].get("user_id") or ""),
                    str(item["record"].get("tool_id") or ""),
                ),
            ),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    counts = {
        "source": {kind: len(source[kind]) for kind in KINDS},
        "eligible": {kind: len(records[kind]) for kind in KINDS},
        "users": len(users),
        "referenced_users": len({item["user_id"] for kind in KINDS for item in records[kind]}),
        "missing_user_count": len({value for value in missing_users if value}),
        "duplicate_key_count": duplicate_keys,
        "invalid_count": len(invalid),
        "invalid_records": invalid,
        "canonical_sha256": canonical_digest,
    }
    return records, counts


def validate_source(counts: dict) -> None:
    blockers = (
        counts["missing_user_count"], counts["duplicate_key_count"], counts["invalid_count"],
    )
    if any(blockers) or counts["source"] != counts["eligible"]:
        raise RuntimeError("Task 15 source integrity checks failed; inspect the sanitized report")


def clean_source_key(value: str) -> str:
    text = str(value or DEFAULT_SOURCE_KEY).strip()
    if not SOURCE_KEY_PATTERN.fullmatch(text):
        raise RuntimeError("Source key must contain 8-80 safe characters")
    return text


def endpoint_url(endpoint: str, path: str) -> str:
    base = str(endpoint or "").strip().rstrip("/")
    if not base.startswith("https://") and not base.startswith("http://127.0.0.1"):
        raise RuntimeError("Endpoint must use HTTPS or local loopback HTTP")
    return f"{base}{path}"


def request_json(url: str, token: str, payload: dict | None, production: bool):
    headers = {"Accept": "application/json", "X-Session-Token": token}
    method = "GET" if payload is None else "POST"
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if production:
        headers["X-WYJ-Task15-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            message = payload.get("error") or payload.get("message") or ""
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = ""
        raise RuntimeError(f"Cloud import request failed with HTTP {exc.code}: {message[:160]}") from exc


def ensure_outside_repository(path: Path) -> None:
    resolved = path.resolve()
    try:
        resolved.relative_to(ROOT.resolve())
    except ValueError:
        return
    raise RuntimeError("Production backups and reports must be stored outside the Git repository")


def production_backup(args) -> Path | None:
    if args.environment != "production":
        return None
    if args.confirm_production != PRODUCTION_CONFIRMATION:
        raise RuntimeError("Production requires the exact confirmation phrase")
    if not args.backup_dir:
        raise RuntimeError("Production requires an outside-repository backup directory")
    backup_dir = Path(args.backup_dir)
    ensure_outside_repository(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"task15-source-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.sqlite3"
    source_uri = Path(args.source_db).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(source_uri, uri=True)) as source, closing(sqlite3.connect(target)) as destination:
        source.backup(destination)
        check = destination.execute("PRAGMA quick_check").fetchone()
        if not check or str(check[0]).lower() != "ok":
            raise RuntimeError("Production SQLite backup integrity check failed")
    return target


def apply_import(args, records: dict) -> dict:
    production = args.environment == "production"
    production_backup(args)
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Session token environment variable {args.session_token_env} is empty")
    source_key = clean_source_key(args.source_key)
    results = []
    for kind in KINDS:
        rows = records[kind]
        if not rows:
            batches = [[]]
        else:
            batches = [rows[index:index + MAX_BATCH] for index in range(0, len(rows), MAX_BATCH)]
        for index, batch in enumerate(batches):
            payload = {
                "source_key": source_key,
                "kind": kind,
                "batch_key": f"{kind}:{index:06d}",
                "source_count": len(rows),
                "records": batch,
                "complete": index == len(batches) - 1,
            }
            results.append(request_json(
                endpoint_url(args.endpoint, "/api/admin/task15/import"), token, payload, production,
            ))
    status = request_json(
        endpoint_url(args.endpoint, f"/api/admin/task15/import/status?source_key={urllib.parse.quote(source_key)}"),
        token,
        None,
        production,
    )
    imports = {item.get("kind"): item for item in status.get("imports", []) if item.get("source_key") == source_key}
    for kind in KINDS:
        item = imports.get(kind) or {}
        expected = len(records[kind])
        if (
            int(item.get("source_count", -1)) != expected
            or int(item.get("received_count", -1)) != expected
            or item.get("complete") is not True
        ):
            raise RuntimeError(f"Cloud import verification failed for {kind}")
    return {
        "batches": len(results),
        "received": sum(item.get("received", 0) for item in results),
        "status": status.get("counts", {}),
        "imports": list(imports.values()),
    }


def rollback_import(args) -> dict:
    production = args.environment == "production"
    production_backup(args)
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Session token environment variable {args.session_token_env} is empty")
    return request_json(
        endpoint_url(args.endpoint, "/api/admin/task15/import/rollback"),
        token,
        {"source_key": clean_source_key(args.source_key)},
        production,
    )


def write_report(path_value: str, report: dict, production: bool) -> None:
    if not path_value:
        return
    path = Path(path_value)
    if production:
        ensure_outside_repository(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source-db", required=True)
    result.add_argument("--endpoint", default="https://thewyj.uk")
    result.add_argument("--environment", choices=("preview", "production"), default="preview")
    result.add_argument("--session-token-env", default="WYJ_TASK15_MIGRATION_SESSION")
    result.add_argument("--source-key", default=DEFAULT_SOURCE_KEY)
    result.add_argument("--report", default="")
    result.add_argument("--backup-dir", default="")
    result.add_argument("--confirm-production", default="")
    group = result.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true")
    group.add_argument("--rollback", action="store_true")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    args.source_db = Path(args.source_db)
    records, counts = analyze_source(args.source_db)
    report = {"schema_version": 1, "generated_at": iso_now(), "environment": args.environment, "counts": counts, "applied": False}
    if args.rollback:
        validate_source(counts)
        report["rollback"] = rollback_import(args)
    elif args.apply:
        validate_source(counts)
        report["cloud"] = apply_import(args, records)
        report["applied"] = True
    write_report(args.report, report, args.environment == "production")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
