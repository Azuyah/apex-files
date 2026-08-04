from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class AuthRegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)
    display_name: str = ""
    company_name: str = ""
    vat_number: str = ""
    phone_number: str = ""
    country: str = ""
    package_key: Literal["free", "lite", "pro"] = "free"


class AuthLoginIn(BaseModel):
    email: str = Field(min_length=1)
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    company_name: str
    vat_number: str
    phone_number: str
    country: str
    selected_package: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthOut(BaseModel):
    token: str
    user: UserOut


class SubscriptionOut(BaseModel):
    plan_name: str
    monthly_file_limit: int
    files_used_this_period: int
    period_started_at: datetime
    period_ends_at: datetime
    status: str

    model_config = {"from_attributes": True}


class ProjectCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    vehicle_label: str = ""
    ecu_label: str = ""
    source_filename: str = ""
    source_sha256: str = ""
    requested_options: dict[str, Any] = Field(default_factory=dict)


class ProjectUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    vehicle_label: str | None = None
    ecu_label: str | None = None
    source_filename: str | None = None
    requested_options: dict[str, Any] | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    vehicle_label: str
    ecu_label: str
    source_filename: str
    source_sha256: str
    requested_options: dict[str, Any]
    last_build_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BuildJobOut(BaseModel):
    id: str
    project_id: str | None
    source_filename: str
    source_sha256: str
    source_size_bytes: int
    vehicle_label: str
    ecu_label: str
    base_tune: str
    requested_options: dict[str, Any]
    status: Literal["queued", "scanning", "building", "ready", "failed"] | str
    progress: int
    current_stage: str
    strategy: str | None
    result_filename: str | None
    result_sha256: str | None
    revtech_payload: dict[str, Any] | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BuildJobListOut(BaseModel):
    items: list[BuildJobOut]


class BuildMatchOut(BaseModel):
    matched: bool
    message: str
    source_filename: str
    source_sha256: str
    source_size_bytes: int
    project_name: str = ""
    vehicle_label: str = ""
    ecu_label: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    base_tunes: list[str] = Field(default_factory=list)
    addon_keys: list[str] = Field(default_factory=list)
    stage_gains: dict[str, dict[str, Any]] = Field(default_factory=dict)


class BuildScanOut(BaseModel):
    id: str
    source_filename: str
    source_sha256: str
    source_size_bytes: int
    status: Literal["queued", "scanning", "ready", "failed"] | str
    progress: int
    current_stage: str
    result_payload: dict[str, Any] | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BridgeStatusOut(BaseModel):
    mode: str
    configured: bool
    revtech_api_base_url: str
    health: dict[str, Any] | None = None
    message: str | None = None
