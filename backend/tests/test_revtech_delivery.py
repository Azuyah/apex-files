from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.builds import validated_scan_offer
from app.services.build_pipeline import (
    adaptation_candidate_selections,
    append_buildable_selection,
    buildable_selection,
    database_buildable_selections,
    first_successful_patch_output,
    offer_selection_is_buildable,
    offer_selection_is_candidate,
    project_live_identifiers,
    select_delivery_candidate,
)
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
