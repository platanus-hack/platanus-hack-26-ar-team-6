from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from fastapi.testclient import TestClient  # noqa: E402

from relevo.api import demo as demo_api  # noqa: E402
from relevo.config import AppConfig  # noqa: E402
from relevo.main import create_app  # noqa: E402


ACCOUNT_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
PROJECT_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
LEADER_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


def account() -> dict:
    return {
        "id": ACCOUNT_ID,
        "email": "leader@railwaywise.test",
        "display_name": "Railway Lead",
    }


def membership() -> dict:
    return {
        "project_id": PROJECT_ID,
        "project_name": "Railwaywise",
        "description": demo_api.PROJECT_DESCRIPTION,
        "user_id": LEADER_ID,
        "display_name": "Railway Lead",
        "domain_summary": demo_api.LEADER_DOMAIN_SUMMARY,
        "role": "leader",
    }


class RailwaywiseDemoRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(AppConfig(sha="test"))
        self.app.dependency_overrides[demo_api.get_db] = lambda: SimpleNamespace()
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_route_requires_account_auth(self) -> None:
        response = self.client.post("/demo/railwaywise")

        self.assertEqual(response.status_code, 401)

    def test_route_creates_and_returns_project_membership(self) -> None:
        self.app.dependency_overrides[demo_api.require_account] = account
        teammates = [
            {
                "id": UUID(f"00000000-0000-4000-8000-00000000000{i}"),
                "display_name": name.name,
                "domain_summary": name.domain_summary,
            }
            for i, name in enumerate(demo_api.TEAMMATES, start=1)
        ]

        with (
            patch.object(demo_api, "_ensure_railwaywise_membership", Mock(return_value=membership())) as ensure,
            patch.object(demo_api, "_ensure_demo_teammates", Mock(return_value=teammates)) as ensure_team,
            patch.object(demo_api, "_cleanup_demo_rows", Mock()) as cleanup,
            patch.object(demo_api, "_seed_demo_rows", Mock(return_value={})) as seed,
        ):
            response = self.client.post("/demo/railwaywise")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["project_name"], "Railwaywise")
        self.assertEqual(payload["role"], "leader")
        ensure.assert_called_once()
        ensure_team.assert_called_once_with(unittest.mock.ANY, PROJECT_ID)
        cleanup.assert_called_once_with(unittest.mock.ANY, PROJECT_ID)
        seed.assert_called_once()

    def test_route_cleans_before_reseeding_for_idempotency(self) -> None:
        self.app.dependency_overrides[demo_api.require_account] = account
        calls: list[str] = []

        def cleanup(_conn: object, _project_id: UUID) -> None:
            calls.append("cleanup")

        def seed(_conn: object, _membership: dict, _teammates: list[dict]) -> dict[str, int]:
            calls.append("seed")
            return {}

        with (
            patch.object(demo_api, "_ensure_railwaywise_membership", return_value=membership()),
            patch.object(demo_api, "_ensure_demo_teammates", return_value=[]),
            patch.object(demo_api, "_cleanup_demo_rows", side_effect=cleanup),
            patch.object(demo_api, "_seed_demo_rows", side_effect=seed),
        ):
            response = self.client.post("/demo/railwaywise")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(calls, ["cleanup", "seed"])

    def test_seed_plan_has_counts_for_graph_pulse_and_responsibilities(self) -> None:
        teammates = [
            {
                "id": UUID(f"00000000-0000-4000-8000-00000000000{i}"),
                "display_name": teammate.name,
                "domain_summary": teammate.domain_summary,
            }
            for i, teammate in enumerate(demo_api.TEAMMATES, start=1)
        ]
        conn = RecordingConnection()

        counts = demo_api._seed_demo_rows(conn, membership(), teammates)

        self.assertEqual(counts["project_context_entry"], 12)
        self.assertEqual(counts["context_entry"], 18)
        self.assertEqual(counts["agent_memory_document"], 48)
        self.assertEqual(counts["agent_memory_event"], 42)
        self.assertEqual(counts["context_exchange"], 14)
        self.assertEqual(conn.commits, 1)
        self.assertEqual(len(conn.inserts["responsibility"]), 6)
        self.assertEqual(len(conn.inserts["global"]), 18)
        self.assertEqual(len(conn.inserts["pulse"]), 30)

    def test_cleanup_removes_only_demo_tagged_rows_for_project(self) -> None:
        conn = RecordingConnection()

        demo_api._cleanup_demo_rows(conn, PROJECT_ID)

        self.assertEqual(len(conn.deletes), 5)
        delete_params = [tuple(map(str, params)) for params in conn.deletes]
        self.assertTrue(all(str(PROJECT_ID) in params for params in delete_params))
        self.assertTrue(all(demo_api.DEMO_KEY in params for params in delete_params))
        self.assertEqual(conn.commits, 1)


class RecordingConnection:
    def __init__(self) -> None:
        self.commits = 0
        self.deletes: list[tuple] = []
        self.inserts = {"responsibility": [], "global": [], "pulse": []}

    def cursor(self) -> "RecordingCursor":
        return RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1


class RecordingCursor:
    def __init__(self, conn: RecordingConnection) -> None:
        self.conn = conn

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, sql: str, params: tuple = ()) -> None:
        normalized = " ".join(sql.split())
        if normalized.startswith("DELETE"):
            self.conn.deletes.append(params)
            return
        if "INSERT INTO agent_memory_document" not in normalized:
            return
        document_key = params[2]
        if document_key == demo_api.RESPONSIBILITY_DOCUMENT_KEY:
            self.conn.inserts["responsibility"].append(params)
            self.conn.inserts["global"].append(params)
        elif str(document_key).startswith(demo_api.PULSE_DOCUMENT_KEY_PREFIX):
            self.conn.inserts["pulse"].append(params)
        else:
            self.conn.inserts["global"].append(params)


if __name__ == "__main__":
    unittest.main()
