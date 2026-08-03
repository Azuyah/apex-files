from __future__ import annotations

import asyncio
import json
import logging
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
from ..models import BuildJob, BuildScan, Project, Subscription, User, as_utc, utcnow
from ..schemas import BuildJobListOut, BuildJobOut, BuildMatchOut, BuildScanOut, ProjectOut
from ..services.build_pipeline import build_match_offer, customer_result_filename, customer_safe_error, normalize_filename_part, process_build_job, process_build_scan, sha256_file
from ..services.revtech_client import RevtechClient
from ..settings import get_settings

router = APIRouter(prefix="/builds", tags=["builds"])
logger = logging.getLogger(__name__)

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


def parse_base_tune(value: str | None) -> str:
    base_key = str(value or "").strip().upper()
    if base_key not in ALLOWED_BASE_TUNES:
        raise HTTPException(status_code=400, detail=f"Unsupported base tune: {base_key}")
    return base_key


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


def build_job_display_filename(row: BuildJob) -> str | None:
    if row.status != "ready":
        return row.result_filename
    addon_keys = list((row.requested_options or {}).get("addon_keys") or [])
    payload = row.revtech_payload or {}
    offer = payload.get("apex_offer") if isinstance(payload.get("apex_offer"), dict) else None
    if offer is None:
        cache_payload = payload.get("cache") if isinstance(payload.get("cache"), dict) else {}
        offer = cache_payload.get("apex_offer") if isinstance(cache_payload.get("apex_offer"), dict) else None
    fallback = row.result_filename or (Path(row.result_path).name if row.result_path else row.source_filename)
    return customer_result_filename(
        source_filename=row.source_filename,
        base_key=row.base_tune,
        addon_keys=addon_keys,
        offer=offer,
        fallback_filename=fallback,
    )


def build_job_out(row: BuildJob) -> BuildJobOut:
    output = BuildJobOut.model_validate(row)
    output.result_filename = build_job_display_filename(row)
    return output


async def run_job(job_id: str) -> None:
    await process_build_job(job_id)


async def run_scan(scan_id: str) -> None:
    await process_build_scan(scan_id)


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
        revtech = RevtechClient(settings)
        match_payload = await revtech.match_bin(source_path, max_matches=50, exact_only=False)
        offer = build_match_offer(
            match_payload,
            source_filename=source_name,
            source_sha256=source_sha,
            source_size_bytes=source_size,
        )
        if offer.get("matched"):
            try:
                offer["stage_gains"] = await revtech.vehicle_stage_gains(offer.get("metadata") or {})
            except Exception:
                logger.exception("Could not resolve Revtech vehicle gains for Apex match")
                offer["stage_gains"] = {}
        return BuildMatchOut.model_validate(offer)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=customer_safe_error(exc)) from exc
    finally:
        source_path.unlink(missing_ok=True)


@router.post("/scan", response_model=BuildScanOut)
async def scan_build_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildScanOut:
    subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    ensure_subscription_available(subscription)
    db.add(subscription)
    db.commit()

    settings = get_settings()
    scan_root = settings.storage_path / "scans" / user.id
    scan_root.mkdir(parents=True, exist_ok=True)

    source_name = normalize_filename_part(file.filename or "customer-file.bin")
    source_path = scan_root / f"{uuid.uuid4()}-{source_name}"
    with source_path.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            handle.write(chunk)

    source_size = source_path.stat().st_size
    if source_size < 16:
        source_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="File is too small to process")

    scan = BuildScan(
        user_id=user.id,
        source_filename=source_name,
        source_path=str(source_path),
        source_sha256=sha256_file(source_path),
        source_size_bytes=source_size,
        status="queued",
        progress=1,
        current_stage="Queued",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    background_tasks.add_task(run_scan, scan.id)
    return BuildScanOut.model_validate(scan)


@router.get("/scans/{scan_id}", response_model=BuildScanOut)
def get_build_scan(
    scan_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildScanOut:
    scan = db.get(BuildScan, scan_id)
    if not scan or scan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build scan not found")
    return BuildScanOut.model_validate(scan)


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
    return BuildJobListOut(items=[build_job_out(row) for row in rows])


@router.get("/{job_id}", response_model=BuildJobOut)
def get_build(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildJobOut:
    row = db.get(BuildJob, job_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build job not found")
    return build_job_out(row)


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
    base_key = parse_base_tune(base_tune)
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
        base_tune=base_key,
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
    return build_job_out(job)


@router.post("/{job_id}/retry", response_model=BuildJobOut)
def retry_build_with_available_options(
    job_id: str,
    background_tasks: BackgroundTasks,
    base_tune: str = Form("STAGE1"),
    addon_keys: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildJobOut:
    base_key = parse_base_tune(base_tune)
    addons = parse_addon_keys(addon_keys)

    subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    ensure_subscription_available(subscription)
    db.add(subscription)
    db.commit()

    original = db.get(BuildJob, job_id)
    if not original or original.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build job not found")
    if not original.source_path or not Path(original.source_path).exists():
        raise HTTPException(status_code=409, detail="The original uploaded file is no longer available")

    job = BuildJob(
        user_id=user.id,
        project_id=original.project_id,
        source_filename=original.source_filename,
        source_path=original.source_path,
        source_sha256=original.source_sha256,
        source_size_bytes=original.source_size_bytes,
        vehicle_label=original.vehicle_label,
        ecu_label=original.ecu_label,
        base_tune=base_key,
        requested_options={
            "addon_keys": addons,
            "retry_of": original.id,
            "source_request": original.requested_options or {},
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_job, job.id)
    return build_job_out(job)


@router.post("/{job_id}/request-file", response_model=ProjectOut)
def request_build_file(
    job_id: str,
    base_tune: str = Form("STAGE1"),
    addon_keys: str | None = Form(None),
    comments: str = Form(""),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    base_key = parse_base_tune(base_tune)
    addons = parse_addon_keys(addon_keys)

    original = db.get(BuildJob, job_id)
    if not original or original.user_id != user.id:
        raise HTTPException(status_code=404, detail="Build job not found")

    project = Project(
        user_id=user.id,
        name=f"Requested {original.source_filename}"[:180],
        vehicle_label=original.vehicle_label,
        ecu_label=original.ecu_label,
        source_filename=original.source_filename,
        source_sha256=original.source_sha256,
        requested_options={
            "status": "requested",
            "request_file": True,
            "source_build_id": original.id,
            "base_tune": base_key,
            "addon_keys": addons,
            "comments": comments.strip(),
            "source_filename": original.source_filename,
            "source_sha256": original.source_sha256,
        },
        last_build_id=original.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


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
    return FileResponse(path, filename=build_job_display_filename(row) or row.result_filename or path.name, media_type="application/octet-stream")
