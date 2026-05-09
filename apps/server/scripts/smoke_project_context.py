"""Smoke test for global retriever context and updater writes.

Preconditions match smoke_closure.py:
  - Postgres up and schema migrated.
  - Seeds loaded.
  - Server running on http://localhost:8000 (override via SERVER_URL env var).

Run:
  uv run python apps/server/scripts/smoke_project_context.py   # from repo root
  uv run python scripts/smoke_project_context.py               # from apps/server

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


QUESTION = (
    "What are the shared architecture pieces in this project, and when should "
    "the AI use global project context instead of asking User1 or User2?"
)
FOLLOWUP_QUESTION = (
    "What did global context say about shared architecture pieces and project "
    "context routing?"
)
ASKER_TOKEN = "dev-token-user1"


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


def _count_global_smoke_events(conn, project_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM agent_memory_event
            WHERE project_id = %s
              AND importance = 'global'
              AND metadata->>'source' = 'smoke-global'
            """,
            (project_id,),
        )
        row = cur.fetchone()
    return int(row["n"])


def _post_global_ctx(server_url: str, token: str, query: str) -> tuple[int, str]:
    return _post_json(
        server_url,
        "/global-ctx",
        token,
        {
            "query": query,
            "metadata": {"source": "smoke_project_context"},
        },
    )


def _post_memory_update(
    server_url: str,
    token: str,
    *,
    asker_agent_id: str,
    exchange_id: str,
    retrieved_summary: str,
) -> tuple[int, str]:
    canonical = (
        "Global project context smoke: shared architecture pieces, project "
        "context routing, and global memory were retrieved and committed. "
        f"Retrieved context: {retrieved_summary}"
    )
    return _post_json(
        server_url,
        "/memory-updates",
        token,
        {
            "chat_session_id": "smoke-global-context",
            "checkpoint_index": 1,
            "operations": [
                {
                    "author_agent_id": asker_agent_id,
                    "importance": "global",
                    "document_key": "global-project-smoke",
                    "context_exchange_id": exchange_id,
                    "event_content": (
                        f"Global context retrieval question: {QUESTION}\n"
                        f"Retriever returned: {retrieved_summary}"
                    ),
                    "canonical_content": canonical,
                    "metadata": {"source": "smoke-global"},
                }
            ],
        },
    )


def main() -> None:
    server_url = os.environ.get("SERVER_URL", "http://localhost:8000")

    failed_check: str | None = None
    try:
        with connect() as conn:
            user1 = get_user_by_token(conn, ASKER_TOKEN)
            if user1 is None:
                failed_check = "resolve_user1"
                raise AssertionError(f"check failed: {failed_check} (token={ASKER_TOKEN})")
            user1_id = str(user1["id"])
            project_id = user1["project_id"]
            before_count = _count_global_smoke_events(conn, project_id)

        status, payload = _post_global_ctx(server_url, ASKER_TOKEN, QUESTION)
        if status != 200:
            failed_check = "global_ctx_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        retrieval = _parse_response(payload)
        exchange_id = retrieval.get("context_exchange_id")
        if not isinstance(exchange_id, str) or not exchange_id:
            failed_check = "context_exchange_id_present"
            raise AssertionError(f"check failed: {failed_check}")

        results = retrieval.get("results")
        if not isinstance(results, list) or not results:
            failed_check = "global_results_non_empty"
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
            exchange_id=exchange_id,
            retrieved_summary=retrieved_summary,
        )
        if status != 200:
            failed_check = "memory_update_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        update = _parse_response(payload)
        written_ids = set(update.get("event_ids") or []) | set(update.get("document_ids") or [])
        if not written_ids:
            failed_check = "memory_update_ids"
            raise AssertionError(f"check failed: {failed_check} (got {update})")

        with connect() as conn:
            after_count = _count_global_smoke_events(conn, project_id)
            if after_count != before_count + 1:
                failed_check = "global_event_count_incremented_by_one"
                raise AssertionError(
                    f"check failed: {failed_check} (before={before_count}, after={after_count})"
                )

        followup_status, followup_payload = _post_global_ctx(
            server_url,
            ASKER_TOKEN,
            FOLLOWUP_QUESTION,
        )
        if followup_status != 200:
            failed_check = "followup_global_ctx_status_200"
            raise AssertionError(
                f"check failed: {failed_check} (got {followup_status}, body={followup_payload[:500]})"
            )

        followup = _parse_response(followup_payload)
        followup_results = followup.get("results")
        if not isinstance(followup_results, list) or not followup_results:
            failed_check = "followup_results_non_empty"
            raise AssertionError(f"check failed: {failed_check}")
        followup_ids = {
            str(row.get("id"))
            for row in followup_results
            if isinstance(row, dict) and row.get("id")
        }
        if written_ids.isdisjoint(followup_ids):
            failed_check = "followup_retrieves_committed_global_memory"
            raise AssertionError(
                f"check failed: {failed_check} (written={sorted(written_ids)}, got={sorted(followup_ids)})"
            )

        print("global context smoke test passed")

    except AssertionError as exc:
        print("global context smoke test FAILED")
        print(f"  failed check: {failed_check}")
        print(f"  detail: {exc}")
        sys.exit(1)
    except Exception as exc:
        print("global context smoke test ERRORED")
        print(f"  unexpected: {type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
