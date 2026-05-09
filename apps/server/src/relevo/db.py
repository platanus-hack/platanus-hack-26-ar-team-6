"""V1 data-access layer.

Narf's API routes call into these functions. They are the only place that
should issue SQL. Everything is synchronous psycopg for V1 simplicity; if we
need async we can switch the connection pool without touching call sites.

The shapes here are the contract between Sarf (database) and Narf (API).
If you need to change a return shape, sync with Narf first.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

DEFAULT_DATABASE_URL = "postgresql://relevo:relevo@localhost:5432/relevo"


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


@contextmanager
def connect(database_url: str | None = None) -> Iterator[psycopg.Connection]:
    url = database_url or get_database_url()
    with psycopg.connect(url, row_factory=dict_row) as conn:
        yield conn


def get_user_by_token(conn: psycopg.Connection, token: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, project_id, display_name, domain_summary, profile FROM app_user WHERE auth_token = %s",
            (token,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_user(conn: psycopg.Connection, user_id: UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, project_id, display_name, domain_summary, profile FROM app_user WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_directory(conn: psycopg.Connection, project_id: UUID) -> list[dict[str, Any]]:
    """All users in a project, with the fields Jerf's eval and the AI's roster need."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, display_name, domain_summary, profile
            FROM app_user
            WHERE project_id = %s
            ORDER BY display_name
            """,
            (project_id,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_project(conn: psycopg.Connection, project_id: UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, description FROM project WHERE id = %s",
            (project_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_recent_context_entries(
    conn: psycopg.Connection, user_id: UUID, limit: int = 10
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM context_entry
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_bootstrap(conn: psycopg.Connection, user_id: UUID) -> dict[str, Any]:
    """Bundle everything Narf's /bootstrap endpoint returns.

    Shape (the contract that Marirf's UI and Jorf's local-AI prompt both consume):

      {
        "user": {id, display_name, domain_summary, profile},
        "project": {id, name, description},
        "roster": [{id, display_name, domain_summary, profile}, ...],
        "recent_entries": [{id, kind, content, metadata, created_at}, ...],
      }

    Raises ValueError if the user does not exist.
    """
    user = get_user(conn, user_id)
    if user is None:
        raise ValueError(f"user not found: {user_id}")
    project = get_project(conn, user["project_id"])
    if project is None:
        raise ValueError(f"project not found for user {user_id}")
    roster = get_user_directory(conn, user["project_id"])
    recent = get_recent_context_entries(conn, user_id, limit=10)
    return {
        "user": user,
        "project": project,
        "roster": roster,
        "recent_entries": recent,
    }


def write_prompt_answer_entry(
    conn: psycopg.Connection,
    user_id: UUID,
    prompt: str,
    final_answer: str,
    extra_metadata: dict[str, Any] | None = None,
) -> UUID:
    """Append a single prompt+answer row to the prompting user's context.

    V1 shape:
      kind = 'prompt_answer'
      content = "PROMPT:\n<prompt>\n\nANSWER:\n<final_answer>"
      metadata = {"prompt": ..., "final_answer": ..., **extra_metadata}

    Embedding is left NULL in V1 (model decision deferred to V2 with Jorf).
    """
    metadata: dict[str, Any] = {"prompt": prompt, "final_answer": final_answer}
    if extra_metadata:
        metadata.update(extra_metadata)
    content = f"PROMPT:\n{prompt}\n\nANSWER:\n{final_answer}"
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO context_entry (user_id, kind, content, metadata)
            VALUES (%s, 'prompt_answer', %s, %s)
            RETURNING id
            """,
            (user_id, content, psycopg.types.json.Jsonb(metadata)),
        )
        row = cur.fetchone()
        conn.commit()
    return row["id"]  # type: ignore[index]


def write_cross_user_qa_entry(
    conn: psycopg.Connection,
    target_user_id: UUID,
    asker_user_id: UUID,
    question: str,
    answer: str,
    extra_metadata: dict[str, Any] | None = None,
) -> UUID:
    """Closure invariant write: append the Q&A produced by target_user's
    on-demand agent into target_user's context.

    Wired by V2. Provided in V1 so Narf's stub endpoint and Jerf's eval
    fixtures can exercise the function signature.
    """
    metadata: dict[str, Any] = {
        "asker_user_id": str(asker_user_id),
        "question": question,
        "answer": answer,
    }
    if extra_metadata:
        metadata.update(extra_metadata)
    content = f"QUESTION (from {asker_user_id}):\n{question}\n\nANSWER:\n{answer}"
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO context_entry (user_id, kind, content, metadata)
            VALUES (%s, 'cross_user_qa', %s, %s)
            RETURNING id
            """,
            (target_user_id, content, psycopg.types.json.Jsonb(metadata)),
        )
        row = cur.fetchone()
        conn.commit()
    return row["id"]  # type: ignore[index]
