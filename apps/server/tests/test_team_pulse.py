from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from fastapi.testclient import TestClient  # noqa: E402

from relevo.api import team_pulse as pulse_api  # noqa: E402
from relevo.config import AppConfig  # noqa: E402
from relevo.main import create_app  # noqa: E402


ASKER_ID = UUID("11111111-1111-4111-8111-111111111111")
TEAMMATE_ID = UUID("22222222-2222-4222-8222-222222222222")
PROJECT_ID = UUID("33333333-3333-4333-8333-333333333333")


def _make_user(user_id: UUID, project_id: UUID, display_name: str) -> dict:
    return {
        "id": user_id,
        "project_id": project_id,
        "display_name": display_name,
        "domain_summary": "",
        "profile": {},
        "role": "member",
        "account_id": None,
    }


class TeamPulseRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(AppConfig(sha="test"))
        self.app.dependency_overrides[pulse_api.get_db] = lambda: SimpleNamespace()
        self.app.dependency_overrides[pulse_api.require_auth] = lambda: {
            "kind": "legacy",
            "user": _make_user(ASKER_ID, PROJECT_ID, "Asker"),
        }
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    # -- GET /team-pulse -------------------------------------------------

    def test_get_team_pulse_returns_grid_for_each_member(self) -> None:
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        size = 3600
        bucket_starts = [
            datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc),
            datetime(2026, 5, 9, 13, 0, tzinfo=timezone.utc),
            datetime(2026, 5, 9, 14, 0, tzinfo=timezone.utc),
        ]
        roster = [
            _make_user(ASKER_ID, PROJECT_ID, "Asker"),
            _make_user(TEAMMATE_ID, PROJECT_ID, "Teammate"),
        ]
        docs = [
            {
                "id": "doc-1",
                "author_agent_id": ASKER_ID,
                "document_key": "pulse:2026-05-09T13:00:00Z",
                "content": "wired oauth callback",
                "metadata": {
                    "kind": "team_pulse_bucket",
                    "bucket_start": "2026-05-09T13:00:00Z",
                    "bucket_end": "2026-05-09T14:00:00Z",
                    "event_count": 3,
                },
                "updated_at": now,
            }
        ]

        with (
            patch.object(pulse_api, "_now_utc", return_value=now),
            patch.object(pulse_api, "get_user_directory", return_value=roster),
            patch.object(pulse_api, "list_pulse_documents", return_value=docs),
        ):
            response = self.client.get(
                f"/projects/{PROJECT_ID}/team-pulse",
                params={"size": size, "buckets": 3},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["bucket_size_seconds"], size)
        self.assertEqual(len(payload["bucket_starts"]), 3)
        self.assertEqual(len(payload["members"]), 2)

        asker = next(m for m in payload["members"] if m["agent_id"] == str(ASKER_ID))
        teammate = next(m for m in payload["members"] if m["agent_id"] == str(TEAMMATE_ID))

        # Asker has summary in middle bucket (13:00).
        self.assertEqual(asker["cells"][0]["summary"], None)
        self.assertEqual(asker["cells"][1]["summary"], "wired oauth callback")
        self.assertEqual(asker["cells"][1]["event_count"], 3)
        self.assertEqual(asker["cells"][2]["summary"], None)

        # Teammate has no docs at all.
        self.assertTrue(all(cell["summary"] is None for cell in teammate["cells"]))

    # -- POST /team-pulse/refresh ---------------------------------------

    def test_refresh_writes_pulse_and_responsibility_docs(self) -> None:
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        bucket_start = datetime(2026, 5, 9, 13, 0, tzinfo=timezone.utc)

        with (
            patch.object(pulse_api, "_now_utc", return_value=now),
            patch.object(pulse_api, "upsert_pulse_document", return_value="pulse-1") as upsert_pulse,
            patch.object(pulse_api, "upsert_responsibility_document", return_value="resp-1") as upsert_resp,
            patch.object(pulse_api, "get_responsibility_refresh_state", return_value=None),
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/team-pulse/refresh",
                json={
                    "size": 3600,
                    "buckets": 3,
                    "summaries": [
                        {
                            "agent_id": str(ASKER_ID),
                            "bucket_start": bucket_start.isoformat(),
                            "summary": "wired oauth callback",
                            "event_count": 3,
                            "event_ids": [],
                        }
                    ],
                    "responsibilities": [
                        {
                            "agent_id": str(ASKER_ID),
                            "content": "## General responsibility\nFrontend",
                            "word_count": 12,
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["pulse_doc_ids"], ["pulse-1"])
        self.assertEqual(payload["responsibility_doc_ids"], ["resp-1"])
        self.assertEqual(payload["skipped_responsibility_agent_ids"], [])
        upsert_pulse.assert_called_once()
        upsert_resp.assert_called_once()

    def test_refresh_rejects_summary_for_other_user(self) -> None:
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        bucket_start = datetime(2026, 5, 9, 13, 0, tzinfo=timezone.utc)

        with (
            patch.object(pulse_api, "_now_utc", return_value=now),
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/team-pulse/refresh",
                json={
                    "size": 3600,
                    "buckets": 3,
                    "summaries": [
                        {
                            "agent_id": str(TEAMMATE_ID),
                            "bucket_start": bucket_start.isoformat(),
                            "summary": "spoofed",
                            "event_count": 1,
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 403)

    def test_refresh_skips_recent_responsibility(self) -> None:
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        recent = now - timedelta(seconds=60)

        with (
            patch.object(pulse_api, "_now_utc", return_value=now),
            patch.object(pulse_api, "get_responsibility_refresh_state", return_value=recent),
            patch.object(pulse_api, "upsert_responsibility_document") as upsert_resp,
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/team-pulse/refresh",
                json={
                    "size": 3600,
                    "buckets": 3,
                    "summaries": [],
                    "responsibilities": [
                        {
                            "agent_id": str(ASKER_ID),
                            "content": "## body",
                            "word_count": 5,
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        upsert_resp.assert_not_called()
        payload = response.json()
        self.assertEqual(payload["skipped_responsibility_agent_ids"], [str(ASKER_ID)])

    # -- GET /responsibilities ------------------------------------------

    def test_responsibilities_includes_members_with_and_without_doc(self) -> None:
        roster = [
            _make_user(ASKER_ID, PROJECT_ID, "Asker"),
            _make_user(TEAMMATE_ID, PROJECT_ID, "Teammate"),
        ]
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        docs = [
            {
                "id": "doc-1",
                "author_agent_id": ASKER_ID,
                "content": "## General responsibility\nFrontend",
                "metadata": {"kind": "responsibility_doc", "word_count": 12},
                "updated_at": now,
            }
        ]

        with (
            patch.object(pulse_api, "get_user_directory", return_value=roster),
            patch.object(pulse_api, "list_responsibility_documents", return_value=docs),
        ):
            response = self.client.get(f"/projects/{PROJECT_ID}/responsibilities")

        self.assertEqual(response.status_code, 200, response.text)
        members = response.json()["members"]
        self.assertEqual(len(members), 2)
        asker = next(m for m in members if m["agent_id"] == str(ASKER_ID))
        teammate = next(m for m in members if m["agent_id"] == str(TEAMMATE_ID))
        self.assertEqual(asker["content"], "## General responsibility\nFrontend")
        self.assertEqual(asker["word_count"], 12)
        self.assertIsNone(teammate["content"])

    # -- GET /team-pulse/raw-events -------------------------------------

    def test_raw_events_returns_bucket_aligned_events(self) -> None:
        now = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        events = [
            {
                "id": UUID("44444444-4444-4444-8444-444444444444"),
                "author_agent_id": ASKER_ID,
                "content": "Did a thing",
                "metadata": {},
                "created_at": datetime(2026, 5, 9, 13, 17, tzinfo=timezone.utc),
            }
        ]

        with (
            patch.object(pulse_api, "_now_utc", return_value=now),
            patch.object(pulse_api, "list_pulse_raw_events", return_value=events),
        ):
            response = self.client.get(
                f"/projects/{PROJECT_ID}/team-pulse/raw-events",
                params={"size": 3600, "buckets": 3, "agent_id": str(ASKER_ID)},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload["events"]), 1)
        self.assertEqual(payload["events"][0]["bucket_start"], "2026-05-09T13:00:00Z")


if __name__ == "__main__":
    unittest.main()
