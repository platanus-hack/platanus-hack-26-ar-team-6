from __future__ import annotations

import logging
import time
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
    retrieve_context,
    retrieve_global_memory,
)

logger = logging.getLogger("relevo.api.context")


MAX_ACTIVITY_TEXT_CHARS = 120_000


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


def _truncate_text(text: str, max_length: int = MAX_ACTIVITY_TEXT_CHARS) -> str:
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 34].rstrip()}\n...[truncated by Relevo ingest]"


def _format_changed_files(changed_files: list[str]) -> str:
    if not changed_files:
        return "No changed files reported."
    return "\n".join(f"- {file_path}" for file_path in changed_files)


def _activity_event_content(body: "ClaudeCodeActivityRequest") -> str:
    sections = [
        "Claude Code activity",
        f"Session: {body.session_id}",
    ]
    if body.cwd:
        sections.append(f"Working directory: {body.cwd}")

    sections.extend(
        [
            f"Prompt:\n{body.prompt.strip() or 'No prompt captured.'}",
            f"Final answer:\n{body.final_answer.strip() or 'No final answer captured.'}",
            f"Changed files:\n{_format_changed_files(body.changed_files)}",
        ]
    )
    if body.diff.strip():
        sections.append(f"Diff:\n```diff\n{body.diff.strip()}\n```")

    return _truncate_text("\n\n".join(sections))


def _activity_canonical_content(body: "ClaudeCodeActivityRequest") -> str:
    sections = [
        "Latest Claude Code activity summary",
        f"Prompt: {_preview(body.prompt, 600) or 'No prompt captured.'}",
        f"Final answer: {_preview(body.final_answer, 900) or 'No final answer captured.'}",
        f"Changed files:\n{_format_changed_files(body.changed_files)}",
    ]
    return _truncate_text("\n\n".join(sections), max_length=8_000)


def _activity_metadata(body: "ClaudeCodeActivityRequest") -> dict[str, Any]:
    metadata = dict(body.metadata)
    metadata.update(
        {
            "source": "claude_code_hook",
            "session_id": body.session_id,
            "cwd": body.cwd,
            "transcript_path": body.transcript_path,
            "hook_event_name": body.hook_event_name,
            "changed_files": body.changed_files,
            "prompt_chars": len(body.prompt),
            "final_answer_chars": len(body.final_answer),
            "diff_chars": len(body.diff),
        }
    )
    return metadata


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


class RetrieveContextRequest(BaseModel):
    query: str = Field(min_length=1)
    target_agent_ids: list[UUID] = Field(default_factory=list)
    target_agent_id: UUID | None = None
    mentioned_agent_ids: list[UUID] = Field(default_factory=list)
    limit: int = Field(default=6, ge=1, le=20)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrieveContextResponse(BaseModel):
    query: str
    route: str
    selected_agent_ids: list[UUID]
    results: list[MemoryResultOut]
    context_exchange_id: UUID
    insufficient_context: bool
    diagnostics: dict[str, Any]


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


class ClaudeCodeActivityRequest(BaseModel):
    session_id: str = Field(min_length=1)
    checkpoint_index: int = Field(default=1, ge=1)
    cwd: str = Field(default="")
    prompt: str = Field(default="")
    final_answer: str = Field(default="")
    diff: str = Field(default="")
    changed_files: list[str] = Field(default_factory=list)
    transcript_path: str | None = None
    hook_event_name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


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


def _target_agent_ids(body: RetrieveContextRequest) -> list[UUID]:
    ids: list[UUID] = []
    for agent_id in [*body.target_agent_ids, *body.mentioned_agent_ids]:
        if agent_id not in ids:
            ids.append(agent_id)
    if body.target_agent_id is not None and body.target_agent_id not in ids:
        ids.append(body.target_agent_id)
    return ids


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
    handler_started = time.perf_counter()
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
    ensure_agent_started = time.perf_counter()
    _ensure_agent_in_project(conn, body.agent_id, project_id)
    ensure_agent_ms = round((time.perf_counter() - ensure_agent_started) * 1000)
    retrieve_started = time.perf_counter()
    results = retrieve_agent_memory(
        conn,
        project_id,
        body.agent_id,
        body.query,
        limit=body.limit,
    )
    retrieve_ms = round((time.perf_counter() - retrieve_started) * 1000)
    record_started = time.perf_counter()
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
    record_ms = round((time.perf_counter() - record_started) * 1000)
    response = AgentContextResponse(
        results=[MemoryResultOut(**row) for row in results],
        context_exchange_id=exchange_id,
        insufficient_context=len(results) == 0,
    )
    total_ms = round((time.perf_counter() - handler_started) * 1000)
    logger.info(
        "agent_ctx:success asking_agent_id=%s project_id=%s target_agent_id=%s exchange_id=%s result_count=%s insufficient_context=%s total_ms=%s ensure_agent_ms=%s retrieve_ms=%s record_ms=%s",
        current_user["id"],
        project_id,
        body.agent_id,
        exchange_id,
        len(results),
        response.insufficient_context,
        total_ms,
        ensure_agent_ms,
        retrieve_ms,
        record_ms,
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
    handler_started = time.perf_counter()
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
    retrieve_started = time.perf_counter()
    results = retrieve_global_memory(
        conn,
        project_id,
        body.query,
        limit=body.limit,
    )
    retrieve_ms = round((time.perf_counter() - retrieve_started) * 1000)
    record_started = time.perf_counter()
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
    record_ms = round((time.perf_counter() - record_started) * 1000)
    response = GlobalContextResponse(
        results=[MemoryResultOut(**row) for row in results],
        context_exchange_id=exchange_id,
        insufficient_context=len(results) == 0,
    )
    total_ms = round((time.perf_counter() - handler_started) * 1000)
    logger.info(
        "global_ctx:success asking_agent_id=%s project_id=%s exchange_id=%s result_count=%s insufficient_context=%s total_ms=%s retrieve_ms=%s record_ms=%s",
        current_user["id"],
        project_id,
        exchange_id,
        len(results),
        response.insufficient_context,
        total_ms,
        retrieve_ms,
        record_ms,
    )
    return response


@router.post("/retrieve-context", response_model=RetrieveContextResponse)
@router.post("/retrieve_context", response_model=RetrieveContextResponse)
def retrieve_context_route(
    body: RetrieveContextRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> RetrieveContextResponse:
    handler_started = time.perf_counter()
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]
    target_agent_ids = _target_agent_ids(body)
    for agent_id in target_agent_ids:
        _ensure_agent_in_project(conn, agent_id, project_id)
    logger.info(
        "retrieve_context:start auth_kind=%s asking_agent_id=%s project_id=%s target_agent_ids=%s limit=%s query=%r metadata_keys=%s",
        current_auth.get("kind"),
        current_user["id"],
        project_id,
        [str(agent_id) for agent_id in target_agent_ids],
        body.limit,
        _preview(body.query),
        _metadata_keys(body.metadata),
    )
    retrieve_started = time.perf_counter()
    retrieved = retrieve_context(
        conn,
        project_id,
        body.query,
        target_agent_ids=target_agent_ids,
        limit=body.limit,
    )
    retrieve_ms = round((time.perf_counter() - retrieve_started) * 1000)
    results = retrieved["results"]
    selected_agent_ids = retrieved["selected_agent_ids"]
    target_for_audit = selected_agent_ids[0] if len(selected_agent_ids) == 1 else None
    exchange_id = record_context_exchange(
        conn,
        project_id=project_id,
        asking_agent_id=current_user["id"],
        target_agent_id=target_for_audit,
        query=body.query,
        tool_name="retrieve_context",
        results=results,
        metadata={
            **body.metadata,
            "route": retrieved["route"],
            "selected_agent_ids": [str(agent_id) for agent_id in selected_agent_ids],
            "diagnostics": retrieved["diagnostics"],
        },
    )
    response = RetrieveContextResponse(
        query=body.query,
        route=retrieved["route"],
        selected_agent_ids=selected_agent_ids,
        results=[MemoryResultOut(**row) for row in results],
        context_exchange_id=exchange_id,
        insufficient_context=len(results) == 0,
        diagnostics=retrieved["diagnostics"],
    )
    logger.info(
        "retrieve_context:success asking_agent_id=%s project_id=%s route=%s exchange_id=%s result_count=%s selected_agent_ids=%s insufficient_context=%s total_ms=%s retrieve_ms=%s",
        current_user["id"],
        project_id,
        response.route,
        exchange_id,
        len(results),
        [str(agent_id) for agent_id in selected_agent_ids],
        response.insufficient_context,
        round((time.perf_counter() - handler_started) * 1000),
        retrieve_ms,
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
    handler_started = time.perf_counter()
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
    commit_started = time.perf_counter()
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
    commit_ms = round((time.perf_counter() - commit_started) * 1000)
    response = CommitMemoryUpdateResponse(**result)
    total_ms = round((time.perf_counter() - handler_started) * 1000)
    logger.info(
        "memory_updates:success asking_agent_id=%s project_id=%s chat_session_id=%s checkpoint_index=%s event_count=%s document_count=%s event_ids=%s document_ids=%s total_ms=%s commit_ms=%s",
        current_user["id"],
        project_id,
        body.chat_session_id,
        body.checkpoint_index,
        len(response.event_ids),
        len(response.document_ids),
        response.event_ids,
        response.document_ids,
        total_ms,
        commit_ms,
    )
    return response


@router.post("/claude-code/activity", response_model=CommitMemoryUpdateResponse)
@router.post("/claude_code/activity", response_model=CommitMemoryUpdateResponse)
def claude_code_activity(
    body: ClaudeCodeActivityRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> CommitMemoryUpdateResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]
    logger.info(
        "claude_code_activity:start auth_kind=%s author_agent_id=%s project_id=%s session_id=%s checkpoint_index=%s changed_file_count=%s prompt_chars=%s answer_chars=%s diff_chars=%s metadata_keys=%s",
        current_auth.get("kind"),
        current_user["id"],
        project_id,
        body.session_id,
        body.checkpoint_index,
        len(body.changed_files),
        len(body.prompt),
        len(body.final_answer),
        len(body.diff),
        _metadata_keys(body.metadata),
    )
    operations = [
        {
            "author_agent_id": current_user["id"],
            "importance": "local",
            "document_key": f"claude-code:{body.session_id}",
            "event_content": _activity_event_content(body),
            "canonical_content": _activity_canonical_content(body),
            "metadata": _activity_metadata(body),
            "chat_session_id": f"claude-code:{body.session_id}",
            "checkpoint_index": body.checkpoint_index,
        }
    ]
    try:
        result = commit_memory_update(
            conn,
            project_id=project_id,
            operations=operations,
        )
    except ValueError as exc:
        logger.warning(
            "claude_code_activity:invalid author_agent_id=%s project_id=%s session_id=%s error=%s",
            current_user["id"],
            project_id,
            body.session_id,
            exc,
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    response = CommitMemoryUpdateResponse(**result)
    logger.info(
        "claude_code_activity:success author_agent_id=%s project_id=%s session_id=%s event_count=%s document_count=%s",
        current_user["id"],
        project_id,
        body.session_id,
        len(response.event_ids),
        len(response.document_ids),
    )
    return response
