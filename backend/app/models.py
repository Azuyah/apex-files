from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(160), default="")
    company_name: Mapped[str] = mapped_column(String(180), default="")
    vat_number: Mapped[str] = mapped_column(String(80), default="")
    phone_number: Mapped[str] = mapped_column(String(80), default="")
    country: Mapped[str] = mapped_column(String(120), default="")
    selected_package: Mapped[str] = mapped_column(String(40), default="free")
    role: Mapped[str] = mapped_column(String(40), default="tuner")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    session_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    subscription: Mapped["Subscription"] = relationship(back_populates="user", uselist=False, cascade="all,delete-orphan")
    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all,delete-orphan")
    build_jobs: Mapped[list["BuildJob"]] = relationship(back_populates="user", cascade="all,delete-orphan")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    plan_name: Mapped[str] = mapped_column(String(120), default="Apex Lite")
    monthly_file_limit: Mapped[int] = mapped_column(Integer, default=20)
    files_used_this_period: Mapped[int] = mapped_column(Integer, default=0)
    period_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    period_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(40), default="active")

    user: Mapped[User] = relationship(back_populates="subscription")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(180))
    vehicle_label: Mapped[str] = mapped_column(String(255), default="")
    ecu_label: Mapped[str] = mapped_column(String(255), default="")
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    source_sha256: Mapped[str] = mapped_column(String(64), default="")
    requested_options: Mapped[dict] = mapped_column(JSON, default=dict)
    last_build_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("build_jobs.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="projects", foreign_keys=[user_id])
    last_build: Mapped["BuildJob | None"] = relationship(foreign_keys=[last_build_id], post_update=True)


class BuildJob(Base):
    __tablename__ = "build_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    source_filename: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    source_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    vehicle_label: Mapped[str] = mapped_column(String(255), default="")
    ecu_label: Mapped[str] = mapped_column(String(255), default="")
    base_tune: Mapped[str] = mapped_column(String(80), default="STAGE1")
    requested_options: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(40), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_stage: Mapped[str] = mapped_column(String(120), default="Queued")
    strategy: Mapped[str | None] = mapped_column(String(120), nullable=True)
    result_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revtech_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="build_jobs")


class BuildScan(Base):
    __tablename__ = "build_scans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_filename: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    source_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(40), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_stage: Mapped[str] = mapped_column(String(120), default="Queued")
    result_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class FileDeliveryCache(Base):
    __tablename__ = "file_delivery_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    option_signature: Mapped[str] = mapped_column(String(255), index=True)
    base_tune: Mapped[str] = mapped_column(String(80), default="")
    addon_keys: Mapped[list] = mapped_column(JSON, default=list)
    strategy: Mapped[str] = mapped_column(String(120), default="cached")
    result_filename: Mapped[str] = mapped_column(String(255))
    result_path: Mapped[str] = mapped_column(Text)
    result_sha256: Mapped[str] = mapped_column(String(64), index=True)
    result_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    revtech_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (
        UniqueConstraint("provider", "external_reference", name="uq_purchases_provider_reference"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40), default="manual")
    external_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    receipt_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    status: Mapped[str] = mapped_column(String(40), default="paid")
    notes: Mapped[str] = mapped_column(Text, default="")
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AdminAuditEvent(Base):
    __tablename__ = "admin_audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(80), index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
