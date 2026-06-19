from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Subscription, User, utcnow
from ..schemas import AuthLoginIn, AuthOut, AuthRegisterIn, UserOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _default_period_end():
    return utcnow() + timedelta(days=30)


@router.post("/register", response_model=AuthOut)
def register(payload: AuthRegisterIn, db: Session = Depends(get_db)) -> AuthOut:
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account already exists for this email")

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        company_name=payload.company_name.strip(),
    )
    db.add(user)
    db.flush()
    db.add(
        Subscription(
            user_id=user.id,
            plan_name="Apex Launch",
            monthly_file_limit=25,
            period_ends_at=_default_period_end(),
        )
    )
    db.commit()
    db.refresh(user)
    return AuthOut(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthOut)
def login(payload: AuthLoginIn, db: Session = Depends(get_db)) -> AuthOut:
    account = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == account))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid account or password")
    return AuthOut(token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
