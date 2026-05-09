from __future__ import annotations

from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from relevo.agent import answer_from_context
from relevo.db import (
    connect,
    get_bootstrap,
    get_user,
    get_user_by_token,
    retrieve_user_context,
    write_cross_user_qa_entry,
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

    target: str | None = Field(default=None, description="Target user id. P0 only.")
    target_user_id: UUID | None = None
    question: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrievedContextEntry(BaseModel):
    id: UUID
    kind: str
    content: str
    metadata: dict[str, Any]
    created_at: Any


class RequestContextResponse(BaseModel):
    answer: str
    source_user_ids: list[UUID]
    target_user_id: UUID
    context_entry_id: UUID
    retrieved_context_entries: list[RetrievedContextEntry]


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
    current_user: Annotated[dict[str, Any], Depends(require_user)],
    user_id: Annotated[UUID | None, Query()] = None,
) -> dict[str, Any]:
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
    current_user: Annotated[dict[str, Any], Depends(require_user)],
) -> WriteContextEntryResponse:
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
    current_user: Annotated[dict[str, Any], Depends(require_user)],
) -> RequestContextResponse:
    target_user_id = _resolve_target_user_id(body)
    target_user = get_user(conn, target_user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail=f"Target user not found: {target_user_id}")
    if target_user["project_id"] != current_user["project_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Target user is not in the authenticated user's project",
        )

    retrieved = retrieve_user_context(conn, target_user_id, body.question, limit=6)
    answer = answer_from_context(
        question=body.question,
        target_user=target_user,
        context_entries=retrieved,
        config=request.app.state.config,
    )
    context_entry_id = write_cross_user_qa_entry(
        conn,
        target_user_id=target_user_id,
        asker_user_id=current_user["id"],
        question=body.question,
        answer=answer,
        extra_metadata={
            **body.metadata,
            "retrieved_context_entry_ids": [str(row["id"]) for row in retrieved],
        },
    )
    return RequestContextResponse(
        answer=answer,
        source_user_ids=[target_user_id],
        target_user_id=target_user_id,
        context_entry_id=context_entry_id,
        retrieved_context_entries=[RetrievedContextEntry(**row) for row in retrieved],
    )


def _resolve_target_user_id(body: RequestContextRequest) -> UUID:
    if body.target_user_id is not None:
        return body.target_user_id
    if body.target is None:
        raise HTTPException(status_code=422, detail="target or target_user_id is required")
    if body.target == "project":
        raise HTTPException(status_code=400, detail='target="project" is V3/stretch')
    try:
        return UUID(body.target)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="target must be a user UUID") from exc
