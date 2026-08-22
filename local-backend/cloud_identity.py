"""Verify short-lived Cloudflare Pages identity assertions for legacy business APIs."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
import urllib.parse


BRIDGE_VERSION = "1"
BRIDGE_ENTITLEMENT_VERSION = "2"
BRIDGE_VERSIONS = {BRIDGE_VERSION, BRIDGE_ENTITLEMENT_VERSION}
BRIDGE_MAX_AGE_SECONDS = 45
BRIDGE_SECRET_ENV = "VOCAB_LEGACY_IDENTITY_BRIDGE_SECRET"
_SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_ENTITLEMENTS = {
    "language_english_access",
    "language_japanese_access",
    "language_all_access",
    "tools_access",
    "tools_batch_access",
    "temporary_share_access",
    "save_tool_config",
    "all_features_access",
}


class CloudIdentityError(ValueError):
    """The request carried a cloud identity assertion that could not be trusted."""


def _header(headers, name):
    return str(headers.get(name, "") or "").strip()


def _canonical(user_id, username, issued_at, request_id, method, pathname, version=BRIDGE_VERSION, entitlements=()):
    lines = [
            f"wyj-legacy-identity-v{version}",
            str(issued_at),
            str(request_id),
            str(method).upper(),
            str(pathname),
            str(user_id),
            str(username),
    ]
    if version == BRIDGE_ENTITLEMENT_VERSION:
        lines.append(",".join(sorted(set(entitlements))))
    return "\n".join(lines)


def _signature(secret, canonical):
    digest = hmac.new(
        str(secret).encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def assertion_present(headers):
    return any(
        _header(headers, name)
        for name in (
            "X-WYJ-Identity-Version",
            "X-WYJ-Identity-User-ID",
            "X-WYJ-Identity-Signature",
        )
    )


def verify_cloud_identity(headers, method, pathname, now=None, secret=None):
    """Return a minimal trusted identity, None when absent, or raise when invalid."""
    if not assertion_present(headers):
        return None
    if _header(headers, "X-WYJ-Proxy").casefold() != "pages":
        raise CloudIdentityError("identity assertion did not come through Pages")
    configured_secret = str(secret if secret is not None else os.environ.get(BRIDGE_SECRET_ENV, ""))
    if len(configured_secret) < 32:
        raise CloudIdentityError("identity bridge is not configured")
    version = _header(headers, "X-WYJ-Identity-Version")
    if version not in BRIDGE_VERSIONS:
        raise CloudIdentityError("identity assertion version is unsupported")
    try:
        user_id = urllib.parse.unquote(_header(headers, "X-WYJ-Identity-User-ID"))
        username = urllib.parse.unquote(_header(headers, "X-WYJ-Identity-Username"))
        issued_at = int(_header(headers, "X-WYJ-Identity-Issued-At"))
    except (TypeError, ValueError, UnicodeDecodeError) as exc:
        raise CloudIdentityError("identity assertion fields are invalid") from exc
    request_id = _header(headers, "X-WYJ-Identity-Request-ID")
    signature = _header(headers, "X-WYJ-Identity-Signature")
    entitlements = ()
    if version == BRIDGE_ENTITLEMENT_VERSION:
        try:
            entitlement_value = urllib.parse.unquote(
                _header(headers, "X-WYJ-Identity-Entitlements")
            )
        except (UnicodeDecodeError, ValueError) as exc:
            raise CloudIdentityError("identity assertion entitlements are invalid") from exc
        if len(entitlement_value) > 1024:
            raise CloudIdentityError("identity assertion entitlements are invalid")
        raw_entitlements = tuple(item for item in entitlement_value.split(",") if item)
        if len(raw_entitlements) != len(set(raw_entitlements)) or any(
            item not in _ENTITLEMENTS for item in raw_entitlements
        ):
            raise CloudIdentityError("identity assertion entitlements are invalid")
        entitlements = tuple(sorted(raw_entitlements))
    current = int(time.time() if now is None else now)
    if abs(current - issued_at) > BRIDGE_MAX_AGE_SECONDS:
        raise CloudIdentityError("identity assertion expired")
    if not _SAFE_ID.fullmatch(user_id) or not username or len(username) > 40:
        raise CloudIdentityError("identity assertion account is invalid")
    if not _SAFE_REQUEST_ID.fullmatch(request_id):
        raise CloudIdentityError("identity assertion request ID is invalid")
    expected = _signature(
        configured_secret,
        _canonical(
            user_id, username, issued_at, request_id, method, pathname,
            version, entitlements,
        ),
    )
    if not signature or not hmac.compare_digest(signature, expected):
        raise CloudIdentityError("identity assertion signature is invalid")
    result = {"id": user_id, "username": username}
    if version == BRIDGE_ENTITLEMENT_VERSION:
        result["entitlements"] = entitlements
    return result


__all__ = [
    "BRIDGE_MAX_AGE_SECONDS",
    "BRIDGE_ENTITLEMENT_VERSION",
    "BRIDGE_SECRET_ENV",
    "CloudIdentityError",
    "assertion_present",
    "verify_cloud_identity",
]
