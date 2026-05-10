"""Project topology graph endpoint.

Projects an Obsidian-style knowledge graph from existing tables — no new
storage. Nodes come from app_user (agents), agent_memory_document (docs),
and agent_memory_event (events). Edges come from authorship and
context_exchange (asking_agent → target_agent), plus event-to-exchange
provenance.

Default scope is `importance='global'` so the view shows pooled/public
information only. Pass `include_local=true` to include private nodes.
"""
from __future__ import annotations

import logging
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from relevo.api.auth import require_auth, require_project_membership
from relevo.db import connect, get_user_directory

logger = logging.getLogger("relevo.api.graph")

router = APIRouter()


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class GraphNode(BaseModel):
    id: str
    kind: str  # 'agent' | 'doc' | 'event'
    label: str
    meta: dict[str, Any] = {}


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: str  # 'authored' | 'asked' | 'provenance'
    weight: int = 1
    meta: dict[str, Any] = {}


class ProjectGraphResponse(BaseModel):
    project_id: UUID
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _truncate(text: str, max_len: int = 80) -> str:
    text = " ".join((text or "").split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _doc_label(document_key: str, content: str) -> str:
    if document_key:
        return document_key
    return _truncate(content, 60)


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/graph",
    response_model=ProjectGraphResponse,
)
def get_project_graph(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    include_local: Annotated[bool, Query()] = False,
    max_docs: Annotated[int, Query(gt=0, le=2000)] = 400,
    max_events: Annotated[int, Query(gt=0, le=2000)] = 400,
    max_exchanges: Annotated[int, Query(gt=0, le=5000)] = 1000,
) -> ProjectGraphResponse:
    require_project_membership(conn, current_auth, project_id)

    importance_filter = ("local", "global") if include_local else ("global",)

    roster = get_user_directory(conn, project_id)
    agent_ids = {row["id"] for row in roster}

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # Agent nodes.
    for user in roster:
        nodes.append(
            GraphNode(
                id=f"agent:{user['id']}",
                kind="agent",
                label=user["display_name"] or "agent",
                meta={
                    "role": user.get("role"),
                    "domain_summary": user.get("domain_summary"),
                },
            )
        )

    # Document nodes + authorship edges.
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, author_agent_id, importance, document_key, content,
                   metadata, updated_at
              FROM agent_memory_document
             WHERE project_id = %s AND importance = ANY(%s)
             ORDER BY updated_at DESC
             LIMIT %s
            """,
            (project_id, list(importance_filter), max_docs),
        )
        for row in cur.fetchall():
            doc_id = f"doc:{row['id']}"
            nodes.append(
                GraphNode(
                    id=doc_id,
                    kind="doc",
                    label=_doc_label(row["document_key"], row["content"]),
                    meta={
                        "importance": row["importance"],
                        "document_key": row["document_key"],
                        "updated_at": row["updated_at"].isoformat()
                        if row["updated_at"] is not None
                        else None,
                        "preview": _truncate(row["content"], 240),
                        "metadata": row["metadata"] or {},
                    },
                )
            )
            if row["author_agent_id"] in agent_ids:
                edges.append(
                    GraphEdge(
                        source=f"agent:{row['author_agent_id']}",
                        target=doc_id,
                        kind="authored",
                    )
                )

    # Event nodes + authorship + provenance edges.
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, author_agent_id, importance, content, metadata,
                   source_context_exchange_id, created_at
              FROM agent_memory_event
             WHERE project_id = %s AND importance = ANY(%s)
             ORDER BY created_at DESC
             LIMIT %s
            """,
            (project_id, list(importance_filter), max_events),
        )
        event_rows = cur.fetchall()

    event_ids: set[UUID] = set()
    for row in event_rows:
        event_id = f"event:{row['id']}"
        event_ids.add(row["id"])
        nodes.append(
            GraphNode(
                id=event_id,
                kind="event",
                label=_truncate(row["content"], 60),
                meta={
                    "importance": row["importance"],
                    "created_at": row["created_at"].isoformat()
                    if row["created_at"] is not None
                    else None,
                    "preview": _truncate(row["content"], 240),
                    "metadata": row["metadata"] or {},
                },
            )
        )
        if row["author_agent_id"] in agent_ids:
            edges.append(
                GraphEdge(
                    source=f"agent:{row['author_agent_id']}",
                    target=event_id,
                    kind="authored",
                )
            )

    # Context-exchange edges between agents (asked).
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT asking_agent_id, target_agent_id, COUNT(*) AS n
              FROM context_exchange
             WHERE project_id = %s
               AND target_agent_id IS NOT NULL
               AND asking_agent_id <> target_agent_id
             GROUP BY asking_agent_id, target_agent_id
             ORDER BY n DESC
             LIMIT %s
            """,
            (project_id, max_exchanges),
        )
        for row in cur.fetchall():
            if row["asking_agent_id"] not in agent_ids:
                continue
            if row["target_agent_id"] not in agent_ids:
                continue
            edges.append(
                GraphEdge(
                    source=f"agent:{row['asking_agent_id']}",
                    target=f"agent:{row['target_agent_id']}",
                    kind="asked",
                    weight=int(row["n"]),
                )
            )

    return ProjectGraphResponse(project_id=project_id, nodes=nodes, edges=edges)
