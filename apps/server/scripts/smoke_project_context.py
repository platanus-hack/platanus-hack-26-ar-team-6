"""Smoke test for V3 target="project" request_context.

Preconditions match smoke_closure.py:
  - Postgres up and schema migrated.
  - Seeds loaded.
  - Server running on http://localhost:8000 (override via SERVER_URL env var).

Run:
  python apps/server/scripts/smoke_project_context.py   # from repo root
  python scripts/smoke_project_context.py               # from apps/server

Exit code 0 on success, 1 on failure.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from relevo.db import connect, get_user_by_token  # noqa: E402


QUESTION = (
    "What are the shared architecture pieces in this project, and when should "
    "the AI use project context instead of asking User1 or User2?"
)
FOLLOWUP_QUESTION = (
    "What did project context say about shared architecture pieces and project "
    "context routing?"
)
ASKER_TOKEN = "dev-token-user1"


def _count_project_qa(conn, project_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM project_context_entry
            WHERE project_id = %s
              AND kind = 'project_qa'
            """,
            (project_id,),
        )
        row = cur.fetchone()
    return int(row["n"])


def _latest_project_qa(conn, project_id) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, content, metadata, created_at
            FROM project_context_entry
            WHERE project_id = %s
              AND kind = 'project_qa'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (project_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise AssertionError("latest_project_qa: no row found for project")
    return dict(row)


def _project_context_ids(conn, project_id) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM project_context_entry WHERE project_id = %s",
            (project_id,),
        )
        rows = cur.fetchall()
    return {str(row["id"]) for row in rows}


def _ledger_count_for_entry(conn, project_context_entry_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM project_qa_ledger
            WHERE project_context_entry_id = %s
            """,
            (project_context_entry_id,),
        )
        row = cur.fetchone()
    return int(row["n"])


def _post_project_request_context(server_url: str, token: str, question: str):
    body = json.dumps({"target": "project", "question": question}).encode("utf-8")
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


def _parse_response(payload: str) -> dict:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as e:
        raise AssertionError(f"response_json_parse failed: {e}; body={payload[:500]}") from e
    if not isinstance(data, dict):
        raise AssertionError("response_is_object failed")
    return data


def _run_v2_closure_smoke() -> None:
    script = Path(__file__).with_name("smoke_closure.py")
    result = subprocess.run([sys.executable, str(script)], check=False)
    if result.returncode != 0:
        raise AssertionError(f"existing user-target closure smoke failed: {result.returncode}")


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
            project_id_text = str(project_id)
            before_count = _count_project_qa(conn, project_id)

        status, payload = _post_project_request_context(server_url, ASKER_TOKEN, QUESTION)
        if status != 200:
            failed_check = "http_status_200"
            raise AssertionError(f"check failed: {failed_check} (got {status}, body={payload[:500]})")

        data = _parse_response(payload)
        answer = data.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            failed_check = "answer_non_empty_str"
            raise AssertionError(f"check failed: {failed_check}")
        if data.get("target") != "project":
            failed_check = "target_project"
            raise AssertionError(f"check failed: {failed_check} (got {data.get('target')!r})")
        if data.get("target_project_id") != project_id_text:
            failed_check = "target_project_id"
            raise AssertionError(
                f"check failed: {failed_check} (got {data.get('target_project_id')!r})"
            )
        if data.get("source_user_ids") != []:
            failed_check = "source_user_ids_empty"
            raise AssertionError(f"check failed: {failed_check} (got {data.get('source_user_ids')!r})")

        source_ids = data.get("source_context_entry_ids")
        if not isinstance(source_ids, list) or not source_ids:
            failed_check = "source_context_entry_ids_non_empty"
            raise AssertionError(f"check failed: {failed_check} (got {source_ids!r})")

        retrieved = data.get("retrieved_context_entries")
        if not isinstance(retrieved, list) or not retrieved:
            failed_check = "retrieved_context_entries_non_empty"
            raise AssertionError(f"check failed: {failed_check}")
        retrieved_ids = {str(row.get("id")) for row in retrieved if isinstance(row, dict)}
        if set(source_ids) != retrieved_ids:
            failed_check = "source_ids_match_retrieved"
            raise AssertionError(
                f"check failed: {failed_check} (source={source_ids}, retrieved={sorted(retrieved_ids)})"
            )

        with connect() as conn:
            project_context_ids = _project_context_ids(conn, project_id)
            if not set(source_ids).issubset(project_context_ids):
                failed_check = "retrieved_rows_are_project_context"
                raise AssertionError(f"check failed: {failed_check} (got {source_ids})")

            after_count = _count_project_qa(conn, project_id)
            if after_count != before_count + 1:
                failed_check = "project_qa_count_incremented_by_one"
                raise AssertionError(
                    f"check failed: {failed_check} (before={before_count}, after={after_count})"
                )

            latest = _latest_project_qa(conn, project_id)
            materialized_id = str(latest["id"])
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
                    f"check failed: {failed_check} (got {metadata.get('asker_user_id')!r})"
                )
            if metadata.get("target") != "project":
                failed_check = "metadata_target"
                raise AssertionError(f"check failed: {failed_check}")
            if metadata.get("question") != QUESTION:
                failed_check = "metadata_question"
                raise AssertionError(f"check failed: {failed_check}")
            if metadata.get("answer") != answer:
                failed_check = "metadata_answer"
                raise AssertionError(f"check failed: {failed_check}")
            if _ledger_count_for_entry(conn, latest["id"]) != 1:
                failed_check = "project_qa_ledger_row"
                raise AssertionError(f"check failed: {failed_check}")

        followup_status, followup_payload = _post_project_request_context(
            server_url,
            ASKER_TOKEN,
            FOLLOWUP_QUESTION,
        )
        if followup_status != 200:
            failed_check = "followup_http_status_200"
            raise AssertionError(
                f"check failed: {failed_check} (got {followup_status}, body={followup_payload[:500]})"
            )
        followup_data = _parse_response(followup_payload)
        followup_source_ids = followup_data.get("source_context_entry_ids")
        if not isinstance(followup_source_ids, list):
            failed_check = "followup_source_context_entry_ids_is_list"
            raise AssertionError(f"check failed: {failed_check} (got {followup_source_ids!r})")
        if materialized_id not in followup_source_ids:
            failed_check = "followup_retrieves_project_qa"
            raise AssertionError(
                f"check failed: {failed_check} (materialized={materialized_id}, got={followup_source_ids})"
            )

        _run_v2_closure_smoke()
        print("project context smoke test passed")

    except AssertionError as e:
        print("project context smoke test FAILED")
        print(f"  failed check: {failed_check}")
        print(f"  detail: {e}")
        sys.exit(1)
    except Exception as e:
        print("project context smoke test ERRORED")
        print(f"  unexpected: {type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
