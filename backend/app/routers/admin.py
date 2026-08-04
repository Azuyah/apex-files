from __future__ import annotations

import html
import math
import secrets
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..admin_schemas import (
    AdminAuditEventListOut,
    AdminAuditEventOut,
    AdminBuildSummaryOut,
    AdminOverviewOut,
    AdminPasswordResetIn,
    AdminPasswordResetOut,
    AdminProjectListOut,
    AdminProjectOut,
    AdminPurchaseCreateIn,
    AdminPurchaseListOut,
    AdminPurchaseOut,
    AdminPurchaseUserOut,
    AdminSubscriptionListItemOut,
    AdminSubscriptionListOut,
    AdminSubscriptionOut,
    AdminSubscriptionUpdateIn,
    AdminUserCreateIn,
    AdminUserDetailOut,
    AdminUserListItemOut,
    AdminUserListOut,
    AdminUserStatsOut,
    AdminUserStatusIn,
    AdminUserUpdateIn,
)
from ..database import get_db
from ..deps import get_current_admin, require_admin_origin
from ..models import AdminAuditEvent, BuildJob, Project, Purchase, Subscription, User, as_utc, utcnow
from ..schemas import AuthLoginIn, AuthOut, UserOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin_origin)],
)

PACKAGE_PLANS = {
    "free": ("Apex Free", 1),
    "lite": ("Apex Lite", 20),
    "pro": ("Apex Pro", 9999),
}
_ADMIN_LOGIN_WINDOW = timedelta(minutes=15)
_ADMIN_LOGIN_MAX_FAILURES = 5
_admin_login_failures: dict[tuple[str, str], list[datetime]] = defaultdict(list)
_admin_login_lock = threading.Lock()


def _pages(total: int, page_size: int) -> int:
    return math.ceil(total / page_size) if total else 0


def _request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded[:64]
    return str(request.client.host if request.client else "")[:64]


def _admin_login_key(request: Request, account: str) -> tuple[str, str]:
    return (_request_ip(request), account)


def _check_admin_login_rate_limit(key: tuple[str, str]) -> None:
    cutoff = utcnow() - _ADMIN_LOGIN_WINDOW
    with _admin_login_lock:
        failures = [value for value in _admin_login_failures.get(key, []) if value >= cutoff]
        if failures:
            _admin_login_failures[key] = failures
        else:
            _admin_login_failures.pop(key, None)
        if len(failures) >= _ADMIN_LOGIN_MAX_FAILURES:
            raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")


def _record_admin_login_failure(key: tuple[str, str]) -> None:
    with _admin_login_lock:
        _admin_login_failures[key].append(utcnow())


def _clear_admin_login_failures(key: tuple[str, str]) -> None:
    with _admin_login_lock:
        _admin_login_failures.pop(key, None)


def _record_audit(
    db: Session,
    *,
    actor: User,
    action: str,
    request: Request,
    target_user_id: str | None = None,
    details: dict | None = None,
) -> AdminAuditEvent:
    event = AdminAuditEvent(
        actor_user_id=actor.id,
        target_user_id=target_user_id,
        action=action,
        details=details or {},
        ip_address=_request_ip(request),
        user_agent=request.headers.get("user-agent", "")[:255],
    )
    db.add(event)
    return event


def _user_summary(user: User) -> AdminPurchaseUserOut:
    return AdminPurchaseUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        company_name=user.company_name,
    )


def _audit_events_out(db: Session, events: list[AdminAuditEvent]) -> list[AdminAuditEventOut]:
    user_ids = {
        value
        for event in events
        for value in (event.actor_user_id, event.target_user_id)
        if value
    }
    users = {
        user.id: user.email
        for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}
    return [
        AdminAuditEventOut(
            id=event.id,
            action=event.action,
            actor_user_id=event.actor_user_id,
            actor_email=users.get(event.actor_user_id),
            target_user_id=event.target_user_id,
            target_email=users.get(event.target_user_id),
            details=event.details or {},
            ip_address=event.ip_address,
            created_at=event.created_at,
        )
        for event in events
    ]


def _purchase_out(db: Session, purchase: Purchase, user: User | None = None) -> AdminPurchaseOut:
    account = user or db.get(User, purchase.user_id)
    if account is None:
        raise HTTPException(status_code=500, detail="Purchase account is missing")
    return AdminPurchaseOut(
        id=purchase.id,
        user_id=purchase.user_id,
        user=_user_summary(account),
        provider=purchase.provider,
        external_reference=purchase.external_reference,
        idempotency_key=purchase.idempotency_key,
        receipt_number=purchase.receipt_number,
        description=purchase.description,
        amount_minor=purchase.amount_minor,
        currency=purchase.currency,
        status=purchase.status,
        notes=purchase.notes,
        purchased_at=purchase.purchased_at,
        created_by_user_id=purchase.created_by_user_id,
        created_at=purchase.created_at,
        updated_at=purchase.updated_at,
        receipt_url=f"/api/admin/purchases/{purchase.id}/receipt",
    )


def _purchase_matches_payload(purchase: Purchase, payload: AdminPurchaseCreateIn) -> bool:
    if (
        purchase.user_id != payload.user_id
        or purchase.amount_minor != payload.amount_minor
        or purchase.currency != payload.currency
        or purchase.description != payload.description.strip()
        or purchase.provider != payload.provider
        or purchase.external_reference != payload.external_reference
        or purchase.status != payload.status
        or purchase.notes != payload.notes.strip()
    ):
        return False
    if payload.purchased_at is not None:
        return as_utc(purchase.purchased_at) == as_utc(payload.purchased_at)
    return True


def _user_stats(db: Session, user_id: str) -> AdminUserStatsOut:
    project_count = db.scalar(select(func.count(Project.id)).where(Project.user_id == user_id)) or 0
    build_row = db.execute(
        select(
            func.count(BuildJob.id),
            func.coalesce(func.sum(case((BuildJob.status == "ready", 1), else_=0)), 0),
            func.coalesce(func.sum(case((BuildJob.status == "failed", 1), else_=0)), 0),
            func.coalesce(
                func.sum(case((BuildJob.status.notin_(("ready", "failed")), 1), else_=0)),
                0,
            ),
            func.max(BuildJob.created_at),
        ).where(BuildJob.user_id == user_id)
    ).one()
    purchase_count = db.scalar(select(func.count(Purchase.id)).where(Purchase.user_id == user_id)) or 0
    paid_rows = db.execute(
        select(Purchase.currency, func.sum(Purchase.amount_minor), func.count(Purchase.id))
        .where(Purchase.user_id == user_id, Purchase.status == "paid")
        .group_by(Purchase.currency)
    ).all()
    return AdminUserStatsOut(
        project_count=int(project_count),
        total_builds=int(build_row[0] or 0),
        ready_builds=int(build_row[1] or 0),
        failed_builds=int(build_row[2] or 0),
        processing_builds=int(build_row[3] or 0),
        last_build_at=build_row[4],
        purchase_count=int(purchase_count),
        paid_by_currency=[
            {"currency": currency, "amount_minor": int(amount or 0), "count": int(count)}
            for currency, amount, count in paid_rows
        ],
    )


def _user_item(
    db: Session,
    user: User,
    subscription: Subscription | None = None,
    stats: AdminUserStatsOut | None = None,
) -> AdminUserListItemOut:
    if subscription is None:
        subscription = db.scalar(select(Subscription).where(Subscription.user_id == user.id))
    return AdminUserListItemOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        company_name=user.company_name,
        vat_number=user.vat_number,
        phone_number=user.phone_number,
        country=user.country,
        selected_package=user.selected_package,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        subscription=AdminSubscriptionOut.model_validate(subscription) if subscription else None,
        stats=stats or _user_stats(db, user.id),
    )


def _activity(db: Session, *, days: int, user_id: str | None = None) -> list[dict]:
    now = utcnow()
    start_date = (now - timedelta(days=days - 1)).date()
    activity = {
        (start_date + timedelta(days=offset)).isoformat(): {
            "date": (start_date + timedelta(days=offset)).isoformat(),
            "users_created": 0,
            "builds_total": 0,
            "builds_ready": 0,
            "builds_failed": 0,
            "purchases": 0,
        }
        for offset in range(days)
    }

    if user_id is None:
        created_rows = db.scalars(select(User.created_at).where(User.created_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc))).all()
        for created_at in created_rows:
            key = created_at.date().isoformat()
            if key in activity:
                activity[key]["users_created"] += 1

    builds_query = select(BuildJob.created_at, BuildJob.status).where(
        BuildJob.created_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    )
    purchases_query = select(Purchase.purchased_at).where(
        Purchase.purchased_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    )
    if user_id is not None:
        builds_query = builds_query.where(BuildJob.user_id == user_id)
        purchases_query = purchases_query.where(Purchase.user_id == user_id)

    for created_at, build_status in db.execute(builds_query).all():
        key = created_at.date().isoformat()
        if key not in activity:
            continue
        activity[key]["builds_total"] += 1
        if build_status == "ready":
            activity[key]["builds_ready"] += 1
        elif build_status == "failed":
            activity[key]["builds_failed"] += 1
    for purchased_at in db.scalars(purchases_query).all():
        key = purchased_at.date().isoformat()
        if key in activity:
            activity[key]["purchases"] += 1
    return list(activity.values())


def _get_user_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _get_purchase_or_404(db: Session, purchase_id: str) -> Purchase:
    purchase = db.get(Purchase, purchase_id)
    if purchase is None:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return purchase


def _user_detail(db: Session, user: User) -> AdminUserDetailOut:
    item = _user_item(db, user)
    builds = db.scalars(
        select(BuildJob)
        .where(BuildJob.user_id == user.id)
        .order_by(BuildJob.created_at.desc())
        .limit(20)
    ).all()
    purchases = db.scalars(
        select(Purchase)
        .where(Purchase.user_id == user.id)
        .order_by(Purchase.purchased_at.desc())
        .limit(20)
    ).all()
    events = db.scalars(
        select(AdminAuditEvent)
        .where(
            or_(
                AdminAuditEvent.target_user_id == user.id,
                AdminAuditEvent.actor_user_id == user.id,
            )
        )
        .order_by(AdminAuditEvent.created_at.desc())
        .limit(20)
    ).all()
    return AdminUserDetailOut(
        **item.model_dump(),
        recent_builds=[AdminBuildSummaryOut.model_validate(build) for build in builds],
        recent_purchases=[_purchase_out(db, purchase, user) for purchase in purchases],
        recent_audit_events=_audit_events_out(db, list(events)),
        activity=_activity(db, days=30, user_id=user.id),
    )


@router.post("/auth/login", response_model=AuthOut)
def admin_login(payload: AuthLoginIn, request: Request, db: Session = Depends(get_db)) -> AuthOut:
    require_admin_origin(request)
    account = payload.email.strip().lower()
    rate_key = _admin_login_key(request, account)
    _check_admin_login_rate_limit(rate_key)
    user = db.scalar(select(User).where(User.email == account))
    if (
        not user
        or not verify_password(payload.password, user.password_hash)
        or not user.is_active
        or user.role != "admin"
    ):
        _record_admin_login_failure(rate_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid account or password")
    _clear_admin_login_failures(rate_key)
    return AuthOut(
        token=create_token(
            user.id,
            expires_delta=timedelta(hours=8),
            session_version=user.session_version,
            audience="admin",
        ),
        user=UserOut.model_validate(user),
    )


@router.get("/auth/me", response_model=UserOut)
def admin_me(admin: User = Depends(get_current_admin)) -> UserOut:
    return UserOut.model_validate(admin)


@router.get("/overview", response_model=AdminOverviewOut)
def overview(
    days: int = Query(default=30, ge=7, le=90),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminOverviewOut:
    del admin
    since = utcnow() - timedelta(days=days)
    total_users = db.scalar(select(func.count(User.id))) or 0
    active_users = db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0
    new_users = db.scalar(select(func.count(User.id)).where(User.created_at >= since)) or 0

    subscription_rows = db.execute(
        select(Subscription.status, func.count(Subscription.id)).group_by(Subscription.status)
    ).all()
    plan_rows = db.execute(
        select(User.selected_package, func.count(User.id)).group_by(User.selected_package)
    ).all()
    usage_row = db.execute(
        select(
            func.coalesce(func.sum(Subscription.files_used_this_period), 0),
            func.coalesce(func.sum(Subscription.monthly_file_limit), 0),
        )
    ).one()

    build_rows = db.execute(
        select(BuildJob.status, func.count(BuildJob.id)).group_by(BuildJob.status)
    ).all()
    build_statuses = {str(key): int(value) for key, value in build_rows}
    period_builds = db.scalar(select(func.count(BuildJob.id)).where(BuildJob.created_at >= since)) or 0
    ready = build_statuses.get("ready", 0)
    failed = build_statuses.get("failed", 0)
    finished = ready + failed

    purchase_rows = db.execute(
        select(Purchase.status, func.count(Purchase.id)).group_by(Purchase.status)
    ).all()
    revenue_rows = db.execute(
        select(Purchase.currency, func.sum(Purchase.amount_minor), func.count(Purchase.id))
        .where(Purchase.status == "paid")
        .group_by(Purchase.currency)
    ).all()
    period_purchases = db.scalar(
        select(func.count(Purchase.id)).where(Purchase.purchased_at >= since)
    ) or 0

    events = db.scalars(
        select(AdminAuditEvent).order_by(AdminAuditEvent.created_at.desc()).limit(12)
    ).all()
    return AdminOverviewOut(
        generated_at=utcnow(),
        period_days=days,
        users={
            "total": int(total_users),
            "active": int(active_users),
            "disabled": int(total_users - active_users),
            "new": int(new_users),
        },
        subscriptions={
            "by_status": {str(key): int(value) for key, value in subscription_rows},
            "by_plan": {str(key): int(value) for key, value in plan_rows},
            "files_used_this_period": int(usage_row[0] or 0),
            "file_limit_total": int(usage_row[1] or 0),
        },
        builds={
            "total": sum(build_statuses.values()),
            "by_status": build_statuses,
            "period_total": int(period_builds),
            "success_rate": round((ready / finished) * 100, 1) if finished else 0.0,
        },
        purchases={
            "total": sum(int(value) for _, value in purchase_rows),
            "period_total": int(period_purchases),
            "by_status": {str(key): int(value) for key, value in purchase_rows},
            "paid_by_currency": [
                {"currency": currency, "amount_minor": int(amount or 0), "count": int(count)}
                for currency, amount, count in revenue_rows
            ],
        },
        activity=_activity(db, days=days),
        recent_audit_events=_audit_events_out(db, list(events)),
    )


@router.get("/users", response_model=AdminUserListOut)
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=255),
    status_filter: str = Query(default="all", alias="status", pattern="^(all|active|disabled)$"),
    plan: str = Query(default="all", pattern="^(all|free|lite|pro)$"),
    role: str = Query(default="all", pattern="^(all|admin|tuner)$"),
    sort: str = Query(
        default="created_at",
        pattern="^(created_at|email|display_name|company_name|builds|last_build_at)$",
    ),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserListOut:
    del admin
    project_stats = (
        select(Project.user_id.label("user_id"), func.count(Project.id).label("project_count"))
        .group_by(Project.user_id)
        .subquery()
    )
    build_stats = (
        select(
            BuildJob.user_id.label("user_id"),
            func.count(BuildJob.id).label("total_builds"),
            func.sum(case((BuildJob.status == "ready", 1), else_=0)).label("ready_builds"),
            func.sum(case((BuildJob.status == "failed", 1), else_=0)).label("failed_builds"),
            func.sum(case((BuildJob.status.notin_(("ready", "failed")), 1), else_=0)).label("processing_builds"),
            func.max(BuildJob.created_at).label("last_build_at"),
        )
        .group_by(BuildJob.user_id)
        .subquery()
    )
    purchase_stats = (
        select(Purchase.user_id.label("user_id"), func.count(Purchase.id).label("purchase_count"))
        .group_by(Purchase.user_id)
        .subquery()
    )
    query = (
        select(
            User,
            Subscription,
            func.coalesce(project_stats.c.project_count, 0),
            func.coalesce(build_stats.c.total_builds, 0),
            func.coalesce(build_stats.c.ready_builds, 0),
            func.coalesce(build_stats.c.failed_builds, 0),
            func.coalesce(build_stats.c.processing_builds, 0),
            build_stats.c.last_build_at,
            func.coalesce(purchase_stats.c.purchase_count, 0),
        )
        .outerjoin(Subscription, Subscription.user_id == User.id)
        .outerjoin(project_stats, project_stats.c.user_id == User.id)
        .outerjoin(build_stats, build_stats.c.user_id == User.id)
        .outerjoin(purchase_stats, purchase_stats.c.user_id == User.id)
    )
    count_query = select(func.count(User.id))
    filters = []
    normalized_search = search.strip()
    if normalized_search:
        filters.append(
            or_(
                func.lower(User.email).contains(normalized_search.lower(), autoescape=True),
                func.lower(User.display_name).contains(normalized_search.lower(), autoescape=True),
                func.lower(User.company_name).contains(normalized_search.lower(), autoescape=True),
            )
        )
    if status_filter == "active":
        filters.append(User.is_active.is_(True))
    elif status_filter == "disabled":
        filters.append(User.is_active.is_(False))
    if plan != "all":
        filters.append(User.selected_package == plan)
    if role != "all":
        filters.append(User.role == role)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)

    sort_column = {
        "created_at": User.created_at,
        "email": User.email,
        "display_name": User.display_name,
        "company_name": User.company_name,
        "builds": func.coalesce(build_stats.c.total_builds, 0),
        "last_build_at": build_stats.c.last_build_at,
    }[sort]
    query = query.order_by(sort_column.asc() if direction == "asc" else sort_column.desc(), User.id.asc())
    total = int(db.scalar(count_query) or 0)
    rows = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()
    row_user_ids = [row[0].id for row in rows]
    paid_by_user: dict[str, list[dict]] = defaultdict(list)
    if row_user_ids:
        paid_rows = db.execute(
            select(
                Purchase.user_id,
                Purchase.currency,
                func.sum(Purchase.amount_minor),
                func.count(Purchase.id),
            )
            .where(Purchase.user_id.in_(row_user_ids), Purchase.status == "paid")
            .group_by(Purchase.user_id, Purchase.currency)
        ).all()
        for paid_user_id, currency, amount, count in paid_rows:
            paid_by_user[paid_user_id].append(
                {"currency": currency, "amount_minor": int(amount or 0), "count": int(count)}
            )
    items = []
    for row in rows:
        user, subscription = row[0], row[1]
        stats_out = AdminUserStatsOut(
            project_count=int(row[2] or 0),
            total_builds=int(row[3] or 0),
            ready_builds=int(row[4] or 0),
            failed_builds=int(row[5] or 0),
            processing_builds=int(row[6] or 0),
            last_build_at=row[7],
            purchase_count=int(row[8] or 0),
            paid_by_currency=paid_by_user.get(user.id, []),
        )
        items.append(_user_item(db, user, subscription, stats_out))
    return AdminUserListOut(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=_pages(total, page_size),
    )


@router.post("/users", response_model=AdminUserDetailOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreateIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    email = payload.email.strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    plan_name, monthly_limit = PACKAGE_PLANS[payload.package_key]
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        company_name=payload.company_name.strip(),
        vat_number=payload.vat_number.strip(),
        phone_number=payload.phone_number.strip(),
        country=payload.country.strip(),
        selected_package=payload.package_key,
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(
        Subscription(
            user_id=user.id,
            plan_name=plan_name,
            monthly_file_limit=monthly_limit,
            period_ends_at=utcnow() + timedelta(days=30),
        )
    )
    _record_audit(
        db,
        actor=admin,
        action="user.created",
        request=request,
        target_user_id=user.id,
        details={"email": email, "role": payload.role, "package_key": payload.package_key},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    db.refresh(user)
    return _user_detail(db, user)


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user_detail(
    user_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    del admin
    return _user_detail(db, _get_user_or_404(db, user_id))


@router.get("/users/{user_id}/projects", response_model=AdminProjectListOut)
def list_user_projects(
    user_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=255),
    sort: str = Query(default="updated_at", pattern="^(updated_at|created_at|name)$"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminProjectListOut:
    del admin
    _get_user_or_404(db, user_id)

    query = select(Project).where(Project.user_id == user_id)
    count_query = select(func.count(Project.id)).where(Project.user_id == user_id)
    normalized_search = search.strip()
    if normalized_search:
        search_filter = or_(
            func.lower(Project.name).contains(normalized_search.lower(), autoescape=True),
            func.lower(Project.vehicle_label).contains(normalized_search.lower(), autoescape=True),
            func.lower(Project.ecu_label).contains(normalized_search.lower(), autoescape=True),
            func.lower(Project.source_filename).contains(normalized_search.lower(), autoescape=True),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    sort_column = {
        "updated_at": Project.updated_at,
        "created_at": Project.created_at,
        "name": Project.name,
    }[sort]
    query = query.order_by(
        sort_column.asc() if direction == "asc" else sort_column.desc(),
        Project.id.asc(),
    )
    total = int(db.scalar(count_query) or 0)
    projects = list(
        db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    )

    project_ids = [project.id for project in projects]
    build_counts: dict[str, int] = {}
    last_builds: dict[str, BuildJob] = {}
    if project_ids:
        build_counts = {
            str(project_id): int(count)
            for project_id, count in db.execute(
                select(BuildJob.project_id, func.count(BuildJob.id))
                .where(BuildJob.user_id == user_id, BuildJob.project_id.in_(project_ids))
                .group_by(BuildJob.project_id)
            ).all()
            if project_id is not None
        }
        last_build_ids = {
            project.last_build_id for project in projects if project.last_build_id
        }
        if last_build_ids:
            last_builds = {
                build.id: build
                for build in db.scalars(
                    select(BuildJob).where(
                        BuildJob.user_id == user_id,
                        BuildJob.id.in_(last_build_ids),
                    )
                ).all()
            }

    return AdminProjectListOut(
        items=[
            AdminProjectOut(
                id=project.id,
                user_id=project.user_id,
                name=project.name,
                vehicle_label=project.vehicle_label,
                ecu_label=project.ecu_label,
                source_filename=project.source_filename,
                source_sha256=project.source_sha256,
                requested_options=project.requested_options or {},
                last_build_id=project.last_build_id,
                last_build=(
                    AdminBuildSummaryOut.model_validate(last_builds[project.last_build_id])
                    if project.last_build_id in last_builds
                    else None
                ),
                build_count=build_counts.get(project.id, 0),
                created_at=project.created_at,
                updated_at=project.updated_at,
            )
            for project in projects
        ],
        total=total,
        page=page,
        page_size=page_size,
        pages=_pages(total, page_size),
    )


@router.patch("/users/{user_id}", response_model=AdminUserDetailOut)
def update_user_profile(
    user_id: str,
    payload: AdminUserUpdateIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    user = _get_user_or_404(db, user_id)
    before = {
        "email": user.email,
        "display_name": user.display_name,
        "company_name": user.company_name,
        "vat_number": user.vat_number,
        "phone_number": user.phone_number,
        "country": user.country,
        "role": user.role,
    }
    identity_changed = False
    if payload.email is not None:
        email = payload.email.strip().lower()
        duplicate = db.scalar(
            select(User.id).where(func.lower(User.email) == email, User.id != user.id)
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="An account already exists for this email")
        if email != user.email:
            user.email = email
            identity_changed = True
    for field_name in (
        "display_name",
        "company_name",
        "vat_number",
        "phone_number",
        "country",
    ):
        value = getattr(payload, field_name)
        if value is not None:
            setattr(user, field_name, value.strip())
    if payload.role is not None and payload.role != user.role:
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=409, detail="You cannot remove your own administrator role")
        if user.role == "admin" and user.is_active and payload.role != "admin":
            active_admins = db.scalar(
                select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
            ) or 0
            if active_admins <= 1:
                raise HTTPException(status_code=409, detail="The last active administrator cannot be demoted")
        user.role = payload.role
        identity_changed = True
    if identity_changed:
        user.session_version = int(user.session_version or 0) + 1

    after = {
        "email": user.email,
        "display_name": user.display_name,
        "company_name": user.company_name,
        "vat_number": user.vat_number,
        "phone_number": user.phone_number,
        "country": user.country,
        "role": user.role,
    }
    if before != after:
        _record_audit(
            db,
            actor=admin,
            action="user.profile_updated",
            request=request,
            target_user_id=user.id,
            details={"before": before, "after": after, "sessions_revoked": identity_changed},
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="An account already exists for this email")
        db.refresh(user)
    return _user_detail(db, user)


@router.patch("/users/{user_id}/status", response_model=AdminUserDetailOut)
def set_user_status(
    user_id: str,
    payload: AdminUserStatusIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    user = _get_user_or_404(db, user_id)
    if user.id == admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="You cannot disable your own administrator account")
    previous = bool(user.is_active)
    if previous != payload.is_active:
        user.is_active = payload.is_active
        user.session_version = int(user.session_version or 0) + 1
        _record_audit(
            db,
            actor=admin,
            action="user.enabled" if payload.is_active else "user.disabled",
            request=request,
            target_user_id=user.id,
            details={"previous_is_active": previous, "is_active": payload.is_active},
        )
        db.commit()
        db.refresh(user)
    return _user_detail(db, user)


@router.post("/users/{user_id}/password-reset", response_model=AdminPasswordResetOut)
def reset_user_password(
    user_id: str,
    payload: AdminPasswordResetIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminPasswordResetOut:
    user = _get_user_or_404(db, user_id)
    temporary_password = payload.temporary_password or secrets.token_urlsafe(18)
    user.password_hash = hash_password(temporary_password)
    user.session_version = int(user.session_version or 0) + 1
    _record_audit(
        db,
        actor=admin,
        action="user.password_reset",
        request=request,
        target_user_id=user.id,
        details={"sessions_revoked": True},
    )
    db.commit()
    return AdminPasswordResetOut(
        user_id=user.id,
        temporary_password=temporary_password,
        session_version=user.session_version,
        message="Password reset. Existing sessions have been revoked; show this password only once.",
    )


@router.patch("/users/{user_id}/subscription", response_model=AdminSubscriptionOut)
def update_user_subscription(
    user_id: str,
    payload: AdminSubscriptionUpdateIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminSubscriptionOut:
    user = _get_user_or_404(db, user_id)
    subscription = db.scalar(select(Subscription).where(Subscription.user_id == user.id))
    created_subscription = subscription is None
    if subscription is None:
        plan_key = payload.package_key or user.selected_package or "free"
        plan_name, monthly_limit = PACKAGE_PLANS.get(plan_key, PACKAGE_PLANS["free"])
        period_started_at = utcnow()
        subscription = Subscription(
            user_id=user.id,
            plan_name=plan_name,
            monthly_file_limit=monthly_limit,
            files_used_this_period=0,
            period_started_at=period_started_at,
            period_ends_at=period_started_at + timedelta(days=30),
            status="active",
        )
        db.add(subscription)

    before = {
        "package_key": user.selected_package,
        "plan_name": subscription.plan_name,
        "monthly_file_limit": subscription.monthly_file_limit,
        "files_used_this_period": subscription.files_used_this_period,
        "status": subscription.status,
        "period_started_at": subscription.period_started_at.isoformat(),
        "period_ends_at": subscription.period_ends_at.isoformat(),
    }
    if payload.package_key is not None:
        user.selected_package = payload.package_key
        subscription.plan_name, subscription.monthly_file_limit = PACKAGE_PLANS[payload.package_key]
    if payload.plan_name is not None:
        subscription.plan_name = payload.plan_name.strip()
    if payload.monthly_file_limit is not None:
        subscription.monthly_file_limit = payload.monthly_file_limit
    if payload.period_started_at is not None:
        subscription.period_started_at = payload.period_started_at
    if payload.period_ends_at is not None:
        subscription.period_ends_at = payload.period_ends_at
    if as_utc(subscription.period_ends_at) <= as_utc(subscription.period_started_at):
        raise HTTPException(status_code=422, detail="period_ends_at must be after period_started_at")
    if payload.status is not None:
        subscription.status = payload.status

    after = {
        "package_key": user.selected_package,
        "plan_name": subscription.plan_name,
        "monthly_file_limit": subscription.monthly_file_limit,
        "files_used_this_period": subscription.files_used_this_period,
        "status": subscription.status,
        "period_started_at": subscription.period_started_at.isoformat(),
        "period_ends_at": subscription.period_ends_at.isoformat(),
    }
    if created_subscription or before != after:
        _record_audit(
            db,
            actor=admin,
            action="subscription.created" if created_subscription else "subscription.updated",
            request=request,
            target_user_id=user.id,
            details={"before": before, "after": after},
        )
        db.commit()
        db.refresh(subscription)
    return AdminSubscriptionOut.model_validate(subscription)


@router.get("/subscriptions", response_model=AdminSubscriptionListOut)
def list_subscriptions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=255),
    plan: str = Query(default="all", pattern="^(all|free|lite|pro)$"),
    status_filter: str = Query(
        default="all",
        alias="status",
        pattern="^(all|active|inactive|past_due|cancelled)$",
    ),
    sort: str = Query(default="period_ends_at", pattern="^(period_ends_at|usage|email|plan)$"),
    direction: str = Query(default="asc", pattern="^(asc|desc)$"),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminSubscriptionListOut:
    del admin
    query = select(Subscription, User).join(User, User.id == Subscription.user_id)
    count_query = select(func.count(Subscription.id)).join(User, User.id == Subscription.user_id)
    filters = []
    if search.strip():
        term = search.strip()
        filters.append(
            or_(
                func.lower(User.email).contains(term.lower(), autoescape=True),
                func.lower(User.display_name).contains(term.lower(), autoescape=True),
                func.lower(User.company_name).contains(term.lower(), autoescape=True),
            )
        )
    if plan != "all":
        filters.append(User.selected_package == plan)
    if status_filter != "all":
        filters.append(Subscription.status == status_filter)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    usage_expression = case(
        (Subscription.monthly_file_limit > 0, Subscription.files_used_this_period * 1.0 / Subscription.monthly_file_limit),
        else_=0.0,
    )
    sort_column = {
        "period_ends_at": Subscription.period_ends_at,
        "usage": usage_expression,
        "email": User.email,
        "plan": Subscription.plan_name,
    }[sort]
    query = query.order_by(sort_column.asc() if direction == "asc" else sort_column.desc(), Subscription.id.asc())
    total = int(db.scalar(count_query) or 0)
    rows = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    for subscription, user in rows:
        usage_percent = (
            (subscription.files_used_this_period / subscription.monthly_file_limit) * 100
            if subscription.monthly_file_limit > 0
            else 0.0
        )
        items.append(
            AdminSubscriptionListItemOut(
                **AdminSubscriptionOut.model_validate(subscription).model_dump(),
                user=_user_summary(user),
                is_active=user.is_active,
                selected_package=user.selected_package,
                usage_percent=round(usage_percent, 1),
            )
        )
    return AdminSubscriptionListOut(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=_pages(total, page_size),
    )


@router.get("/purchases", response_model=AdminPurchaseListOut)
def list_purchases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=255),
    user_id: str | None = None,
    status_filter: str = Query(default="all", alias="status", pattern="^(all|pending|paid|refunded|void)$"),
    provider: str = Query(default="", max_length=40),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = Query(default="purchased_at", pattern="^(purchased_at|created_at|amount)$"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminPurchaseListOut:
    del admin
    query = select(Purchase, User).join(User, User.id == Purchase.user_id)
    count_query = select(func.count(Purchase.id)).join(User, User.id == Purchase.user_id)
    filters = []
    if search.strip():
        term = search.strip()
        filters.append(
            or_(
                func.lower(User.email).contains(term.lower(), autoescape=True),
                func.lower(User.company_name).contains(term.lower(), autoescape=True),
                func.lower(Purchase.description).contains(term.lower(), autoescape=True),
                func.lower(Purchase.receipt_number).contains(term.lower(), autoescape=True),
                func.lower(Purchase.external_reference).contains(term.lower(), autoescape=True),
            )
        )
    if user_id:
        filters.append(Purchase.user_id == user_id)
    if status_filter != "all":
        filters.append(Purchase.status == status_filter)
    if provider.strip():
        filters.append(Purchase.provider == provider.strip().lower())
    if date_from is not None:
        filters.append(Purchase.purchased_at >= date_from)
    if date_to is not None:
        filters.append(Purchase.purchased_at <= date_to)
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    sort_column = {
        "purchased_at": Purchase.purchased_at,
        "created_at": Purchase.created_at,
        "amount": Purchase.amount_minor,
    }[sort]
    query = query.order_by(sort_column.asc() if direction == "asc" else sort_column.desc(), Purchase.id.asc())
    total = int(db.scalar(count_query) or 0)
    rows = db.execute(query.offset((page - 1) * page_size).limit(page_size)).all()
    return AdminPurchaseListOut(
        items=[_purchase_out(db, purchase, user) for purchase, user in rows],
        total=total,
        page=page,
        page_size=page_size,
        pages=_pages(total, page_size),
    )


@router.post("/purchases", response_model=AdminPurchaseOut, status_code=status.HTTP_201_CREATED)
def create_purchase(
    payload: AdminPurchaseCreateIn,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminPurchaseOut:
    user = _get_user_or_404(db, payload.user_id)
    existing = None
    if payload.idempotency_key:
        existing = db.scalar(select(Purchase).where(Purchase.idempotency_key == payload.idempotency_key))
    if existing is None and payload.external_reference:
        existing = db.scalar(
            select(Purchase).where(
                Purchase.provider == payload.provider,
                Purchase.external_reference == payload.external_reference,
            )
        )
    if existing:
        if not _purchase_matches_payload(existing, payload):
            raise HTTPException(status_code=409, detail="Idempotency key or provider reference is already used")
        return _purchase_out(db, existing)

    purchase = Purchase(
        user_id=user.id,
        provider=payload.provider,
        external_reference=payload.external_reference,
        idempotency_key=payload.idempotency_key,
        receipt_number=f"APX-{utcnow():%Y%m%d}-{uuid.uuid4().hex[:10].upper()}",
        description=payload.description.strip(),
        amount_minor=payload.amount_minor,
        currency=payload.currency,
        status=payload.status,
        notes=payload.notes.strip(),
        purchased_at=payload.purchased_at or utcnow(),
        created_by_user_id=admin.id,
    )
    db.add(purchase)
    try:
        db.flush()
        _record_audit(
            db,
            actor=admin,
            action="purchase.created",
            request=request,
            target_user_id=user.id,
            details={
                "purchase_id": purchase.id,
                "receipt_number": purchase.receipt_number,
                "amount_minor": purchase.amount_minor,
                "currency": purchase.currency,
                "provider": purchase.provider,
                "external_reference": purchase.external_reference,
                "status": purchase.status,
            },
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        duplicate = None
        if payload.idempotency_key:
            duplicate = db.scalar(select(Purchase).where(Purchase.idempotency_key == payload.idempotency_key))
        if duplicate is None and payload.external_reference:
            duplicate = db.scalar(
                select(Purchase).where(
                    Purchase.provider == payload.provider,
                    Purchase.external_reference == payload.external_reference,
                )
            )
        if duplicate and _purchase_matches_payload(duplicate, payload):
            return _purchase_out(db, duplicate)
        raise HTTPException(status_code=409, detail="Purchase reference already exists")
    db.refresh(purchase)
    return _purchase_out(db, purchase, user)


@router.get("/purchases/{purchase_id}", response_model=AdminPurchaseOut)
def get_purchase(
    purchase_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminPurchaseOut:
    del admin
    return _purchase_out(db, _get_purchase_or_404(db, purchase_id))


@router.get("/purchases/{purchase_id}/receipt", response_class=HTMLResponse)
def purchase_receipt(
    purchase_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    del admin
    purchase = _get_purchase_or_404(db, purchase_id)
    user = _get_user_or_404(db, purchase.user_id)

    def safe(value: object) -> str:
        return html.escape(str(value or ""), quote=True)

    amount = f"{purchase.amount_minor / 100:,.2f} {safe(purchase.currency)}"
    buyer_lines = [user.company_name, user.display_name, user.email, user.vat_number, user.country]
    buyer = "<br>".join(safe(value) for value in buyer_lines if value)
    reference = safe(purchase.external_reference or "—")
    receipt_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment record {safe(purchase.receipt_number)}</title>
  <style>
    :root {{ color-scheme: light; }}
    body {{ margin: 0; background: #f1f3f5; color: #151719; font: 14px/1.5 Arial, sans-serif; }}
    main {{ box-sizing: border-box; width: min(800px, calc(100% - 32px)); margin: 32px auto; padding: 48px; background: white; }}
    header {{ display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #ff8700; padding-bottom: 24px; }}
    h1 {{ margin: 0; font-size: 30px; }} h2 {{ margin: 32px 0 8px; font-size: 13px; text-transform: uppercase; color: #687078; }}
    .muted {{ color: #687078; }} .right {{ text-align: right; }}
    table {{ width: 100%; margin-top: 28px; border-collapse: collapse; }} th, td {{ padding: 12px 8px; border-bottom: 1px solid #dfe3e6; text-align: left; }}
    th:last-child, td:last-child {{ text-align: right; }} .total {{ font-size: 20px; font-weight: bold; }}
    footer {{ margin-top: 48px; color: #687078; font-size: 12px; }}
    @media print {{ body {{ background: white; }} main {{ width: 100%; margin: 0; padding: 20mm; }} }}
  </style>
</head>
<body><main>
  <header><div><h1>Apex Files</h1><div class="muted">{'Manual payment record' if purchase.provider == 'manual' else 'Payment record'}</div></div>
    <div class="right"><strong>{safe(purchase.receipt_number)}</strong><br>{safe(purchase.purchased_at.strftime('%Y-%m-%d %H:%M UTC'))}<br>Status: {safe(purchase.status.upper())}</div></header>
  <h2>Customer</h2><div>{buyer}</div>
  <table><thead><tr><th>Description</th><th>Reference</th><th>Amount</th></tr></thead>
    <tbody><tr><td>{safe(purchase.description)}</td><td>{reference}</td><td>{amount}</td></tr>
    <tr><td colspan="2" class="right total">Total</td><td class="total">{amount}</td></tr></tbody></table>
  <footer>Recorded through {safe(purchase.provider)}. This document only reflects transaction data registered in Apex Files and does not replace an official receipt or tax invoice issued by the payment provider or supplier.</footer>
</main></body></html>"""
    return HTMLResponse(
        receipt_html,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="receipt-{purchase.receipt_number}.html"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
        },
    )


@router.get("/audit-events", response_model=AdminAuditEventListOut)
def list_audit_events(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user_id: str | None = None,
    action: str = Query(default="", max_length=80),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminAuditEventListOut:
    del admin
    query = select(AdminAuditEvent)
    count_query = select(func.count(AdminAuditEvent.id))
    filters = []
    if user_id:
        filters.append(
            or_(
                AdminAuditEvent.actor_user_id == user_id,
                AdminAuditEvent.target_user_id == user_id,
            )
        )
    if action.strip():
        filters.append(AdminAuditEvent.action == action.strip())
    if filters:
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    query = query.order_by(AdminAuditEvent.created_at.desc(), AdminAuditEvent.id.desc())
    total = int(db.scalar(count_query) or 0)
    events = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return AdminAuditEventListOut(
        items=_audit_events_out(db, list(events)),
        total=total,
        page=page,
        page_size=page_size,
        pages=_pages(total, page_size),
    )
