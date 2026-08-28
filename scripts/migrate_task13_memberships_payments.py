"""Audit and migrate Task 13 memberships/payments from SQLite to D1 and private R2."""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "local-backend"))

from membership import LEGACY_PLAN_MAP, MEMBERSHIP_PLANS  # noqa: E402


SCHEMA_VERSION = "1"
PRODUCTION_CONFIRMATION = "TASK13-PRODUCTION-MEMBERSHIP-PAYMENT-MIGRATION"
IMPORT_ORDER = (
    "memberships",
    "entitlement_overrides",
    "payment_orders",
    "payment_history",
    "fulfillments",
    "approvals",
    "admin_audit",
)
PAYMENT_METHODS = ("wechat", "alipay")
OPEN_PAYMENT_STATUSES = {"pending_payment", "user_paid", "processing"}
TERMINAL_PAYMENT_STATUSES = {"approved", "rejected", "cancelled", "expired"}
PAYMENT_STATUSES = OPEN_PAYMENT_STATUSES | TERMINAL_PAYMENT_STATUSES
MIGRATED_AUDIT_PREFIXES = ("membership_", "entitlement_", "payment_")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_QR_BYTES = 3 * 1024 * 1024
QR_ASSET_PLAN_ALIASES = {"finance_monthly": "all_access_monthly"}


def qr_asset_plan_code(plan_code: str) -> str:
    return QR_ASSET_PLAN_ALIASES.get(str(plan_code or ""), str(plan_code or ""))


MAX_BATCH = 100


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone() is not None


def rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    if not table_exists(connection, table):
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"').fetchall()]


def parse_json(value, fallback):
    if isinstance(value, type(fallback)):
        return value
    try:
        parsed = json.loads(value or json.dumps(fallback))
    except (json.JSONDecodeError, TypeError, ValueError):
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


def plan_code(value: str) -> str:
    raw = str(value or "").strip()
    code = LEGACY_PLAN_MAP.get(raw, raw)
    if code not in MEMBERSHIP_PLANS:
        raise RuntimeError(f"Unknown membership plan code count=1 code_hash={hashlib.sha256(raw.encode()).hexdigest()[:12]}")
    return code


def stable_id(prefix: str, *parts) -> str:
    digest = hashlib.sha256("\0".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:48]
    return f"{prefix}-{digest}"


def membership_records(source_rows: list[dict]) -> list[dict]:
    output = []
    for row in source_rows:
        output.append(
            {
                "id": str(row.get("id") or ""),
                "user_id": str(row.get("user_id") or ""),
                "plan_code": plan_code(row.get("plan_code")),
                "starts_at": str(row.get("starts_at") or row.get("created_at") or iso_now()),
                "expires_at": str(row.get("expires_at") or ""),
                "is_lifetime": bool(row.get("is_lifetime")),
                "status": str(row.get("status") or "active"),
                "source": str(row.get("source") or "legacy_import"),
                "source_ref": str(row.get("source_ref") or ""),
                "created_by": str(row.get("created_by") or ""),
                "metadata": parse_json(row.get("metadata_json"), {}),
                "created_at": str(row.get("created_at") or row.get("starts_at") or iso_now()),
                "updated_at": str(row.get("updated_at") or row.get("created_at") or iso_now()),
            }
        )
    return output


def override_records(source_rows: list[dict]) -> list[dict]:
    return [
        {
            "user_id": str(row.get("user_id") or ""),
            "entitlement_code": str(row.get("entitlement_code") or ""),
            "allowed": bool(row.get("allowed")),
            "note": str(row.get("note") or "")[:500],
            "updated_by": str(row.get("updated_by") or ""),
            "updated_at": str(row.get("updated_at") or iso_now()),
        }
        for row in source_rows
    ]


def payment_records(source_rows: list[dict]) -> list[dict]:
    output = []
    for row in source_rows:
        code = plan_code(row.get("plan_code"))
        plan = MEMBERSHIP_PLANS[code]
        status = str(row.get("status") or "pending_payment")
        if status not in PAYMENT_STATUSES:
            raise RuntimeError(f"Unknown payment status count=1 status_hash={hashlib.sha256(status.encode()).hexdigest()[:12]}")
        method = str(row.get("payment_method") or "")
        resource = str(row.get("qr_resource_id") or "")
        if status in OPEN_PAYMENT_STATUSES and (
            method not in PAYMENT_METHODS or resource != f"qr-v1:{method}:{code}"
        ):
            raise RuntimeError("An open payment order has no valid payment method/QR binding")
        requested_at = str(row.get("requested_at") or row.get("updated_at") or iso_now())
        raw_snapshot_entitlements = row.get("entitlements_snapshot_json")
        snapshot_entitlements = (
            parse_json(raw_snapshot_entitlements, [])
            if raw_snapshot_entitlements not in (None, "")
            else list(plan["entitlements"])
        )
        snapshot_entitlements = [str(value) for value in snapshot_entitlements]
        output.append(
            {
                "id": str(row.get("id") or ""),
                "order_number": str(row.get("order_number") or ""),
                "user_id": str(row.get("user_id") or ""),
                "username_snapshot": str(row.get("username") or ""),
                "plan_code": code,
                "plan_name_snapshot": str(row.get("plan_name_snapshot") or plan["name"]),
                "amount_cents": int(row.get("amount_cents") or 0),
                "currency": str(row.get("currency") or "CNY"),
                "lifetime_snapshot": bool(
                    row.get("lifetime_snapshot")
                    if row.get("lifetime_snapshot") is not None
                    else plan["lifetime"]
                ),
                "duration_months_snapshot": int(
                    row.get("duration_months_snapshot")
                    if row.get("duration_months_snapshot") is not None
                    else plan["duration_months"]
                ),
                "entitlements_snapshot": snapshot_entitlements,
                "description_snapshot": str(
                    row.get("description_snapshot") or plan["description"]
                ),
                "trial_language": str(row.get("trial_language") or ""),
                "payment_method": method if method in PAYMENT_METHODS else "",
                "qr_resource_id": resource if method in PAYMENT_METHODS else "",
                "payment_note": str(row.get("payment_note") or "")[:500],
                "status": status,
                "requested_at": requested_at,
                "expires_at": str(row.get("expires_at") or ""),
                "user_confirmed_at": str(row.get("user_confirmed_at") or ""),
                "processing_at": str(row.get("processing_at") or ""),
                "handled_at": str(row.get("handled_at") or ""),
                "handled_by": str(row.get("handled_by") or ""),
                "admin_note": str(row.get("admin_note") or "")[:500],
                "updated_at": str(row.get("updated_at") or requested_at),
            }
        )
    return output


def history_records(source_rows: list[dict]) -> list[dict]:
    return [
        {
            "id": str(row.get("id") or ""),
            "payment_order_id": str(row.get("payment_request_id") or ""),
            "from_status": str(row.get("from_status") or ""),
            "to_status": str(row.get("to_status") or ""),
            "actor_user_id": str(row.get("actor_user_id") or ""),
            "actor_username": str(row.get("actor_username") or ""),
            "note": str(row.get("note") or "")[:500],
            "created_at": str(row.get("created_at") or iso_now()),
        }
        for row in source_rows
    ]


def fulfillment_records(source_rows: list[dict]) -> list[dict]:
    return [
        {
            "id": str(row.get("id") or ""),
            "payment_order_id": str(row.get("payment_request_id") or ""),
            "user_id": str(row.get("user_id") or ""),
            "plan_code": plan_code(row.get("plan_code")),
            "user_membership_id": str(row.get("user_membership_id") or ""),
            "source": str(row.get("source") or "payment"),
            "source_ref": str(row.get("source_ref") or ""),
            "fulfilled_at": str(row.get("fulfilled_at") or iso_now()),
        }
        for row in source_rows
    ]


def approval_records(payment_rows: list[dict], users: list[dict]) -> tuple[list[dict], int]:
    by_username = {
        str(row.get("username") or "").strip().casefold(): row
        for row in users
        if str(row.get("username") or "").strip()
    }
    output = []
    skipped = 0
    for row in payment_rows:
        status = str(row.get("status") or "")
        if status not in {"approved", "rejected"}:
            continue
        username = str(row.get("handled_by") or "").strip()
        actor = by_username.get(username.casefold())
        if not actor:
            skipped += 1
            continue
        output.append(
            {
                "id": stable_id("task13-approval", row.get("id"), status),
                "payment_order_id": str(row.get("id") or ""),
                "action": "approve" if status == "approved" else "reject",
                "admin_user_id": str(actor.get("id") or ""),
                "admin_username": username,
                "note": str(row.get("admin_note") or "")[:500],
                "created_at": str(row.get("handled_at") or row.get("updated_at") or iso_now()),
            }
        )
    return output, skipped


def audit_records(source_rows: list[dict], user_ids: set[str]) -> tuple[list[dict], int]:
    output = []
    skipped = 0
    for row in source_rows:
        action = str(row.get("action") or "")
        if not action.startswith(MIGRATED_AUDIT_PREFIXES):
            continue
        actor_user_id = str(row.get("actor_user_id") or "")
        if actor_user_id not in user_ids:
            skipped += 1
            continue
        output.append(
            {
                "id": str(row.get("id") or ""),
                "actor_user_id": actor_user_id,
                "actor_username": str(row.get("actor_username") or ""),
                "target_user_id": str(row.get("target_user_id") or ""),
                "target_username": str(row.get("target_username") or ""),
                "action": action,
                "before": parse_json(row.get("before_json"), {}),
                "after": parse_json(row.get("after_json"), {}),
                "note": str(row.get("note") or "")[:500],
                "created_at": str(row.get("created_at") or iso_now()),
            }
        )
    return output, skipped


def duplicate_count(records: list[dict], fields: tuple[str, ...]) -> int:
    identities = [tuple(str(row.get(field) or "") for field in fields) for row in records]
    return len(identities) - len(set(identities))


def qr_inventory(qr_directory: Path, payment_rows: list[dict]) -> tuple[dict, dict[str, Path]]:
    expected = {
        (method, qr_asset_plan_code(code))
        for method in PAYMENT_METHODS
        for code, plan in MEMBERSHIP_PLANS.items()
        if plan["purchasable"]
    }
    expected.update(
        (row["payment_method"], qr_asset_plan_code(row["plan_code"]))
        for row in payment_rows
        if row["payment_method"] in PAYMENT_METHODS
    )
    valid: dict[str, Path] = {}
    missing = invalid = 0
    for method, code in sorted(expected):
        path = qr_directory / f"{method}_{code}.png"
        if not path.is_file():
            missing += 1
            continue
        size = path.stat().st_size
        try:
            with path.open("rb") as stream:
                signature = stream.read(8)
        except OSError:
            invalid += 1
            continue
        if size < 8 or size > MAX_QR_BYTES or signature != PNG_SIGNATURE:
            invalid += 1
            continue
        valid[f"payments/qrcodes/v1/{method}_{code}.png"] = path
    return {
        "expected": len(expected),
        "valid": len(valid),
        "missing": missing,
        "invalid": invalid,
    }, valid


def analyze_source(database_path: Path, qr_directory: Path) -> tuple[dict[str, list[dict]], dict, dict[str, Path]]:
    if not database_path.is_file():
        raise FileNotFoundError("Source SQLite database was not found")
    source_uri = database_path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(source_uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN")
        users = rows(connection, "users")
        raw_memberships = rows(connection, "user_memberships")
        raw_overrides = rows(connection, "user_entitlement_overrides")
        raw_payments = rows(connection, "payment_requests")
        raw_history = rows(connection, "payment_request_events")
        raw_fulfillments = rows(connection, "payment_fulfillments")
        raw_audit = rows(connection, "admin_audit_logs")

    user_ids = {str(row.get("id") or "") for row in users}
    memberships = membership_records(raw_memberships)
    overrides = override_records(raw_overrides)
    payments = payment_records(raw_payments)
    history = history_records(raw_history)
    fulfillments = fulfillment_records(raw_fulfillments)
    approvals, skipped_approvals = approval_records(raw_payments, users)
    audit, skipped_audit = audit_records(raw_audit, user_ids)
    data = {
        "memberships": memberships,
        "entitlement_overrides": overrides,
        "payment_orders": payments,
        "payment_history": history,
        "fulfillments": fulfillments,
        "approvals": approvals,
        "admin_audit": audit,
    }
    referenced_user_ids = {
        str(row.get("user_id") or "")
        for kind in (memberships, overrides, payments, fulfillments)
        for row in kind
    }
    missing_users = referenced_user_ids - user_ids
    status_counts = Counter(row["status"] for row in payments)
    legacy_counts = Counter(
        row["plan_code"] for row in memberships + payments if row["plan_code"].startswith("legacy_")
    )
    qr_counts, qr_assets = qr_inventory(qr_directory, payments)
    counts = {
        "users": len(user_ids),
        "memberships": len(memberships),
        "entitlement_overrides": len(overrides),
        "payment_orders": len(payments),
        "payment_statuses": dict(sorted(status_counts.items())),
        "payment_history": len(history),
        "fulfillments": len(fulfillments),
        "approvals": len(approvals),
        "admin_audit": len(audit),
        "legacy_plans": dict(sorted(legacy_counts.items())),
        "referenced_user_ids": len(referenced_user_ids),
        "missing_user_ids": len(missing_users),
        "missing_membership_ids": sum(not row["id"] for row in memberships),
        "missing_payment_ids": sum(not row["id"] for row in payments),
        "missing_order_numbers": sum(not row["order_number"] for row in payments),
        "missing_fulfillment_ids": sum(not row["id"] for row in fulfillments),
        "duplicate_membership_ids": duplicate_count(memberships, ("id",)),
        "duplicate_membership_sources": duplicate_count(
            [row for row in memberships if row["source_ref"]], ("user_id", "source", "source_ref")
        ),
        "duplicate_payment_ids": duplicate_count(payments, ("id",)),
        "duplicate_order_numbers": duplicate_count(payments, ("order_number",)),
        "duplicate_fulfillment_orders": duplicate_count(fulfillments, ("payment_order_id",)),
        "skipped_approvals_without_admin": skipped_approvals,
        "skipped_audit_without_actor": skipped_audit,
        "qr_inventory": qr_counts,
    }
    return data, counts, qr_assets


def validate_source(counts: dict) -> None:
    blockers = (
        "missing_user_ids",
        "missing_membership_ids",
        "missing_payment_ids",
        "missing_order_numbers",
        "missing_fulfillment_ids",
        "duplicate_membership_ids",
        "duplicate_membership_sources",
        "duplicate_payment_ids",
        "duplicate_order_numbers",
        "duplicate_fulfillment_orders",
    )
    if any(int(counts.get(key) or 0) for key in blockers):
        raise RuntimeError("Source membership/payment integrity checks failed")
    qr = counts.get("qr_inventory") or {}
    if int(qr.get("missing") or 0) or int(qr.get("invalid") or 0):
        raise RuntimeError("Payment QR inventory is incomplete or invalid")


def endpoint_url(base: str, path: str) -> str:
    parsed = urllib.parse.urlsplit(base.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--endpoint must be an http(s) site URL")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("A remote migration endpoint must use HTTPS")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def request_json(url: str, token: str, payload: dict | None, production: bool) -> dict:
    parsed = urllib.parse.urlsplit(url)
    headers = {
        "Accept": "application/json",
        "Origin": urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")),
        "User-Agent": "WYJ-Task13-Migration/1.0",
        "X-Session-Token": token,
    }
    body = None
    method = "GET"
    if payload is not None:
        method = "POST"
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if production:
        headers["X-WYJ-Task13-Production-Confirm"] = PRODUCTION_CONFIRMATION
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
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


def upload_qr_assets(assets: dict[str, Path], bucket: str, wrangler_env: str) -> int:
    if not bucket or not assets:
        return 0
    npx = shutil.which("npx.cmd" if os.name == "nt" else "npx") or shutil.which("npx")
    if not npx:
        raise RuntimeError("Wrangler launcher is unavailable")
    uploaded = 0
    for key, source in assets.items():
        command = [
            npx, "wrangler", "r2", "object", "put", f"{bucket}/{key}",
            "--file", str(source), "--content-type", "image/png",
            "--cache-control", "private, no-store", "--remote", "--force",
            "--env", wrangler_env, "--config", "wrangler.jsonc",
        ]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            raise RuntimeError("Private R2 QR upload failed; no local path or object content was logged")
        uploaded += 1
    return uploaded


def create_backup(source: Path, backup_directory: Path) -> None:
    backup_directory.mkdir(parents=True, exist_ok=True)
    target = backup_directory / f"task13-source-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite3"
    with closing(sqlite3.connect(source)) as source_connection, closing(sqlite3.connect(target)) as target_connection:
        source_connection.backup(target_connection)


def apply_import(args, data: dict[str, list[dict]], qr_assets: dict[str, Path]) -> dict:
    token = os.environ.get(args.session_token_env, "").strip()
    if not token:
        raise RuntimeError(f"Set {args.session_token_env} without printing its value before --apply")
    production = args.environment == "production"
    if production and (
        not args.backup_confirmed
        or args.confirm_production != PRODUCTION_CONFIRMATION
        or not args.backup_dir
    ):
        raise RuntimeError(
            "Production requires --backup-confirmed, --backup-dir and "
            f"--confirm-production {PRODUCTION_CONFIRMATION}"
        )
    before = request_json(
        endpoint_url(args.endpoint, "/api/admin/task13/import/status"), token, None, production
    ).get("counts", {})
    if production:
        create_backup(Path(args.source_db).expanduser().resolve(), Path(args.backup_dir).expanduser().resolve())
    uploaded = upload_qr_assets(qr_assets, args.r2_bucket, args.wrangler_env) if args.upload_r2 else 0
    imported = {}
    for kind in IMPORT_ORDER:
        received = changed = 0
        for batch in chunks(data[kind]):
            result = request_json(
                endpoint_url(args.endpoint, "/api/admin/task13/import"),
                token,
                {"schema_version": SCHEMA_VERSION, "kind": kind, "records": batch},
                production,
            )
            received += int(result.get("received") or 0)
            changed += int(result.get("changed") or 0)
        imported[kind] = {"received": received, "changed": changed}
    after = request_json(
        endpoint_url(args.endpoint, "/api/admin/task13/import/status"), token, None, production
    ).get("counts", {})
    return {
        "before_counts": before,
        "batches": imported,
        "after_counts": after,
        "qr_uploaded": uploaded,
        "backup_created": production,
    }


def write_report(path: str, report: dict) -> None:
    if not path:
        return
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    default_db = os.environ.get("VOCAB_USERS_DB") or str(ROOT / "local-backend" / "data" / "users.sqlite3")
    default_qr = os.environ.get("VOCAB_PAYMENT_QR_DIR") or str(ROOT / "local-backend" / "data" / "payment" / "qrcodes")
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source-db", default=default_db)
    result.add_argument("--qr-dir", default=default_qr)
    result.add_argument("--environment", choices=("preview", "production"), default="preview")
    result.add_argument("--endpoint", default="")
    result.add_argument("--session-token-env", default="WYJ_TASK13_ADMIN_SESSION")
    result.add_argument("--report", default="")
    result.add_argument("--apply", action="store_true")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--upload-r2", action="store_true")
    result.add_argument("--r2-bucket", default="")
    result.add_argument("--wrangler-env", choices=("preview", "production"), default="preview")
    result.add_argument("--backup-confirmed", action="store_true")
    result.add_argument("--backup-dir", default="")
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
    if args.upload_r2 and not args.r2_bucket:
        raise SystemExit("--r2-bucket is required with --upload-r2")
    source_db = Path(args.source_db).expanduser().resolve()
    data, counts, qr_assets = analyze_source(source_db, Path(args.qr_dir).expanduser().resolve())
    validate_source(counts)
    report = {
        "schema_version": SCHEMA_VERSION,
        "environment": args.environment,
        "mode": "apply" if args.apply else "dry-run",
        "generated_at": iso_now(),
        "source_counts": counts,
        "stable_user_ids_preserved": counts["missing_user_ids"] == 0,
        "sensitive_values_included_in_report": False,
        "qr_contents_included_in_report": False,
        "rollback": "disable Task 13 cloud flags and keep the legacy backend primary",
    }
    if args.apply:
        report["result"] = apply_import(args, data, qr_assets)
    write_report(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError, sqlite3.Error) as error:
        print(f"Task 13 migration failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
