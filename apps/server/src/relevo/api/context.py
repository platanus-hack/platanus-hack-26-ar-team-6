from __future__ import annotations

import logging
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from relevo.api.auth import require_auth, require_project_membership
from relevo.db import (
    commit_memory_update,
    connect,
    get_bootstrap,
    get_user,
    record_context_exchange,
    retrieve_agent_memory,
    retrieve_global_memory,
)

logger = logging.getLogger("relevo.api.context")


def _preview(text: str, max_length: int = 160) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 1]}..."


def _metadata_keys(metadata: dict[str, Any]) -> list[str]:
    return sorted(metadata.keys())


def _operation_summary(operation: "MemoryUpdateOperation") -> dict[str, Any]:
    return {
        "author_agent_id": str(operation.author_agent_id),
        "importance": operation.importance,
        "document_key": operation.document_key,
        "has_canonical_content": bool(operation.canonical_content),
        "context_exchange_id": str(operation.context_exchange_id)
        if operation.context_exchange_id
        else None,
        "metadata_keys": _metadata_keys(operation.metadata),
    }


class ContextEntryOut(BaseModel):
    id: UUID
    kind: str
    content: str
    metadata: dict[str, Any]
    created_at: Any


class UserOut(BaseModel):
    id: UUID
    display_name: str
    domain_summary: str
    profile: dict[str, Any]
    role: str | None = None
    account_id: UUID | None = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    description: str | None = None


class BootstrapResponse(BaseModel):
    user: UserOut
    project: ProjectOut
    roster: list[UserOut]
    recent_entries: list[ContextEntryOut]
    project_context: list[ContextEntryOut]


class MemoryResultOut(BaseModel):
    id: UUID
    kind: str
    content: str
    metadata: dict[str, Any]
    created_at: Any


class AgentContextRequest(BaseModel):
    agent_id: UUID
    query: str = Field(min_length=1)
    limit: int = Field(default=6, ge=1, le=20)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentContextResponse(BaseModel):
    results: list[MemoryResultOut]
    context_exchange_id: UUID
    insufficient_context: bool


class GlobalContextRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=6, ge=1, le=20)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GlobalContextResponse(BaseModel):
    results: list[MemoryResultOut]
    context_exchange_id: UUID
    insufficient_context: bool


class MemoryUpdateOperation(BaseModel):
    author_agent_id: UUID
    importance: str = Field(default="local", pattern="^(local|global)$")
    document_key: str = Field(default="chat-summary", min_length=1)
    event_content: str = Field(default="")
    canonical_content: str = Field(default="")
    context_exchange_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CommitMemoryUpdateRequest(BaseModel):
    chat_session_id: str = Field(min_length=1)
    checkpoint_index: int = Field(ge=1)
    operations: list[MemoryUpdateOperation] = Field(min_length=1)


class CommitMemoryUpdateResponse(BaseModel):
    event_ids: list[str]
    document_ids: list[str]


router = APIRouter()


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


def _ensure_user_matches_auth(
    requested_user_id: UUID | None, current_user: dict[str, Any]
) -> UUID:
    current_user_id = current_user["id"]
    if requested_user_id is not None and requested_user_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated user cannot read as another user",
        )
    return current_user_id


def _ensure_agent_in_project(
    conn: psycopg.Connection,
    agent_id: UUID,
    project_id: UUID,
) -> dict[str, Any]:
    agent = get_user(conn, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")
    if agent["project_id"] != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent is not in the authenticated user's project",
        )
    return agent


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    user_id: Annotated[UUID | None, Query()] = None,
    project_id: Annotated[UUID | None, Query()] = None,
) -> dict[str, Any]:
    logger.info(
        "bootstrap:start auth_kind=%s requested_user_id=%s requested_project_id=%s",
        current_auth.get("kind"),
        user_id,
        project_id,
    )
    current_user = require_project_membership(conn, current_auth, project_id)
    resolved_user_id = _ensure_user_matches_auth(user_id, current_user)
    try:
        response = get_bootstrap(conn, resolved_user_id)
    except ValueError as exc:
        logger.warning(
            "bootstrap:not_found auth_kind=%s resolved_user_id=%s project_id=%s error=%s",
            current_auth.get("kind"),
            resolved_user_id,
            current_user.get("project_id"),
            exc,
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logger.info(
        "bootstrap:success auth_kind=%s user_id=%s project_id=%s roster_count=%s recent_count=%s project_context_count=%s",
        current_auth.get("kind"),
        response["user"]["id"],
        response["project"]["id"],
        len(response["roster"]),
        len(response["recent_entries"]),
        len(response["project_context"]),
    )
    return response


@router.post("/agent-ctx", response_model=AgentContextResponse)
@router.post("/agent_ctx", response_model=AgentContextResponse)
def agent_ctx(
    body: AgentContextRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> AgentContextResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]
    logger.info(
        "agent_ctx:start auth_kind=%s asking_agent_id=%s project_id=%s target_agent_id=%s limit=%s query=%r metadata_keys=%s",
        current_auth.get("kind"),
        current_user["id"],
        project_id,
        body.agent_id,
        body.limit,
        _preview(body.query),
        _metadata_keys(body.metadata),
    )
    _ensure_agent_in_project(conn, body.agent_id, project_id)
    results = retrieve_agent_memory(
        conn,
        project_id,
        body.agent_id,
        body.query,
        limit=body.limit,
    )
    exchange_id = record_context_exchange(
        conn,
        project_id=project_id,
        asking_agent_id=current_user["id"],
        target_agent_id=body.agent_id,
        query=body.query,
        tool_name="agent_ctx",
        results=results,
        metadata=body.metadata,
    )
    response = AgentContextResponse(
        results=[MemoryResultOut(**row) for row in results],
        context_exchange_id=exchange_id,
        insufficient_context=len(results) == 0,
    )
    logger.info(
        "agent_ctx:success asking_agent_id=%s project_id=%s target_agent_id=%s exchange_id=%s result_count=%s insufficient_context=%s",
        current_user["id"],
        project_id,
        body.agent_id,
        exchange_id,
        len(results),
        response.insufficient_context,
    )
    return response


@router.post("/global-ctx", response_model=GlobalContextResponse)
@router.post("/global_ctx", response_model=GlobalContextResponse)
def global_ctx(
    body: GlobalContextRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> GlobalContextResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]
    logger.info(
        "global_ctx:start auth_kind=%s asking_agent_id=%s project_id=%s limit=%s query=%r metadata_keys=%s",
        current_auth.get("kind"),
        current_user["id"],
        project_id,
        body.limit,
        _preview(body.query),
        _metadata_keys(body.metadata),
    )
    results = retrieve_global_memory(
        conn,
        project_id,
        body.query,
        limit=body.limit,
    )
    exchange_id = record_context_exchange(
        conn,
        project_id=project_id,
        asking_agent_id=current_user["id"],
        target_agent_id=None,
        query=body.query,
        tool_name="global_ctx",
        results=results,
        metadata=body.metadata,
    )
    response = GlobalContextResponse(
        results=[MemoryResultOut(**row) for row in results],
        context_exchange_id=exchange_id,
        insufficient_context=len(results) == 0,
    )
    logger.info(
        "global_ctx:success asking_agent_id=%s project_id=%s exchange_id=%s result_count=%s insufficient_context=%s",
        current_user["id"],
        project_id,
        exchange_id,
        len(results),
        response.insufficient_context,
    )
    return response


@router.post("/memory-updates", response_model=CommitMemoryUpdateResponse)
@router.post("/memory_updates", response_model=CommitMemoryUpdateResponse)
def memory_updates(
    body: CommitMemoryUpdateRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> CommitMemoryUpdateResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]
    logger.info(
        "memory_updates:start auth_kind=%s asking_agent_id=%s project_id=%s chat_session_id=%s checkpoint_index=%s operation_count=%s operations=%s",
        current_auth.get("kind"),
        current_user["id"],
        project_id,
        body.chat_session_id,
        body.checkpoint_index,
        len(body.operations),
        [_operation_summary(operation) for operation in body.operations],
    )
    operations = [
        {
            **operation.model_dump(),
            "chat_session_id": body.chat_session_id,
            "checkpoint_index": body.checkpoint_index,
        }
        for operation in body.operations
    ]
    try:
        result = commit_memory_update(
            conn,
            project_id=project_id,
            operations=operations,
        )
    except ValueError as exc:
        logger.warning(
            "memory_updates:invalid asking_agent_id=%s project_id=%s chat_session_id=%s checkpoint_index=%s error=%s",
            current_user["id"],
            project_id,
            body.chat_session_id,
            body.checkpoint_index,
            exc,
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    response = CommitMemoryUpdateResponse(**result)
    logger.info(
        "memory_updates:success asking_agent_id=%s project_id=%s chat_session_id=%s checkpoint_index=%s event_count=%s document_count=%s event_ids=%s document_ids=%s",
        current_user["id"],
        project_id,
        body.chat_session_id,
        body.checkpoint_index,
        len(response.event_ids),
        len(response.document_ids),
        response.event_ids,
        response.document_ids,
    )
    return response
