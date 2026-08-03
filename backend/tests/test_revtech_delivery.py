from __future__ import annotations

import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.builds import validated_scan_offer
from app.services.build_pipeline import (
    adaptation_candidate_selections,
    append_buildable_selection,
    buildable_selection,
    cached_buildable_selections,
    database_buildable_selections,
    first_successful_patch_output,
    get_cached_delivery,
    offer_selection_is_buildable,
    offer_selection_is_candidate,
    process_build_job,
    process_build_scan,
    project_live_identifiers,
    scan_candidate_selections,
    select_delivery_candidate,
)
from app.services.revtech_client import RevtechClient


class _Response:
    def __init__(self, *, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"matches": []}
        self.text = text
        self.content = b"result"
        self.headers = {"content-disposition": 'attachment; filename="result.bin"'}

    def json(self):
        return self._payload


class _RecordingAsyncClient:
    calls: list[dict] = []
    response = _Response()

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.response


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


class BuildableSelectionContractTests(unittest.TestCase):
    def test_separate_found_options_do_not_imply_a_buildable_union(self):
        selections = [
            buildable_selection(base_key="STAGE1", addon_keys=[], source="patch", strategy="cached"),
            buildable_selection(base_key="", addon_keys=["EGR_OFF"], source="patch", strategy="cached"),
            buildable_selection(base_key="", addon_keys=["DPF_OFF"], source="patch", strategy="cached"),
        ]
        offer = {"availability": {"buildable_selections": selections}}

        self.assertTrue(offer_selection_is_buildable(offer, base_key="STAGE1", addon_keys=[]))
        self.assertTrue(offer_selection_is_buildable(offer, base_key="", addon_keys=["DPF_OFF"]))
        self.assertFalse(
            offer_selection_is_buildable(
                offer,
                base_key="STAGE1",
                addon_keys=["EGR_OFF", "DPF_OFF"],
            )
        )

    def test_only_valid_existing_cache_files_are_buildable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            valid_path = Path(temp_dir) / "cached.bin"
            valid_path.write_bytes(b"cached")
            valid_sha256 = hashlib.sha256(valid_path.read_bytes()).hexdigest()
            rows = [
                SimpleNamespace(
                    id="cache-valid",
                    base_tune="stage1",
                    addon_keys=["EGR_OFF"],
                    option_signature="base=STAGE1|addons=EGR_OFF",
                    strategy="patch_adaptation",
                    result_path=str(valid_path),
                    result_size_bytes=valid_path.stat().st_size,
                    result_sha256=valid_sha256,
                ),
                SimpleNamespace(
                    id="cache-stale",
                    base_tune="",
                    addon_keys=["DPF_OFF"],
                    option_signature="base=|addons=DPF_OFF",
                    strategy="patch_adaptation",
                    result_path=str(Path(temp_dir) / "missing.bin"),
                    result_size_bytes=6,
                    result_sha256=valid_sha256,
                ),
                SimpleNamespace(
                    id="cache-mismatched",
                    base_tune="STAGE1",
                    addon_keys=[],
                    option_signature="base=STAGE2|addons=",
                    strategy="exact_match",
                    result_path=str(valid_path),
                    result_size_bytes=valid_path.stat().st_size,
                    result_sha256=valid_sha256,
                ),
                SimpleNamespace(
                    id="cache-wrong-size",
                    base_tune="STAGE2",
                    addon_keys=[],
                    option_signature="base=STAGE2|addons=",
                    strategy="patch_adaptation",
                    result_path=str(valid_path),
                    result_size_bytes=valid_path.stat().st_size + 1,
                    result_sha256=valid_sha256,
                ),
                SimpleNamespace(
                    id="cache-wrong-hash",
                    base_tune="",
                    addon_keys=["DPF_OFF"],
                    option_signature="base=|addons=DPF_OFF",
                    strategy="patch_adaptation",
                    result_path=str(valid_path),
                    result_size_bytes=valid_path.stat().st_size,
                    result_sha256="0" * 64,
                ),
            ]

            class Query:
                def filter(self, *args):
                    return self

                def order_by(self, *args):
                    return self

                def all(self):
                    return rows

                def first(self):
                    return rows[-1]

            db = SimpleNamespace(query=lambda model: Query())
            selections = cached_buildable_selections(db, source_sha256="source-sha")
            corrupt_delivery = get_cached_delivery(
                db,
                source_sha256="source-sha",
                base_key="",
                addon_keys=["DPF_OFF"],
            )

        self.assertEqual(
            selections,
            [
                {
                    "signature": "base=STAGE1|addons=EGR_OFF",
                    "base_tune": "STAGE1",
                    "addon_keys": ["EGR_OFF"],
                    "source": "cache",
                    "strategy": "cached_patch_adaptation",
                    "cache_id": "cache-valid",
                }
            ],
        )
        self.assertIsNone(corrupt_delivery)

    def test_server_candidate_selections_override_local_project_derivation(self):
        match = {"tier": "bench_adaptation", "project": _project(adaptation=True)}
        payload = {
            "candidate_selections": [
                {
                    "signature": "base=|addons=EGR_OFF",
                    "base_tune": "",
                    "addon_keys": ["EGR_OFF"],
                    "candidate_project_count": 1,
                }
            ]
        }

        selections = scan_candidate_selections(payload, [match])

        self.assertEqual(
            {entry["signature"] for entry in selections},
            {"base=|addons=EGR_OFF"},
        )

    def test_buildable_signatures_are_canonical_and_deduplicated(self):
        selections: list[dict] = []
        append_buildable_selection(
            selections,
            buildable_selection(
                base_key="stage1",
                addon_keys=["DPF_OFF", "EGR_OFF"],
                source="database",
                strategy="merge",
            ),
        )
        append_buildable_selection(
            selections,
            buildable_selection(
                base_key="STAGE1",
                addon_keys=["EGR_OFF", "DPF_OFF"],
                source="database",
                strategy="merge",
            ),
        )

        self.assertEqual(len(selections), 1)
        self.assertEqual(selections[0]["signature"], "base=STAGE1|addons=DPF_OFF,EGR_OFF")

    def test_database_projects_are_not_cross_merged(self):
        stage_project = _project(adaptation=False)
        stage_project["available_versions"] = [{"index": 1, "name": "Stage 1"}]
        dpf_project = _project(adaptation=False)
        dpf_project["extra_meta"]["winols_project_filename"] = "dpf-project.ols"
        dpf_project["available_versions"] = [{"index": 3, "name": "DPF off"}]
        matches = [
            {"tier": "exact", "method": "EXACT_BYTES", "project": stage_project},
            {"tier": "exact", "method": "EXACT_BYTES", "project": dpf_project},
        ]

        selections = database_buildable_selections(matches)
        signatures = {selection["signature"] for selection in selections}

        self.assertIn("base=STAGE1|addons=", signatures)
        self.assertIn("base=|addons=DPF_OFF", signatures)
        self.assertNotIn("base=STAGE1|addons=DPF_OFF", signatures)

    def test_same_project_versions_can_form_a_verified_merge_selection(self):
        project = _project(adaptation=False)
        matches = [{"tier": "exact", "method": "EXACT_BYTES", "project": project}]

        signatures = {
            selection["signature"]
            for selection in database_buildable_selections(matches)
        }

        self.assertIn("base=STAGE1|addons=EGR_OFF", signatures)

    def test_patch_success_without_downloadable_output_is_not_buildable(self):
        payload = {"candidates": [{"status": "success", "output": {}}]}

        self.assertIsNone(first_successful_patch_output(payload))

    def test_adaptation_candidate_requires_one_project_with_a_complete_version_plan(self):
        compatible_project = _project(adaptation=True)
        incompatible_dpf_project = _project(adaptation=True)
        incompatible_dpf_project["extra_meta"]["winols_project_filename"] = "dpf-only.ols"
        incompatible_dpf_project["original_filename"] = "dpf-only.ols"
        incompatible_dpf_project["available_versions"] = [{"index": 4, "name": "DPF off"}]
        matches = [
            {"tier": "bench_adaptation", "project": compatible_project},
            {"tier": "bench_adaptation", "project": incompatible_dpf_project},
        ]

        selections = adaptation_candidate_selections(matches)
        signatures = {selection["signature"] for selection in selections}

        self.assertIn("base=STAGE1|addons=EGR_OFF", signatures)
        self.assertNotIn("base=STAGE1|addons=DPF_OFF,EGR_OFF", signatures)

    def test_prepared_selection_is_not_duplicated_as_candidate(self):
        match = {"tier": "bench_adaptation", "project": _project(adaptation=True)}

        selections = adaptation_candidate_selections(
            [match],
            prepared_signatures={"base=STAGE1|addons=EGR_OFF"},
        )

        self.assertNotIn(
            "base=STAGE1|addons=EGR_OFF",
            {selection["signature"] for selection in selections},
        )

    def test_candidate_contract_is_separate_from_prepared_contract(self):
        offer = {
            "availability": {
                "buildable_selections": [
                    buildable_selection(base_key="STAGE1", addon_keys=[], source="cache", strategy="cached")
                ],
                "candidate_selections": [
                    {
                        "signature": "base=STAGE1|addons=EGR_OFF",
                        "base_tune": "STAGE1",
                        "addon_keys": ["EGR_OFF"],
                    }
                ],
            }
        }

        self.assertFalse(offer_selection_is_buildable(offer, base_key="STAGE1", addon_keys=["EGR_OFF"]))
        self.assertTrue(offer_selection_is_candidate(offer, base_key="STAGE1", addon_keys=["EGR_OFF"]))

    def test_legacy_contract_allows_only_single_options(self):
        offer = {"base_tunes": ["STAGE1"], "addon_keys": ["EGR_OFF", "DPF_OFF"]}

        self.assertTrue(offer_selection_is_buildable(offer, base_key="", addon_keys=["DPF_OFF"]))
        self.assertFalse(
            offer_selection_is_buildable(
                offer,
                base_key="STAGE1",
                addon_keys=["EGR_OFF", "DPF_OFF"],
            )
        )


class RevtechClientDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _RecordingAsyncClient.calls.clear()
        _RecordingAsyncClient.response = _Response()
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

    async def test_scan_plan_uses_preliminary_endpoint(self):
        payload = {
            "status": "ok",
            "bin": {
                "sha256": hashlib.sha256(self.file_path.read_bytes()).hexdigest(),
                "size_bytes": self.file_path.stat().st_size,
            },
            "matches": [{"project": {"id": "project-1"}}],
        }
        _RecordingAsyncClient.response = _Response(payload=payload)

        with patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient):
            result = await self.client.scan_plan(self.file_path, max_matches=100)

        self.assertIs(result, payload)
        call = _RecordingAsyncClient.calls[0]
        self.assertTrue(call["url"].endswith("/admin/fileserver/ols/live/patch-adaptation/scan-plan"))
        self.assertEqual(call["data"], {"max_matches": "100"})

    async def test_scan_plan_falls_back_only_when_endpoint_is_unavailable(self):
        _RecordingAsyncClient.response = _Response(status_code=404, text="not found")
        fallback_payload = {"matches": []}

        with (
            patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient),
            patch.object(
                self.client,
                "match_bin",
                AsyncMock(return_value=fallback_payload),
            ) as fallback,
        ):
            result = await self.client.scan_plan(self.file_path, max_matches=100)

        self.assertIs(result, fallback_payload)
        fallback.assert_awaited_once_with(self.file_path, max_matches=100, exact_only=False)

    async def test_scan_plan_falls_back_when_response_belongs_to_another_file(self):
        _RecordingAsyncClient.response = _Response(
            payload={
                "status": "ok",
                "bin": {"sha256": "0" * 64, "size_bytes": self.file_path.stat().st_size},
                "matches": [],
            }
        )
        fallback_payload = {"matches": []}

        with (
            patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient),
            patch.object(
                self.client,
                "match_bin",
                AsyncMock(return_value=fallback_payload),
            ) as fallback,
        ):
            result = await self.client.scan_plan(self.file_path, max_matches=100)

        self.assertIs(result, fallback_payload)
        fallback.assert_awaited_once_with(self.file_path, max_matches=100, exact_only=False)

    async def test_scan_plan_falls_back_for_incompatible_success_schema(self):
        _RecordingAsyncClient.response = _Response(payload={"status": "ok"})
        fallback_payload = {"matches": []}

        with (
            patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient),
            patch.object(
                self.client,
                "match_bin",
                AsyncMock(return_value=fallback_payload),
            ) as fallback,
        ):
            result = await self.client.scan_plan(self.file_path, max_matches=100)

        self.assertIs(result, fallback_payload)
        fallback.assert_awaited_once_with(self.file_path, max_matches=100, exact_only=False)

    async def test_scan_plan_does_not_double_run_after_server_error(self):
        _RecordingAsyncClient.response = _Response(status_code=503, text="unavailable")

        with (
            patch("app.services.revtech_client.httpx.AsyncClient", _RecordingAsyncClient),
            patch.object(self.client, "match_bin", AsyncMock()) as fallback,
        ):
            with self.assertRaisesRegex(Exception, "unavailable"):
                await self.client.scan_plan(self.file_path, max_matches=100)

        fallback.assert_not_awaited()

    async def test_selected_patch_checks_up_to_one_hundred_candidates(self):
        payload = {
            "candidates": [
                {
                    "status": "success",
                    "output": {
                        "filename": "patched.bin",
                        "content_b64": "cGF0Y2hlZA==",
                    },
                }
            ]
        }
        with patch.object(
            self.client,
            "patch_adaptation_test",
            AsyncMock(return_value=payload),
        ) as adaptation_test:
            result_payload, content, filename = await self.client.run_patch_adaptation(
                self.file_path,
                base_key="STAGE1",
                addon_keys=["EGR_OFF"],
            )

        self.assertIs(result_payload, payload)
        self.assertEqual(content, b"patched")
        self.assertEqual(filename, "patched.bin")
        adaptation_test.assert_awaited_once_with(
            self.file_path,
            base_key="STAGE1",
            addon_keys=["EGR_OFF"],
            max_matches=100,
            max_candidates=100,
            include_output=True,
        )


class ScanPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_scan_matches_once_without_eager_patch_calls_and_keeps_selection_contract(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "input.bin"
            source_path.write_bytes(b"input-data" * 8)
            cached_path = Path(temp_dir) / "cached-dpf.bin"
            cached_path.write_bytes(b"cached-dpf")

            scan = SimpleNamespace(
                id="scan-1",
                user_id="user-1",
                source_filename="input.bin",
                source_path=str(source_path),
                source_sha256="source-sha",
                source_size_bytes=source_path.stat().st_size,
                status="queued",
                progress=1,
                current_stage="Queued",
                result_payload=None,
                error_message=None,
            )
            cache_rows = [
                SimpleNamespace(
                    id="cache-dpf",
                    base_tune="",
                    addon_keys=["DPF_OFF"],
                    option_signature="base=|addons=DPF_OFF",
                    strategy="patch_adaptation",
                    result_path=str(cached_path),
                    result_size_bytes=cached_path.stat().st_size,
                    result_sha256=hashlib.sha256(cached_path.read_bytes()).hexdigest(),
                )
            ]

            class Query:
                def filter(self, *args):
                    return self

                def order_by(self, *args):
                    return self

                def all(self):
                    return cache_rows

            class Db:
                def get(self, model, row_id):
                    return scan if row_id == scan.id else None

                def query(self, model):
                    return Query()

                def add(self, row):
                    pass

                def commit(self):
                    pass

                def refresh(self, row):
                    pass

                def close(self):
                    pass

            exact_project = _project(adaptation=False)
            exact_project["available_versions"] = [{"index": 1, "name": "Stage 1"}]
            adaptation_project = _project(adaptation=True)
            match_payload = {
                "matches": [
                    {"tier": "exact", "method": "EXACT_BYTES", "project": exact_project},
                    {"tier": "bench_adaptation", "project": adaptation_project},
                ]
            }

            class Client:
                def __init__(self):
                    self.scan_plan_calls = []
                    self.patch_calls = 0
                    self.gain_calls = 0

                async def scan_plan(self, file_path, **kwargs):
                    self.scan_plan_calls.append((file_path, kwargs))
                    return match_payload

                async def vehicle_stage_gains(self, metadata):
                    self.gain_calls += 1
                    return {}

                async def patch_adaptation_test(self, *args, **kwargs):
                    self.patch_calls += 1
                    raise AssertionError("scan must not generate patch outputs")

            client = Client()
            with (
                patch("app.services.build_pipeline.SessionLocal", return_value=Db()),
                patch("app.services.build_pipeline.RevtechClient", return_value=client),
                patch("app.services.build_pipeline.get_settings", return_value=_settings()),
            ):
                await process_build_scan(scan.id)

        self.assertEqual(len(client.scan_plan_calls), 1)
        self.assertEqual(
            client.scan_plan_calls[0][1],
            {"max_matches": 100},
        )
        self.assertEqual(client.patch_calls, 0)
        self.assertEqual(client.gain_calls, 0)
        self.assertEqual(scan.status, "ready")
        offer = scan.result_payload
        self.assertTrue(offer_selection_is_buildable(offer, base_key="STAGE1", addon_keys=[]))
        self.assertTrue(offer_selection_is_buildable(offer, base_key="", addon_keys=["DPF_OFF"]))
        self.assertTrue(offer_selection_is_candidate(offer, base_key="STAGE1", addon_keys=["EGR_OFF"]))
        self.assertFalse(offer_selection_is_candidate(offer, base_key="STAGE1", addon_keys=[]))
        self.assertFalse(offer_selection_is_buildable(offer, base_key="STAGE2", addon_keys=[]))
        self.assertFalse(offer_selection_is_candidate(offer, base_key="STAGE2", addon_keys=[]))

    async def test_candidate_build_skips_redundant_match_and_validates_selected_patch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "input.bin"
            source_path.write_bytes(b"input-data" * 8)
            scan_offer = {
                "metadata": {},
                "availability": {
                    "buildable_selections": [],
                    "candidate_selections": [
                        {
                            "signature": "base=STAGE1|addons=EGR_OFF",
                            "base_tune": "STAGE1",
                            "addon_keys": ["EGR_OFF"],
                        }
                    ],
                },
            }
            scan = SimpleNamespace(
                id="scan-1",
                user_id="user-1",
                source_sha256="source-sha",
                status="ready",
                result_payload=scan_offer,
            )
            job = SimpleNamespace(
                id="job-1",
                user_id="user-1",
                source_filename="input.bin",
                source_path=str(source_path),
                source_sha256="source-sha",
                source_size_bytes=source_path.stat().st_size,
                base_tune="STAGE1",
                requested_options={"addon_keys": ["EGR_OFF"], "scan_id": scan.id},
                status="queued",
                progress=1,
                current_stage="Queued",
                strategy=None,
                result_filename=None,
                result_path=None,
                result_sha256=None,
                revtech_payload=None,
                error_message=None,
            )

            class Query:
                def filter(self, *args):
                    return self

                def order_by(self, *args):
                    return self

                def first(self):
                    return None

                def one_or_none(self):
                    return None

            class Db:
                def get(self, model, row_id):
                    if row_id == job.id:
                        return job
                    if row_id == scan.id:
                        return scan
                    return None

                def query(self, model):
                    return Query()

                def add(self, row):
                    pass

                def commit(self):
                    pass

                def refresh(self, row):
                    pass

                def close(self):
                    pass

            class Client:
                def __init__(self):
                    self.match_calls = 0
                    self.patch_calls = []

                async def match_bin(self, *args, **kwargs):
                    self.match_calls += 1
                    raise AssertionError("candidate build must rely on patch validation match")

                async def run_patch_adaptation(self, file_path, **kwargs):
                    self.patch_calls.append((file_path, kwargs))
                    return {"status": "success"}, b"patched-output", "patched.bin"

            client = Client()
            settings = SimpleNamespace(
                **vars(_settings()),
                revtech_enabled=True,
                storage_path=Path(temp_dir) / "storage",
            )
            with (
                patch("app.services.build_pipeline.SessionLocal", return_value=Db()),
                patch("app.services.build_pipeline.RevtechClient", return_value=client),
                patch("app.services.build_pipeline.get_settings", return_value=settings),
            ):
                await process_build_job(job.id)

            result_path = Path(job.result_path)
            self.assertTrue(result_path.is_file())
            self.assertEqual(result_path.read_bytes(), b"patched-output")

        self.assertEqual(client.match_calls, 0)
        self.assertEqual(
            client.patch_calls,
            [(source_path, {"base_key": "STAGE1", "addon_keys": ["EGR_OFF"]})],
        )
        self.assertEqual(job.status, "ready")
        self.assertEqual(job.strategy, "patch_adaptation")


class ScanOwnershipContractTests(unittest.TestCase):
    def test_scan_offer_requires_owner_and_matching_file_hash(self):
        scan = SimpleNamespace(
            id="scan-1",
            user_id="user-1",
            source_sha256="sha-1",
            status="ready",
            result_payload={"availability": {"buildable_selections": []}},
        )
        db = SimpleNamespace(get=lambda model, row_id: scan if row_id == scan.id else None)

        row, offer = validated_scan_offer(
            db,
            scan_id="scan-1",
            user_id="user-1",
            source_sha256="sha-1",
        )

        self.assertIs(row, scan)
        self.assertEqual(offer, scan.result_payload)

        with self.assertRaises(HTTPException) as wrong_owner:
            validated_scan_offer(
                db,
                scan_id="scan-1",
                user_id="user-2",
                source_sha256="sha-1",
            )
        self.assertEqual(wrong_owner.exception.status_code, 404)

        with self.assertRaises(HTTPException) as wrong_hash:
            validated_scan_offer(
                db,
                scan_id="scan-1",
                user_id="user-1",
                source_sha256="sha-2",
            )
        self.assertEqual(wrong_hash.exception.status_code, 409)

    def test_missing_scan_id_reuses_latest_ready_scan_for_same_user_and_hash(self):
        scan = SimpleNamespace(
            id="scan-latest",
            user_id="user-1",
            source_sha256="sha-1",
            status="ready",
            result_payload={"availability": {"buildable_selections": []}},
        )
        query = SimpleNamespace()
        query.filter = lambda *args: query
        query.order_by = lambda *args: query
        query.first = lambda: scan
        db = SimpleNamespace(
            get=lambda model, row_id: None,
            query=lambda model: query,
        )

        row, offer = validated_scan_offer(
            db,
            scan_id=None,
            user_id="user-1",
            source_sha256="sha-1",
        )

        self.assertIs(row, scan)
        self.assertEqual(offer, scan.result_payload)


if __name__ == "__main__":
    unittest.main()
