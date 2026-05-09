from __future__ import annotations

import os
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from relevo.agent import answer_from_context
from relevo.agents import (
    ContextSliceEntry,
    ContextSliceTarget,
    OnDemandContextSlice,
    answer_on_demand,
)
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
    source_context_entry_ids: list[UUID]
    target_user_id: UUID
    context_entry_id: UUID
    retrieved_context_entries: list[RetrievedContextEntry]


router = APIRouter()


def _extract_token(authorization: str | None) -> str | None:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed bearer token",
        )
    return None


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


def require_user(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    token = _extract_token(authorization)
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
    if target_user_id == current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="self-target rejected",
        )

    target_user = get_user(conn, target_user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail=f"Target user not found: {target_user_id}")
    if target_user["project_id"] != current_user["project_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Target user is not in the authenticated user's project",
        )

    retrieval_limit = request.app.state.config.on_demand_agent.retrieval_top_k
    retrieved = retrieve_user_context(
        conn,
        target_user_id,
        body.question,
        limit=retrieval_limit,
    )
    answer, source_user_ids = _answer_request_context(
        question=body.question,
        target_user=target_user,
        context_entries=retrieved,
        request=request,
    )
    source_context_entry_ids = [row["id"] for row in retrieved]
    context_entry_id = write_cross_user_qa_entry(
        conn,
        target_user_id=target_user_id,
        asker_user_id=current_user["id"],
        question=body.question,
        answer=answer,
        extra_metadata={
            **body.metadata,
            "source_context_entry_ids": [
                str(entry_id) for entry_id in source_context_entry_ids
            ],
            "retrieved_context_entry_ids": [
                str(entry_id) for entry_id in source_context_entry_ids
            ],
        },
    )
    return RequestContextResponse(
        answer=answer,
        source_user_ids=source_user_ids,
        source_context_entry_ids=source_context_entry_ids,
        target_user_id=target_user_id,
        context_entry_id=context_entry_id,
        retrieved_context_entries=[RetrievedContextEntry(**row) for row in retrieved],
    )


def _resolve_target_user_id(body: RequestContextRequest) -> UUID:
    target_user_id = body.target_user_id
    target_alias_id: UUID | None = None
    if body.target is not None:
        target = body.target.strip()
        if target.lower() == "project":
            raise HTTPException(status_code=400, detail='target="project" is V3/stretch')
        try:
            target_alias_id = UUID(target)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="target must be a user UUID") from exc

    if target_user_id is not None and target_alias_id is not None:
        if target_user_id != target_alias_id:
            raise HTTPException(
                status_code=422,
                detail="target and target_user_id must refer to the same user",
            )
        return target_user_id
    if body.target_user_id is not None:
        return target_user_id
    if target_alias_id is not None:
        return target_alias_id
    raise HTTPException(status_code=422, detail="target or target_user_id is required")


def _answer_request_context(
    *,
    question: str,
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
    request: Request,
) -> tuple[str, list[UUID]]:
    has_live_model_credentials = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if has_live_model_credentials:
        try:
            answer = answer_on_demand(
                _build_context_slice(target_user, context_entries),
                question,
                config=request.app.state.config.on_demand_agent,
            )
            source_user_ids = [UUID(source_id) for source_id in answer.source_user_ids]
            return answer.answer, source_user_ids
        except Exception:  # pragma: no cover - live model fallback
            pass

        answer = _fallback_answer_from_context(question, target_user, context_entries)
    else:
        answer = answer_from_context(
            question=question,
            target_user=target_user,
            context_entries=context_entries,
            config=request.app.state.config,
        )

    return answer, [target_user["id"]]


def _build_context_slice(
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
) -> OnDemandContextSlice:
    return OnDemandContextSlice(
        target=ContextSliceTarget(
            id=target_user["id"],
            display_name=target_user["display_name"],
            domain_summary=target_user.get("domain_summary"),
            profile=target_user.get("profile") or {},
        ),
        entries=[
            ContextSliceEntry(
                id=row["id"],
                user_id=target_user["id"],
                kind=row["kind"],
                content=row["content"],
                metadata=row.get("metadata") or {},
                created_at=row.get("created_at"),
            )
            for row in context_entries
        ],
    )


def _fallback_answer_from_context(
    question: str,
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
) -> str:
    if not context_entries:
        return (
            f"I do not have stored context for {target_user['display_name']} "
            f"that answers: {question}"
        )

    lines = [
        f"{target_user['display_name']}'s stored context has these relevant facts:",
    ]
    for row in context_entries[:4]:
        content = " ".join(str(row["content"]).split())
        lines.append(f"- {content}")
    return "\n".join(lines)
