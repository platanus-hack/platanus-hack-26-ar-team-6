from __future__ import annotations

from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from relevo.api.auth import require_auth, require_project_membership
from relevo.agent import answer_from_context
from relevo.agents import (
    ContextSliceEntry,
    ContextSliceTarget,
    OnDemandAgentAnswer,
    OnDemandAgentError,
    OnDemandContextSlice,
    answer_on_demand,
)
from relevo.db import (
    connect,
    get_bootstrap,
    get_project,
    get_user,
    get_user_by_token,
    retrieve_project_context,
    retrieve_user_context,
    write_cross_user_qa_entry,
    write_project_qa_entry,
    write_prompt_answer_entry,
)


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


class WriteContextEntryRequest(BaseModel):
    user_id: UUID | None = None
    prompt: str = Field(min_length=1)
    final_answer: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WriteContextEntryResponse(BaseModel):
    id: UUID
    kind: str = "prompt_answer"


class RequestContextRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target: str | None = Field(default=None, description='Target user id or "project".')
    target_user_id: UUID | None = None
    question: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrievedContextEntry(BaseModel):
    id: UUID
    kind: str
    content: str
    metadata: dict[str, Any]
    created_at: Any


class ContextEntryCitationOut(BaseModel):
    claim: str
    context_entry_id: str


class RequestContextResponse(BaseModel):
    answer: str
    source_user_ids: list[str]
    source_context_entry_ids: list[str] = Field(default_factory=list)
    target: str
    target_user_id: UUID | None = None
    target_project_id: UUID | None = None
    context_entry_id: UUID | None = None
    project_context_entry_id: UUID | None = None
    retrieved_context_entries: list[RetrievedContextEntry]
    citations: list[ContextEntryCitationOut] = Field(default_factory=list)
    confidence: float = 0.0
    insufficient_context: bool = False


router = APIRouter()


def _extract_token(
    authorization: str | None,
    x_user_token: str | None,
    x_auth_token: str | None,
) -> str | None:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
        if authorization.strip():
            return authorization.strip()
    return x_user_token or x_auth_token


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


def require_user(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
    x_user_token: Annotated[str | None, Header(alias="X-User-Token")] = None,
    x_auth_token: Annotated[str | None, Header(alias="X-Auth-Token")] = None,
) -> dict[str, Any]:
    token = _extract_token(authorization, x_user_token, x_auth_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    user = get_user_by_token(conn, token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token",
        )
    return user


def _ensure_user_matches_auth(
    requested_user_id: UUID | None, current_user: dict[str, Any]
) -> UUID:
    current_user_id = current_user["id"]
    if requested_user_id is not None and requested_user_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated user cannot write/read as another user",
        )
    return current_user_id


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    user_id: Annotated[UUID | None, Query()] = None,
    project_id: Annotated[UUID | None, Query()] = None,
) -> dict[str, Any]:
    current_user = require_project_membership(conn, current_auth, project_id)
    resolved_user_id = _ensure_user_matches_auth(user_id, current_user)
    try:
        return get_bootstrap(conn, resolved_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/context-entries", response_model=WriteContextEntryResponse)
@router.post("/context_entries", response_model=WriteContextEntryResponse)
def write_context_entry(
    body: WriteContextEntryRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> WriteContextEntryResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    user_id = _ensure_user_matches_auth(body.user_id, current_user)
    entry_id = write_prompt_answer_entry(
        conn,
        user_id,
        body.prompt,
        body.final_answer,
        extra_metadata=body.metadata,
    )
    return WriteContextEntryResponse(id=entry_id)


@router.post("/request-context", response_model=RequestContextResponse)
@router.post("/request_context", response_model=RequestContextResponse)
def request_context(
    body: RequestContextRequest,
    request: Request,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
) -> RequestContextResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    target_kind, target_user_id = _resolve_target(body)
    if target_kind == "project":
        return _request_project_context(body, request, conn, current_user)
    if target_user_id is None:
        raise HTTPException(status_code=422, detail="target user id is required")
    if target_user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="self-target rejected")

    target_user = get_user(conn, target_user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail=f"Target user not found: {target_user_id}")
    if target_user["project_id"] != current_user["project_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Target user is not in the authenticated user's project",
        )

    on_demand_config = request.app.state.config.on_demand_agent
    retrieved = retrieve_user_context(
        conn,
        target_user_id,
        body.question,
        limit=on_demand_config.retrieval_top_k,
    )
    context_slice = _build_on_demand_context_slice(target_user, retrieved)
    try:
        answer = answer_on_demand(
            context_slice,
            body.question,
            config=on_demand_config,
        )
    except OnDemandAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"on-demand agent failed: {exc}",
        ) from exc

    answer_metadata = _answer_metadata(body.metadata, retrieved, answer)
    context_entry_id = write_cross_user_qa_entry(
        conn,
        target_user_id=target_user_id,
        asker_user_id=current_user["id"],
        question=body.question,
        answer=answer.answer,
        extra_metadata=answer_metadata,
    )
    return RequestContextResponse(
        answer=answer.answer,
        source_user_ids=answer.source_user_ids,
        target="user",
        target_user_id=target_user_id,
        context_entry_id=context_entry_id,
        retrieved_context_entries=[RetrievedContextEntry(**row) for row in retrieved],
        source_context_entry_ids=answer_metadata["source_context_entry_ids"],
        citations=[
            ContextEntryCitationOut(**citation.model_dump()) for citation in answer.citations
        ],
        confidence=answer.confidence,
        insufficient_context=answer.insufficient_context,
    )


def _request_project_context(
    body: RequestContextRequest,
    request: Request,
    conn: psycopg.Connection,
    current_user: dict[str, Any],
) -> RequestContextResponse:
    project_id = current_user["project_id"]
    project = get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    on_demand_config = request.app.state.config.on_demand_agent
    retrieved = retrieve_project_context(
        conn,
        project_id,
        body.question,
        limit=on_demand_config.retrieval_top_k,
    )
    answer = answer_from_context(
        question=body.question,
        target_user={
            "id": project["id"],
            "display_name": f"{project['name']} project",
        },
        context_entries=retrieved,
        config=request.app.state.config,
    )
    project_context_entry_id = write_project_qa_entry(
        conn,
        project_id=project_id,
        asker_user_id=current_user["id"],
        question=body.question,
        answer=answer,
        extra_metadata={
            **body.metadata,
            "retrieved_project_context_entry_ids": [str(row["id"]) for row in retrieved],
        },
    )
    return RequestContextResponse(
        answer=answer,
        source_user_ids=[],
        source_context_entry_ids=[str(row["id"]) for row in retrieved],
        target="project",
        target_project_id=project_id,
        project_context_entry_id=project_context_entry_id,
        retrieved_context_entries=[RetrievedContextEntry(**row) for row in retrieved],
    )


def _resolve_target(body: RequestContextRequest) -> tuple[str, UUID | None]:
    if body.target_user_id is not None:
        return "user", body.target_user_id
    if body.target is None:
        raise HTTPException(status_code=422, detail="target or target_user_id is required")
    target = body.target.strip()
    if target.lower() == "project":
        return "project", None
    try:
        return "user", UUID(target)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='target must be a user UUID or "project"') from exc


def _build_on_demand_context_slice(
    target_user: dict[str, Any],
    retrieved: list[dict[str, Any]],
) -> OnDemandContextSlice:
    target_user_id = target_user["id"]
    return OnDemandContextSlice(
        target=ContextSliceTarget(
            id=target_user_id,
            display_name=target_user["display_name"],
            domain_summary=target_user.get("domain_summary"),
            profile=target_user.get("profile") or {},
        ),
        entries=[
            ContextSliceEntry(
                id=row["id"],
                user_id=target_user_id,
                kind=row["kind"],
                content=row["content"],
                metadata=row.get("metadata") or {},
                created_at=row.get("created_at"),
            )
            for row in retrieved
        ],
    )


def _answer_metadata(
    request_metadata: dict[str, Any],
    retrieved: list[dict[str, Any]],
    answer: OnDemandAgentAnswer,
) -> dict[str, Any]:
    source_context_entry_ids = _source_context_entry_ids(answer)
    return {
        **request_metadata,
        "retrieved_context_entry_ids": [str(row["id"]) for row in retrieved],
        "source_context_entry_ids": source_context_entry_ids,
        "citations": [citation.model_dump() for citation in answer.citations],
        "confidence": answer.confidence,
        "insufficient_context": answer.insufficient_context,
    }


def _source_context_entry_ids(answer: OnDemandAgentAnswer) -> list[str]:
    ids: list[str] = []
    for citation in answer.citations:
        context_entry_id = citation.context_entry_id
        if context_entry_id not in ids:
            ids.append(context_entry_id)
    return ids
