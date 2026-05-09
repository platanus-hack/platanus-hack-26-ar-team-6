"""Team pulse and responsibility document API routes.

The desktop client owns the LLM call. The server owns storage and projection
into the existing `agent_memory_document` table:

- one row per (project, agent, hour-bucket) with `importance='local'` and
  `document_key='pulse:<iso>'` for cell summaries;
- one row per (project, agent) with `importance='global'` and
  `document_key='responsibility'` for the long-form responsibility doc.

This means the responsibility doc surfaces through `global_ctx` automatically
and the retriever can use it as a routing index.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from relevo.api.auth import require_auth, require_project_membership
from relevo.db import (
    PULSE_DOCUMENT_KEY_PREFIX,
    RESPONSIBILITY_DOCUMENT_KEY,
    connect,
    get_responsibility_refresh_state,
    get_user_directory,
    list_pulse_documents,
    list_pulse_raw_events,
    list_responsibility_documents,
    upsert_pulse_document,
    upsert_responsibility_document,
)

logger = logging.getLogger("relevo.api.team_pulse")

router = APIRouter()


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DEFAULT_BUCKET_SIZE_SECONDS = int(os.environ.get("PULSE_BUCKET_SECONDS", "3600"))
DEFAULT_BUCKET_COUNT = int(os.environ.get("PULSE_BUCKET_COUNT", "24"))
MAX_BUCKET_COUNT = 168  # 1 week of hourly buckets
RESPONSIBILITY_DEBOUNCE_SECONDS = int(
    os.environ.get("PULSE_RESPONSIBILITY_DEBOUNCE_SECONDS", "600")
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _align_bucket_start(ts: datetime, size: int) -> datetime:
    """Align `ts` down to the start of its UTC bucket."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    epoch = int(ts.timestamp())
    aligned = (epoch // size) * size
    return datetime.fromtimestamp(aligned, tz=timezone.utc)


def _bucket_window(
    *, size: int, buckets: int, now: datetime | None = None
) -> tuple[datetime, list[datetime]]:
    """Return (window_start, bucket_starts ascending oldest first)."""
    now = now or _now_utc()
    current_start = _align_bucket_start(now, size)
    starts = [current_start - timedelta(seconds=size * (buckets - 1 - i)) for i in range(buckets)]
    return starts[0], starts


def _ensure_bucket_size(size: int) -> int:
    if size <= 0 or size > 24 * 3600:
        raise HTTPException(status_code=422, detail="size must be in (0, 86400] seconds")
    return size


def _ensure_bucket_count(buckets: int) -> int:
    if buckets <= 0 or buckets > MAX_BUCKET_COUNT:
        raise HTTPException(
            status_code=422, detail=f"buckets must be in (0, {MAX_BUCKET_COUNT}]"
        )
    return buckets


def _parse_iso_utc(value: str) -> datetime:
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid timestamp: {value}") from exc
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _bucket_iso(ts: datetime) -> str:
    return ts.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _truncate_summary(content: str, max_length: int = 80) -> str:
    text = " ".join(content.split())
    if len(text) <= max_length:
        return text
    cut = text[: max_length - 1]
    last_space = cut.rfind(" ")
    if last_space >= max_length * 0.55:
        cut = cut[:last_space]
    return f"{cut.rstrip()}..."


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PulseCell(BaseModel):
    summary: str | None = None
    event_count: int = 0
    updated_at: datetime | None = None


class PulseMember(BaseModel):
    agent_id: UUID
    display_name: str
    cells: list[PulseCell]


class TeamPulseResponse(BaseModel):
    bucket_size_seconds: int
    bucket_starts: list[datetime]
    members: list[PulseMember]


class TeamPulseRawEvent(BaseModel):
    id: UUID
    agent_id: UUID
    bucket_start: datetime
    content: str
    metadata: dict[str, Any]
    created_at: datetime


class TeamPulseRawEventsResponse(BaseModel):
    events: list[TeamPulseRawEvent]


class PulseSummaryInput(BaseModel):
    agent_id: UUID
    bucket_start: datetime
    summary: str = Field(min_length=1)
    event_count: int = Field(ge=1)
    event_ids: list[UUID] = Field(default_factory=list)


class ResponsibilityInput(BaseModel):
    agent_id: UUID
    content: str = Field(min_length=1)
    word_count: int = Field(ge=1)


class TeamPulseRefreshRequest(BaseModel):
    size: int = Field(default=DEFAULT_BUCKET_SIZE_SECONDS, gt=0, le=24 * 3600)
    buckets: int = Field(default=DEFAULT_BUCKET_COUNT, gt=0, le=MAX_BUCKET_COUNT)
    summaries: list[PulseSummaryInput] = Field(default_factory=list)
    responsibilities: list[ResponsibilityInput] = Field(default_factory=list)


class TeamPulseRefreshResponse(BaseModel):
    pulse_doc_ids: list[str]
    responsibility_doc_ids: list[str]
    skipped_responsibility_agent_ids: list[UUID]


class ResponsibilityMember(BaseModel):
    agent_id: UUID
    display_name: str
    content: str | None = None
    updated_at: datetime | None = None
    word_count: int | None = None


class ResponsibilitiesResponse(BaseModel):
    members: list[ResponsibilityMember]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/team-pulse", response_model=TeamPulseResponse)
def get_team_pulse(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    size: Annotated[int, Query(gt=0, le=24 * 3600)] = DEFAULT_BUCKET_SIZE_SECONDS,
    buckets: Annotated[int, Query(gt=0, le=MAX_BUCKET_COUNT)] = DEFAULT_BUCKET_COUNT,
) -> TeamPulseResponse:
    require_project_membership(conn, current_auth, project_id)
    size = _ensure_bucket_size(size)
    buckets = _ensure_bucket_count(buckets)

    _, bucket_starts = _bucket_window(size=size, buckets=buckets)
    roster = get_user_directory(conn, project_id)
    docs = list_pulse_documents(
        conn,
        project_id,
        bucket_starts=bucket_starts,
        agent_ids=[user["id"] for user in roster] or None,
    )
    bucket_iso_to_index = {_bucket_iso(start): index for index, start in enumerate(bucket_starts)}
    docs_by_member: dict[UUID, dict[int, dict[str, Any]]] = {}
    for doc in docs:
        meta = doc.get("metadata") or {}
        bucket_iso = meta.get("bucket_start")
        if not bucket_iso:
            continue
        index = bucket_iso_to_index.get(bucket_iso)
        if index is None:
            continue
        docs_by_member.setdefault(doc["author_agent_id"], {})[index] = doc

    members: list[PulseMember] = []
    for user in roster:
        cells: list[PulseCell] = []
        member_docs = docs_by_member.get(user["id"], {})
        for index, _start in enumerate(bucket_starts):
            doc = member_docs.get(index)
            if doc is None:
                cells.append(PulseCell())
                continue
            meta = doc.get("metadata") or {}
            cells.append(
                PulseCell(
                    summary=doc["content"],
                    event_count=int(meta.get("event_count", 0) or 0),
                    updated_at=doc.get("updated_at"),
                )
            )
        members.append(
            PulseMember(
                agent_id=user["id"],
                display_name=user["display_name"],
                cells=cells,
            )
        )

    return TeamPulseResponse(
        bucket_size_seconds=size,
        bucket_starts=bucket_starts,
        members=members,
    )


@router.get(
    "/projects/{project_id}/team-pulse/raw-events",
    response_model=TeamPulseRawEventsResponse,
)
def get_team_pulse_raw_events(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    size: Annotated[int, Query(gt=0, le=24 * 3600)] = DEFAULT_BUCKET_SIZE_SECONDS,
    buckets: Annotated[int, Query(gt=0, le=MAX_BUCKET_COUNT)] = DEFAULT_BUCKET_COUNT,
    agent_id: Annotated[UUID | None, Query()] = None,
    since: Annotated[str | None, Query()] = None,
    until: Annotated[str | None, Query()] = None,
) -> TeamPulseRawEventsResponse:
    require_project_membership(conn, current_auth, project_id)
    size = _ensure_bucket_size(size)
    buckets = _ensure_bucket_count(buckets)

    if since:
        window_start = _parse_iso_utc(since)
    else:
        window_start, _ = _bucket_window(size=size, buckets=buckets)
    window_end = _parse_iso_utc(until) if until else _now_utc() + timedelta(seconds=1)
    if window_end <= window_start:
        raise HTTPException(status_code=422, detail="until must be > since")

    rows = list_pulse_raw_events(
        conn,
        project_id,
        window_start=window_start,
        window_end=window_end,
        agent_ids=[agent_id] if agent_id else None,
    )
    events: list[TeamPulseRawEvent] = []
    for row in rows:
        bucket_start = _align_bucket_start(row["created_at"], size)
        events.append(
            TeamPulseRawEvent(
                id=row["id"],
                agent_id=row["author_agent_id"],
                bucket_start=bucket_start,
                content=row["content"],
                metadata=row.get("metadata") or {},
                created_at=row["created_at"],
            )
        )
    return TeamPulseRawEventsResponse(events=events)


@router.post(
    "/projects/{project_id}/team-pulse/refresh",
    response_model=TeamPulseRefreshResponse,
)
def refresh_team_pulse(
    project_id: UUID,
    body: TeamPulseRefreshRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
) -> TeamPulseRefreshResponse:
    membership = require_project_membership(conn, current_auth, project_id)
    asking_agent_id = membership["id"]

    size = _ensure_bucket_size(body.size)
    buckets = _ensure_bucket_count(body.buckets)
    _, bucket_starts = _bucket_window(size=size, buckets=buckets)
    valid_starts = {_bucket_iso(s) for s in bucket_starts}

    pulse_doc_ids: list[str] = []
    responsibility_doc_ids: list[str] = []
    skipped_responsibility_agent_ids: list[UUID] = []

    for entry in body.summaries:
        if entry.agent_id != asking_agent_id:
            # Only the user themselves can author pulse cells for now. This
            # prevents one client overwriting another's summary.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="agent_id in summaries must match the authenticated user",
            )
        bucket_start = entry.bucket_start.astimezone(timezone.utc)
        bucket_start = _align_bucket_start(bucket_start, size)
        if _bucket_iso(bucket_start) not in valid_starts:
            raise HTTPException(
                status_code=422,
                detail=f"bucket_start outside requested window: {entry.bucket_start.isoformat()}",
            )
        bucket_end = bucket_start + timedelta(seconds=size)
        summary = _truncate_summary(entry.summary)
        try:
            doc_id = upsert_pulse_document(
                conn,
                project_id=project_id,
                author_agent_id=entry.agent_id,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
                summary=summary,
                event_count=entry.event_count,
                event_ids=entry.event_ids,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        pulse_doc_ids.append(doc_id)

    for entry in body.responsibilities:
        if entry.agent_id != asking_agent_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="agent_id in responsibilities must match the authenticated user",
            )
        last_updated = get_responsibility_refresh_state(
            conn, project_id=project_id, author_agent_id=entry.agent_id
        )
        if (
            last_updated is not None
            and (_now_utc() - last_updated).total_seconds() < RESPONSIBILITY_DEBOUNCE_SECONDS
        ):
            skipped_responsibility_agent_ids.append(entry.agent_id)
            continue
        window_start, _ = _bucket_window(size=size, buckets=buckets)
        doc_id = upsert_responsibility_document(
            conn,
            project_id=project_id,
            author_agent_id=entry.agent_id,
            content=entry.content,
            word_count=entry.word_count,
            source_window_start=window_start,
        )
        responsibility_doc_ids.append(doc_id)

    return TeamPulseRefreshResponse(
        pulse_doc_ids=pulse_doc_ids,
        responsibility_doc_ids=responsibility_doc_ids,
        skipped_responsibility_agent_ids=skipped_responsibility_agent_ids,
    )


@router.get(
    "/projects/{project_id}/responsibilities",
    response_model=ResponsibilitiesResponse,
)
def get_responsibilities(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
) -> ResponsibilitiesResponse:
    require_project_membership(conn, current_auth, project_id)
    roster = get_user_directory(conn, project_id)
    docs = list_responsibility_documents(conn, project_id)
    docs_by_agent: dict[UUID, dict[str, Any]] = {doc["author_agent_id"]: doc for doc in docs}

    members: list[ResponsibilityMember] = []
    for user in roster:
        doc = docs_by_agent.get(user["id"])
        if doc is None:
            members.append(
                ResponsibilityMember(
                    agent_id=user["id"],
                    display_name=user["display_name"],
                )
            )
            continue
        meta = doc.get("metadata") or {}
        members.append(
            ResponsibilityMember(
                agent_id=user["id"],
                display_name=user["display_name"],
                content=doc["content"],
                updated_at=doc.get("updated_at"),
                word_count=meta.get("word_count"),
            )
        )

    return ResponsibilitiesResponse(members=members)
