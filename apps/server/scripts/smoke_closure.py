"""Smoke test for the retriever/updater closure invariant.

This exercises the new server primitives directly:

1. POST /agent-ctx records a context_exchange for asker -> target retrieval.
2. POST /memory-updates appends asker memory and target closure memory.

Preconditions:
  - Postgres up:
      docker compose -f infra/docker-compose.yml up -d
  - Migrations applied + seeds loaded:
      uv run python -m relevo.seeds.loader
  - Server running on http://localhost:8000 (override via SERVER_URL env var):
      uv run uvicorn relevo.main:app --reload

Run:
  uv run python apps/server/scripts/smoke_closure.py     # from repo root
  uv run python scripts/smoke_closure.py                 # from apps/server

Exit code 0 on success, 1 on failure.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from relevo.db import connect, get_user_by_token  # noqa: E402


QUESTION = "What deploy quirks should I know about?"
ASKER_TOKEN = "dev-token-user1"
TARGET_TOKEN = "dev-token-user2"


def _post_json(server_url: str, path: str, token: str, body: dict[str, Any]) -> tuple[int, str]:
    req = urllib.request.Request(
        url=f"{server_url.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def _parse_response(payload: str) -> dict[str, Any]:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AssertionError(f"response_json_parse failed: {exc}; body={payload[:500]}") from exc
    if not isinstance(data, dict):
        raise AssertionError("response_is_object failed")
    return data


def _count_target_closure_events(conn, target_agent_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM agent_memory_event
            WHERE author_agent_id = %s
              AND metadata->>'source' = 'retriever-closure'
            """,
            (target_agent_id,),
        )
        row = cur.fetchone()
    return int(row["n"])


def _latest_closure_event(conn, target_agent_id, exchange_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, content, metadata, source_context_exchange_id, created_at
            FROM agent_memory_event
            WHERE author_agent_id = %s
              AND source_context_exchange_id = %s
              AND metadata->>'source' = 'retriever-closure'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (target_agent_id, exchange_id),
        )
        row = cur.fetchone()
    if row is None:
        raise AssertionError("latest_closure_event: no row found for target agent")
    return dict(row)


def _post_agent_ctx(server_url: str, token: str, target_agent_id: str) -> tuple[int, str]:
    return _post_json(
        server_url,
        "/agent-ctx",
        token,
        {
            "agent_id": target_agent_id,
            "query": QUESTION,
            "metadata": {"source": "smoke_closure"},
        },
    )


def _post_memory_update(
    server_url: str,
    token: str,
    *,
    asker_agent_id: str,
    target_agent_id: str,
    exchange_id: str,
    retrieved_summary: str,
) -> tuple[int, str]:
    return _post_json(
        server_url,
        "/memory-updates",
        token,
        {
            "chat_session_id": "smoke-closure",
            "checkpoint_index": 1,
            "operations": [
                {
                    "author_agent_id": asker_agent_id,
                    "importance": "local",
                    "document_key": "chat-summary:smoke-closure",
                    "context_exchange_id": exchange_id,
                    "event_content": (
                        f"Asked retriever for deployment context: {QUESTION}\n"
                        f"Retriever returned: {retrieved_summary}"
                    ),
                    "canonical_content": (
                        "The user asked for deployment context and the retriever "
                        f"returned: {retrieved_summary}"
                    ),
                    "metadata": {"source": "smoke-asker"},
                },
                {
                    "author_agent_id": target_agent_id,
                    "importance": "local",
                    "document_key": f"retriever-closure:{exchange_id}",
                    "context_exchange_id": exchange_id,
                    "event_content": (
                        f"Closure record: another agent retrieved this context from "
                        f"the target agent for question: {QUESTION}\n"
                        f"Returned context: {retrieved_summary}"
                    ),
                    "canonical_content": (
                        f"Retriever closure for deployment question '{QUESTION}': "
                        f"{retrieved_summary}"
                    ),
                    "metadata": {"source": "retriever-closure"},
                },
            ],
        },
    )


def main() -> None:
    server_url = os.environ.get("SERVER_URL", "http://localhost:8000")

    failed_check: str | None = None
    try:
        with connect() as conn:
            user1 = get_user_by_token(conn, ASKER_TOKEN)
            user2 = get_user_by_token(conn, TARGET_TOKEN)
            if user1 is None:
                failed_check = "resolve_user1"
                raise AssertionError(f"check failed: {failed_check} (token={ASKER_TOKEN})")
            if user2 is None:
                failed_check = "resolve_user2"
                raise AssertionError(f"check failed: {failed_check} (token={TARGET_TOKEN})")

            user1_id = str(user1["id"])
            user2_id = str(user2["id"])
            before_count = _count_target_closure_events(conn, user2["id"])

        status, payload = _post_agent_ctx(server_url, ASKER_TOKEN, user2_id)
        if status != 200:
            failed_check = "agent_ctx_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        retrieval = _parse_response(payload)
        exchange_id = retrieval.get("context_exchange_id")
        if not isinstance(exchange_id, str) or not exchange_id:
            failed_check = "context_exchange_id_present"
            raise AssertionError(f"check failed: {failed_check}")

        results = retrieval.get("results")
        if not isinstance(results, list) or not results:
            failed_check = "retrieval_results_non_empty"
            raise AssertionError(f"check failed: {failed_check}")

        retrieved_summary = " ".join(
            str(row.get("content", "")).strip()
            for row in results
            if isinstance(row, dict)
        ).strip()
        if not retrieved_summary:
            failed_check = "retrieved_summary_non_empty"
            raise AssertionError(f"check failed: {failed_check}")

        status, payload = _post_memory_update(
            server_url,
            ASKER_TOKEN,
            asker_agent_id=user1_id,
            target_agent_id=user2_id,
            exchange_id=exchange_id,
            retrieved_summary=retrieved_summary,
        )
        if status != 200:
            failed_check = "memory_update_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        update = _parse_response(payload)
        if len(update.get("event_ids") or []) < 2:
            failed_check = "memory_update_event_ids"
            raise AssertionError(f"check failed: {failed_check} (got {update})")
        if len(update.get("document_ids") or []) < 2:
            failed_check = "memory_update_document_ids"
            raise AssertionError(f"check failed: {failed_check} (got {update})")

        with connect() as conn:
            after_count = _count_target_closure_events(conn, user2["id"])
            if after_count != before_count + 1:
                failed_check = "target_closure_count_incremented_by_one"
                raise AssertionError(
                    f"check failed: {failed_check} (before={before_count}, after={after_count})"
                )

            latest = _latest_closure_event(conn, user2["id"], exchange_id)
            content = latest["content"]
            metadata = latest["metadata"] or {}
            if QUESTION not in content:
                failed_check = "closure_content_contains_question"
                raise AssertionError(f"check failed: {failed_check}")
            if retrieved_summary[:80] not in content:
                failed_check = "closure_content_contains_retrieved_context"
                raise AssertionError(f"check failed: {failed_check}")
            if metadata.get("source") != "retriever-closure":
                failed_check = "closure_metadata_source"
                raise AssertionError(f"check failed: {failed_check}")

        print("closure invariant smoke test passed")

    except AssertionError as exc:
        print("closure invariant smoke test FAILED")
        print(f"  failed check: {failed_check}")
        print(f"  detail: {exc}")
        sys.exit(1)
    except Exception as exc:
        print("closure invariant smoke test ERRORED")
        print(f"  unexpected: {type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
