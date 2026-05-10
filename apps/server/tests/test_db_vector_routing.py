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


import psycopg  # noqa: E402

from relevo import db  # noqa: E402
from relevo.vector_retrieval import OpenAIEmbeddingConfig, content_hash  # noqa: E402


PROJECT_ID = UUID("33333333-3333-4333-8333-333333333333")
AGENT_ID = UUID("22222222-2222-4222-8222-222222222222")
ENTRY_ID = UUID("44444444-4444-4444-8444-444444444444")
SOURCE_ID = UUID("55555555-5555-4555-8555-555555555555")


def vector_row(
    *,
    score: float,
    author_agent_id: UUID | None,
    importance: str,
    content: str = "Railway deploy notes",
) -> dict:
    return {
        "id": ENTRY_ID,
        "project_id": PROJECT_ID,
        "author_agent_id": author_agent_id,
        "importance": importance,
        "source_table": "agent_memory_document",
        "source_id": SOURCE_ID,
        "document_key": "deploy",
        "chunk_index": 0,
        "content": content,
        "metadata": {},
        "created_at": "2026-05-09T00:00:00Z",
        "updated_at": "2026-05-09T00:00:00Z",
        "similarity_score": score,
    }


class FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple | None]] = []
        self.executemany_calls: list[tuple[str, list[tuple]]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple | None = None) -> None:
        self.executed.append((sql, params))

    def fetchone(self) -> dict[str, str]:
        return {"regclass": "memory_chunk"}

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        self.executemany_calls.append((sql, rows))


class FakeConn:
    def __init__(self) -> None:
        self.cursor_obj = FakeCursor()
        self.rollback = Mock()

    def cursor(self) -> FakeCursor:
        return self.cursor_obj


class FakeEmbeddingClient:
    def __init__(self, config: OpenAIEmbeddingConfig) -> None:
        self.config = config

    def embed_texts(self, texts: list[str]) -> list[tuple[float, ...]]:
        return [(0.1, 0.2) for _ in texts]


class DbVectorRoutingTest(unittest.TestCase):
    def test_retrieve_context_routes_to_pool_when_pool_is_confident(self) -> None:
        with (
            patch.object(db, "_query_embedding", Mock(return_value=([0.1, 0.2], "model"))),
            patch.object(
                db,
                "_fetch_vector_candidates",
                Mock(
                    return_value=(
                        [vector_row(score=0.82, author_agent_id=None, importance="global")],
                        [vector_row(score=0.70, author_agent_id=AGENT_ID, importance="local")],
                    )
                ),
            ),
        ):
            result = db.retrieve_context(SimpleNamespace(), PROJECT_ID, "deploy", limit=2)

        self.assertEqual(result["route"], "pool")
        self.assertEqual(result["selected_agent_ids"], [])
        self.assertEqual(result["diagnostics"]["pool_top_score"], 0.82)

    def test_retrieve_context_routes_to_agents_when_agent_is_confident(self) -> None:
        with (
            patch.object(db, "_query_embedding", Mock(return_value=([0.1, 0.2], "model"))),
            patch.object(
                db,
                "_fetch_vector_candidates",
                Mock(
                    return_value=(
                        [vector_row(score=0.10, author_agent_id=None, importance="global")],
                        [vector_row(score=0.91, author_agent_id=AGENT_ID, importance="local")],
                    )
                ),
            ),
        ):
            result = db.retrieve_context(SimpleNamespace(), PROJECT_ID, "deploy", limit=2)

        self.assertEqual(result["route"], "agents")
        self.assertEqual(result["selected_agent_ids"], [AGENT_ID])

    def test_retrieve_context_routes_to_mixed_when_both_sides_are_useful(self) -> None:
        with (
            patch.object(db, "_query_embedding", Mock(return_value=([0.1, 0.2], "model"))),
            patch.object(
                db,
                "_fetch_vector_candidates",
                Mock(
                    return_value=(
                        [vector_row(score=0.78, author_agent_id=None, importance="global")],
                        [vector_row(score=0.86, author_agent_id=AGENT_ID, importance="local")],
                    )
                ),
            ),
        ):
            result = db.retrieve_context(SimpleNamespace(), PROJECT_ID, "deploy", limit=4)

        self.assertEqual(result["route"], "mixed")
        self.assertEqual(result["selected_agent_ids"], [AGENT_ID])
        self.assertEqual(len(result["results"]), 2)

    def test_retrieve_context_uses_lexical_fallback_without_embedding(self) -> None:
        fallback = {
            "query": "deploy",
            "route": "lexical_fallback",
            "selected_agent_ids": [],
            "results": [],
            "diagnostics": {"lexical_fallback": True},
        }

        with (
            patch.object(db, "_query_embedding", Mock(return_value=(None, "model"))),
            patch.object(db, "_legacy_retrieve_context", Mock(return_value=fallback)) as legacy,
        ):
            result = db.retrieve_context(SimpleNamespace(), PROJECT_ID, "deploy", limit=2)

        self.assertEqual(result, fallback)
        legacy.assert_called_once()

    def test_retrieve_context_falls_back_when_vector_table_is_missing(self) -> None:
        conn = FakeConn()
        fallback = {
            "query": "deploy",
            "route": "lexical_fallback",
            "selected_agent_ids": [],
            "results": [],
            "diagnostics": {"lexical_fallback": True},
        }

        with (
            patch.object(db, "_query_embedding", Mock(return_value=([0.1, 0.2], "model"))),
            patch.object(
                db,
                "_fetch_vector_candidates",
                Mock(side_effect=psycopg.errors.UndefinedTable("missing")),
            ),
            patch.object(db, "_legacy_retrieve_context", Mock(return_value=fallback)) as legacy,
        ):
            result = db.retrieve_context(conn, PROJECT_ID, "deploy", limit=2)

        self.assertEqual(result, fallback)
        conn.rollback.assert_called_once()
        legacy.assert_called_once()

    def test_index_memory_source_chunks_stores_hash_and_embedding_vector(self) -> None:
        conn = FakeConn()
        config = OpenAIEmbeddingConfig(
            api_key="sk-test",
            model="text-embedding-unit",
            dimensions=2,
        )

        with (
            patch.object(db, "_embedding_config", Mock(return_value=config)),
            patch.object(db, "OpenAIEmbeddingClient", FakeEmbeddingClient),
        ):
            indexed = db.index_memory_source_chunks(
                conn,
                project_id=PROJECT_ID,
                author_agent_id=AGENT_ID,
                importance="local",
                source_table="agent_memory_document",
                source_id=SOURCE_ID,
                content="Railway deploy notes",
                source_kind="deploy",
                metadata={"source": "test"},
            )

        self.assertEqual(indexed, 1)
        _, rows = conn.cursor_obj.executemany_calls[0]
        self.assertEqual(rows[0][6], 0)
        self.assertEqual(rows[0][7], "Railway deploy notes")
        self.assertEqual(rows[0][8], content_hash("Railway deploy notes"))
        self.assertEqual(rows[0][10], "[0.1,0.2]")
        self.assertEqual(rows[0][11], "text-embedding-unit")
        self.assertEqual(rows[0][12], 2)


if __name__ == "__main__":
    unittest.main()
