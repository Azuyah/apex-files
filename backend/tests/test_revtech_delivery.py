from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.build_pipeline import project_live_identifiers, select_delivery_candidate
from app.services.revtech_client import RevtechClient


class _Response:
    status_code = 200
    text = ""
    content = b"result"
    headers = {"content-disposition": 'attachment; filename="result.bin"'}


class _RecordingAsyncClient:
    calls: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return _Response()


def _settings():
    return SimpleNamespace(
        revtech_api_base_url="https://revtech.invalid/api/proxy",
        revtech_timeout_seconds=30,
        revtech_configured=True,
        revtech_service_token="service-token",
    )


def _project(*, adaptation: bool) -> dict:
    extra_meta = {
        "source": "live_winols_exact_index",
        "winols_project_filename": "project.ols",
        "winols_project_path": r"D:\\WinOLS\\client\\project.ols",
        "indexed_client_name": "client-a",
    }
    if adaptation:
        extra_meta.update(
            {
                "materialized": {"state": "ready", "verified": True},
                "bench_adaptation": {
                    "eligible": True,
                    "requires_adaptation": True,
                },
            }
        )
    return {
        "original_filename": "fallback.ols",
        "available_versions": [
            {"index": 1, "name": "Stage 1"},
            {"index": 2, "name": "EGR off"},
        ],
        "extra_meta": extra_meta,
    }


class DeliverySelectionTests(unittest.TestCase):
    def test_materialized_bench_match_is_not_selected_for_direct_export(self):
        match = {
            "tier": "bench_adaptation",
            "method": "WINOLS_MATERIALIZED_CLOUD_BENCH_ADAPTATION",
            "match_meta": {"match_source": "cloud_materialized_index"},
            "project": _project(adaptation=True),
        }

        self.assertEqual(
            select_delivery_candidate([match], "STAGE1", []),
            (None, None, None, []),
        )

    def test_materialized_bench_match_is_not_selected_for_version_merge(self):
        match = {
            "tier": "bench_adaptation",
            "method": "WINOLS_MATERIALIZED_CLOUD_BENCH_ADAPTATION",
            "match_meta": {"match_source": "cloud_materialized_index"},
            "project": _project(adaptation=True),
        }

        self.assertEqual(
            select_delivery_candidate([match], "STAGE1", ["EGR_OFF"]),
            (None, None, None, []),
        )

    def test_exact_match_still_selects_direct_export(self):
        project = _project(adaptation=False)
        match = {"tier": "exact", "method": "EXACT_BYTES", "project": project}

        selected_match, selected_project, direct, merge = select_delivery_candidate(
            [match], "STAGE1", []
        )

        self.assertIs(selected_match, match)
        self.assertIs(selected_project, project)
        self.assertEqual(direct, {"index": 1, "name": "Stage 1"})
        self.assertEqual(merge, [])

    def test_exact_match_still_selects_version_merge(self):
        project = _project(adaptation=False)
        match = {"tier": "exact", "method": "EXACT_BYTES", "project": project}

        selected_match, selected_project, direct, merge = select_delivery_candidate(
            [match], "STAGE1", ["EGR_OFF"]
        )

        self.assertIs(selected_match, match)
        self.assertIs(selected_project, project)
        self.assertIsNone(direct)
        self.assertEqual(
            merge,
            [
                {"index": 1, "name": "Stage 1"},
                {"index": 2, "name": "EGR off"},
            ],
        )

    def test_fileserver_exact_match_still_selects_direct_delivery(self):
        project = _project(adaptation=False)
        project["extra_meta"] = {
            "source": "fileserver_library_exact",
            "fileserver_library_match": {"direct_delivery": True},
        }
        match = {
            "tier": "exact",
            "match_meta": {"match_source": "fileserver_library_exact"},
            "project": project,
        }

        selected_match, selected_project, direct, merge = select_delivery_candidate(
            [match], "STAGE1", []
        )

        self.assertIs(selected_match, match)
        self.assertIs(selected_project, project)
        self.assertEqual(direct, {"index": 1, "name": "Stage 1"})
        self.assertEqual(merge, [])

    def test_project_identifiers_include_indexed_client_name(self):
        self.assertEqual(
            project_live_identifiers(_project(adaptation=False)),
            ("project.ols", r"D:\\WinOLS\\client\\project.ols", "client-a"),
        )

    def test_project_identifiers_accept_client_name_fallback(self):
        project = _project(adaptation=False)
        project["extra_meta"].pop("indexed_client_name")
        project["extra_meta"]["client_name"] = "legacy-client"

        self.assertEqual(project_live_identifiers(project)[2], "legacy-client")


class RevtechClientDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _RecordingAsyncClient.calls.clear()
        self.client = RevtechClient(_settings())
        self.temp_dir = tempfile.TemporaryDirectory()
        self.file_path = Path(self.temp_dir.name) / "input.bin"
        self.file_path.write_bytes(b"input")

    async def asyncTearDown(self):
        self.temp_dir.cleanup()

    async def test_export_sends_client_name(self):
        with patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient):
            await self.client.export_version(
                self.file_path,
                project_filename="project.ols",
                project_path=r"D:\\WinOLS\\client\\project.ols",
                client_name="client-a",
                version_name="Stage 1",
                version_index=1,
            )

        data = _RecordingAsyncClient.calls[0]["data"]
        self.assertEqual(data["client_name"], "client-a")
        self.assertEqual(data["project_filename"], "project.ols")
        self.assertEqual(data["version_index"], "1")

    async def test_merge_sends_client_name(self):
        versions = [
            {"version_name": "Stage 1", "version_index": 1},
            {"version_name": "EGR off", "version_index": 2},
        ]
        with patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient):
            await self.client.merge_versions(
                self.file_path,
                project_filename="project.ols",
                project_path=r"D:\\WinOLS\\client\\project.ols",
                client_name="client-a",
                versions=versions,
                merged_version_name="Stage 1 + EGR off",
            )

        data = _RecordingAsyncClient.calls[0]["data"]
        self.assertEqual(data["client_name"], "client-a")
        self.assertEqual(json.loads(data["versions"]), versions)


if __name__ == "__main__":
    unittest.main()
