from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import UUID

from fastapi.testclient import TestClient


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from relevo import db as db_module  # noqa: E402
from relevo.api import context as context_api  # noqa: E402
from relevo.config import AppConfig  # noqa: E402
from relevo.main import create_app  # noqa: E402


PROJECT_ID = UUID("00000000-0000-4000-8000-000000000001")
OTHER_PROJECT_ID = UUID("00000000-0000-4000-8000-000000000002")
ASKER_ID = UUID("11111111-1111-4111-8111-111111111111")
TARGET_ID = UUID("22222222-2222-4222-8222-222222222222")
UNKNOWN_TARGET_ID = UUID("33333333-3333-4333-8333-333333333333")
SOURCE_ENTRY_ID = UUID("44444444-4444-4444-8444-444444444444")
CLOSURE_ENTRY_ID = UUID("55555555-5555-4555-8555-555555555555")
QA_LEDGER_ID = UUID("66666666-6666-4666-8666-666666666666")
QUESTION = "What deploy quirks should I know about?"
ANSWER = "Check /health before the demo deploy."


ASKER = {
    "id": ASKER_ID,
    "project_id": PROJECT_ID,
    "display_name": "User1",
    "domain_summary": "Desktop integration",
    "profile": {},
}
TARGET = {
    "id": TARGET_ID,
    "project_id": PROJECT_ID,
    "display_name": "User2",
    "domain_summary": "Server deployment",
    "profile": {"domain": {"tags": ["deployment"]}},
}
RETRIEVED_ENTRY = {
    "id": SOURCE_ENTRY_ID,
    "kind": "seed",
    "content": "Railway deploys should be checked with /health.",
    "metadata": {"tags": ["deployment", "health"]},
    "created_at": datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc),
}


def _user_by_token(_conn: object, token: str) -> dict[str, object] | None:
    return ASKER if token == "dev-token-user1" else None


def _user_by_id(_conn: object, user_id: UUID) -> dict[str, object] | None:
    if user_id == ASKER_ID:
        return ASKER
    if user_id == TARGET_ID:
        return TARGET
    return None


class RequestContextRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        app = create_app(AppConfig(sha="test"))

        def override_db():
            yield object()

        app.dependency_overrides[context_api.get_db] = override_db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)

    def post_request_context(
        self,
        target_user_id: UUID = TARGET_ID,
        headers: dict[str, str] | None = None,
    ):
        return self.client.post(
            "/request-context",
            json={"target_user_id": str(target_user_id), "question": QUESTION},
            headers=headers or {},
        )

    def test_missing_auth_returns_401(self) -> None:
        response = self.post_request_context()

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Missing bearer token")

    def test_legacy_token_headers_are_not_auth(self) -> None:
        response = self.post_request_context(headers={"X-User-Token": "dev-token-user1"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Missing bearer token")

    def test_invalid_auth_returns_401(self) -> None:
        with patch.object(context_api, "get_user_by_token", return_value=None):
            response = self.post_request_context(headers={"Authorization": "Bearer bad-token"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Invalid bearer token")

    def test_malformed_auth_returns_401(self) -> None:
        response = self.post_request_context(headers={"Authorization": "bad-token"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Malformed bearer token")

    def test_unknown_target_returns_404(self) -> None:
        with (
            patch.object(context_api, "get_user_by_token", side_effect=_user_by_token),
            patch.object(context_api, "get_user", side_effect=_user_by_id),
        ):
            response = self.post_request_context(
                target_user_id=UNKNOWN_TARGET_ID,
                headers={"Authorization": "Bearer dev-token-user1"},
            )

        self.assertEqual(response.status_code, 404)
        self.assertIn(str(UNKNOWN_TARGET_ID), response.json()["detail"])

    def test_self_target_returns_400_without_retrieval_or_write(self) -> None:
        retrieve = Mock()
        write = Mock()

        with (
            patch.object(context_api, "get_user_by_token", side_effect=_user_by_token),
            patch.object(context_api, "get_user", side_effect=_user_by_id),
            patch.object(context_api, "retrieve_user_context", retrieve),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.post_request_context(
                target_user_id=ASKER_ID,
                headers={"Authorization": "Bearer dev-token-user1"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "self-target rejected")
        retrieve.assert_not_called()
        write.assert_not_called()

    def test_cross_project_target_returns_403_without_retrieval_or_write(self) -> None:
        retrieve = Mock()
        write = Mock()
        cross_project_target = {**TARGET, "project_id": OTHER_PROJECT_ID}

        with (
            patch.object(context_api, "get_user_by_token", side_effect=_user_by_token),
            patch.object(context_api, "get_user", return_value=cross_project_target),
            patch.object(context_api, "retrieve_user_context", retrieve),
            patch.object(context_api, "write_cross_user_qa_entry", write),
        ):
            response = self.post_request_context(headers={"Authorization": "Bearer dev-token-user1"})

        self.assertEqual(response.status_code, 403)
        retrieve.assert_not_called()
        write.assert_not_called()

    def test_success_writes_closure_and_returns_context_ids(self) -> None:
        writes: list[dict[str, object]] = []

        def fake_write(_conn: object, **kwargs: object) -> UUID:
            writes.append(kwargs)
            return CLOSURE_ENTRY_ID

        with (
            patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}),
            patch.object(context_api, "get_user_by_token", side_effect=_user_by_token),
            patch.object(context_api, "get_user", side_effect=_user_by_id),
            patch.object(context_api, "retrieve_user_context", return_value=[RETRIEVED_ENTRY]),
            patch.object(context_api, "answer_from_context", return_value=ANSWER),
            patch.object(context_api, "write_cross_user_qa_entry", side_effect=fake_write),
        ):
            response = self.post_request_context(headers={"Authorization": "Bearer dev-token-user1"})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["answer"], ANSWER)
        self.assertEqual(data["source_user_ids"], [str(TARGET_ID)])
        self.assertEqual(data["source_context_entry_ids"], [str(SOURCE_ENTRY_ID)])
        self.assertEqual(data["target_user_id"], str(TARGET_ID))
        self.assertEqual(data["context_entry_id"], str(CLOSURE_ENTRY_ID))
        self.assertEqual(data["retrieved_context_entries"][0]["id"], str(SOURCE_ENTRY_ID))

        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["target_user_id"], TARGET_ID)
        self.assertEqual(writes[0]["asker_user_id"], ASKER_ID)
        self.assertEqual(writes[0]["question"], QUESTION)
        self.assertEqual(writes[0]["answer"], ANSWER)
        self.assertEqual(
            writes[0]["extra_metadata"],
            {
                "source_context_entry_ids": [str(SOURCE_ENTRY_ID)],
                "retrieved_context_entry_ids": [str(SOURCE_ENTRY_ID)],
            },
        )


class FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple[object, ...]]] = []
        self._rows = [{"id": CLOSURE_ENTRY_ID}, {"id": QA_LEDGER_ID}]

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.executed.append((query, params))

    def fetchone(self) -> dict[str, UUID]:
        return self._rows.pop(0)


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_obj = FakeCursor()
        self.commit_count = 0

    def cursor(self) -> FakeCursor:
        return self.cursor_obj

    def commit(self) -> None:
        self.commit_count += 1


class WriteCrossUserQaEntryTest(unittest.TestCase):
    def test_writes_context_entry_qa_ledger_and_ledger_metadata(self) -> None:
        conn = FakeConnection()

        with patch.object(db_module, "get_user", side_effect=[TARGET, ASKER]):
            result = db_module.write_cross_user_qa_entry(
                conn,
                target_user_id=TARGET_ID,
                asker_user_id=ASKER_ID,
                question=QUESTION,
                answer=ANSWER,
                extra_metadata={
                    "source": "spoofed",
                    "asker_user_id": "spoofed",
                    "target_user_id": "spoofed",
                    "question": "spoofed",
                    "answer": "spoofed",
                    "source_context_entry_ids": [str(SOURCE_ENTRY_ID)],
                },
            )

        self.assertEqual(result, CLOSURE_ENTRY_ID)
        self.assertEqual(conn.commit_count, 1)

        executed = conn.cursor_obj.executed
        context_insert = _find_executed(executed, "INSERT INTO context_entry")
        ledger_insert = _find_executed(executed, "INSERT INTO qa_ledger")
        metadata_update = _find_executed(executed, "UPDATE context_entry")

        self.assertEqual(context_insert[1][0], TARGET_ID)
        self.assertIn(QUESTION, str(context_insert[1][1]))
        self.assertIn(ANSWER, str(context_insert[1][1]))
        self.assertEqual(
            context_insert[1][2].obj["source_context_entry_ids"],
            [str(SOURCE_ENTRY_ID)],
        )
        self.assertEqual(context_insert[1][2].obj["source"], "request_context")
        self.assertEqual(context_insert[1][2].obj["asker_user_id"], str(ASKER_ID))
        self.assertEqual(context_insert[1][2].obj["target_user_id"], str(TARGET_ID))
        self.assertEqual(context_insert[1][2].obj["question"], QUESTION)
        self.assertEqual(context_insert[1][2].obj["answer"], ANSWER)

        self.assertEqual(
            ledger_insert[1][:6],
            (PROJECT_ID, ASKER_ID, TARGET_ID, CLOSURE_ENTRY_ID, QUESTION, ANSWER),
        )
        self.assertEqual(ledger_insert[1][6].obj, {"source": "request_context"})
        self.assertEqual(metadata_update[1][0].obj, {"qa_ledger_id": str(QA_LEDGER_ID)})
        self.assertEqual(metadata_update[1][1], CLOSURE_ENTRY_ID)


def _find_executed(
    executed: list[tuple[str, tuple[object, ...]]],
    needle: str,
) -> tuple[str, tuple[object, ...]]:
    for query, params in executed:
        if needle in " ".join(query.split()):
            return query, params
    raise AssertionError(f"SQL not executed: {needle}")


if __name__ == "__main__":
    unittest.main()
