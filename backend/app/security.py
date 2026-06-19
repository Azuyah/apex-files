from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .settings import get_settings


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return f"pbkdf2_sha256${_b64url(salt)}${_b64url(digest)}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
      _algo, salt_b64, digest_b64 = password_hash.split("$", 2)
      salt = _b64url_decode(salt_b64)
      expected = _b64url_decode(digest_b64)
    except Exception:
      return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return hmac.compare_digest(actual, expected)


def create_token(subject: str, expires_delta: timedelta | None = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + (expires_delta or timedelta(days=14))).timestamp()),
    }
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(settings.app_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url(signature)}"


def read_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(settings.app_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
        supplied = _b64url_decode(signature)
        if not hmac.compare_digest(expected, supplied):
            return None
        payload = json.loads(_b64url_decode(body))
        if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            return None
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None
