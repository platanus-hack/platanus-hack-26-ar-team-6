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


from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from relevo.api import context as context_api  # noqa: E402
from relevo.config import AppConfig  # noqa: E402
from relevo.main import create_app  # noqa: E402


ASKER_ID = UUID("11111111-1111-4111-8111-111111111111")
TARGET_ID = UUID("22222222-2222-4222-8222-222222222222")
PROJECT_ID = UUID("33333333-3333-4333-8333-333333333333")
OTHER_PROJECT_ID = UUID("66666666-6666-4666-8666-666666666666")
ENTRY_ID = UUID("44444444-4444-4444-8444-444444444444")
EXCHANGE_ID = UUID("55555555-5555-4555-8555-555555555555")
ACCOUNT_ID = UUID("77777777-7777-4777-8777-777777777777")


class MemoryRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(AppConfig(sha="test"))
        self.app.dependency_overrides[context_api.get_db] = lambda: SimpleNamespace()
        self.app.dependency_overrides[context_api.require_auth] = lambda: {
            "kind": "legacy",
            "user": {
                "id": ASKER_ID,
                "project_id": PROJECT_ID,
                "display_name": "User1",
                "domain_summary": "Frontend",
                "profile": {},
                "role": "member",
                "account_id": None,
            },
        }
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_agent_ctx_returns_author_owned_memory_and_records_exchange(self) -> None:
        retrieved = [
            {
                "id": ENTRY_ID,
                "kind": "agent_memory_document",
                "content": "Railway deploys the FastAPI server.",
                "metadata": {
                    "source_table": "agent_memory_document",
                    "importance": "local",
                    "author_agent_id": str(TARGET_ID),
                },
                "created_at": "2026-05-09T00:00:00Z",
            }
        ]

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
            patch.object(context_api, "retrieve_agent_memory", Mock(return_value=retrieved)) as retrieve,
            patch.object(context_api, "record_context_exchange", Mock(return_value=EXCHANGE_ID)) as record,
        ):
            response = self.client.post(
                "/agent-ctx",
                json={"agent_id": str(TARGET_ID), "query": "How do we deploy?"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["context_exchange_id"], str(EXCHANGE_ID))
        self.assertFalse(payload["insufficient_context"])
        self.assertEqual(payload["results"][0]["id"], str(ENTRY_ID))
        self.assertEqual(payload["results"][0]["metadata"]["author_agent_id"], str(TARGET_ID))

        retrieve.assert_called_once_with(
            unittest.mock.ANY,
            PROJECT_ID,
            TARGET_ID,
            "How do we deploy?",
            limit=6,
        )
        record.assert_called_once()
        self.assertEqual(record.call_args.kwargs["target_agent_id"], TARGET_ID)
        self.assertEqual(record.call_args.kwargs["tool_name"], "agent_ctx")

    def test_global_ctx_returns_project_global_memory(self) -> None:
        retrieved = [
            {
                "id": ENTRY_ID,
                "kind": "agent_memory_event",
                "content": "The deployment breakthrough is useful to everyone.",
                "metadata": {"source_table": "agent_memory_event", "importance": "global"},
                "created_at": "2026-05-09T00:00:00Z",
            }
        ]

        with (
            patch.object(context_api, "retrieve_global_memory", Mock(return_value=retrieved)) as retrieve,
            patch.object(context_api, "record_context_exchange", Mock(return_value=EXCHANGE_ID)) as record,
        ):
            response = self.client.post(
                "/global-ctx",
                json={"query": "shared deployment decisions"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["context_exchange_id"], str(EXCHANGE_ID))
        self.assertEqual(payload["results"][0]["metadata"]["importance"], "global")
        retrieve.assert_called_once_with(
            unittest.mock.ANY,
            PROJECT_ID,
            "shared deployment decisions",
            limit=6,
        )
        self.assertEqual(record.call_args.kwargs["target_agent_id"], None)
        self.assertEqual(record.call_args.kwargs["tool_name"], "global_ctx")

    def test_retrieve_context_routes_vector_packet_and_records_exchange(self) -> None:
        retrieved = {
            "query": "How do we deploy?",
            "route": "agents",
            "selected_agent_ids": [TARGET_ID],
            "results": [
                {
                    "id": ENTRY_ID,
                    "kind": "agent_memory_document",
                    "content": "Railway deploys the FastAPI server.",
                    "metadata": {
                        "source_table": "memory_chunk",
                        "importance": "local",
                        "author_agent_id": str(TARGET_ID),
                    },
                    "created_at": "2026-05-09T00:00:00Z",
                }
            ],
            "diagnostics": {
                "pool_top_score": 0.2,
                "agent_top_score": 0.91,
                "embedding_model": "text-embedding-3-small",
            },
        }

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
            patch.object(context_api, "retrieve_context", Mock(return_value=retrieved)) as retrieve,
            patch.object(context_api, "record_context_exchange", Mock(return_value=EXCHANGE_ID)) as record,
        ):
            response = self.client.post(
                "/retrieve-context",
                json={
                    "query": "How do we deploy?",
                    "target_agent_id": str(TARGET_ID),
                    "limit": 4,
                    "metadata": {"source": "test"},
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["query"], "How do we deploy?")
        self.assertEqual(payload["route"], "agents")
        self.assertEqual(payload["selected_agent_ids"], [str(TARGET_ID)])
        self.assertEqual(payload["context_exchange_id"], str(EXCHANGE_ID))
        self.assertFalse(payload["insufficient_context"])
        self.assertEqual(payload["diagnostics"]["agent_top_score"], 0.91)
        retrieve.assert_called_once_with(
            unittest.mock.ANY,
            PROJECT_ID,
            "How do we deploy?",
            target_agent_ids=[TARGET_ID],
            limit=4,
        )
        record.assert_called_once()
        self.assertEqual(record.call_args.kwargs["target_agent_id"], TARGET_ID)
        self.assertEqual(record.call_args.kwargs["tool_name"], "retrieve_context")
        self.assertEqual(record.call_args.kwargs["metadata"]["route"], "agents")

    def test_memory_updates_commit_append_and_canonical_operations(self) -> None:
        commit = Mock(return_value={"event_ids": ["event-1"], "document_ids": ["doc-1"]})

        with patch.object(context_api, "commit_memory_update", commit):
            response = self.client.post(
                "/memory-updates",
                json={
                    "chat_session_id": "session-1",
                    "checkpoint_index": 1,
                    "operations": [
                        {
                            "author_agent_id": str(ASKER_ID),
                            "importance": "local",
                            "document_key": "chat-summary",
                            "event_content": "A learned how deployment works.",
                            "canonical_content": "Deployment runs on Railway.",
                        }
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"event_ids": ["event-1"], "document_ids": ["doc-1"]})
        commit.assert_called_once()
        operation = commit.call_args.kwargs["operations"][0]
        self.assertEqual(operation["chat_session_id"], "session-1")
        self.assertEqual(operation["checkpoint_index"], 1)
        self.assertEqual(operation["author_agent_id"], ASKER_ID)

    def test_claude_code_activity_commits_current_user_memory(self) -> None:
        commit = Mock(return_value={"event_ids": ["event-1"], "document_ids": ["doc-1"]})

        with patch.object(context_api, "commit_memory_update", commit):
            response = self.client.post(
                "/claude-code/activity",
                json={
                    "session_id": "claude-session-1",
                    "checkpoint_index": 2,
                    "cwd": "/repo",
                    "prompt": "Add the hook.",
                    "final_answer": "Implemented the hook.",
                    "changed_files": [".claude/hooks/relevo_activity.py"],
                    "diff": "diff --git a/.claude/hooks/relevo_activity.py b/.claude/hooks/relevo_activity.py\n",
                    "transcript_path": "/tmp/transcript.jsonl",
                    "hook_event_name": "Stop",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"event_ids": ["event-1"], "document_ids": ["doc-1"]})
        commit.assert_called_once()
        self.assertEqual(commit.call_args.kwargs["project_id"], PROJECT_ID)
        operation = commit.call_args.kwargs["operations"][0]
        self.assertEqual(operation["author_agent_id"], ASKER_ID)
        self.assertEqual(operation["importance"], "global")
        self.assertEqual(operation["chat_session_id"], "claude-code:claude-session-1")
        self.assertEqual(operation["checkpoint_index"], 2)
        self.assertEqual(operation["document_key"], "claude-code:claude-session-1")
        self.assertIn("Prompt:\nAdd the hook.", operation["event_content"])
        self.assertIn("Final answer:\nImplemented the hook.", operation["event_content"])
        self.assertIn("Diff:\n```diff", operation["event_content"])
        self.assertEqual(operation["metadata"]["source"], "claude_code_hook")
        self.assertEqual(operation["metadata"]["changed_files"], [".claude/hooks/relevo_activity.py"])

    def test_request_context_route_is_removed(self) -> None:
        response = self.client.post(
            "/request-context",
            json={"target": str(TARGET_ID), "question": "How do we deploy?"},
        )

        self.assertEqual(response.status_code, 404)

    def test_old_global_tool_route_spelling_is_removed(self) -> None:
        response = self.client.post(
            "/global-ct",
            json={"query": "shared deployment decisions"},
        )

        self.assertEqual(response.status_code, 404)

    def test_session_bootstrap_requires_project_id(self) -> None:
        self.app.dependency_overrides[context_api.require_auth] = lambda: {
            "kind": "session",
            "account": {"id": ACCOUNT_ID, "email": "user@example.com"},
        }

        response = self.client.get("/bootstrap")

        self.assertEqual(response.status_code, 422)
        self.assertIn("project_id", response.json()["detail"])

    def test_session_bootstrap_rejects_non_member_project(self) -> None:
        self.app.dependency_overrides[context_api.require_auth] = lambda: {
            "kind": "session",
            "account": {"id": ACCOUNT_ID, "email": "user@example.com"},
        }

        with patch.object(
            context_api,
            "require_project_membership",
            Mock(side_effect=HTTPException(status_code=403, detail="not a member")),
        ):
            response = self.client.get(f"/bootstrap?project_id={OTHER_PROJECT_ID}")

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
