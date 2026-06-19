from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Subscription, User, as_utc, utcnow
from ..security import hash_password
from ..settings import get_settings


def ensure_temp_admin_account(db: Session) -> None:
    settings = get_settings()
    if not settings.temp_admin_enabled:
        return

    username = settings.temp_admin_username.strip().lower() or "admin"
    password = settings.temp_admin_password or "admin"
    user = db.scalar(select(User).where(User.email == username))
    if user is None:
        user = User(
            email=username,
            password_hash=hash_password(password),
            display_name="Temporary Admin",
            company_name="Apex Files",
            role="admin",
        )
        db.add(user)
        db.flush()
    else:
        user.password_hash = hash_password(password)
        user.display_name = user.display_name or "Temporary Admin"
        user.company_name = user.company_name or "Apex Files"
        user.role = user.role or "admin"

    subscription = db.scalar(select(Subscription).where(Subscription.user_id == user.id))
    if subscription is None:
        subscription = Subscription(
            user_id=user.id,
            plan_name="Temporary Admin",
            monthly_file_limit=9999,
            period_ends_at=utcnow() + timedelta(days=365),
        )
        db.add(subscription)
    else:
        subscription.plan_name = "Temporary Admin"
        subscription.monthly_file_limit = max(subscription.monthly_file_limit, 9999)
        subscription.status = "active"
        now = utcnow()
        if as_utc(subscription.period_ends_at) <= now:
            subscription.period_ends_at = now + timedelta(days=365)

    db.commit()
