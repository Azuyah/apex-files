from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx

from ..settings import Settings


class RevtechClientError(RuntimeError):
    pass


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

    async def health(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/admin/fileserver/ols/live/health",
                headers=self._headers(),
            )
        if response.status_code >= 400:
            raise RevtechClientError(response.text or f"Revtech health failed with {response.status_code}")
        return response.json()

    async def match_bin(self, file_path: Path, *, max_matches: int = 50) -> dict[str, Any]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data = {"max_matches": str(max_matches), "exact_only": "true"}
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

    async def export_version(
        self,
        file_path: Path,
        *,
        project_filename: str,
        project_path: str | None = None,
        version_name: str | None = None,
        version_index: int | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data: dict[str, str] = {"project_filename": project_filename}
            if project_path:
                data["project_path"] = project_path
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

    async def run_patch_adaptation(
        self,
        file_path: Path,
        *,
        base_key: str | None,
        addon_keys: list[str],
    ) -> tuple[dict[str, Any], bytes, str]:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, "application/octet-stream")}
            data = {
                "base_key": base_key or "",
                "addon_keys": json.dumps(addon_keys),
                "max_matches": "50",
                "max_candidates": "8",
                "include_output": "true",
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
        payload = response.json()
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
