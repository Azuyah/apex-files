from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import read_token
from .settings import get_settings


def require_admin_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        return
    normalized_origin = origin.strip().rstrip("/")
    if normalized_origin.lower() == "null" or normalized_origin not in get_settings().admin_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin origin is not allowed")


def _authenticated_user(authorization: str | None, db: Session, *, audience: str) -> User:
    scheme, _, token = str(authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    payload = read_token(token)
    token_audience = payload.get("aud", "app") if payload else None
    if token_audience != audience:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    user_id = str(payload.get("sub") if payload else "")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    try:
        token_session_version = int(payload.get("sv", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    if token_session_version != int(user.session_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return user


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    return _authenticated_user(authorization, db, audience="app")


def get_current_admin(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    require_admin_origin(request)
    user = _authenticated_user(authorization, db, audience="admin")
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user
