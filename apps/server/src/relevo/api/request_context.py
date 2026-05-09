from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from relevo.db import connect, get_user, get_user_by_token, write_cross_user_qa_entry


class RequestContextBody(BaseModel):
    target_user_id: UUID
    question: str = Field(min_length=1)


class RequestContextResponse(BaseModel):
    answer: str
    source_user_ids: list[UUID]


router = APIRouter()


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="missing bearer token")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="malformed bearer token")
    return parts[1].strip()


@router.post("/request-context", response_model=RequestContextResponse)
def request_context(
    body: RequestContextBody,
    authorization: str | None = Header(default=None),
) -> RequestContextResponse:
    token = _extract_bearer(authorization)
    with connect() as conn:
        asker = get_user_by_token(conn, token)
        if asker is None:
            raise HTTPException(status_code=401, detail="unknown token")
        target = get_user(conn, body.target_user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="target user not found")
        if asker["id"] == body.target_user_id:
            raise HTTPException(status_code=400, detail="self-target rejected")
        answer = f"[stub answer] target={target['display_name']} was asked: {body.question}"
        write_cross_user_qa_entry(
            conn,
            target_user_id=body.target_user_id,
            asker_user_id=asker["id"],
            question=body.question,
            answer=answer,
        )
    return RequestContextResponse(answer=answer, source_user_ids=[body.target_user_id])
