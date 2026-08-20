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
BRIDGE_MAX_AGE_SECONDS = 45
BRIDGE_SECRET_ENV = "VOCAB_LEGACY_IDENTITY_BRIDGE_SECRET"
_SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class CloudIdentityError(ValueError):
    """The request carried a cloud identity assertion that could not be trusted."""


def _header(headers, name):
    return str(headers.get(name, "") or "").strip()


def _canonical(user_id, username, issued_at, request_id, method, pathname):
    return "\n".join(
        (
            "wyj-legacy-identity-v1",
            str(issued_at),
            str(request_id),
            str(method).upper(),
            str(pathname),
            str(user_id),
            str(username),
        )
    )


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
    if _header(headers, "X-WYJ-Identity-Version") != BRIDGE_VERSION:
        raise CloudIdentityError("identity assertion version is unsupported")
    try:
        user_id = urllib.parse.unquote(_header(headers, "X-WYJ-Identity-User-ID"))
        username = urllib.parse.unquote(_header(headers, "X-WYJ-Identity-Username"))
        issued_at = int(_header(headers, "X-WYJ-Identity-Issued-At"))
    except (TypeError, ValueError, UnicodeDecodeError) as exc:
        raise CloudIdentityError("identity assertion fields are invalid") from exc
    request_id = _header(headers, "X-WYJ-Identity-Request-ID")
    signature = _header(headers, "X-WYJ-Identity-Signature")
    current = int(time.time() if now is None else now)
    if abs(current - issued_at) > BRIDGE_MAX_AGE_SECONDS:
        raise CloudIdentityError("identity assertion expired")
    if not _SAFE_ID.fullmatch(user_id) or not username or len(username) > 40:
        raise CloudIdentityError("identity assertion account is invalid")
    if not _SAFE_REQUEST_ID.fullmatch(request_id):
        raise CloudIdentityError("identity assertion request ID is invalid")
    expected = _signature(
        configured_secret,
        _canonical(user_id, username, issued_at, request_id, method, pathname),
    )
    if not signature or not hmac.compare_digest(signature, expected):
        raise CloudIdentityError("identity assertion signature is invalid")
    return {"id": user_id, "username": username}


__all__ = [
    "BRIDGE_MAX_AGE_SECONDS",
    "BRIDGE_SECRET_ENV",
    "CloudIdentityError",
    "assertion_present",
    "verify_cloud_identity",
]
