"""Data-access layer for bootstrap and the LangGraph memory network.

API routes call into these functions. They are the only place that should issue
SQL. Everything is synchronous psycopg for hackathon simplicity; if we need
async we can switch the connection pool without touching call sites.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from contextlib import contextmanager
from typing import Any, Iterator
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DEFAULT_DATABASE_URL = "postgresql://relevo:relevo@localhost:5432/relevo"
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5
SESSION_TOKEN_PREFIX = "rlv_"
MAX_RETRIEVED_CONTENT_CHARS = 4000

_pool: ConnectionPool | None = None


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def get_connect_timeout() -> int:
    return int(os.environ.get("DB_CONNECT_TIMEOUT", DEFAULT_CONNECT_TIMEOUT_SECONDS))


def init_pool(database_url: str | None = None) -> None:
    global _pool
    url = database_url or get_database_url()
    _pool = ConnectionPool(
        conninfo=url,
        min_size=2,
        max_size=10,
        kwargs={"row_factory": dict_row},
        open=True,
    )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connect(database_url: str | None = None) -> Iterator[psycopg.Connection]:
    if _pool is not None and database_url is None:
        with _pool.connection() as conn:
            yield conn
    else:
        url = database_url or get_database_url()
        with psycopg.connect(
            url,
            row_factory=dict_row,
            connect_timeout=get_connect_timeout(),
        ) as conn:
            yield conn


def get_user_by_token(conn: psycopg.Connection, token: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, display_name, domain_summary, profile, role, account_id
            FROM app_user
            WHERE auth_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_user(conn: psycopg.Connection, user_id: UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, display_name, domain_summary, profile, role, account_id
            FROM app_user
            WHERE id = %s
            """,
            (user_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_directory(conn: psycopg.Connection, project_id: UUID) -> list[dict[str, Any]]:
    """All users in a project, with the fields Jerf's eval and the AI's roster need."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, display_name, domain_summary, profile, role, account_id
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


def delete_project_by_id(conn: psycopg.Connection, project_id: UUID) -> bool:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM project WHERE id = %s", (project_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def remove_project_membership_for_account(
    conn: psycopg.Connection,
    *,
    account_id: UUID,
    project_id: UUID,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM app_user
            WHERE account_id = %s AND project_id = %s
            """,
            (account_id, project_id),
        )
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def normalize_email(email: str) -> str:
    return email.strip().lower()


def token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def new_opaque_token(prefix: str = SESSION_TOKEN_PREFIX) -> str:
    return f"{prefix}{secrets.token_urlsafe(32)}"


def upsert_account_from_google(
    conn: psycopg.Connection,
    *,
    google_sub: str,
    email: str,
    display_name: str,
    avatar_url: str | None = None,
    email_verified: bool = False,
) -> dict[str, Any]:
    normalized_email = normalize_email(email)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO account (
              google_sub,
              email,
              email_normalized,
              display_name,
              avatar_url,
              email_verified,
              last_login_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (google_sub)
            DO UPDATE SET
              email = EXCLUDED.email,
              email_normalized = EXCLUDED.email_normalized,
              display_name = EXCLUDED.display_name,
              avatar_url = EXCLUDED.avatar_url,
              email_verified = EXCLUDED.email_verified,
              last_login_at = NOW()
            RETURNING id, google_sub, email, email_normalized, display_name, avatar_url, email_verified, created_at, last_login_at
            """,
            (
                google_sub,
                email,
                normalized_email,
                display_name,
                avatar_url,
                email_verified,
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return dict(row)


def get_account_by_email(conn: psycopg.Connection, email: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, google_sub, email, email_normalized, display_name, avatar_url, email_verified, created_at, last_login_at
            FROM account
            WHERE email_normalized = %s
            """,
            (normalize_email(email),),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_account_by_session_token(conn: psycopg.Connection, token: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.google_sub, a.email, a.email_normalized, a.display_name, a.avatar_url, a.email_verified, a.created_at, a.last_login_at
            FROM account_session s
            JOIN account a ON a.id = s.account_id
            WHERE s.token_hash = %s
              AND s.revoked_at IS NULL
              AND s.expires_at > NOW()
            """,
            (token_hash(token),),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def create_account_session(
    conn: psycopg.Connection,
    account_id: UUID,
    *,
    ttl_seconds: int,
) -> str:
    token = new_opaque_token()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO account_session (account_id, token_hash, expires_at)
            VALUES (%s, %s, %s)
            """,
            (account_id, token_hash(token), expires_at),
        )
        conn.commit()
    return token


def revoke_account_session(conn: psycopg.Connection, token: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE account_session
            SET revoked_at = NOW()
            WHERE token_hash = %s AND revoked_at IS NULL
            """,
            (token_hash(token),),
        )
        conn.commit()


def create_oauth_login_state(
    conn: psycopg.Connection,
    *,
    state: str,
    desktop_redirect_uri: str,
    google_redirect_uri: str,
    ttl_seconds: int,
) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO oauth_login_state (
              state,
              desktop_redirect_uri,
              google_redirect_uri,
              expires_at
            )
            VALUES (%s, %s, %s, %s)
            """,
            (state, desktop_redirect_uri, google_redirect_uri, expires_at),
        )
        conn.commit()


def consume_oauth_login_state(conn: psycopg.Connection, state: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE oauth_login_state
            SET used_at = NOW()
            WHERE state = %s
              AND used_at IS NULL
              AND expires_at > NOW()
            RETURNING state, desktop_redirect_uri, google_redirect_uri, created_at, expires_at
            """,
            (state,),
        )
        row = cur.fetchone()
        conn.commit()
    return dict(row) if row else None


def create_desktop_login_exchange(
    conn: psycopg.Connection,
    *,
    account_id: UUID,
    ttl_seconds: int,
) -> str:
    code = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desktop_login_exchange (code, account_id, expires_at)
            VALUES (%s, %s, %s)
            """,
            (code, account_id, expires_at),
        )
        conn.commit()
    return code


def consume_desktop_login_exchange(conn: psycopg.Connection, code: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE desktop_login_exchange
            SET used_at = NOW()
            WHERE code = %s
              AND used_at IS NULL
              AND expires_at > NOW()
            RETURNING account_id
            """,
            (code,),
        )
        row = cur.fetchone()
        conn.commit()
    return dict(row) if row else None


def get_account(conn: psycopg.Connection, account_id: UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, google_sub, email, email_normalized, display_name, avatar_url, email_verified, created_at, last_login_at
            FROM account
            WHERE id = %s
            """,
            (account_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_project_memberships_for_account(
    conn: psycopg.Connection,
    account_id: UUID,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              p.id AS project_id,
              p.name AS project_name,
              p.description,
              u.id AS user_id,
              u.display_name,
              u.domain_summary,
              u.role
            FROM app_user u
            JOIN project p ON p.id = u.project_id
            WHERE u.account_id = %s
            ORDER BY p.name
            """,
            (account_id,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_project_membership_for_account(
    conn: psycopg.Connection,
    *,
    account_id: UUID,
    project_id: UUID,
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, display_name, domain_summary, profile, role, account_id
            FROM app_user
            WHERE account_id = %s AND project_id = %s
            """,
            (account_id, project_id),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def create_project_for_account(
    conn: psycopg.Connection,
    *,
    account_id: UUID,
    name: str,
    description: str | None,
    domain_summary: str,
) -> dict[str, Any]:
    account = get_account(conn, account_id)
    if account is None:
        raise ValueError(f"account not found: {account_id}")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project (name, description)
            VALUES (%s, %s)
            RETURNING id, name, description
            """,
            (name, description),
        )
        project = dict(cur.fetchone())
        cur.execute(
            """
            INSERT INTO app_user (
              project_id,
              account_id,
              display_name,
              domain_summary,
              auth_token,
              profile,
              role
            )
            VALUES (%s, %s, %s, %s, NULL, %s, 'leader')
            RETURNING id, project_id, display_name, domain_summary, role
            """,
            (
                project["id"],
                account_id,
                account["display_name"],
                domain_summary,
                psycopg.types.json.Jsonb(default_profile(domain_summary)),
            ),
        )
        membership = dict(cur.fetchone())
        conn.commit()
    return {
        "project_id": project["id"],
        "project_name": project["name"],
        "description": project["description"],
        "user_id": membership["id"],
        "display_name": membership["display_name"],
        "domain_summary": membership["domain_summary"],
        "role": membership["role"],
    }


def default_profile(domain_summary: str) -> dict[str, Any]:
    return {
        "voice": {},
        "domain": {
            "primary": "project member",
            "tags": [],
            "expertise_summary": domain_summary,
        },
    }


def add_existing_account_to_project(
    conn: psycopg.Connection,
    *,
    project_id: UUID,
    account_id: UUID,
    domain_summary: str,
    role: str = "member",
) -> dict[str, Any]:
    account = get_account(conn, account_id)
    if account is None:
        raise ValueError(f"account not found: {account_id}")
    existing = get_project_membership_for_account(
        conn,
        account_id=account_id,
        project_id=project_id,
    )
    if existing is not None:
        raise ValueError("account is already a project member")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_user (
              project_id,
              account_id,
              display_name,
              domain_summary,
              auth_token,
              profile,
              role
            )
            VALUES (%s, %s, %s, %s, NULL, %s, %s)
            RETURNING id, project_id, display_name, domain_summary, role
            """,
            (
                project_id,
                account_id,
                account["display_name"],
                domain_summary,
                psycopg.types.json.Jsonb(default_profile(domain_summary)),
                role,
            ),
        )
        membership = dict(cur.fetchone())
        conn.commit()
    project = get_project(conn, project_id)
    return {
        "project_id": membership["project_id"],
        "project_name": project["name"] if project else "",
        "description": project["description"] if project else None,
        "user_id": membership["id"],
        "display_name": membership["display_name"],
        "domain_summary": membership["domain_summary"],
        "role": membership["role"],
    }


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


def _metadata_search_text(metadata: dict[str, Any]) -> str:
    return json.dumps(metadata, default=str, sort_keys=True)


def _rank_context_rows(
    rows: list[dict[str, Any]],
    question: str,
    *,
    closure_kind: str,
    limit: int,
) -> list[dict[str, Any]]:
    question_tokens = _search_tokens(question)
    ranked: list[tuple[int, int, dict[str, Any]]] = []
    for index, row in enumerate(rows):
        metadata = row.get("metadata") or {}
        text_tokens = _search_tokens(f"{row['content']} {_metadata_search_text(metadata)}")
        overlap = len(question_tokens & text_tokens)
        kind_boost = 1 if row.get("kind") == closure_kind else 0
        ranked.append((overlap + kind_boost, -index, row))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    selected = [row for score, _, row in ranked if score > 0][:limit]
    if selected:
        return selected
    return rows[:limit]


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

    return _rank_context_rows(
        rows,
        question,
        closure_kind="cross_user_qa",
        limit=limit,
    )


def retrieve_project_context(
    conn: psycopg.Connection,
    project_id: UUID,
    question: str,
    limit: int = 6,
    scan_limit: int = 50,
) -> list[dict[str, Any]]:
    """Project-scoped retrieval while embeddings are still nullable.

    This intentionally mirrors retrieve_user_context's lexical fallback over
    project_context_entry rows so vector ranking can replace it at one call
    site after embeddings are backfilled.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM project_context_entry
            WHERE project_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (project_id, scan_limit),
        )
        rows = [dict(r) for r in cur.fetchall()]

    return _rank_context_rows(
        rows,
        question,
        closure_kind="project_qa",
        limit=limit,
    )


def _sort_memory_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: str(row.get("created_at") or ""), reverse=True)


def _with_memory_metadata(
    row: dict[str, Any],
    *,
    source_table: str,
    importance: str,
    author_agent_id: UUID | None = None,
    document_key: str | None = None,
) -> dict[str, Any]:
    metadata = dict(row.get("metadata") or {})
    metadata.update(
        {
            "source_table": source_table,
            "importance": importance,
        }
    )
    if author_agent_id is not None:
        metadata["author_agent_id"] = str(author_agent_id)
    if document_key is not None:
        metadata["document_key"] = document_key
    content = str(row["content"])
    if len(content) > MAX_RETRIEVED_CONTENT_CHARS:
        metadata["truncated"] = True
        metadata["original_content_length"] = len(content)
        content = content[: MAX_RETRIEVED_CONTENT_CHARS - 3].rstrip() + "..."
    return {
        "id": row["id"],
        "kind": source_table,
        "content": content,
        "metadata": metadata,
        "created_at": row.get("created_at") or row.get("updated_at"),
    }


def retrieve_agent_memory(
    conn: psycopg.Connection,
    project_id: UUID,
    agent_id: UUID,
    query: str,
    limit: int = 6,
    scan_limit: int = 80,
) -> list[dict[str, Any]]:
    """Author-owned memory for one agent.

    New agent memory rows are searched first, but legacy context_entry rows are
    included so existing seed data remains useful during the migration.
    """
    rows: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, importance, document_key, content, metadata, updated_at AS created_at
            FROM agent_memory_document
            WHERE project_id = %s AND author_agent_id = %s
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (project_id, agent_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table="agent_memory_document",
                importance=row["importance"],
                author_agent_id=agent_id,
                document_key=row["document_key"],
            )
            for row in cur.fetchall()
        )
        cur.execute(
            """
            SELECT id, importance, content, metadata, created_at
            FROM agent_memory_event
            WHERE project_id = %s AND author_agent_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (project_id, agent_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table="agent_memory_event",
                importance=row["importance"],
                author_agent_id=agent_id,
            )
            for row in cur.fetchall()
        )
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM context_entry
            WHERE user_id = %s
              AND kind = 'seed'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (agent_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table=f"context_entry:{row['kind']}",
                importance="local",
                author_agent_id=agent_id,
            )
            for row in cur.fetchall()
        )

    return _rank_context_rows(
        _sort_memory_rows(rows),
        query,
        closure_kind="agent_memory_event",
        limit=limit,
    )


def retrieve_global_memory(
    conn: psycopg.Connection,
    project_id: UUID,
    query: str,
    limit: int = 6,
    scan_limit: int = 80,
) -> list[dict[str, Any]]:
    """Project-wide memory marked global, plus legacy project context rows."""
    rows: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, author_agent_id, document_key, content, metadata, updated_at AS created_at
            FROM agent_memory_document
            WHERE project_id = %s AND importance = 'global'
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (project_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table="agent_memory_document",
                importance="global",
                author_agent_id=row["author_agent_id"],
                document_key=row["document_key"],
            )
            for row in cur.fetchall()
        )
        cur.execute(
            """
            SELECT id, author_agent_id, content, metadata, created_at
            FROM agent_memory_event
            WHERE project_id = %s AND importance = 'global'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (project_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table="agent_memory_event",
                importance="global",
                author_agent_id=row["author_agent_id"],
            )
            for row in cur.fetchall()
        )
        cur.execute(
            """
            SELECT id, kind, content, metadata, created_at
            FROM project_context_entry
            WHERE project_id = %s
              AND kind = 'seed'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (project_id, scan_limit),
        )
        rows.extend(
            _with_memory_metadata(
                dict(row),
                source_table=f"project_context_entry:{row['kind']}",
                importance="global",
            )
            for row in cur.fetchall()
        )

    return _rank_context_rows(
        _sort_memory_rows(rows),
        query,
        closure_kind="agent_memory_event",
        limit=limit,
    )


def record_context_exchange(
    conn: psycopg.Connection,
    *,
    project_id: UUID,
    asking_agent_id: UUID,
    target_agent_id: UUID | None,
    query: str,
    tool_name: str,
    results: list[dict[str, Any]],
    metadata: dict[str, Any] | None = None,
) -> UUID:
    result_refs = [
        {
            "id": str(row["id"]),
            "source_table": (row.get("metadata") or {}).get("source_table", row.get("kind")),
        }
        for row in results
    ]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO context_exchange (
              project_id, asking_agent_id, target_agent_id, query, tool_name,
              result_refs, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                project_id,
                asking_agent_id,
                target_agent_id,
                query,
                tool_name,
                psycopg.types.json.Jsonb(result_refs),
                psycopg.types.json.Jsonb(metadata or {}),
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return row["id"]  # type: ignore[index]


def get_context_exchange(conn: psycopg.Connection, exchange_id: UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, project_id, asking_agent_id, target_agent_id, query, tool_name,
                   result_refs, metadata, created_at
            FROM context_exchange
            WHERE id = %s
            """,
            (exchange_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def commit_memory_update(
    conn: psycopg.Connection,
    *,
    project_id: UUID,
    operations: list[dict[str, Any]],
) -> dict[str, list[str]]:
    """Append memory events and upsert canonical memory documents atomically."""
    event_ids: list[str] = []
    document_ids: list[str] = []

    # Batch-validate authors and context exchanges in 2 queries instead of 2N
    author_ids = list({UUID(str(op["author_agent_id"])) for op in operations})
    exchange_ids = [
        UUID(str(op["context_exchange_id"]))
        for op in operations
        if op.get("context_exchange_id")
    ]
    with conn.cursor() as _vcur:
        _vcur.execute(
            "SELECT id, project_id FROM app_user WHERE id = ANY(%s)",
            (author_ids,),
        )
        authors_by_id: dict[UUID, dict[str, Any]] = {row["id"]: row for row in _vcur.fetchall()}

        exchanges_by_id: dict[UUID, dict[str, Any]] = {}
        if exchange_ids:
            _vcur.execute(
                "SELECT id, project_id, asking_agent_id, target_agent_id FROM context_exchange WHERE id = ANY(%s)",
                (exchange_ids,),
            )
            exchanges_by_id = {row["id"]: row for row in _vcur.fetchall()}

    with conn.cursor() as cur:
        for operation in operations:
            author_agent_id = UUID(str(operation["author_agent_id"]))
            importance = str(operation.get("importance") or "local")
            if importance not in {"local", "global"}:
                raise ValueError("importance must be local or global")

            author = authors_by_id.get(author_agent_id)
            if author is None or author["project_id"] != project_id:
                raise ValueError(f"author agent is not in project: {author_agent_id}")

            exchange_id: UUID | None = None
            if operation.get("context_exchange_id"):
                exchange_id = UUID(str(operation["context_exchange_id"]))
                exchange = exchanges_by_id.get(exchange_id)
                if exchange is None or exchange["project_id"] != project_id:
                    raise ValueError(f"context exchange not found in project: {exchange_id}")
                if author_agent_id not in {
                    exchange["asking_agent_id"],
                    exchange.get("target_agent_id"),
                }:
                    raise ValueError("context exchange does not involve author agent")

            metadata = dict(operation.get("metadata") or {})
            metadata.update(
                {
                    "chat_session_id": operation.get("chat_session_id"),
                    "checkpoint_index": operation.get("checkpoint_index"),
                }
            )
            event_content = str(operation.get("event_content") or "").strip()
            if event_content:
                cur.execute(
                    """
                    INSERT INTO agent_memory_event (
                      project_id, author_agent_id, importance, content, metadata,
                      source_context_exchange_id
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        project_id,
                        author_agent_id,
                        importance,
                        event_content,
                        psycopg.types.json.Jsonb(metadata),
                        exchange_id,
                    ),
                )
                event_ids.append(str(cur.fetchone()["id"]))

            canonical_content = str(operation.get("canonical_content") or "").strip()
            if canonical_content:
                document_key = str(operation.get("document_key") or "chat-summary")
                cur.execute(
                    """
                    INSERT INTO agent_memory_document (
                      project_id, author_agent_id, importance, document_key, content, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (project_id, author_agent_id, importance, document_key)
                    DO UPDATE SET
                      content = EXCLUDED.content,
                      metadata = agent_memory_document.metadata || EXCLUDED.metadata,
                      updated_at = NOW()
                    RETURNING id
                    """,
                    (
                        project_id,
                        author_agent_id,
                        importance,
                        document_key,
                        canonical_content,
                        psycopg.types.json.Jsonb(metadata),
                    ),
                )
                document_ids.append(str(cur.fetchone()["id"]))
        conn.commit()
    return {"event_ids": event_ids, "document_ids": document_ids}
