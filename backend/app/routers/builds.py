from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import BuildJob, Project, Subscription, User, as_utc, utcnow
from ..schemas import BuildJobListOut, BuildJobOut, BuildMatchOut
from ..services.build_pipeline import build_match_offer, customer_safe_error, normalize_filename_part, process_build_job, sha256_file
from ..services.revtech_client import RevtechClient
from ..settings import get_settings

router = APIRouter(prefix="/builds", tags=["builds"])

ALLOWED_BASE_TUNES = {"STAGE1", "STAGE2", "CUSTOM", "ECO", "TCU", ""}
ALLOWED_ADDONS = {
    "EGR_OFF",
    "DPF_OFF",
    "GPF_OPF_OFF",
    "DECAT",
    "SWIRL_FLAPS_OFF",
    "ADBLUE_OFF",
    "DTC_REMOVE",
    "MAF_OFF",
    "LAMBDA_OFF",
    "NOX_OFF",
    "START_STOP_OFF",
    "TORQUE_MONITORING_OFF",
    "HOT_START_FIX",
    "POPS_BANGS",
    "VMAX",
}


def parse_addon_keys(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except Exception:
        parsed = [part.strip() for part in value.split(",")]
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="addon_keys must be a JSON array")
    clean = []
    for item in parsed:
        key = str(item or "").strip().upper()
        if not key:
            continue
        if key not in ALLOWED_ADDONS:
            raise HTTPException(status_code=400, detail=f"Unsupported add-on option: {key}")
        if key not in clean:
            clean.append(key)
    return clean


def ensure_subscription_available(subscription: Subscription | None) -> None:
    if not subscription:
        raise HTTPException(status_code=402, detail="No active subscription is attached to this account")
    now = utcnow()
    if as_utc(subscription.period_ends_at) <= now:
        subscription.period_started_at = now
        subscription.period_ends_at = now + timedelta(days=30)
        subscription.files_used_this_period = 0
    if subscription.status != "active":
        raise HTTPException(status_code=402, detail="Your subscription is not active")
    if subscription.files_used_this_period >= subscription.monthly_file_limit:
        raise HTTPException(status_code=402, detail="Monthly file limit reached for your current package")


async def run_job(job_id: str) -> None:
    await process_build_job(job_id)


@router.post("/match", response_model=BuildMatchOut)
async def match_build_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildMatchOut:
    subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    ensure_subscription_available(subscription)
    db.add(subscription)
    db.commit()

    settings = get_settings()
    match_root = settings.storage_path / "matches" / user.id
    match_root.mkdir(parents=True, exist_ok=True)

    source_name = normalize_filename_part(file.filename or "customer-file.bin")
    source_path = match_root / f"{uuid.uuid4()}-{source_name}"
    try:
        with source_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        source_size = source_path.stat().st_size
        if source_size < 16:
            raise HTTPException(status_code=400, detail="File is too small to process")

        source_sha = sha256_file(source_path)
        match_payload = await RevtechClient(settings).match_bin(source_path, max_matches=50)
        return BuildMatchOut.model_validate(
            build_match_offer(
                match_payload,
                source_filename=source_name,
                source_sha256=source_sha,
                source_size_bytes=source_size,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=customer_safe_error(exc)) from exc
    finally:
        source_path.unlink(missing_ok=True)


@router.get("", response_model=BuildJobListOut)
def list_builds(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildJobListOut:
    rows = (
        db.query(BuildJob)
        .filter(BuildJob.user_id == user.id)
        .order_by(desc(BuildJob.created_at))
        .limit(100)
        .all()
    )
    return BuildJobListOut(items=[BuildJobOut.model_validate(row) for row in rows])


@router.get("/{job_id}", response_model=BuildJobOut)
def get_build(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildJobOut:
    row = db.get(BuildJob, job_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build job not found")
    return BuildJobOut.model_validate(row)


@router.post("", response_model=BuildJobOut)
async def create_build(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    base_tune: str = Form("STAGE1"),
    addon_keys: str | None = Form(None),
    vehicle_label: str = Form(""),
    ecu_label: str = Form(""),
    project_id: str | None = Form(None),
    save_project: bool = Form(False),
    project_name: str = Form(""),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildJobOut:
    base_key = str(base_tune or "").strip().upper()
    if base_key not in ALLOWED_BASE_TUNES:
        raise HTTPException(status_code=400, detail=f"Unsupported base tune: {base_key}")
    addons = parse_addon_keys(addon_keys)

    subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    ensure_subscription_available(subscription)
    db.add(subscription)
    db.commit()

    settings = get_settings()
    upload_root = settings.storage_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)

    source_name = normalize_filename_part(file.filename or "customer-file.bin")
    job = BuildJob(
        user_id=user.id,
        project_id=project_id or None,
        source_filename=source_name,
        source_path="pending",
        source_sha256="",
        source_size_bytes=0,
        vehicle_label=vehicle_label.strip(),
        ecu_label=ecu_label.strip(),
        base_tune=base_key or "STAGE1",
        requested_options={"addon_keys": addons},
    )
    db.add(job)
    db.flush()

    job_dir = upload_root / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    source_path = job_dir / source_name
    with source_path.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            handle.write(chunk)

    if source_path.stat().st_size < 16:
        raise HTTPException(status_code=400, detail="File is too small to process")

    job.source_path = str(source_path)
    job.source_size_bytes = source_path.stat().st_size
    job.source_sha256 = sha256_file(source_path)

    project: Project | None = None
    if project_id:
        project = db.get(Project, project_id)
        if not project or project.user_id != user.id:
            raise HTTPException(status_code=404, detail="Project not found")
    elif save_project:
        project = Project(
            user_id=user.id,
            name=(project_name or source_name).strip()[:180],
            vehicle_label=vehicle_label.strip(),
            ecu_label=ecu_label.strip(),
            source_filename=source_name,
            source_sha256=job.source_sha256,
            requested_options={"base_tune": job.base_tune, "addon_keys": addons},
        )
        db.add(project)
        db.flush()
        job.project_id = project.id

    db.add(job)
    db.commit()
    db.refresh(job)

    if project:
        project.last_build_id = job.id
        db.add(project)
        db.commit()

    background_tasks.add_task(run_job, job.id)
    return BuildJobOut.model_validate(job)


@router.get("/{job_id}/download")
def download_build_result(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    row = db.get(BuildJob, job_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build job not found")
    if row.status != "ready" or not row.result_path:
        raise HTTPException(status_code=409, detail="Build result is not ready")
    path = Path(row.result_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Build result file is missing")
    return FileResponse(path, filename=row.result_filename or path.name, media_type="application/octet-stream")
