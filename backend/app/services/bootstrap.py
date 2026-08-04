from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Subscription, User, utcnow
from ..security import hash_password
from ..settings import get_settings


def ensure_temp_admin_account(db: Session) -> None:
    settings = get_settings()
    if not settings.temp_admin_enabled:
        return

    username = settings.temp_admin_username.strip().lower()
    password = settings.temp_admin_password
    if not username or not password:
        return
    user = db.scalar(select(User).where(User.email == username))
    if user is not None:
        return
    user = User(
        email=username,
        password_hash=hash_password(password),
        display_name="Temporary Admin",
        company_name="Apex Files",
        selected_package="pro",
        role="admin",
    )
    db.add(user)
    db.flush()

    subscription = db.scalar(select(Subscription).where(Subscription.user_id == user.id))
    if subscription is None:
        subscription = Subscription(
            user_id=user.id,
            plan_name="Apex Pro",
            monthly_file_limit=9999,
            period_ends_at=utcnow() + timedelta(days=365),
        )
        db.add(subscription)

    db.commit()
