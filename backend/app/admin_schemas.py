from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


PackageKey = Literal["free", "lite", "pro"]
PurchaseStatus = Literal["pending", "paid", "refunded", "void"]
SubscriptionStatus = Literal["active", "inactive", "past_due", "cancelled"]


class AdminSubscriptionOut(BaseModel):
    id: str
    user_id: str
    plan_name: str
    monthly_file_limit: int
    files_used_this_period: int
    period_started_at: datetime
    period_ends_at: datetime
    status: str

    model_config = {"from_attributes": True}


class AdminUserStatsOut(BaseModel):
    project_count: int = 0
    total_builds: int = 0
    ready_builds: int = 0
    failed_builds: int = 0
    processing_builds: int = 0
    last_build_at: datetime | None = None
    purchase_count: int = 0
    paid_by_currency: list[dict] = Field(default_factory=list)


class AdminUserListItemOut(BaseModel):
    id: str
    email: str
    display_name: str
    company_name: str
    vat_number: str
    phone_number: str
    country: str
    selected_package: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    subscription: AdminSubscriptionOut | None = None
    stats: AdminUserStatsOut = Field(default_factory=AdminUserStatsOut)


class AdminBuildSummaryOut(BaseModel):
    id: str
    project_id: str | None
    source_filename: str
    source_size_bytes: int
    vehicle_label: str
    ecu_label: str
    base_tune: str
    requested_options: dict
    status: str
    progress: int
    current_stage: str
    strategy: str | None
    result_filename: str | None
    result_sha256: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminAuditEventOut(BaseModel):
    id: str
    action: str
    actor_user_id: str | None
    actor_email: str | None = None
    target_user_id: str | None
    target_email: str | None = None
    details: dict = Field(default_factory=dict)
    ip_address: str
    created_at: datetime


class AdminPurchaseUserOut(BaseModel):
    id: str
    email: str
    display_name: str
    company_name: str


class AdminPurchaseOut(BaseModel):
    id: str
    user_id: str
    user: AdminPurchaseUserOut
    provider: str
    external_reference: str | None
    idempotency_key: str | None
    receipt_number: str
    description: str
    amount_minor: int
    currency: str
    status: str
    notes: str
    purchased_at: datetime
    created_by_user_id: str | None
    created_at: datetime
    updated_at: datetime
    receipt_url: str


class AdminUserDetailOut(AdminUserListItemOut):
    recent_builds: list[AdminBuildSummaryOut] = Field(default_factory=list)
    recent_purchases: list[AdminPurchaseOut] = Field(default_factory=list)
    recent_audit_events: list[AdminAuditEventOut] = Field(default_factory=list)
    activity: list[dict] = Field(default_factory=list)


class AdminUserListOut(BaseModel):
    items: list[AdminUserListItemOut]
    total: int
    page: int
    page_size: int
    pages: int


class AdminSubscriptionListItemOut(AdminSubscriptionOut):
    user: AdminPurchaseUserOut
    is_active: bool
    selected_package: str
    usage_percent: float


class AdminSubscriptionListOut(BaseModel):
    items: list[AdminSubscriptionListItemOut]
    total: int
    page: int
    page_size: int
    pages: int


class AdminPurchaseListOut(BaseModel):
    items: list[AdminPurchaseOut]
    total: int
    page: int
    page_size: int
    pages: int


class AdminAuditEventListOut(BaseModel):
    items: list[AdminAuditEventOut]
    total: int
    page: int
    page_size: int
    pages: int


class AdminUserCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    display_name: str = Field(default="", max_length=160)
    company_name: str = Field(default="", max_length=180)
    vat_number: str = Field(default="", max_length=80)
    phone_number: str = Field(default="", max_length=80)
    country: str = Field(default="", max_length=120)
    role: Literal["tuner", "admin"] = "tuner"
    package_key: PackageKey = "free"


class AdminUserUpdateIn(BaseModel):
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=160)
    company_name: str | None = Field(default=None, max_length=180)
    vat_number: str | None = Field(default=None, max_length=80)
    phone_number: str | None = Field(default=None, max_length=80)
    country: str | None = Field(default=None, max_length=120)
    role: Literal["tuner", "admin"] | None = None


class AdminUserStatusIn(BaseModel):
    is_active: bool


class AdminPasswordResetIn(BaseModel):
    temporary_password: str | None = Field(default=None, min_length=10, max_length=256)

    @field_validator("temporary_password")
    @classmethod
    def validate_temporary_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("temporary_password must contain at least 10 non-whitespace characters")
        return cleaned


class AdminPasswordResetOut(BaseModel):
    user_id: str
    temporary_password: str
    session_version: int
    message: str


class AdminSubscriptionUpdateIn(BaseModel):
    package_key: PackageKey | None = None
    plan_name: str | None = Field(default=None, min_length=1, max_length=120)
    monthly_file_limit: int | None = Field(default=None, ge=0, le=1_000_000)
    files_used_this_period: int | None = Field(default=None, ge=0, le=1_000_000)
    period_started_at: datetime | None = None
    period_ends_at: datetime | None = None
    status: SubscriptionStatus | None = None

    @model_validator(mode="after")
    def validate_period(self):
        if self.period_started_at is not None and self.period_ends_at is not None:
            started = self.period_started_at
            ended = self.period_ends_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if ended.tzinfo is None:
                ended = ended.replace(tzinfo=timezone.utc)
            if ended <= started:
                raise ValueError("period_ends_at must be after period_started_at")
        return self


class AdminPurchaseCreateIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=36)
    amount_minor: int = Field(ge=0, le=2_147_483_647)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    description: str = Field(min_length=1, max_length=255)
    provider: str = Field(default="manual", min_length=1, max_length=40)
    external_reference: str | None = Field(default=None, min_length=1, max_length=255)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=255)
    status: PurchaseStatus = "paid"
    purchased_at: datetime | None = None
    notes: str = Field(default="", max_length=4000)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        currency = value.strip().upper()
        if not currency.isalpha():
            raise ValueError("currency must be a three-letter ISO code")
        return currency

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("external_reference", "idempotency_key")
    @classmethod
    def normalize_optional_identifier(cls, value: str | None) -> str | None:
        return value.strip() if value else None


class AdminOverviewOut(BaseModel):
    generated_at: datetime
    period_days: int
    users: dict
    subscriptions: dict
    builds: dict
    purchases: dict
    activity: list[dict]
    recent_audit_events: list[AdminAuditEventOut]
