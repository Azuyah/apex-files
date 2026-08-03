from __future__ import annotations

import asyncio
import base64
import hashlib
import itertools
import logging
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import BuildJob, BuildScan, FileDeliveryCache, Subscription
from ..settings import get_settings
from .revtech_client import RevtechClient, RevtechClientError

logger = logging.getLogger(__name__)


def normalize_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned[:90] or "apex-file"


def filename_slug(value: Any, *, fallback: str = "") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return cleaned[:42] or fallback


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

BASE_NAMES = {
    "STAGE1": "Stage 1",
    "STAGE2": "Stage 2",
    "CUSTOM": "Custom",
    "ECO": "ECO",
    "TCU": "TCU",
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
PATCH_SCAN_BASE_KEYS = ["STAGE1", "STAGE2", "CUSTOM", "ECO", "TCU"]
PATCH_SCAN_ADDON_KEYS = ["EGR_OFF", "DPF_OFF", "DECAT", "SWIRL_FLAPS_OFF", "ADBLUE_OFF", "VMAX"]


def display_addons(addon_keys: list[str]) -> str:
    return ", ".join(ADDON_NAMES.get(key, key) for key in addon_keys)


def option_filename_part(base_key: str | None, addon_keys: list[str] | None) -> str:
    parts: list[str] = []
    base = str(base_key or "").strip().upper()
    if base:
        parts.append(filename_slug(BASE_NAMES.get(base, base).replace(" ", ""), fallback=base.lower()))
    for key in list(addon_keys or []):
        clean_key = str(key or "").strip().upper()
        label = ADDON_NAMES.get(clean_key, clean_key)
        slug = filename_slug(label, fallback=clean_key.lower())
        if slug and slug not in parts:
            parts.append(slug)
    return ("_".join(parts) or "options")[:82].strip("_-") or "options"


def customer_result_filename(
    *,
    source_filename: str,
    base_key: str | None,
    addon_keys: list[str] | None,
    offer: dict[str, Any] | None = None,
    fallback_filename: str | None = None,
) -> str:
    metadata = (offer or {}).get("metadata") if isinstance((offer or {}).get("metadata"), dict) else {}
    brand = filename_slug(metadata.get("brand"), fallback="")
    model = filename_slug(metadata.get("model") or metadata.get("vehicle"), fallback="")
    ecu = filename_slug(metadata.get("ecu_type") or metadata.get("ecu_build") or (offer or {}).get("ecu_label"), fallback="")

    if not brand or not model or not ecu:
        source_stem = Path(source_filename or fallback_filename or "apex-file").stem
        source_parts = [part for part in re.split(r"[_\-\s]+", source_stem.lower()) if part]
        if not brand and source_parts:
            brand = filename_slug(source_parts[0], fallback="")
        if not model and len(source_parts) > 1:
            model = filename_slug(source_parts[1], fallback="")
        if not ecu:
            ecu_candidate = next((part for part in source_parts if "edc" in part or "med" in part or "mg1" in part or "md1" in part), "")
            ecu = filename_slug(ecu_candidate, fallback="")

    extension_source = fallback_filename or source_filename or "apex-file.bin"
    extension = Path(extension_source).suffix.lower()
    if extension not in {".bin", ".ori", ".dat", ".ecu", ".hex"}:
        extension = ".bin"

    parts = [
        brand or "vehicle",
        model or "model",
        ecu or "ecu",
        option_filename_part(base_key, addon_keys),
        "apexfiles",
    ]
    stem = "_".join(parts)
    max_stem_length = 180 - len(extension)
    if len(stem) > max_stem_length:
        stem = stem[:max_stem_length].rstrip("_-")
    return f"{stem}{extension}"


def display_solution_key(base_key: str | None = None, addon_keys: list[str] | None = None) -> str:
    if base_key:
        return BASE_NAMES.get(base_key, base_key)
    return display_addons(list(addon_keys or [])) or "selection"


def option_signature(base_key: str | None, addon_keys: list[str] | None) -> str:
    base = str(base_key or "").strip().upper()
    addons = sorted({str(key or "").strip().upper() for key in list(addon_keys or []) if str(key or "").strip()})
    return "|".join([f"base={base}", f"addons={','.join(addons)}"])


def buildable_selection(
    *,
    base_key: str | None,
    addon_keys: list[str] | None,
    source: str,
    strategy: str,
    cache_id: str | None = None,
) -> dict[str, Any]:
    base = str(base_key or "").strip().upper()
    addons = sorted({str(key or "").strip().upper() for key in list(addon_keys or []) if str(key or "").strip()})
    entry: dict[str, Any] = {
        "signature": option_signature(base, addons),
        "base_tune": base,
        "addon_keys": addons,
        "source": str(source or "").strip(),
        "strategy": str(strategy or "").strip(),
    }
    if cache_id:
        entry["cache_id"] = str(cache_id)
    return entry


def append_buildable_selection(entries: list[dict[str, Any]], entry: dict[str, Any]) -> None:
    signature = str(entry.get("signature") or "").strip()
    if not signature or any(str(item.get("signature") or "").strip() == signature for item in entries):
        return
    entries.append(entry)


def offer_buildable_selections(offer: dict[str, Any] | None) -> list[dict[str, Any]]:
    availability = (offer or {}).get("availability") if isinstance((offer or {}).get("availability"), dict) else {}
    raw_entries = availability.get("buildable_selections")
    return [entry for entry in list(raw_entries or []) if isinstance(entry, dict)]


def offer_selection_is_buildable(
    offer: dict[str, Any] | None,
    *,
    base_key: str | None,
    addon_keys: list[str] | None,
) -> bool:
    signature = option_signature(base_key, addon_keys)
    entries = offer_buildable_selections(offer)
    if entries:
        return any(str(entry.get("signature") or "").strip() == signature for entry in entries)

    # Legacy scan payloads only carried the union of available keys. A single
    # option is safe to revalidate, but never infer a multi-option combination.
    base = str(base_key or "").strip().upper()
    addons = sorted({str(key or "").strip().upper() for key in list(addon_keys or []) if str(key or "").strip()})
    if (1 if base else 0) + len(addons) != 1:
        return False
    if base:
        return base in {str(key or "").strip().upper() for key in list((offer or {}).get("base_tunes") or [])}
    return addons[0] in {str(key or "").strip().upper() for key in list((offer or {}).get("addon_keys") or [])}


def first_successful_patch_output(payload: dict[str, Any]) -> tuple[bytes, str] | None:
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list):
        return None
    for candidate in candidates:
        if not isinstance(candidate, dict) or str(candidate.get("status") or "").lower() != "success":
            continue
        output = candidate.get("output") if isinstance(candidate.get("output"), dict) else {}
        content_b64 = str(output.get("content_b64") or "")
        if not content_b64:
            continue
        filename = str(output.get("filename") or "apex-patched.bin")
        return base64.b64decode(content_b64), filename
    return None


def successful_patch_project_ids(payload: dict[str, Any]) -> set[str]:
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list):
        return set()
    project_ids: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict) or str(candidate.get("status") or "").strip().lower() != "success":
            continue
        project = candidate.get("project") if isinstance(candidate.get("project"), dict) else {}
        project_id = str(project.get("id") or candidate.get("project_id") or "").strip()
        if project_id:
            project_ids.add(project_id)
    return project_ids


def offer_candidate_selections(offer: dict[str, Any] | None) -> list[dict[str, Any]]:
    availability = (offer or {}).get("availability") if isinstance((offer or {}).get("availability"), dict) else {}
    raw_entries = availability.get("candidate_selections")
    return [entry for entry in list(raw_entries or []) if isinstance(entry, dict)]


def offer_selection_is_candidate(
    offer: dict[str, Any] | None,
    *,
    base_key: str | None,
    addon_keys: list[str] | None,
) -> bool:
    signature = option_signature(base_key, addon_keys)
    return any(str(entry.get("signature") or "").strip() == signature for entry in offer_candidate_selections(offer))


def patch_success_count(payload: dict[str, Any]) -> int:
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list):
        return 0
    return len([candidate for candidate in candidates if isinstance(candidate, dict) and str(candidate.get("status") or "").lower() == "success"])


def customer_safe_error(exc: Exception) -> str:
    message = str(exc).strip()
    if isinstance(exc, RevtechClientError):
        if "needs a prepared database file" in message:
            return message
        if "not configured" in message.lower():
            return "The file build service is not connected yet. Please contact support."
        if "did not return a safe patch adaptation output" in message:
            return "No prepared file was found for this request. Please try another file or contact support."
        return "No prepared file was found for this request. Please try another file or contact support."
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


def is_fileserver_library_exact(match: dict[str, Any] | None, project: dict[str, Any] | None) -> bool:
    project_meta = project.get("extra_meta") if isinstance(project, dict) and isinstance(project.get("extra_meta"), dict) else {}
    source = str(project_meta.get("source") or project_meta.get("source_kind") or "").strip().lower()
    library_meta = project_meta.get("fileserver_library_match") if isinstance(project_meta.get("fileserver_library_match"), dict) else {}
    match_meta = match.get("match_meta") if isinstance(match, dict) and isinstance(match.get("match_meta"), dict) else {}
    match_source = str(match_meta.get("match_source") or "").strip().lower()
    return source == "fileserver_library_exact" or match_source == "fileserver_library_exact" or bool(library_meta.get("direct_delivery"))


def requires_patch_adaptation(match: dict[str, Any] | None, project: dict[str, Any] | None) -> bool:
    project_meta = (
        project.get("extra_meta")
        if isinstance(project, dict) and isinstance(project.get("extra_meta"), dict)
        else {}
    )
    match_meta = (
        match.get("match_meta")
        if isinstance(match, dict) and isinstance(match.get("match_meta"), dict)
        else {}
    )
    adaptation_markers = (
        project_meta.get("bench_adaptation"),
        match_meta.get("bench_adaptation"),
        match.get("bench_adaptation") if isinstance(match, dict) else None,
    )
    for marker in adaptation_markers:
        if not isinstance(marker, dict):
            continue
        if bool(marker.get("requires_adaptation")):
            return True
        if bool(marker.get("eligible")) and bool(marker.get("requires_adaptation", True)):
            return True

    tier = str(match.get("tier") or "").strip().lower() if isinstance(match, dict) else ""
    method = str(match.get("method") or "").strip().upper() if isinstance(match, dict) else ""
    return tier == "bench_adaptation" or "BENCH_ADAPTATION" in method


def fileserver_package_entries(match: dict[str, Any] | None, project: dict[str, Any] | None) -> list[dict[str, Any]]:
    candidates: list[Any] = []
    if isinstance(match, dict) and isinstance(match.get("match_meta"), dict):
        candidates.append(match["match_meta"].get("package_variants"))
    if isinstance(project, dict) and isinstance(project.get("extra_meta"), dict):
        library_meta = project["extra_meta"].get("fileserver_library_match")
        if isinstance(library_meta, dict):
            candidates.append(library_meta.get("package_variants"))

    for raw_entries in candidates:
        if isinstance(raw_entries, list):
            entries = [entry for entry in raw_entries if isinstance(entry, dict)]
            if entries:
                return entries
    return []


def select_fileserver_package(
    match: dict[str, Any] | None,
    project: dict[str, Any] | None,
    version: dict[str, Any] | None,
) -> dict[str, Any] | None:
    entries = fileserver_package_entries(match, project)
    if not entries:
        return None

    version_index = version.get("index") if isinstance(version, dict) else None
    if isinstance(version_index, int):
        found = next(
            (
                entry
                for entry in entries
                if str(entry.get("version_index") or "").strip() == str(version_index)
            ),
            None,
        )
        if found:
            return found

    version_name = normalize_version_text(version.get("name") if isinstance(version, dict) else None)
    if version_name:
        found = next((entry for entry in entries if normalize_version_text(entry.get("version_name")) == version_name), None)
        if found:
            return found

    return entries[0] if len(entries) == 1 else None


def exact_or_strong_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (
            match
            for match in matches
            if str(match.get("tier") or "").lower() in {"exact", "strong"}
            or str(match.get("method") or "").upper() == "EXACT_BYTES"
        ),
        None,
    )


def preferred_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    return exact_or_strong_match(matches) or (matches[0] if matches else None)


def first_text_value(sources: list[dict[str, Any]], keys: tuple[str, ...]) -> str:
    for source in sources:
        for key in keys:
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def clean_metadata_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(int(value)) if float(value).is_integer() else str(value)
    return str(value).strip()


def lookup_path(source: dict[str, Any], path: str) -> Any:
    current: Any = source
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def first_path_text(sources: list[dict[str, Any]], paths: tuple[str, ...]) -> str:
    for source in sources:
        for path in paths:
            text = clean_metadata_text(lookup_path(source, path))
            if text:
                return text
    return ""


def add_metadata_source(sources: list[dict[str, Any]], value: Any) -> None:
    if isinstance(value, dict):
        sources.append(value)


def add_metadata_sources_from_entry(sources: list[dict[str, Any]], entry: Any, depth: int = 0) -> None:
    if not isinstance(entry, dict) or depth > 5:
        return
    add_metadata_source(sources, entry)
    for key in (
        "vehicle_variant",
        "ecu_software",
        "identified",
        "metadata",
        "extra_meta",
        "match_meta",
        "fileserver_library_match",
        "fileserver_modified_match",
        "tuning_variant",
        "package_variant",
        "base_file",
        "final_file",
    ):
        nested = entry.get(key)
        add_metadata_source(sources, nested)
        if isinstance(nested, dict):
            add_metadata_sources_from_entry(sources, nested, depth + 1)
    for list_key in ("package_variants", "tuning_variants", "file_candidates", "candidates", "tuning_variant_candidates"):
        raw_items = entry.get(list_key)
        if isinstance(raw_items, list):
            for item in raw_items:
                add_metadata_sources_from_entry(sources, item, depth + 1)


def metadata_sources_for_match(match_payload: dict[str, Any], matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for list_key in ("file_candidates", "candidates", "tuning_variant_candidates"):
        raw_items = match_payload.get(list_key)
        if isinstance(raw_items, list):
            for item in raw_items:
                add_metadata_sources_from_entry(sources, item)
    for match in matches:
        add_metadata_sources_from_entry(sources, match)
        project = match.get("project") if isinstance(match.get("project"), dict) else None
        if project:
            add_metadata_sources_from_entry(sources, project)
    add_metadata_source(sources, match_payload.get("identified"))
    add_metadata_source(sources, match_payload.get("bin"))
    return sources


def join_non_duplicate(parts: list[str]) -> str:
    output: list[str] = []
    seen: set[str] = set()
    for part in parts:
        text = clean_metadata_text(part)
        if not text:
            continue
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if key and key in seen:
            continue
        if any(key and key in re.sub(r"[^a-z0-9]+", "", existing.lower()) for existing in output):
            continue
        seen.add(key)
        output.append(text)
    return " ".join(output).strip()


def build_engine_display(sources: list[dict[str, Any]]) -> str:
    base = first_path_text(
        sources,
        (
            "engine_unfiltered",
            "engine_name",
            "selected_engine",
            "engine",
            "motorcode",
            "engine_code",
            "engine_type",
        ),
    )
    ps = first_path_text(sources, ("output_ps", "power_output_oem", "power_hp", "target_power_hp"))
    kw = first_path_text(sources, ("output_kw", "power_kw"))
    torque = first_path_text(sources, ("max_torque_nm", "target_torque_nm"))
    power_bits = []
    if ps:
        power_bits.append(f"{ps} HP")
    if kw:
        power_bits.append(f"{kw} kW")
    if torque:
        power_bits.append(f"{torque} Nm")
    if power_bits:
        return f"{base} ({' / '.join(power_bits)})" if base else " / ".join(power_bits)
    return base


def build_ecu_display(sources: list[dict[str, Any]]) -> str:
    explicit = first_path_text(sources, ("ecu", "ecu_type", "ecu_exact", "ecu_family", "controller", "ecu_name"))
    producer = first_path_text(sources, ("producer", "ecu_producer", "vendor"))
    build = first_path_text(sources, ("build", "ecu_build"))
    combined = join_non_duplicate([producer, build])
    return combined or explicit


def build_match_metadata(match_payload: dict[str, Any], matches: list[dict[str, Any]]) -> dict[str, str]:
    sources = metadata_sources_for_match(match_payload, matches)
    brand = first_path_text(sources, ("brand", "vehicle_brand", "vehicle_producer", "make", "manufacturer"))
    model = first_path_text(sources, ("model", "vehicle_model", "series", "engine_model"))
    generation = first_path_text(sources, ("generation", "vehicle_generation"))
    engine_code = first_path_text(sources, ("engine_code", "motorcode", "selected_vehicle_engine_code", "engine_type"))
    ecu_type = build_ecu_display(sources)
    software_number = first_path_text(sources, ("software", "software_number", "sw_id", "sw", "ecu_nr_ecu", "cal_id"))
    hardware_number = first_path_text(sources, ("hardware_number", "hw_id", "hw", "ecu_nr_prod"))
    engine = build_engine_display(sources)
    vehicle = first_path_text(sources, ("vehicle_label", "vehicle_name", "vehicle", "make_model", "car"))
    if not vehicle:
        vehicle = join_non_duplicate([brand, model, generation])
    return {
        "vehicle": vehicle,
        "brand": brand,
        "model": model,
        "generation": generation,
        "engine": engine,
        "engine_code": engine_code,
        "ecu_type": ecu_type,
        "software_number": software_number,
        "hardware_number": hardware_number,
        "ecu_producer": first_path_text(sources, ("producer", "ecu_producer", "vendor")),
        "ecu_build": first_path_text(sources, ("build", "ecu_build")),
        "calibration_id": first_path_text(sources, ("cal_id", "checksum_ref")),
    }


def option_keys_from_field(value: Any, allowed: set[str]) -> list[str]:
    raw_items = value if isinstance(value, list) else [value]
    keys: list[str] = []
    for item in raw_items:
        key = str(item or "").strip().upper()
        if key in allowed and key not in keys:
            keys.append(key)
    return keys


def version_display_text(version: dict[str, Any]) -> str:
    return " ".join(
        str(version.get(key) or "")
        for key in ("name", "version_name", "label", "title", "description", "final_filename")
    ).strip()


def matched_option_keys(match: dict[str, Any], project: dict[str, Any]) -> tuple[list[str], list[str]]:
    versions = available_versions(project)
    entries = fileserver_package_entries(match, project)
    text_values = [version_display_text(version) for version in versions]
    text_values.extend(version_display_text(entry) for entry in entries)

    base_keys: list[str] = []
    addon_keys: list[str] = []

    for entry in entries:
        for key in option_keys_from_field(entry.get("base_tune") or entry.get("base_key") or entry.get("tune_key"), set(BASE_LABELS)):
            if key not in base_keys:
                base_keys.append(key)
        for field in ("addon_keys", "addons", "option_keys", "options"):
            for key in option_keys_from_field(entry.get(field), set(ADDON_LABELS)):
                if key not in addon_keys:
                    addon_keys.append(key)

    for text in text_values:
        normalized = normalize_version_text(text)
        if not normalized:
            continue
        for key, tokens in BASE_LABELS.items():
            if key not in base_keys and any(token in normalized for token in tokens):
                base_keys.append(key)
        for key, tokens in ADDON_LABELS.items():
            if key not in addon_keys and any(token in normalized for token in tokens):
                addon_keys.append(key)

    return base_keys, addon_keys


def append_unique(target: list[str], values: list[str]) -> None:
    for value in values:
        if value not in target:
            target.append(value)


def ordered_matches_for_delivery(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    preferred = preferred_match(matches)
    ordered: list[dict[str, Any]] = []
    if preferred:
        ordered.append(preferred)
    for match in matches:
        if match is not preferred:
            ordered.append(match)
    return ordered


def matched_option_keys_from_matches(matches: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    base_keys: list[str] = []
    addon_keys: list[str] = []
    for candidate in ordered_matches_for_delivery(matches):
        project = candidate.get("project") if isinstance(candidate, dict) else None
        if not isinstance(project, dict):
            continue
        candidate_base_keys, candidate_addon_keys = matched_option_keys(candidate, project)
        append_unique(base_keys, candidate_base_keys)
        append_unique(addon_keys, candidate_addon_keys)
    return base_keys, addon_keys


def match_with_project(matches: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    for candidate in ordered_matches_for_delivery(matches):
        project = candidate.get("project") if isinstance(candidate, dict) else None
        if isinstance(project, dict):
            return candidate, project
    return None, None


def select_delivery_candidate(
    matches: list[dict[str, Any]],
    base_key: str,
    addon_keys: list[str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None, list[dict[str, Any]]]:
    for candidate in ordered_matches_for_delivery(matches):
        project = candidate.get("project") if isinstance(candidate, dict) else None
        if not isinstance(project, dict):
            continue
        if requires_patch_adaptation(candidate, project):
            continue
        direct_version, merge_versions = select_versions(project, base_key, addon_keys)
        if direct_version or merge_versions:
            return candidate, project, direct_version, merge_versions
    return None, None, None, []


def prepared_delivery_strategy(
    match: dict[str, Any] | None,
    project: dict[str, Any] | None,
    direct_version: dict[str, Any] | None,
    merge_versions: list[dict[str, Any]],
) -> str | None:
    if not isinstance(project, dict):
        return None
    if direct_version:
        if is_fileserver_library_exact(match, project):
            package = select_fileserver_package(match, project, direct_version)
            return "fileserver_direct" if str((package or {}).get("final_file_blob_id") or "").strip() else None
        try:
            project_live_identifiers(project)
        except RevtechClientError:
            return None
        return "exact_match"
    if merge_versions:
        if is_fileserver_library_exact(match, project):
            return None
        try:
            project_live_identifiers(project)
        except RevtechClientError:
            return None
        return "version_merge"
    return None


def database_buildable_selections(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base_keys, addon_keys = matched_option_keys_from_matches(matches)
    normalized_bases = [key for key in BASE_LABELS if key in base_keys]
    normalized_addons = [key for key in ADDON_LABELS if key in addon_keys]
    max_addon_count = len(normalized_addons) if len(normalized_addons) <= 8 else min(3, len(normalized_addons))
    addon_combinations = [
        list(combination)
        for count in range(max_addon_count + 1)
        for combination in itertools.combinations(normalized_addons, count)
    ]

    selections: list[dict[str, Any]] = []
    for base_key in ["", *normalized_bases]:
        for addons in addon_combinations:
            if not base_key and not addons:
                continue
            match, project, direct_version, merge_versions = select_delivery_candidate(matches, base_key, addons)
            strategy = prepared_delivery_strategy(match, project, direct_version, merge_versions)
            if not strategy:
                continue
            project_meta = project.get("extra_meta") if isinstance(project, dict) and isinstance(project.get("extra_meta"), dict) else {}
            match_meta = match.get("match_meta") if isinstance(match, dict) and isinstance(match.get("match_meta"), dict) else {}
            source = str(
                project_meta.get("source")
                or project_meta.get("source_kind")
                or match_meta.get("match_source")
                or "database"
            ).strip()
            append_buildable_selection(
                selections,
                buildable_selection(
                    base_key=base_key,
                    addon_keys=addons,
                    source=source,
                    strategy=strategy,
                ),
            )
    return selections


def adaptation_candidate_selections(
    matches: list[dict[str, Any]],
    *,
    prepared_signatures: set[str] | None = None,
) -> list[dict[str, Any]]:
    prepared = set(prepared_signatures or set())
    projects_by_signature: dict[str, set[str]] = {}
    selection_values: dict[str, tuple[str, list[str]]] = {}

    for match in matches:
        project = match.get("project") if isinstance(match, dict) else None
        if not isinstance(project, dict) or not requires_patch_adaptation(match, project):
            continue
        base_keys, addon_keys = matched_option_keys(match, project)
        normalized_bases = [key for key in BASE_LABELS if key in base_keys]
        normalized_addons = [
            key for key in ADDON_LABELS
            if key in PATCH_ADAPTATION_ADDONS and key in addon_keys
        ]
        max_addon_count = len(normalized_addons) if len(normalized_addons) <= 8 else min(3, len(normalized_addons))
        project_meta = project.get("extra_meta") if isinstance(project.get("extra_meta"), dict) else {}
        project_identity = str(
            project.get("id")
            or project.get("original_filename")
            or project_meta.get("winols_project_filename")
            or ""
        ).strip()
        if not project_identity:
            continue

        for base_key in ["", *normalized_bases]:
            for addon_count in range(max_addon_count + 1):
                for addons_tuple in itertools.combinations(normalized_addons, addon_count):
                    addons = list(addons_tuple)
                    if not base_key and not addons:
                        continue
                    direct_version, merge_versions = select_versions(project, base_key, addons)
                    if not direct_version and not merge_versions:
                        continue
                    signature = option_signature(base_key, addons)
                    if signature in prepared:
                        continue
                    projects_by_signature.setdefault(signature, set()).add(project_identity)
                    selection_values[signature] = (base_key, sorted(addons))

    return [
        {
            "signature": signature,
            "base_tune": selection_values[signature][0],
            "addon_keys": selection_values[signature][1],
            "source": "patch_adaptation",
            "strategy": "validate_patch_adaptation",
            "candidate_project_count": len(project_ids),
        }
        for signature, project_ids in sorted(projects_by_signature.items())
    ]


def scan_candidate_selections(
    match_payload: dict[str, Any],
    matches: list[dict[str, Any]],
    *,
    prepared_signatures: set[str] | None = None,
) -> list[dict[str, Any]]:
    prepared = set(prepared_signatures or set())
    raw_entries = match_payload.get("candidate_selections")
    if not isinstance(raw_entries, list):
        payload_availability = (
            match_payload.get("availability")
            if isinstance(match_payload.get("availability"), dict)
            else {}
        )
        raw_entries = payload_availability.get("candidate_selections")
    if not isinstance(raw_entries, list):
        return adaptation_candidate_selections(
            matches,
            prepared_signatures=prepared,
        )

    selections: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            continue
        base_key = str(raw_entry.get("base_tune") or "").strip().upper()
        raw_addons = raw_entry.get("addon_keys")
        addon_keys = sorted(
            {
                str(key or "").strip().upper()
                for key in (raw_addons if isinstance(raw_addons, list) else [])
                if str(key or "").strip()
            }
        )
        signature = option_signature(base_key, addon_keys)
        supplied_signature = str(raw_entry.get("signature") or signature).strip()
        if (
            supplied_signature != signature
            or signature in prepared
            or signature in seen
            or (not base_key and not addon_keys)
            or (base_key and base_key not in BASE_LABELS)
            or any(key not in PATCH_ADAPTATION_ADDONS for key in addon_keys)
        ):
            continue
        try:
            candidate_project_count = max(
                0,
                int(raw_entry.get("candidate_project_count") or 0),
            )
        except (TypeError, ValueError):
            candidate_project_count = 0
        seen.add(signature)
        selections.append(
            {
                "signature": signature,
                "base_tune": base_key,
                "addon_keys": addon_keys,
                "source": str(raw_entry.get("source") or "patch_adaptation").strip(),
                "strategy": str(raw_entry.get("strategy") or "validate_patch_adaptation").strip(),
                "candidate_project_count": candidate_project_count,
            }
        )
    return selections


def build_match_offer(
    match_payload: dict[str, Any],
    *,
    source_filename: str,
    source_sha256: str,
    source_size_bytes: int,
) -> dict[str, Any]:
    matches = [match for match in list(match_payload.get("matches") or []) if isinstance(match, dict)]
    match, project = match_with_project(matches)
    if not isinstance(project, dict):
        metadata = build_match_metadata(match_payload, matches)
        return {
            "matched": False,
            "message": "No matching file was found.",
            "source_filename": source_filename,
            "source_sha256": source_sha256,
            "source_size_bytes": source_size_bytes,
            "project_name": "",
            "vehicle_label": metadata.get("vehicle", ""),
            "ecu_label": metadata.get("ecu_type", ""),
            "metadata": metadata,
            "base_tunes": [],
            "addon_keys": [],
        }

    project_meta = project.get("extra_meta") if isinstance(project.get("extra_meta"), dict) else {}
    match_meta = match.get("match_meta") if isinstance(match.get("match_meta"), dict) else {}
    sources = [project, project_meta, match, match_meta]
    base_keys, addon_keys = matched_option_keys_from_matches(matches)
    matched = bool(base_keys or addon_keys)
    metadata = build_match_metadata(match_payload, matches)
    vehicle_label = metadata.get("vehicle") or first_text_value(
        sources,
        ("vehicle_label", "vehicle_name", "vehicle", "make_model", "model", "car"),
    )
    ecu_label = metadata.get("ecu_type") or first_text_value(
        sources,
        ("ecu_label", "ecu_name", "ecu", "controller", "hardware", "ecu_type"),
    )
    return {
        "matched": matched,
        "message": "Match found." if matched else "A matching file was found, but no prepared versions are available yet.",
        "source_filename": source_filename,
        "source_sha256": source_sha256,
        "source_size_bytes": source_size_bytes,
        "project_name": first_text_value(
            sources,
            ("project_name", "name", "title", "original_filename", "filename"),
        ),
        "vehicle_label": vehicle_label,
        "ecu_label": ecu_label,
        "metadata": metadata,
        "base_tunes": base_keys,
        "addon_keys": addon_keys,
    }


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
    if not base_tokens and requested_addon_count == 1 and len(addon_versions) == 1:
        return addon_versions[0], []
    if not base_tokens and requested_addon_count > 1 and len(addon_versions) == requested_addon_count:
        return None, addon_versions
    return None, []


def project_live_identifiers(project: dict[str, Any]) -> tuple[str, str | None, str | None]:
    meta = project.get("extra_meta") if isinstance(project.get("extra_meta"), dict) else {}
    filename = str(meta.get("winols_project_filename") or project.get("original_filename") or "").strip()
    path = str(meta.get("winols_project_path") or "").strip() or None
    client_name = str(
        meta.get("indexed_client_name")
        or meta.get("client_name")
        or project.get("indexed_client_name")
        or project.get("client_name")
        or ""
    ).strip() or None
    if not filename:
        raise RevtechClientError("Matched Revtech project did not include a WinOLS project filename.")
    return filename, path, client_name


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


def update_scan(db: Session, scan_id: str, **values: Any) -> BuildScan:
    scan = db.get(BuildScan, scan_id)
    if scan is None:
        raise RuntimeError(f"Build scan {scan_id} no longer exists")
    for key, value in values.items():
        setattr(scan, key, value)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan


def find_cached_delivery_row(
    db: Session,
    *,
    source_sha256: str,
    base_key: str | None,
    addon_keys: list[str],
) -> FileDeliveryCache | None:
    signature = option_signature(base_key, addon_keys)
    return (
        db.query(FileDeliveryCache)
        .filter(
            FileDeliveryCache.source_sha256 == source_sha256,
            FileDeliveryCache.option_signature == signature,
        )
        .order_by(FileDeliveryCache.updated_at.desc())
        .first()
    )


def get_cached_delivery(db: Session, *, source_sha256: str, base_key: str | None, addon_keys: list[str]) -> FileDeliveryCache | None:
    row = find_cached_delivery_row(
        db,
        source_sha256=source_sha256,
        base_key=base_key,
        addon_keys=addon_keys,
    )
    if row and cache_file_is_verified(row):
        return row
    return None


def cache_file_is_verified(row: FileDeliveryCache) -> bool:
    result_path = Path(str(row.result_path or ""))
    expected_sha256 = str(row.result_sha256 or "").strip().lower()
    try:
        expected_size = int(row.result_size_bytes)
    except (TypeError, ValueError):
        return False
    if (
        not result_path.is_file()
        or expected_size <= 0
        or len(expected_sha256) != 64
        or any(char not in "0123456789abcdef" for char in expected_sha256)
    ):
        return False
    try:
        return result_path.stat().st_size == expected_size and sha256_file(result_path) == expected_sha256
    except OSError:
        return False


def cached_buildable_selections(db: Session, *, source_sha256: str) -> list[dict[str, Any]]:
    rows = (
        db.query(FileDeliveryCache)
        .filter(FileDeliveryCache.source_sha256 == source_sha256)
        .order_by(FileDeliveryCache.updated_at.desc())
        .all()
    )
    selections: list[dict[str, Any]] = []
    for row in rows:
        if not cache_file_is_verified(row):
            continue

        base_key = str(row.base_tune or "").strip().upper()
        raw_addons = row.addon_keys if isinstance(row.addon_keys, list) else []
        addon_keys = sorted(
            {
                str(key or "").strip().upper()
                for key in raw_addons
                if str(key or "").strip()
            }
        )
        signature = option_signature(base_key, addon_keys)
        if (
            (not base_key and not addon_keys)
            or (base_key and base_key not in BASE_LABELS)
            or any(key not in ADDON_LABELS for key in addon_keys)
            or str(row.option_signature or "").strip() != signature
        ):
            continue

        cached_strategy = str(row.strategy or "delivery").strip() or "delivery"
        if not cached_strategy.startswith("cached_"):
            cached_strategy = f"cached_{cached_strategy}"
        append_buildable_selection(
            selections,
            buildable_selection(
                base_key=base_key,
                addon_keys=addon_keys,
                source="cache",
                strategy=cached_strategy,
                cache_id=row.id,
            ),
        )
    return selections


def linked_scan_offer(db: Session, job: BuildJob) -> dict[str, Any] | None:
    scan_id = str((job.requested_options or {}).get("scan_id") or "").strip()
    if not scan_id:
        return None
    scan = db.get(BuildScan, scan_id)
    if (
        scan is None
        or scan.user_id != job.user_id
        or scan.source_sha256 != job.source_sha256
        or str(scan.status or "").strip().lower() != "ready"
        or not isinstance(scan.result_payload, dict)
    ):
        return None
    return dict(scan.result_payload)


def store_delivery_cache(
    db: Session,
    *,
    settings: Any,
    source_sha256: str,
    base_key: str | None,
    addon_keys: list[str],
    result_filename: str,
    content: bytes,
    strategy: str,
    revtech_payload: dict[str, Any] | None = None,
) -> FileDeliveryCache:
    signature = option_signature(base_key, addon_keys)
    cache_root = settings.storage_path / "cache" / source_sha256[:16] / normalize_filename_part(signature)
    cache_root.mkdir(parents=True, exist_ok=True)
    safe_name = normalize_filename_part(result_filename) or "apex-cached.bin"
    result_path = cache_root / safe_name
    result_path.write_bytes(content)
    result_sha = sha256_bytes(content)
    row = find_cached_delivery_row(
        db,
        source_sha256=source_sha256,
        base_key=base_key,
        addon_keys=addon_keys,
    )
    if row is None:
        row = FileDeliveryCache(
            source_sha256=source_sha256,
            option_signature=signature,
            base_tune=str(base_key or "").strip().upper(),
            addon_keys=list(addon_keys or []),
            strategy=strategy,
            result_filename=safe_name,
            result_path=str(result_path),
            result_sha256=result_sha,
            result_size_bytes=len(content),
            revtech_payload=revtech_payload or {},
        )
    else:
        row.strategy = strategy
        row.result_filename = safe_name
        row.result_path = str(result_path)
        row.result_sha256 = result_sha
        row.result_size_bytes = len(content)
        row.revtech_payload = revtech_payload or {}
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


async def process_build_scan(scan_id: str) -> None:
    settings = get_settings()
    client = RevtechClient(settings)
    db = SessionLocal()
    try:
        scan = db.get(BuildScan, scan_id)
        if scan is None:
            return

        file_path = Path(scan.source_path)
        update_scan(db, scan_id, status="scanning", progress=8, current_stage="Fingerprinting file")
        update_scan(db, scan_id, progress=12, current_stage="Scanning database and version merge candidates")
        # Exact matches are still byte/hash validated, while non-exact matches
        # only need a same-project fingerprint plan at scan time. Full patch
        # validation is deferred until the customer chooses the combination.
        match_payload = await client.scan_plan(file_path, max_matches=100)
        matches = [match for match in list(match_payload.get("matches") or []) if isinstance(match, dict)]
        offer = build_match_offer(
            match_payload,
            source_filename=scan.source_filename,
            source_sha256=scan.source_sha256,
            source_size_bytes=scan.source_size_bytes,
        )
        # Tuning-guide gains are cosmetic and may require many sequential API
        # lookups. Resolve them lazily/cached outside the scan critical path.
        offer["stage_gains"] = {}

        buildable_selections = database_buildable_selections(matches)
        for cached_selection in cached_buildable_selections(
            db,
            source_sha256=scan.source_sha256,
        ):
            append_buildable_selection(buildable_selections, cached_selection)

        candidate_selections = scan_candidate_selections(
            match_payload,
            matches,
            prepared_signatures={
                str(entry.get("signature") or "") for entry in buildable_selections
            },
        )
        availability: dict[str, Any] = {
            "base_tunes": {
                key: {
                    "source": "request",
                    "strategy": "request_file",
                    "status": "requestable",
                    "label": BASE_NAMES.get(key, key),
                }
                for key in PATCH_SCAN_BASE_KEYS
            },
            "addon_keys": {
                key: {
                    "source": "request",
                    "strategy": "request_file",
                    "status": "requestable",
                    "label": ADDON_NAMES.get(key, key),
                }
                for key in ADDON_LABELS
            },
            "patch_candidates": [],
            "buildable_selections": buildable_selections,
            "candidate_selections": candidate_selections,
        }
        update_scan(db, scan_id, progress=92, current_stage="Preparing available combinations")
        base_keys: set[str] = set()
        addon_keys: set[str] = set()
        for selection in buildable_selections:
            selection_base = str(selection.get("base_tune") or "").strip().upper()
            selection_addons = [str(key or "").strip().upper() for key in list(selection.get("addon_keys") or [])]
            if selection_base in BASE_LABELS:
                base_keys.add(selection_base)
                availability["base_tunes"][selection_base] = {
                    "source": selection.get("source") or "database",
                    "strategy": selection.get("strategy") or "prepared",
                    "status": "found",
                    "label": BASE_NAMES.get(selection_base, selection_base),
                }
            for addon in selection_addons:
                if addon not in ADDON_LABELS:
                    continue
                addon_keys.add(addon)
                availability["addon_keys"][addon] = {
                    "source": selection.get("source") or "database",
                    "strategy": selection.get("strategy") or "prepared",
                    "status": "found",
                    "label": ADDON_NAMES.get(addon, addon),
                }

        offer["base_tunes"] = [key for key in BASE_LABELS if key in base_keys]
        offer["addon_keys"] = [key for key in ADDON_LABELS if key in addon_keys]
        offer["availability"] = availability
        offer["matched"] = bool(buildable_selections or candidate_selections)
        offer["message"] = "Scan found delivery candidates." if offer["matched"] else "No delivery candidates were found."

        update_scan(
            db,
            scan_id,
            status="ready",
            progress=100,
            current_stage="Scan complete",
            result_payload=offer,
            error_message=None,
        )
    except Exception as exc:
        logger.exception("Apex build scan %s failed", scan_id)
        update_scan(
            db,
            scan_id,
            status="failed",
            progress=100,
            current_stage="Scan failed",
            error_message=customer_safe_error(exc),
        )
    finally:
        db.close()


async def process_build_job(job_id: str) -> None:
    settings = get_settings()
    client = RevtechClient(settings)
    failure_payload: dict[str, Any] = {}

    db = SessionLocal()
    try:
        job = db.get(BuildJob, job_id)
        if job is None:
            return

        file_path = Path(job.source_path)
        addon_keys = list((job.requested_options or {}).get("addon_keys") or [])
        scan_offer = linked_scan_offer(db, job)
        if scan_offer is not None:
            failure_payload = {
                "apex_offer": scan_offer,
                "scan_id": str((job.requested_options or {}).get("scan_id") or ""),
            }
        cached = get_cached_delivery(
            db,
            source_sha256=job.source_sha256,
            base_key=job.base_tune,
            addon_keys=addon_keys,
        )
        if cached:
            cached_payload = cached.revtech_payload or {}
            cached_offer = cached_payload.get("apex_offer") if isinstance(cached_payload.get("apex_offer"), dict) else {}
            display_filename = customer_result_filename(
                source_filename=job.source_filename,
                base_key=job.base_tune,
                addon_keys=addon_keys,
                offer=cached_offer,
                fallback_filename=cached.result_filename,
            )
            update_job(
                db,
                job_id,
                status="ready",
                progress=100,
                current_stage="Ready",
                strategy=f"cached_{cached.strategy}",
                result_filename=display_filename,
                result_path=cached.result_path,
                result_sha256=cached.result_sha256,
                revtech_payload={"cache": cached.revtech_payload or {}, "option_signature": cached.option_signature},
            )
            subscription = db.query(Subscription).filter(Subscription.user_id == job.user_id).one_or_none()
            if subscription:
                subscription.files_used_this_period += 1
                db.add(subscription)
                db.commit()
            return

        patch_payload: dict[str, Any] | None = None
        match_payload: dict[str, Any] = {}
        offer = scan_offer or {}
        output_bytes: bytes
        result_filename: str
        strategy = "patch_adaptation"
        scan_candidate = scan_offer is not None and offer_selection_is_candidate(
            scan_offer,
            base_key=job.base_tune,
            addon_keys=addon_keys,
        )

        if scan_candidate:
            unsupported_patch_keys = [key for key in addon_keys if key not in PATCH_ADAPTATION_ADDONS]
            if unsupported_patch_keys:
                labels = display_addons(unsupported_patch_keys)
                raise RevtechClientError(
                    f"{labels} needs a prepared database file. No compatible file was found for this request."
                )
            update_job(
                db,
                job_id,
                status="building",
                progress=52,
                current_stage="Validating selected candidate",
                strategy="patch_adaptation",
                revtech_payload={"apex_offer": offer},
            )
            patch_payload, output_bytes, result_filename = await client.run_patch_adaptation(
                file_path,
                base_key=job.base_tune,
                addon_keys=addon_keys,
            )
        else:
            update_job(db, job_id, status="scanning", progress=12, current_stage="Fingerprinting file")
            await asyncio.sleep(0.35 if not settings.revtech_enabled else 0)

            update_job(db, job_id, progress=28, current_stage="Scanning file matches")
            match_payload = await client.match_bin(file_path, max_matches=50, exact_only=False)
            matches = [match for match in list(match_payload.get("matches") or []) if isinstance(match, dict)]
            offer = build_match_offer(
                match_payload,
                source_filename=job.source_filename,
                source_sha256=job.source_sha256,
                source_size_bytes=job.source_size_bytes,
            )
            failure_payload = {
                "apex_offer": scan_offer or offer,
                **({"match_offer": offer} if scan_offer is not None else {}),
            }
            exact_match = exact_or_strong_match(matches)

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
                revtech_payload={"scan": match_payload, "apex_offer": offer},
            )
            await asyncio.sleep(0.45 if not settings.revtech_enabled else 0)

            top_match, top_project, direct_version, merge_versions = select_delivery_candidate(matches, job.base_tune, addon_keys)
            if top_match is None:
                top_match = exact_match or (matches[0] if matches else None)
            if top_project is None and isinstance(top_match, dict):
                candidate_project = top_match.get("project")
                top_project = candidate_project if isinstance(candidate_project, dict) else None

            if direct_version:
                if not isinstance(top_project, dict):
                    raise RevtechClientError("Revtech returned an invalid exact-match project.")
                if is_fileserver_library_exact(top_match, top_project):
                    package_entry = select_fileserver_package(top_match, top_project, direct_version)
                    final_file_blob_id = str((package_entry or {}).get("final_file_blob_id") or "").strip()
                    if not final_file_blob_id:
                        raise RevtechClientError("The saved database delivery is missing its file reference.")
                    update_job(db, job_id, progress=68, current_stage="Preparing matched file", strategy="fileserver_direct")
                    output_bytes, headers = await client.download_file_blob(final_file_blob_id)
                    fallback_name = str((package_entry or {}).get("final_filename") or "").strip() or "apex-file.bin"
                    result_filename = output_filename_from_headers(headers, fallback_name)
                    strategy = "fileserver_direct"
                else:
                    project_filename, project_path, client_name = project_live_identifiers(top_project)
                    update_job(db, job_id, progress=68, current_stage="Exporting matched version", strategy="exact_match")
                    output_bytes, headers = await client.export_version(
                        file_path,
                        project_filename=project_filename,
                        project_path=project_path,
                        client_name=client_name,
                        version_name=str(direct_version.get("name") or ""),
                        version_index=direct_version.get("index") if isinstance(direct_version.get("index"), int) else None,
                    )
                    result_filename = output_filename_from_headers(headers, "apex-exact-match.bin")
                    strategy = "exact_match"
            elif merge_versions:
                if not isinstance(top_project, dict):
                    raise RevtechClientError("Revtech returned an invalid version-merge project.")
                if is_fileserver_library_exact(top_match, top_project):
                    raise RevtechClientError("This request needs a prepared database file. No compatible file was found for this request.")
                project_filename, project_path, client_name = project_live_identifiers(top_project)
                update_job(db, job_id, progress=68, current_stage="Merging requested versions", strategy="version_merge")
                merge_label = " + ".join(str(version.get("name") or "") for version in merge_versions if version.get("name"))
                output_bytes, headers = await client.merge_versions(
                    file_path,
                    project_filename=project_filename,
                    project_path=project_path,
                    client_name=client_name,
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
                        f"{labels} needs a prepared database file. No compatible file was found for this request."
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
        result_filename = customer_result_filename(
            source_filename=job.source_filename,
            base_key=job.base_tune,
            addon_keys=addon_keys,
            offer=offer,
            fallback_filename=result_filename,
        )
        result_path = output_dir / result_filename

        result_path.write_bytes(output_bytes)
        result_sha = sha256_bytes(output_bytes)

        final_payload = {"apex_offer": offer}
        if match_payload:
            final_payload["scan"] = match_payload
        if patch_payload:
            final_payload["patch_adaptation"] = patch_payload

        store_delivery_cache(
            db,
            settings=settings,
            source_sha256=job.source_sha256,
            base_key=job.base_tune,
            addon_keys=addon_keys,
            result_filename=result_filename,
            content=output_bytes,
            strategy=strategy,
            revtech_payload=final_payload,
        )

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
            revtech_payload={**failure_payload, "error_type": exc.__class__.__name__},
        )
    finally:
        db.close()
