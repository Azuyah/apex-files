from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
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
    role: Mapped[str] = mapped_column(String(40), default="tuner")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    subscription: Mapped["Subscription"] = relationship(back_populates="user", uselist=False, cascade="all,delete-orphan")
    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all,delete-orphan")
    build_jobs: Mapped[list["BuildJob"]] = relationship(back_populates="user", cascade="all,delete-orphan")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    plan_name: Mapped[str] = mapped_column(String(120), default="Apex Launch")
    monthly_file_limit: Mapped[int] = mapped_column(Integer, default=25)
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
