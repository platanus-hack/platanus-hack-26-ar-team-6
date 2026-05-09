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

from relevo.agents import (  # noqa: E402
    ContextEntryCitation,
    OnDemandAgentAnswer,
    OnDemandAgentError,
)
from relevo.api import context as context_api  # noqa: E402
from relevo.config import AppConfig, OnDemandAgentConfig  # noqa: E402
from relevo.main import create_app  # noqa: E402


ASKER_ID = UUID("11111111-1111-4111-8111-111111111111")
TARGET_ID = UUID("22222222-2222-4222-8222-222222222222")
PROJECT_ID = UUID("33333333-3333-4333-8333-333333333333")
ENTRY_ID = UUID("44444444-4444-4444-8444-444444444444")
CLOSURE_ENTRY_ID = UUID("55555555-5555-4555-8555-555555555555")


class RequestContextRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(
            AppConfig(
                sha="test",
                on_demand_agent=OnDemandAgentConfig(retrieval_top_k=3),
            )
        )
        self.app.dependency_overrides[context_api.get_db] = lambda: SimpleNamespace()
        self.app.dependency_overrides[context_api.require_user] = lambda: {
            "id": ASKER_ID,
            "project_id": PROJECT_ID,
            "display_name": "User1",
            "domain_summary": "Frontend",
            "profile": {},
        }
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_request_context_calls_on_demand_agent_and_writes_metadata(self) -> None:
        retrieved = [
            {
                "id": ENTRY_ID,
                "kind": "seed",
                "content": "Railway deploys the FastAPI server.",
                "metadata": {"tags": ["railway"]},
                "created_at": "2026-05-09T00:00:00Z",
            }
        ]
        answer = OnDemandAgentAnswer(
            answer=f"Use Railway for deploys. [{ENTRY_ID}]",
            source_user_ids=[str(TARGET_ID)],
            citations=[
                ContextEntryCitation(
                    claim="Use Railway for deploys.",
                    context_entry_id=str(ENTRY_ID),
                )
            ],
            confidence=0.91,
            insufficient_context=False,
        )
        get_user = Mock(
            return_value={
                "id": TARGET_ID,
                "project_id": PROJECT_ID,
                "display_name": "User2",
                "domain_summary": "Deployment",
                "profile": {"domain": {"tags": ["deploy"]}},
            }
        )
        retrieve = Mock(return_value=retrieved)
        on_demand = Mock(return_value=answer)
        write = Mock(return_value=CLOSURE_ENTRY_ID)

        with (
            patch.object(context_api, "get_user", get_user),
            patch.object(context_api, "retrieve_user_context", retrieve),
            patch.object(context_api, "answer_on_demand", on_demand, create=True),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.client.post(
                "/request-context",
                json={"target": str(TARGET_ID), "question": "How do we deploy?"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["answer"], answer.answer)
        self.assertEqual(payload["source_user_ids"], [str(TARGET_ID)])
        self.assertEqual(payload["target_user_id"], str(TARGET_ID))
        self.assertEqual(payload["context_entry_id"], str(CLOSURE_ENTRY_ID))
        self.assertEqual(payload["source_context_entry_ids"], [str(ENTRY_ID)])
        self.assertEqual(payload["confidence"], 0.91)
        self.assertFalse(payload["insufficient_context"])
        self.assertEqual(payload["citations"][0]["context_entry_id"], str(ENTRY_ID))

        retrieve.assert_called_once_with(
            unittest.mock.ANY,
            TARGET_ID,
            "How do we deploy?",
            limit=3,
        )
        on_demand.assert_called_once()
        context_slice = on_demand.call_args.args[0]
        self.assertEqual(context_slice.target.id, TARGET_ID)
        self.assertEqual(context_slice.entries[0].id, ENTRY_ID)
        write.assert_called_once()
        self.assertEqual(write.call_args.kwargs["answer"], answer.answer)
        self.assertEqual(
            write.call_args.kwargs["extra_metadata"]["retrieved_context_entry_ids"],
            [str(ENTRY_ID)],
        )
        self.assertEqual(write.call_args.kwargs["extra_metadata"]["confidence"], 0.91)
        self.assertFalse(write.call_args.kwargs["extra_metadata"]["insufficient_context"])
        self.assertEqual(
            write.call_args.kwargs["extra_metadata"]["citations"][0]["context_entry_id"],
            str(ENTRY_ID),
        )

    def test_agent_error_returns_502_and_writes_nothing(self) -> None:
        get_user = Mock(
            return_value={
                "id": TARGET_ID,
                "project_id": PROJECT_ID,
                "display_name": "User2",
                "domain_summary": "Deployment",
                "profile": {},
            }
        )
        retrieve = Mock(return_value=[])
        write = Mock()

        with (
            patch.object(context_api, "get_user", get_user),
            patch.object(context_api, "retrieve_user_context", retrieve),
            patch.object(
                context_api,
                "answer_on_demand",
                Mock(side_effect=OnDemandAgentError("bad model json")),
                create=True,
            ),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.client.post(
                "/request-context",
                json={"target": str(TARGET_ID), "question": "How do we deploy?"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertIn("on-demand agent failed", response.json()["detail"])
        write.assert_not_called()

    def test_self_target_is_rejected_before_retrieval(self) -> None:
        retrieve = Mock()
        write = Mock()

        with (
            patch.object(context_api, "retrieve_user_context", retrieve),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.client.post(
                "/request-context",
                json={"target": str(ASKER_ID), "question": "What do I know?"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "self-target rejected")
        retrieve.assert_not_called()
        write.assert_not_called()

    def test_empty_slice_still_writes_insufficient_context_answer(self) -> None:
        answer = OnDemandAgentAnswer(
            answer="No retrieved context entries were provided for User2.",
            source_user_ids=[str(TARGET_ID)],
            citations=[],
            confidence=0,
            insufficient_context=True,
        )
        write = Mock(return_value=CLOSURE_ENTRY_ID)

        with (
            patch.object(
                context_api,
                "get_user",
                Mock(
                    return_value={
                        "id": TARGET_ID,
                        "project_id": PROJECT_ID,
                        "display_name": "User2",
                        "domain_summary": "Deployment",
                        "profile": {},
                    }
                ),
            ),
            patch.object(context_api, "retrieve_user_context", Mock(return_value=[])),
            patch.object(context_api, "answer_on_demand", Mock(return_value=answer), create=True),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.client.post(
                "/request-context",
                json={"target": str(TARGET_ID), "question": "Unknown topic?"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["insufficient_context"])
        self.assertEqual(response.json()["source_context_entry_ids"], [])
        self.assertTrue(write.call_args.kwargs["extra_metadata"]["insufficient_context"])

    def test_only_canonical_request_context_route_is_mounted(self) -> None:
        matching_routes = [
            route
            for route in self.app.routes
            if getattr(route, "path", None) == "/request-context"
            and "POST" in getattr(route, "methods", set())
        ]

        self.assertEqual(len(matching_routes), 1)
        self.assertEqual(matching_routes[0].endpoint.__module__, "relevo.api.context")


if __name__ == "__main__":
    unittest.main()
