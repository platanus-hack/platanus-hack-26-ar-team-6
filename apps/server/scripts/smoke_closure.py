"""Smoke test for the V2 closure invariant.

Proves that POST /request-context enriches the target user's DB
synchronously (plan.md §8 converge criterion).

Preconditions:
  - Postgres up:
      docker compose -f infra/docker-compose.yml up -d
  - Migration applied + seeds loaded:
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


_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from relevo.db import connect, get_user_by_token  # noqa: E402


QUESTION = "What deploy quirks should I know about?"
ASKER_TOKEN = "dev-token-user1"
TARGET_TOKEN = "dev-token-user2"


def _count_cross_user_qa(conn, user_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM context_entry WHERE user_id = %s AND kind = 'cross_user_qa'",
            (user_id,),
        )
        row = cur.fetchone()
    return int(row["n"])


def _latest_cross_user_qa(conn, user_id) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, content, metadata, created_at
            FROM context_entry
            WHERE user_id = %s AND kind = 'cross_user_qa'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise AssertionError("latest_cross_user_qa: no row found for target user")
    return dict(row)


def _post_request_context(server_url: str, token: str, target_user_id: str, question: str):
    body = json.dumps({"target_user_id": target_user_id, "question": question}).encode("utf-8")
    req = urllib.request.Request(
        url=f"{server_url.rstrip('/')}/request-context",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        status = e.code
        payload = e.read().decode("utf-8", errors="replace")
    return status, payload


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

            before_count = _count_cross_user_qa(conn, user2["id"])

        status, payload = _post_request_context(server_url, ASKER_TOKEN, user2_id, QUESTION)

        if status != 200:
            failed_check = "http_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        try:
            data = json.loads(payload)
        except json.JSONDecodeError as e:
            failed_check = "response_json_parse"
            raise AssertionError(f"check failed: {failed_check} ({e}; body={payload[:500]})")

        if not isinstance(data, dict):
            failed_check = "response_is_object"
            raise AssertionError(f"check failed: {failed_check}")

        answer = data.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            failed_check = "answer_non_empty_str"
            raise AssertionError(f"check failed: {failed_check}")

        source_ids = data.get("source_user_ids")
        if not isinstance(source_ids, list):
            failed_check = "source_user_ids_is_list"
            raise AssertionError(f"check failed: {failed_check}")
        if user2_id not in source_ids:
            failed_check = "source_user_ids_contains_target"
            raise AssertionError(f"check failed: {failed_check} (got {source_ids})")

        source_context_entry_ids = data.get("source_context_entry_ids")
        if not isinstance(source_context_entry_ids, list) or not source_context_entry_ids:
            failed_check = "source_context_entry_ids_non_empty"
            raise AssertionError(
                f"check failed: {failed_check} (got {source_context_entry_ids!r})"
            )

        with connect() as conn:
            after_count = _count_cross_user_qa(conn, user2["id"])
            if after_count != before_count + 1:
                failed_check = "row_count_incremented_by_one"
                raise AssertionError(
                    f"check failed: {failed_check} (before={before_count}, after={after_count})"
                )

            latest = _latest_cross_user_qa(conn, user2["id"])
            content = latest["content"]
            metadata = latest["metadata"] or {}

            if QUESTION not in content:
                failed_check = "content_contains_question"
                raise AssertionError(f"check failed: {failed_check}")
            if answer not in content:
                failed_check = "content_contains_answer"
                raise AssertionError(f"check failed: {failed_check}")
            if str(metadata.get("asker_user_id")) != user1_id:
                failed_check = "metadata_asker_user_id"
                raise AssertionError(
                    f"check failed: {failed_check} (got {metadata.get('asker_user_id')!r}, want {user1_id!r})"
                )
            if metadata.get("question") != QUESTION:
                failed_check = "metadata_question"
                raise AssertionError(f"check failed: {failed_check}")
            if metadata.get("answer") != answer:
                failed_check = "metadata_answer"
                raise AssertionError(f"check failed: {failed_check}")

        print("✅ closure invariant smoke test passed")

    except AssertionError as e:
        print("❌ closure invariant smoke test FAILED")
        print(f"  failed check: {failed_check}")
        print(f"  detail: {e}")
        sys.exit(1)
    except Exception as e:
        print("❌ closure invariant smoke test ERRORED")
        print(f"  unexpected: {type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
