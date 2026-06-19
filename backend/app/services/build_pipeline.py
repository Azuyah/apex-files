from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import BuildJob, Subscription
from ..settings import get_settings
from .revtech_client import RevtechClient, RevtechClientError

logger = logging.getLogger(__name__)


def normalize_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned[:90] or "apex-file"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def normalize_version_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


BASE_LABELS = {
    "STAGE1": ("stage 1", "st1"),
    "STAGE2": ("stage 2", "st2"),
    "CUSTOM": ("stage 3", "custom"),
    "ECO": ("eco",),
    "TCU": ("tcu", "gearbox", "dsg"),
}

ADDON_LABELS = {
    "EGR_OFF": ("egr",),
    "DPF_OFF": ("dpf", "fap"),
    "GPF_OPF_OFF": ("gpf", "opf", "ppf"),
    "DECAT": ("decat", "cat off"),
    "SWIRL_FLAPS_OFF": ("swirl",),
    "ADBLUE_OFF": ("adblue", "scr", "urea"),
    "DTC_REMOVE": ("dtc", "fault code", "fault codes"),
    "MAF_OFF": ("maf", "air mass"),
    "LAMBDA_OFF": ("lambda", "o2 sensor", "oxygen sensor"),
    "NOX_OFF": ("nox",),
    "START_STOP_OFF": ("start stop", "startstop", "start/stop"),
    "TORQUE_MONITORING_OFF": ("torque monitoring", "torque monitor"),
    "HOT_START_FIX": ("hot start",),
    "POPS_BANGS": ("pops", "bang", "crackle", "burble"),
    "VMAX": ("v max", "vmax", "speed limiter", "limiter"),
}

ADDON_NAMES = {
    "EGR_OFF": "EGR off",
    "DPF_OFF": "DPF off",
    "GPF_OPF_OFF": "GPF / OPF off",
    "DECAT": "Decat",
    "SWIRL_FLAPS_OFF": "Swirl flaps off",
    "ADBLUE_OFF": "Adblue off",
    "DTC_REMOVE": "DTC removal",
    "MAF_OFF": "MAF off",
    "LAMBDA_OFF": "Lambda off",
    "NOX_OFF": "NOx off",
    "START_STOP_OFF": "Start / stop off",
    "TORQUE_MONITORING_OFF": "Torque monitoring off",
    "HOT_START_FIX": "Hot start fix",
    "POPS_BANGS": "Pops & Bangs",
    "VMAX": "V-max",
}

PATCH_ADAPTATION_ADDONS = {"EGR_OFF", "DPF_OFF", "DECAT", "SWIRL_FLAPS_OFF", "ADBLUE_OFF", "VMAX"}


def display_addons(addon_keys: list[str]) -> str:
    return ", ".join(ADDON_NAMES.get(key, key) for key in addon_keys)


def customer_safe_error(exc: Exception) -> str:
    message = str(exc).strip()
    if isinstance(exc, RevtechClientError):
        if "needs an exact database version" in message:
            return message
        if "not configured" in message.lower():
            return "The file build service is not connected yet. Please contact support."
        if "did not return a safe patch adaptation output" in message:
            return "No safe automatic build was found for this file. Please try another file or contact support."
        return "No safe automatic build was found for this file. Please try another file or contact support."
    if "timeout" in message.lower():
        return "The file build service took too long to respond. Please try again."
    return "Could not finish this file build. Please try again or contact support."


def version_matches_tokens(name: str | None, tokens: tuple[str, ...]) -> bool:
    normalized = normalize_version_text(name)
    return any(token in normalized for token in tokens)


def available_versions(project: dict[str, Any]) -> list[dict[str, Any]]:
    versions = project.get("available_versions")
    if isinstance(versions, list) and versions:
        return [version for version in versions if isinstance(version, dict)]
    raw_names = project.get("project_versions")
    if isinstance(raw_names, list):
        return [{"index": idx, "name": str(name)} for idx, name in enumerate(raw_names)]
    return []


def select_versions(project: dict[str, Any], base_key: str, addon_keys: list[str]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    versions = available_versions(project)
    base_tokens = BASE_LABELS.get(base_key, ())
    addon_token_sets = [ADDON_LABELS.get(key, ()) for key in addon_keys]

    if base_tokens:
        full = next(
            (
                version
                for version in versions
                if version_matches_tokens(version.get("name"), base_tokens)
                and all(version_matches_tokens(version.get("name"), tokens) for tokens in addon_token_sets if tokens)
            ),
            None,
        )
        if full:
            return full, []

    base_version = next(
        (version for version in versions if version_matches_tokens(version.get("name"), base_tokens)),
        None,
    ) if base_tokens else None

    addon_versions: list[dict[str, Any]] = []
    for tokens in addon_token_sets:
        if not tokens:
            continue
        found = next((version for version in versions if version_matches_tokens(version.get("name"), tokens)), None)
        if found:
            addon_versions.append(found)

    requested_addon_count = len([tokens for tokens in addon_token_sets if tokens])
    if base_version and requested_addon_count == 0:
        return base_version, []
    if base_version and len(addon_versions) == requested_addon_count:
        return None, [base_version, *addon_versions]
    return None, []


def project_live_identifiers(project: dict[str, Any]) -> tuple[str, str | None]:
    meta = project.get("extra_meta") if isinstance(project.get("extra_meta"), dict) else {}
    filename = str(meta.get("winols_project_filename") or project.get("original_filename") or "").strip()
    path = str(meta.get("winols_project_path") or "").strip() or None
    if not filename:
        raise RevtechClientError("Matched Revtech project did not include a WinOLS project filename.")
    return filename, path


def output_filename_from_headers(headers: dict[str, str], fallback: str) -> str:
    disposition = headers.get("content-disposition") or headers.get("Content-Disposition") or ""
    match = re.search(r'filename="?([^";]+)"?', disposition)
    return match.group(1) if match else fallback


def update_job(db: Session, job_id: str, **values: Any) -> BuildJob:
    job = db.get(BuildJob, job_id)
    if job is None:
        raise RuntimeError(f"Build job {job_id} no longer exists")
    for key, value in values.items():
        setattr(job, key, value)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


async def process_build_job(job_id: str) -> None:
    settings = get_settings()
    client = RevtechClient(settings)

    db = SessionLocal()
    try:
        job = db.get(BuildJob, job_id)
        if job is None:
            return

        file_path = Path(job.source_path)
        addon_keys = list((job.requested_options or {}).get("addon_keys") or [])

        update_job(db, job_id, status="scanning", progress=12, current_stage="Fingerprinting file")
        await asyncio.sleep(0.35 if not settings.revtech_enabled else 0)

        update_job(db, job_id, progress=28, current_stage="Checking exact matches")
        match_payload = await client.match_bin(file_path, max_matches=50)
        matches = list(match_payload.get("matches") or [])
        exact_match = next(
            (
                match
                for match in matches
                if str(match.get("tier") or "").lower() in {"exact", "strong"}
                or str(match.get("method") or "").upper() == "EXACT_BYTES"
            ),
            None,
        )

        strategy = "exact_match" if exact_match else "patch_adaptation"
        if exact_match and addon_keys:
            strategy = "version_merge"

        update_job(
            db,
            job_id,
            status="building",
            progress=52,
            current_stage="Preparing requested calibration",
            strategy=strategy,
            revtech_payload=match_payload,
        )
        await asyncio.sleep(0.45 if not settings.revtech_enabled else 0)

        patch_payload: dict[str, Any] | None = None
        output_bytes: bytes
        result_filename: str

        top_project = matches[0].get("project") if matches else None
        if top_project is not None and not isinstance(top_project, dict):
            raise RevtechClientError("Revtech returned an invalid match project.")

        direct_version: dict[str, Any] | None = None
        merge_versions: list[dict[str, Any]] = []
        if isinstance(top_project, dict):
            direct_version, merge_versions = select_versions(top_project, job.base_tune, addon_keys)

        if direct_version:
            if not isinstance(top_project, dict):
                raise RevtechClientError("Revtech returned an invalid exact-match project.")
            project_filename, project_path = project_live_identifiers(top_project)
            update_job(db, job_id, progress=68, current_stage="Exporting matched version", strategy="exact_match")
            output_bytes, headers = await client.export_version(
                file_path,
                project_filename=project_filename,
                project_path=project_path,
                version_name=str(direct_version.get("name") or ""),
                version_index=direct_version.get("index") if isinstance(direct_version.get("index"), int) else None,
            )
            result_filename = output_filename_from_headers(headers, "apex-exact-match.bin")
            strategy = "exact_match"
        elif merge_versions:
            if not isinstance(top_project, dict):
                raise RevtechClientError("Revtech returned an invalid version-merge project.")
            project_filename, project_path = project_live_identifiers(top_project)
            update_job(db, job_id, progress=68, current_stage="Merging requested versions", strategy="version_merge")
            merge_label = " + ".join(str(version.get("name") or "") for version in merge_versions if version.get("name"))
            output_bytes, headers = await client.merge_versions(
                file_path,
                project_filename=project_filename,
                project_path=project_path,
                versions=[
                    {
                        "version_name": version.get("name"),
                        "version_index": version.get("index") if isinstance(version.get("index"), int) else None,
                    }
                    for version in merge_versions
                ],
                merged_version_name=merge_label or "Apex merged version",
            )
            result_filename = output_filename_from_headers(headers, "apex-merged.bin")
            strategy = "version_merge"
        else:
            unsupported_patch_keys = [key for key in addon_keys if key not in PATCH_ADAPTATION_ADDONS]
            if unsupported_patch_keys:
                labels = display_addons(unsupported_patch_keys)
                raise RevtechClientError(
                    f"{labels} needs an exact database version. No compatible version was found for this file."
                )
            update_job(db, job_id, progress=68, current_stage="Validating patch adaptation")
            patch_payload, output_bytes, result_filename = await client.run_patch_adaptation(
                file_path,
                base_key=job.base_tune,
                addon_keys=addon_keys,
            )
            strategy = "patch_adaptation"

        await asyncio.sleep(0.45 if not settings.revtech_enabled else 0)

        output_dir = settings.storage_path / "outputs" / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        option_slug = normalize_filename_part("-".join([job.base_tune, *addon_keys]).lower())
        source_stem = normalize_filename_part(Path(job.source_filename).stem)
        result_filename = normalize_filename_part(result_filename) or f"{source_stem}__{option_slug or 'apex'}__apex.bin"
        result_path = output_dir / result_filename

        result_path.write_bytes(output_bytes)
        result_sha = sha256_bytes(output_bytes)

        final_payload = dict(match_payload)
        if patch_payload:
            final_payload["patch_adaptation"] = patch_payload

        update_job(
            db,
            job_id,
            status="ready",
            progress=100,
            current_stage="Ready",
            result_filename=result_filename,
            result_path=str(result_path),
            result_sha256=result_sha,
            revtech_payload=final_payload,
        )

        subscription = db.query(Subscription).filter(Subscription.user_id == job.user_id).one_or_none()
        if subscription:
            subscription.files_used_this_period += 1
            db.add(subscription)
            db.commit()
    except Exception as exc:
        logger.exception("Apex build job %s failed", job_id)
        update_job(
            db,
            job_id,
            status="failed",
            progress=100,
            current_stage="Failed",
            error_message=customer_safe_error(exc),
            revtech_payload={"error_type": exc.__class__.__name__},
        )
    finally:
        db.close()
