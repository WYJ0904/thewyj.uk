"""Audit and migrate legacy temporary shares from SQLite to D1 and private R2.

The report intentionally contains counts and opaque record IDs only. It never
contains shared text, file bytes, passwords, connection codes, hashes, tokens,
or local filesystem paths.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.request


SCHEMA_VERSION = 1
PRODUCTION_CONFIRMATION = "TASK14-PRODUCTION-TEMPORARY-SHARING-MIGRATION"
DEFAULT_SOURCE_KEY = "legacy-temporary"
MAX_BATCH = 100
MAX_TEXT_BYTES = 100 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 30 * 1024 * 1024
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
HEX_64 = re.compile(r"^[a-f0-9]{64}$")
PBKDF2_HASH = re.compile(r"^pbkdf2_sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$")
FILE_TYPES = {
    ".txt": {"text/plain"},
    ".csv": {"text/csv", "application/csv", "text/plain"},
    ".json": {"application/json", "text/json", "text/plain"},
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".webp": {"image/webp"},
    ".gif": {"image/gif"},
    ".zip": {"application/zip", "application/x-zip-compressed"},
    ".mp4": {"video/mp4"},
    ".m4v": {"video/mp4", "video/x-m4v"},
    ".mov": {"video/quicktime"},
    ".webm": {"video/webm"},
}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}
SHARE_TABLES = (
    "temporary_texts", "temporary_files", "temporary_clipboards", "temporary_rooms",
)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone() is not None


def rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    if not table_exists(connection, table):
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"').fetchall()]


def bytes_ok(extension: str, content: bytes) -> bool:
    if not content:
        return False
    if extension == ".pdf":
        return content.startswith(b"%PDF-")
    if extension == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if extension in {".jpg", ".jpeg"}:
        return content.startswith(b"\xff\xd8\xff")
    if extension == ".gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    if extension == ".zip":
        return content.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"))
    if extension == ".webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    if extension in {".mp4", ".m4v", ".mov"}:
        return len(content) >= 12 and content[4:8] == b"ftyp"
    if extension == ".webm":
        return content.startswith(b"\x1a\x45\xdf\xa3")
    if extension in {".txt", ".csv", ".json"}:
        encodings = ("utf-16",) if content.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig",)
        try:
            text = content.decode(encodings[0])
            if "\x00" in text:
                return False
            if extension == ".json":
                json.loads(text)
            return True
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
    return False


def valid_password_hash(value: object) -> bool:
    text = str(value or "")
    if not text:
        return True
    match = PBKDF2_HASH.fullmatch(text)
    if not match:
        return False
    iterations = int(match.group(1))
    if not 100_000 <= iterations <= 2_000_000:
        return False
    try:
        salt = base64.urlsafe_b64decode(match.group(2) + "=" * (-len(match.group(2)) % 4))
        digest = base64.urlsafe_b64decode(match.group(3) + "=" * (-len(match.group(3)) % 4))
    except (ValueError, TypeError):
        return False
    return 8 <= len(salt) <= 64 and len(digest) == 32


def clean_source_key(value: str) -> str:
    text = str(value or DEFAULT_SOURCE_KEY).strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{8,16}", text):
        raise RuntimeError("Source key must contain 8-16 safe characters")
    return text


def import_source_key(base: str, kind: str) -> str:
    suffix = "shares" if kind == "shares" else "room_messages"
    return f"{clean_source_key(base)}:{suffix}"


def object_key(environment: str, record_id: str) -> str:
    scope = environment if environment in {"development", "preview", "production"} else "development"
    return f"temporary/v1/{scope}/files/{record_id}"


def _active(row: dict, now: datetime) -> bool:
    expires = parse_time(row.get("expires_at"))
    return bool(expires and expires > now)


def _share_record(table: str, row: dict, environment: str) -> dict:
    created = str(row.get("created_at") or iso_now())
    common = {
        "id": str(row.get("id") or ""),
        "owner_user_id": str(row.get("owner_user_id") or ""),
        "created_at": created,
        "updated_at": created,
        "expires_at": str(row.get("expires_at") or ""),
        "state": "active",
    }
    if table == "temporary_texts":
        kind = str(row.get("kind") or "text").lower()
        common.update({
            "share_type": "text" if kind == "text" else "qr",
            "kind": kind if kind in {"text", "qr", "wifi", "contact", "url"} else "text",
            "content_text": str(row.get("content") or ""),
            "password_hash": str(row.get("password_hash") or ""),
            "max_views": int(row.get("max_views") or 1),
            "view_count": int(row.get("view_count") or 0),
            "destroy_after_read": bool(row.get("destroy_after_read")),
        })
    elif table == "temporary_files":
        name = str(row.get("file_name") or "")
        extension = Path(name).suffix.lower()
        content = bytes(row.get("content") or b"")
        common.update({
            "share_type": "file", "kind": "file", "file_name": name,
            "mime_type": str(row.get("mime_type") or ""), "size_bytes": len(content),
            "sha256_hex": hashlib.sha256(content).hexdigest(),
            "password_hash": str(row.get("password_hash") or ""),
            "max_downloads": int(row.get("max_downloads") or 1),
            "download_count": int(row.get("download_count") or 0),
            "destroy_after_download": bool(row.get("destroy_after_download")),
            "r2_object_key": object_key(environment, common["id"]),
            "file_extension": extension,
        })
    elif table == "temporary_clipboards":
        common.update({
            "share_type": "clipboard", "kind": "clipboard",
            "content_text": str(row.get("content") or ""),
            "connection_code_digest": str(row.get("code_hash") or ""),
            "view_count": int(row.get("read_count") or 0),
            "destroy_after_read": bool(row.get("destroy_after_read")),
        })
    elif table == "temporary_rooms":
        common.update({
            "share_type": "room", "kind": "room",
            "password_hash": str(row.get("password_hash") or ""),
            "max_messages": int(row.get("max_messages") or 50),
        })
    return common


def analyze_source(database_path: Path, environment: str = "preview", now: datetime | None = None):
    if not database_path.is_file():
        raise FileNotFoundError("Source SQLite database was not found")
    current = now or datetime.now(timezone.utc)
    uri = database_path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        source = {table: rows(connection, table) for table in (*SHARE_TABLES, "temporary_room_messages")}
        users = {str(row.get("id") or "") for row in rows(connection, "users")}

    eligible = []
    expired = 0
    invalid_files = []
    invalid_password_hashes = 0
    invalid_connection_digests = 0
    invalid_ids = 0
    all_ids = []
    file_bytes = 0
    type_counts = Counter()
    for table in SHARE_TABLES:
        for row in source[table]:
            record_id = str(row.get("id") or "")
            all_ids.append(record_id)
            if not ID_PATTERN.fullmatch(record_id):
                invalid_ids += 1
                continue
            if not _active(row, current):
                expired += 1
                continue
            record = _share_record(table, row, environment)
            if not valid_password_hash(record.get("password_hash")):
                invalid_password_hashes += 1
                continue
            if record["share_type"] == "clipboard" and not HEX_64.fullmatch(record["connection_code_digest"]):
                invalid_connection_digests += 1
                continue
            if record["share_type"] == "file":
                extension = record["file_extension"]
                mime = record["mime_type"].lower().split(";", 1)[0]
                content = bytes(row.get("content") or b"")
                limit = MAX_VIDEO_BYTES if extension in VIDEO_EXTENSIONS else MAX_FILE_BYTES
                if (extension not in FILE_TYPES or mime not in FILE_TYPES[extension]
                        or not 0 < len(content) <= limit or not bytes_ok(extension, content)):
                    invalid_files.append({"id": record_id, "error_code": "file_validation_failed"})
                    continue
                file_bytes += len(content)
            eligible.append(record)
            type_counts[record["share_type"]] += 1

    eligible_room_ids = {row["id"] for row in eligible if row["share_type"] == "room"}
    messages = []
    invalid_messages = 0
    for row in source["temporary_room_messages"]:
        record_id = str(row.get("id") or "")
        room_id = str(row.get("room_id") or "")
        if not ID_PATTERN.fullmatch(record_id) or room_id not in eligible_room_ids:
            invalid_messages += 1
            continue
        message = str(row.get("message") or "")
        if not message.strip() or len(message.encode("utf-8")) > 4 * 1024:
            invalid_messages += 1
            continue
        messages.append({
            "id": record_id, "room_id": room_id,
            "author": str(row.get("author") or "访客")[:30],
            "message": message, "created_at": str(row.get("created_at") or iso_now()),
        })

    referenced = {row["owner_user_id"] for row in eligible}
    counts = {
        "source_records": sum(len(source[table]) for table in SHARE_TABLES),
        "eligible_shares": len(eligible),
        "eligible_types": dict(sorted(type_counts.items())),
        "eligible_messages": len(messages),
        "file_count": type_counts["file"],
        "file_bytes": file_bytes,
        "expired_skipped": expired,
        "invalid_ids": invalid_ids,
        "duplicate_ids": len(all_ids) - len(set(all_ids)),
        "missing_user_ids": len(referenced - users),
        "invalid_password_hashes": invalid_password_hashes,
        "invalid_connection_digests": invalid_connection_digests,
        "invalid_messages": invalid_messages,
        "invalid_files": invalid_files,
    }
    return {"shares": eligible, "room_messages": messages}, counts


def validate_source(counts: dict) -> None:
    blockers = (
        counts["invalid_ids"] + counts["duplicate_ids"] + counts["missing_user_ids"]
        + counts["invalid_password_hashes"] + counts["invalid_connection_digests"]
        + counts["invalid_messages"] + len(counts["invalid_files"])
    )
    if blockers:
        raise RuntimeError(f"Task 14 source integrity checks failed; blocker_count={blockers}")


def safe_report(counts: dict) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": iso_now(),
        **counts,
    }


def backup_database(source: Path, backup_directory: Path) -> Path:
    backup_directory.mkdir(parents=True, exist_ok=True)
    target = backup_directory / f"task14-source-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.sqlite3"
    with closing(sqlite3.connect(source)) as source_db, closing(sqlite3.connect(target)) as target_db:
        source_db.backup(target_db)
    return target


def _npx() -> str:
    command = shutil.which("npx.cmd") or shutil.which("npx")
    if not command:
        raise RuntimeError("npx/wrangler is unavailable")
    return command


def upload_file_assets(database_path: Path, records: list[dict], bucket: str, wrangler_env: str,
                       resume_state: Path | None = None) -> dict:
    state = {}
    if resume_state and resume_state.is_file():
        try:
            state = json.loads(resume_state.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            state = {}
    uploaded = skipped = 0
    with closing(sqlite3.connect(database_path)) as connection:
        connection.row_factory = sqlite3.Row
        for record in (item for item in records if item["share_type"] == "file"):
            if state.get(record["id"]) == record["sha256_hex"]:
                skipped += 1
                continue
            row = connection.execute("SELECT content FROM temporary_files WHERE id = ?", (record["id"],)).fetchone()
            if not row or hashlib.sha256(bytes(row["content"])).hexdigest() != record["sha256_hex"]:
                raise RuntimeError("Source file changed after dry-run")
            with tempfile.NamedTemporaryFile(prefix="wyj-task14-", suffix=record["file_extension"], delete=False) as stream:
                stream.write(bytes(row["content"]))
                temporary_path = Path(stream.name)
            try:
                command = [
                    _npx(), "wrangler", "r2", "object", "put",
                    f"{bucket}/{record['r2_object_key']}", "--remote", "--file", str(temporary_path),
                    "--content-type", record["mime_type"], "--cache-control", "private, no-store",
                ]
                if wrangler_env:
                    command.extend(["--env", wrangler_env])
                result = subprocess.run(command, check=False, capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError("R2 upload failed; rerun with the same resume state")
                uploaded += 1
                state[record["id"]] = record["sha256_hex"]
                if resume_state:
                    resume_state.parent.mkdir(parents=True, exist_ok=True)
                    resume_state.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
            finally:
                temporary_path.unlink(missing_ok=True)
    return {"uploaded": uploaded, "resumed": skipped}


def request_json(url: str, token: str, payload: dict | None, production: bool = False) -> dict:
    headers = {
        "Accept": "application/json",
        "User-Agent": "WYJ-Task14-Migration/1.0",
        "X-Session-Token": token,
    }
    data = None
    method = "GET"
    if payload is not None:
        method = "POST"
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if production:
        headers["X-WYJ-Task14-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Task 14 migration API rejected the request with HTTP {error.code}") from error


def _endpoint(base: str, path: str) -> str:
    return base.rstrip("/") + path


def apply_import(args, data: dict, counts: dict) -> dict:
    production = args.environment == "production"
    if production and (
        args.confirm_production != PRODUCTION_CONFIRMATION or not args.backup_confirmed
    ):
        raise RuntimeError("Production requires backup confirmation and the exact confirmation phrase")
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError("Migration session token environment variable is not configured")
    results = {}
    for kind in ("shares", "room_messages"):
        records = data[kind]
        source_key = import_source_key(args.source_key, kind)
        received = changed = 0
        batches = [records[index:index + MAX_BATCH] for index in range(0, len(records), MAX_BATCH)] or [[]]
        for index, batch in enumerate(batches):
            payload = {
                "schema_version": SCHEMA_VERSION,
                "source_key": source_key,
                "kind": kind,
                "records": batch,
                "source_count": len(records),
                "source_bytes": counts["file_bytes"] if kind == "shares" else 0,
                "complete": index == len(batches) - 1,
            }
            response = request_json(
                _endpoint(args.endpoint, "/api/admin/task14/import"), token, payload, production,
            )
            received += int(response.get("received", 0))
            changed += int(response.get("changed", 0))
        results[kind] = {"received": received, "changed": changed}
    status = request_json(
        _endpoint(args.endpoint, "/api/admin/task14/import/status"), token, None, production,
    )
    return {"imports": results, "status": status.get("counts", {})}


def rollback_import(args) -> dict:
    production = args.environment == "production"
    if production and args.confirm_production != PRODUCTION_CONFIRMATION:
        raise RuntimeError("Production rollback requires the exact confirmation phrase")
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError("Migration session token environment variable is not configured")
    removed = 0
    for kind in ("room_messages", "shares"):
        response = request_json(
            _endpoint(args.endpoint, "/api/admin/task14/import/rollback"), token,
            {"source_key": import_source_key(args.source_key, kind)}, production,
        )
        removed += int(response.get("rollback", {}).get("removed", 0))
    return {"removed": removed}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", required=True)
    parser.add_argument("--environment", choices=("development", "preview", "production"), default="preview")
    parser.add_argument("--endpoint", default="")
    parser.add_argument("--session-token-env", default="WYJ_TASK14_MIGRATION_SESSION")
    parser.add_argument("--source-key", default=DEFAULT_SOURCE_KEY)
    parser.add_argument("--report", default="")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--upload-r2", action="store_true")
    parser.add_argument("--r2-bucket", default="")
    parser.add_argument("--wrangler-env", default="preview")
    parser.add_argument("--resume-state", default="")
    parser.add_argument("--backup-dir", default="")
    parser.add_argument("--backup-confirmed", action="store_true")
    parser.add_argument("--confirm-production", default="")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    source = Path(args.source_db)
    data, counts = analyze_source(source, args.environment)
    report = safe_report(counts)
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    validate_source(counts)
    if args.environment == "production" and args.apply:
        if not args.backup_dir:
            raise RuntimeError("Production apply requires --backup-dir")
        backup_database(source, Path(args.backup_dir))
    if args.rollback:
        print(json.dumps(rollback_import(args), ensure_ascii=False, indent=2))
        return 0
    if args.upload_r2:
        if not args.r2_bucket:
            raise RuntimeError("--r2-bucket is required with --upload-r2")
        result = upload_file_assets(
            source, data["shares"], args.r2_bucket, args.wrangler_env,
            Path(args.resume_state) if args.resume_state else None,
        )
        print(json.dumps(result, ensure_ascii=False))
    if args.apply:
        if not args.endpoint:
            raise RuntimeError("--endpoint is required with --apply")
        print(json.dumps(apply_import(args, data, counts), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
