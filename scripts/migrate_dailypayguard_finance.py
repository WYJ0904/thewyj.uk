"""Audit and migrate legacy DailyPayGuard SharedPreferences records to Task 16.

The default mode is a read-only dry run. Reports contain counts, opaque record
identifiers, error codes, and an aggregate digest; they never contain source
text, account credentials, session tokens, or local filesystem paths.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_CONFIRMATION = "TASK16-PRODUCTION-FINANCE-MIGRATION"
DEFAULT_SOURCE_PREFIX = "dailypayguard-v1"
MAX_BATCH = 100
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$")
TYPE_DIRECTIONS = {
    "消费": "expense",
    "消費": "expense",
    "支出": "expense",
    "收款": "income",
    "收入": "income",
    "退款": "refund",
    "退回": "refund",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def extract_records_text(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError("DailyPayGuard source export was not found")
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() != ".xml" and not text.lstrip().startswith("<map"):
        return text
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise RuntimeError("SharedPreferences XML is invalid") from exc
    for child in root.findall("string"):
        if child.attrib.get("name") == "records":
            return child.text or ""
    return ""


def amount_minor(value: str) -> int:
    try:
        amount = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise RuntimeError("amount_invalid") from exc
    cents = int(amount * 100)
    if cents <= 0 or cents > 10_000_000_000_000:
        raise RuntimeError("amount_invalid")
    return cents


def safe_reference(index: int, timestamp: str) -> str:
    if timestamp.isdigit() and 8 <= len(timestamp) <= 32:
        return f"legacy:{timestamp}"
    return f"row-{hashlib.sha256(f'{index}'.encode()).hexdigest()[:16]}"


def source_namespace(user_id: str, source_key: str) -> str:
    value = f"{user_id}\0{source_key}".encode("utf-8")
    return hashlib.sha256(value).hexdigest()[:12]


def resolve_source_key(value: str, user_id: str = "") -> str:
    key = str(value or "").strip()
    if not key:
        if not SAFE_ID.fullmatch(str(user_id or "")):
            raise RuntimeError("A stable user ID is required to derive the migration source key")
        digest = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:16]
        key = f"{DEFAULT_SOURCE_PREFIX}:{digest}"
    if not SAFE_ID.fullmatch(key):
        raise RuntimeError("Source key must contain 8-80 safe characters")
    return key


def stable_record_id(timestamp: int, user_id: str, source_key: str) -> str:
    return f"legacy:{timestamp}:{source_namespace(user_id, source_key)}"


def analyze_source(path: Path, user_id: str, source_key: str = ""):
    if not SAFE_ID.fullmatch(str(user_id or "")):
        raise RuntimeError("User ID must contain 8-80 safe characters")
    effective_source_key = resolve_source_key(source_key, user_id)
    lines = [line for line in extract_records_text(path).splitlines() if line.strip()]
    records = []
    invalid = []
    directions = Counter()
    seen_timestamps = set()
    for index, line in enumerate(lines):
        parts = line.split("\t")
        timestamp_text = parts[0].strip() if parts else ""
        reference = safe_reference(index, timestamp_text)
        try:
            if len(parts) < 5:
                raise RuntimeError("field_count_invalid")
            timestamp = int(timestamp_text)
            if timestamp <= 0:
                raise RuntimeError("timestamp_invalid")
            if timestamp in seen_timestamps:
                raise RuntimeError("duplicate_legacy_timestamp")
            direction = TYPE_DIRECTIONS.get(parts[3].strip())
            if not direction:
                raise RuntimeError("legacy_type_unsupported")
            cents = amount_minor(parts[1].strip())
            source = parts[2].strip()[:80]
            if not source:
                raise RuntimeError("source_missing")
            record = {
                "id": stable_record_id(timestamp, user_id, effective_source_key),
                "user_id": user_id,
                "direction": direction,
                "amount_minor": cents,
                "currency": "CNY",
                "merchant": "",
                "counterparty": "",
                "note": "",
                "occurred_at_ms": timestamp,
                "source": source,
                "legacy_timestamp": timestamp,
                "legacy_type": parts[3].strip()[:40],
            }
            seen_timestamps.add(timestamp)
            records.append(record)
            directions[direction] += 1
        except (RuntimeError, ValueError) as exc:
            invalid.append({"id": reference, "error_code": str(exc)})

    canonical = sorted(records, key=lambda item: item["id"])
    digest = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    report = {
        "schema_version": 1,
        "source_format": "dailypayguard_shared_preferences_v1",
        "source_key": effective_source_key,
        "source_count": len(lines),
        "eligible_count": len(records),
        "invalid_count": len(invalid),
        "invalid_records": invalid,
        "direction_counts": dict(sorted(directions.items())),
        "canonical_sha256": digest,
        "generated_at": iso_now(),
    }
    return records, report


def validate_source(report: dict) -> None:
    if report["invalid_count"] or report["source_count"] != report["eligible_count"]:
        raise RuntimeError("DailyPayGuard source integrity checks failed; inspect the sanitized report")


def ensure_outside_repository(path: Path) -> None:
    try:
        path.resolve().relative_to(ROOT.resolve())
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
    source = Path(args.source).resolve()
    target = backup_dir / f"dailypayguard-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}{source.suffix or '.txt'}"
    shutil.copy2(source, target)
    if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
        raise RuntimeError("Production backup checksum verification failed")
    return target


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
        headers["X-WYJ-Task16-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read().decode("utf-8"))
            message = error.get("error") or ""
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = ""
        raise RuntimeError(f"Cloud import request failed with HTTP {exc.code}: {message[:160]}") from exc


def apply_import(args, records: list[dict], report: dict) -> dict:
    production = args.environment == "production"
    production_backup(args)
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Session token environment variable {args.session_token_env} is empty")
    source_key = resolve_source_key(args.source_key, args.user_id)
    if source_key != report.get("source_key"):
        raise RuntimeError("Migration source key changed after the dry run")
    batches = [records[index:index + MAX_BATCH] for index in range(0, len(records), MAX_BATCH)] or [[]]
    responses = []
    for index, batch in enumerate(batches):
        responses.append(request_json(
            endpoint_url(args.endpoint, "/api/admin/task16/import"),
            token,
            {
                "source_key": source_key,
                "user_id": args.user_id,
                "source_count": len(records),
                "canonical_sha256": report["canonical_sha256"],
                "batch_key": f"records:{index:06d}",
                "records": batch,
                "complete": index == len(batches) - 1,
            },
            production,
        ))
    status = request_json(
        endpoint_url(args.endpoint, f"/api/admin/task16/import/status?source_key={urllib.parse.quote(source_key)}"),
        token,
        None,
        production,
    )
    matches = [item for item in status.get("imports", []) if item.get("source_key") == source_key]
    if len(matches) != 1:
        raise RuntimeError("Cloud import verification did not return the source batch")
    cloud = matches[0]
    if (
        int(cloud.get("source_count", -1)) != len(records)
        or int(cloud.get("received_count", -1)) != len(records)
        or cloud.get("complete") is not True
        or cloud.get("canonical_sha256") != report["canonical_sha256"]
    ):
        raise RuntimeError("Cloud import count or digest verification failed")
    return {
        "batch_count": len(responses),
        "received_count": sum(int(item.get("received", 0)) for item in responses),
        "applied_count": sum(int(item.get("applied", 0)) for item in responses),
        "cloud_counts": status.get("counts", {}),
        "import": cloud,
    }


def rollback_import(args) -> dict:
    production = args.environment == "production"
    production_backup(args)
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Session token environment variable {args.session_token_env} is empty")
    return request_json(
        endpoint_url(args.endpoint, "/api/admin/task16/import/rollback"),
        token,
        {"source_key": resolve_source_key(args.source_key)},
        production,
    )


def write_report(path_value: str, payload: dict, environment: str) -> None:
    if not path_value:
        return
    path = Path(path_value)
    if environment == "production":
        ensure_outside_repository(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source", default="", help="SharedPreferences XML or exported records text")
    result.add_argument("--user-id", default="", help="Stable Task 12 user ID")
    result.add_argument("--source-key", default="", help="Optional stable key; defaults to a user-scoped opaque key")
    result.add_argument("--environment", choices=("dry-run", "preview", "production"), default="dry-run")
    result.add_argument("--endpoint", default="")
    result.add_argument("--session-token-env", default="WYJ_TASK16_ADMIN_SESSION")
    action = result.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true")
    action.add_argument("--rollback", action="store_true")
    result.add_argument("--confirm-production", default="")
    result.add_argument("--backup-dir", default="")
    result.add_argument("--report", default="")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.rollback:
        output = {"rollback": rollback_import(args)}
    else:
        if not args.source or not args.user_id:
            raise RuntimeError("--source and --user-id are required for dry-run and apply")
        records, report = analyze_source(Path(args.source), args.user_id, args.source_key)
        output = {"dry_run": report}

    if args.apply and not args.rollback:
        validate_source(report)
        if args.environment == "dry-run":
            raise RuntimeError("--apply requires preview or production environment")
        output["apply"] = apply_import(args, records, report)
    write_report(args.report, output, args.environment)
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
