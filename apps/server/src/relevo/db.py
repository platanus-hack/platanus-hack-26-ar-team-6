"""V2 data-access layer.

Narf's API routes call into these functions. They are the only place that
should issue SQL. Everything is synchronous psycopg for hackathon simplicity; if we
need async we can switch the connection pool without touching call sites.

The shapes here are the contract between Sarf (database) and Narf (API).
If you need to change a return shape, sync with Narf first.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
import re
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


def get_project_context_entries(
    conn: psycopg.Connection, project_id: UUID, limit: int = 20
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM project_context_entry
            WHERE project_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (project_id, limit),
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
        "project_context": get_project_context_entries(conn, user["project_id"], limit=20),
    }


def _search_tokens(text: str) -> set[str]:
    stopwords = {
        "about",
        "after",
        "again",
        "before",
        "being",
        "does",
        "from",
        "have",
        "into",
        "should",
        "that",
        "their",
        "there",
        "this",
        "what",
        "when",
        "where",
        "which",
        "with",
        "your",
    }
    return {
        token
        for token in re.findall(r"[a-zA-Z0-9_/-]{3,}", text.lower())
        if token not in stopwords
    }


def retrieve_user_context(
    conn: psycopg.Connection,
    user_id: UUID,
    question: str,
    limit: int = 6,
    scan_limit: int = 50,
) -> list[dict[str, Any]]:
    """Hackathon retrieval while embeddings are still nullable.

    It uses lexical overlap against content + metadata tags, then falls back to
    recent rows. Once embeddings are backfilled, this function is the single
    call site to swap to vector ranking.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM context_entry
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (user_id, scan_limit),
        )
        rows = [dict(r) for r in cur.fetchall()]

    question_tokens = _search_tokens(question)
    ranked: list[tuple[int, int, dict[str, Any]]] = []
    for index, row in enumerate(rows):
        metadata = row.get("metadata") or {}
        metadata_text = " ".join(str(value) for value in metadata.values())
        text_tokens = _search_tokens(f"{row['content']} {metadata_text}")
        overlap = len(question_tokens & text_tokens)
        kind_boost = 1 if row.get("kind") == "cross_user_qa" else 0
        ranked.append((overlap + kind_boost, -index, row))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    selected = [row for score, _, row in ranked if score > 0][:limit]
    if selected:
        return selected
    return rows[:limit]


def write_prompt_answer_entry(
    conn: psycopg.Connection,
    user_id: UUID,
    prompt: str,
    final_answer: str,
    extra_metadata: dict[str, Any] | None = None,
) -> UUID:
    """Append a single prompt+answer row to the prompting user's context.

    Shape:
      kind = 'prompt_answer'
      content = "PROMPT:\n<prompt>\n\nANSWER:\n<final_answer>"
      metadata = {"prompt": ..., "final_answer": ..., **extra_metadata}

    Embedding is left NULL until the model decision is locked with Jorf.
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
    on-demand agent into target_user's context and qa_ledger.

    Returns the materialized context_entry id because retrieval cares about
    that row. The ledger id is also stored in the context metadata.
    """
    target_user = get_user(conn, target_user_id)
    if target_user is None:
        raise ValueError(f"target user not found: {target_user_id}")
    asker_user = get_user(conn, asker_user_id)
    if asker_user is None:
        raise ValueError(f"asker user not found: {asker_user_id}")
    if target_user["project_id"] != asker_user["project_id"]:
        raise ValueError("asking user and target user must belong to the same project")

    project_id = target_user["project_id"]
    metadata: dict[str, Any] = {
        "source": "request_context",
        "asker_user_id": str(asker_user_id),
        "target_user_id": str(target_user_id),
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
        context_entry_id = cur.fetchone()["id"]
        cur.execute(
            """
            INSERT INTO qa_ledger (
              project_id,
              asking_user_id,
              target_user_id,
              context_entry_id,
              question,
              answer,
              metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                project_id,
                asker_user_id,
                target_user_id,
                context_entry_id,
                question,
                answer,
                psycopg.types.json.Jsonb({"source": "request_context"}),
            ),
        )
        qa_ledger_id = cur.fetchone()["id"]
        cur.execute(
            """
            UPDATE context_entry
            SET metadata = metadata || %s
            WHERE id = %s
            """,
            (
                psycopg.types.json.Jsonb({"qa_ledger_id": str(qa_ledger_id)}),
                context_entry_id,
            ),
        )
        conn.commit()
    return context_entry_id  # type: ignore[return-value]
