from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import httpx

from ..settings import Settings


class RevtechClientError(RuntimeError):
    pass


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _field(payload: Any, *names: str) -> Any:
    if not isinstance(payload, dict):
        return None
    for name in names:
        if name in payload and payload[name] is not None:
            return payload[name]
    return None


def _as_list(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "results", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _clean_text(value).lower()).strip()


def _compact_norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", _clean_text(value).lower())


def _tokens(value: Any) -> set[str]:
    return {part for part in _norm(value).split() if part}


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(round(float(str(value).replace(",", ".").strip())))
    except (TypeError, ValueError):
        return None


def _file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _score_text(candidate_values: list[Any], query_values: list[Any]) -> int:
    score = 0
    for candidate in candidate_values:
        candidate_text = _norm(candidate)
        candidate_compact = _compact_norm(candidate)
        if not candidate_text:
            continue
        candidate_tokens = _tokens(candidate_text)
        for query in query_values:
            query_text = _norm(query)
            query_compact = _compact_norm(query)
            if not query_text:
                continue
            if candidate_compact and query_compact and candidate_compact == query_compact:
                score += 90
            elif candidate_compact and query_compact and (candidate_compact in query_compact or query_compact in candidate_compact):
                score += 45
            query_tokens = _tokens(query_text)
            if candidate_tokens and query_tokens:
                overlap = len(candidate_tokens & query_tokens)
                if overlap:
                    score += int(25 * (overlap / max(1, len(query_tokens))))
    return score


def _parse_power_torque(*values: Any) -> tuple[int | None, int | None]:
    text = " ".join(_clean_text(value) for value in values)
    hp_match = re.search(r"\b(\d{2,4})\s*(?:hp|bhp|ps|hk)\b", text, re.IGNORECASE)
    nm_match = re.search(r"\b(\d{2,4})\s*nm\b", text, re.IGNORECASE)
    return (
        _to_int(hp_match.group(1)) if hp_match else None,
        _to_int(nm_match.group(1)) if nm_match else None,
    )


def _extract_years(*values: Any) -> list[int]:
    years: list[int] = []
    for value in values:
        for match in re.findall(r"\b(19\d{2}|20\d{2})\b", _clean_text(value)):
            year = int(match)
            if year not in years:
                years.append(year)
    return years


def _year_score(generation: dict[str, Any], years: list[int]) -> int:
    if not years:
        return 0
    year_from = _to_int(_field(generation, "yearFrom", "year_from"))
    year_to = _to_int(_field(generation, "yearTo", "year_to"))
    if year_from is None and year_to is None:
        return 0
    score = 0
    for year in years:
        if (year_from is None or year >= year_from) and (year_to is None or year <= year_to):
            score += 18
    return score


def _stage_key(stage_no: int | None) -> str | None:
    if stage_no == 1:
        return "STAGE1"
    if stage_no == 2:
        return "STAGE2"
    return None


def _stage_gain_payload(engine_full: dict[str, Any]) -> dict[str, dict[str, Any]]:
    tuning = _field(engine_full, "tuning") or {}
    engine = _field(engine_full, "engine") or {}
    stages = _as_list(_field(tuning, "stages"))
    base_hp = _to_int(_field(tuning, "basePowerHP", "base_power_hp")) or _to_int(_field(engine, "powerHp", "power_hp"))
    base_nm = _to_int(_field(tuning, "baseTorqueNm", "base_torque_nm")) or _to_int(_field(engine, "torqueNm", "torque_nm"))

    gains: dict[str, dict[str, Any]] = {}
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        stage_no = _to_int(_field(stage, "stageNo", "stage_no"))
        key = _stage_key(stage_no)
        if not key:
            continue
        power_hp = _to_int(_field(stage, "powerHP", "powerHp", "power_hp"))
        torque_nm = _to_int(_field(stage, "torqueNm", "torque_nm"))
        gain_hp = _to_int(_field(stage, "powerIncreaseHP", "power_increase_hp"))
        gain_nm = _to_int(_field(stage, "torqueIncreaseNm", "torque_increase_nm"))
        if gain_hp is None and power_hp is not None and base_hp is not None:
            gain_hp = max(0, power_hp - base_hp)
        if gain_nm is None and torque_nm is not None and base_nm is not None:
            gain_nm = max(0, torque_nm - base_nm)

        if power_hp is not None and torque_nm is not None:
            display = f"~{power_hp} HP / ~{torque_nm} Nm"
        elif gain_hp is not None and gain_nm is not None:
            display = f"+{gain_hp} HP / +{gain_nm} Nm"
        else:
            display = ""

        gains[key] = {
            "stage_no": stage_no,
            "base_hp": base_hp,
            "base_nm": base_nm,
            "power_hp": power_hp,
            "torque_nm": torque_nm,
            "gain_hp": gain_hp,
            "gain_nm": gain_nm,
            "display": display,
            "gain_display": f"+{gain_hp} HP / +{gain_nm} Nm" if gain_hp is not None and gain_nm is not None else "",
        }
    return gains


class RevtechClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.revtech_api_base_url.rstrip("/")
        self.timeout = settings.revtech_timeout_seconds

    @property
    def configured(self) -> bool:
        return self.settings.revtech_configured

    def _headers(self) -> dict[str, str]:
        token = self.settings.revtech_service_token.strip()
        if not self.configured:
            raise RevtechClientError(
                "Revtech integration is not configured. Set REVTECH_INTEGRATION_MODE=revtech and REVTECH_SERVICE_TOKEN."
            )
        headers = {"X-Apex-Files-App": "apex-files-desktop"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _get_json(self, client: httpx.AsyncClient, path: str) -> Any:
        response = await client.get(f"{self.base_url}{path}", headers=self._headers())
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech request failed with {response.status_code}")
        return response.json()

    async def vehicle_stage_gains(self, metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
        brand = _clean_text(metadata.get("brand"))
        vehicle = _clean_text(metadata.get("vehicle"))
        model = _clean_text(metadata.get("model"))
        generation = _clean_text(metadata.get("generation"))
        engine = _clean_text(metadata.get("engine"))
        engine_code = _clean_text(metadata.get("engine_code"))
        ecu_type = _clean_text(metadata.get("ecu_type"))
        hp_hint, nm_hint = _parse_power_torque(engine, vehicle)
        years = _extract_years(vehicle, generation)

        if not (brand or vehicle) or not (model or vehicle):
            return {}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            makes = [item for item in _as_list(await self._get_json(client, "/tuningguide/makes")) if isinstance(item, dict)]
            make = max(
                makes,
                key=lambda item: _score_text([_field(item, "name"), _field(item, "slug")], [brand, vehicle]),
                default=None,
            )
            if not make or _score_text([_field(make, "name"), _field(make, "slug")], [brand, vehicle]) <= 0:
                return {}

            make_slug = _clean_text(_field(make, "slug"))
            if not make_slug:
                return {}
            models = [
                item
                for item in _as_list(await self._get_json(client, f"/tuningguide/makes/{make_slug}/models"))
                if isinstance(item, dict)
            ]
            scored_models = sorted(
                (
                    (_score_text([_field(item, "name"), _field(item, "slug")], [model, vehicle]), item)
                    for item in models
                ),
                key=lambda item: item[0],
                reverse=True,
            )
            model_candidates = [item for score, item in scored_models[:4] if score > 0]
            if not model_candidates:
                return {}

            best_engine: tuple[int, dict[str, Any]] | None = None
            for model_item in model_candidates:
                model_id = _to_int(_field(model_item, "id"))
                if model_id is None:
                    continue
                try:
                    raw_generations = await self._get_json(client, f"/tuningguide/models/{model_id}/generations")
                except RevtechClientError:
                    continue
                generations = [item for item in _as_list(raw_generations) if isinstance(item, dict)]
                scored_generations = sorted(
                    (
                        (
                            _score_text([_field(item, "name"), _field(item, "slug")], [generation, vehicle])
                            + _year_score(item, years),
                            item,
                        )
                        for item in generations
                    ),
                    key=lambda item: item[0],
                    reverse=True,
                )
                generation_candidates = [item for _, item in scored_generations[:5]] or generations[:5]
                for generation_item in generation_candidates:
                    generation_id = _to_int(_field(generation_item, "id"))
                    if generation_id is None:
                        continue
                    try:
                        raw_engines = await self._get_json(client, f"/tuningguide/generations/{generation_id}/engines")
                    except RevtechClientError:
                        continue
                    engines = [item for item in _as_list(raw_engines) if isinstance(item, dict)]
                    for engine_item in engines:
                        score = _score_text(
                            [
                                _field(engine_item, "name"),
                                _field(engine_item, "slug"),
                                _field(engine_item, "engineCode", "engine_code"),
                                _field(engine_item, "ecu"),
                            ],
                            [engine, engine_code, ecu_type, vehicle],
                        )
                        candidate_hp = _to_int(_field(engine_item, "powerHp", "power_hp"))
                        candidate_nm = _to_int(_field(engine_item, "torqueNm", "torque_nm"))
                        if hp_hint is not None and candidate_hp is not None:
                            score += max(0, 24 - abs(hp_hint - candidate_hp))
                        if nm_hint is not None and candidate_nm is not None:
                            score += max(0, 18 - abs(nm_hint - candidate_nm) // 2)
                        score += _year_score(generation_item, years)
                        if best_engine is None or score > best_engine[0]:
                            best_engine = (score, engine_item)

            if not best_engine or best_engine[0] <= 0:
                return {}
            engine_id = _to_int(_field(best_engine[1], "id"))
            if engine_id is None:
                return {}
            engine_full = await self._get_json(client, f"/tuningguide/engines/{engine_id}")
            if not isinstance(engine_full, dict):
                return {}
            return _stage_gain_payload(engine_full)

    async def health(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/admin/fileserver/ols/live/health",
                headers=self._headers(),
            )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech health failed with {response.status_code}")
        return response.json()

    async def match_bin(self, file_path: Path, *, max_matches: int = 50, exact_only: bool = True) -> dict[str, Any]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data = {"max_matches": str(max_matches), "exact_only": "true" if exact_only else "false"}
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/admin/fileserver/ols/live/match/bin",
                    headers=self._headers(),
                    data=data,
                    files=files,
                )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech match failed with {response.status_code}")
        return response.json()

    async def scan_plan(
        self,
        file_path: Path,
        *,
        max_matches: int = 100,
        selected_ecu_combo: str | None = None,
        selected_brand: str | None = None,
        selected_model: str | None = None,
        selected_generation: str | None = None,
    ) -> dict[str, Any]:
        expected_sha256 = _file_sha256(file_path)
        expected_size = file_path.stat().st_size
        data = {"max_matches": str(max_matches)}
        for key, value in (
            ("selected_ecu_combo", selected_ecu_combo),
            ("selected_brand", selected_brand),
            ("selected_model", selected_model),
            ("selected_generation", selected_generation),
        ):
            clean_value = _clean_text(value)
            if clean_value:
                data[key] = clean_value

        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/admin/fileserver/ols/live/patch-adaptation/scan-plan",
                    headers=self._headers(),
                    data=data,
                    files=files,
                )

        if response.status_code in {404, 405}:
            return await self.match_bin(file_path, max_matches=max_matches, exact_only=False)
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech scan plan failed with {response.status_code}")

        try:
            payload = response.json()
        except ValueError:
            payload = None
        bin_payload = payload.get("bin") if isinstance(payload, dict) and isinstance(payload.get("bin"), dict) else {}
        matches = payload.get("matches") if isinstance(payload, dict) else None
        compatible_bin = (
            str(bin_payload.get("sha256") or "").strip().lower() == expected_sha256
            and _to_int(bin_payload.get("size_bytes")) == expected_size
        )
        compatible_matches = isinstance(matches, list) and all(
            isinstance(match, dict) and isinstance(match.get("project"), dict)
            for match in matches
        )
        if not compatible_bin or not compatible_matches:
            return await self.match_bin(file_path, max_matches=max_matches, exact_only=False)
        return payload

    async def export_version(
        self,
        file_path: Path,
        *,
        project_filename: str,
        project_path: str | None = None,
        client_name: str | None = None,
        version_name: str | None = None,
        version_index: int | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data: dict[str, str] = {"project_filename": project_filename}
            if project_path:
                data["project_path"] = project_path
            if client_name:
                data["client_name"] = client_name
            if version_name:
                data["version_name"] = version_name
            if version_index is not None:
                data["version_index"] = str(version_index)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/admin/fileserver/ols/live/export-bin",
                    headers=self._headers(),
                    data=data,
                    files=files,
                )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech export failed with {response.status_code}")
        return response.content, dict(response.headers)

    async def merge_versions(
        self,
        file_path: Path,
        *,
        project_filename: str,
        project_path: str | None = None,
        client_name: str | None = None,
        versions: list[dict[str, Any]],
        merged_version_name: str,
    ) -> tuple[bytes, dict[str, str]]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data: dict[str, str] = {
                "project_filename": project_filename,
                "versions": json.dumps(versions),
                "merged_version_name": merged_version_name,
            }
            if project_path:
                data["project_path"] = project_path
            if client_name:
                data["client_name"] = client_name
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/admin/fileserver/ols/live/merge-bin",
                    headers=self._headers(),
                    data=data,
                    files=files,
                )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech merge failed with {response.status_code}")
        return response.content, dict(response.headers)

    async def download_file_blob(self, file_id: str) -> tuple[bytes, dict[str, str]]:
        file_id = str(file_id or "").strip()
        if not file_id:
            raise RevtechClientError("Saved delivery file reference is missing.")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/admin/fileserver/files/{file_id}/download",
                headers=self._headers(),
            )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech saved delivery download failed with {response.status_code}")
        return response.content, dict(response.headers)

    async def run_patch_adaptation(
        self,
        file_path: Path,
        *,
        base_key: str | None,
        addon_keys: list[str],
    ) -> tuple[dict[str, Any], bytes, str]:
        payload = await self.patch_adaptation_test(
            file_path,
            base_key=base_key,
            addon_keys=addon_keys,
            max_matches=100,
            max_candidates=100,
            include_output=True,
        )
        candidates = payload.get("candidates") or []
        for candidate in candidates:
            if str(candidate.get("status") or "").lower() != "success":
                continue
            output = candidate.get("output") or {}
            content_b64 = str(output.get("content_b64") or "")
            if content_b64:
                filename = str(output.get("filename") or "apex-patched.bin")
                return payload, base64.b64decode(content_b64), filename
        raise RevtechClientError(payload.get("message") or "Revtech did not return a safe patch adaptation output.")

    async def patch_adaptation_test(
        self,
        file_path: Path,
        *,
        base_key: str | None,
        addon_keys: list[str],
        max_matches: int = 50,
        max_candidates: int = 8,
        include_output: bool = False,
    ) -> dict[str, Any]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data = {
                "base_key": base_key or "",
                "addon_keys": json.dumps(addon_keys),
                "max_matches": str(max_matches),
                "max_candidates": str(max_candidates),
                "include_output": "true" if include_output else "false",
            }
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/admin/fileserver/ols/live/patch-adaptation/test",
                    headers=self._headers(),
                    data=data,
                    files=files,
                )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech patch adaptation failed with {response.status_code}")
        return response.json()
