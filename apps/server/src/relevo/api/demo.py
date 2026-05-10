from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb

from relevo.api.auth import ProjectMembershipOut, require_account
from relevo.db import (
    PULSE_DOCUMENT_KEY_PREFIX,
    RESPONSIBILITY_DOCUMENT_KEY,
    connect,
    create_project_for_account,
    default_profile,
    pulse_document_key,
)

router = APIRouter()

DEMO_KEY = "railwaywise"
PROJECT_NAME = "Railwaywise"
PROJECT_DESCRIPTION = (
    "AI-assisted railway operations workspace for dispatch, maintenance, "
    "signals, passenger communications, and integrations."
)
LEADER_DOMAIN_SUMMARY = (
    "Railwaywise incident commander coordinating live service recovery, safety, "
    "communications, and systems integration."
)


@dataclass(frozen=True)
class DemoTeammate:
    name: str
    domain_summary: str
    primary: str
    tags: tuple[str, ...]


TEAMMATES: tuple[DemoTeammate, ...] = (
    DemoTeammate(
        "Dispatch",
        "Owns timetable recovery, train movements, crew knock-on effects, and operator decisions.",
        "rail dispatch",
        ("operations", "timetable", "service recovery"),
    ),
    DemoTeammate(
        "Maintenance",
        "Owns rolling-stock faults, track access windows, field repairs, and asset readiness.",
        "rail maintenance",
        ("rolling stock", "field work", "asset readiness"),
    ),
    DemoTeammate(
        "Signals/Data",
        "Owns signal telemetry, control-system anomalies, data quality, and incident evidence.",
        "signals and data",
        ("signals", "telemetry", "diagnostics"),
    ),
    DemoTeammate(
        "Passenger Comms",
        "Owns customer-facing updates, station announcements, accessibility guidance, and social copy.",
        "passenger communications",
        ("customers", "stations", "accessibility"),
    ),
    DemoTeammate(
        "Integrations",
        "Owns GTFS-RT feeds, third-party notifications, ops dashboards, and downstream API health.",
        "systems integrations",
        ("gtfs-rt", "apis", "dashboards"),
    ),
)


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


@router.post("/demo/railwaywise", response_model=ProjectMembershipOut)
def create_railwaywise_demo(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> ProjectMembershipOut:
    membership = _ensure_railwaywise_membership(conn, account)
    teammates = _ensure_demo_teammates(conn, membership["project_id"])
    _cleanup_demo_rows(conn, membership["project_id"])
    _seed_demo_rows(conn, membership, teammates)
    return ProjectMembershipOut(**membership)


def _ensure_railwaywise_membership(
    conn: psycopg.Connection,
    account: dict[str, Any],
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id AS project_id,
                   p.name AS project_name,
                   p.description,
                   u.id AS user_id,
                   u.display_name,
                   u.domain_summary,
                   u.role
              FROM project p
              JOIN app_user u ON u.project_id = p.id
             WHERE u.account_id = %s
               AND p.name = %s
             ORDER BY p.created_at ASC
             LIMIT 1
            """,
            (account["id"], PROJECT_NAME),
        )
        row = cur.fetchone()
        if row is not None:
            cur.execute(
                """
                UPDATE project
                   SET description = %s
                 WHERE id = %s
                """,
                (PROJECT_DESCRIPTION, row["project_id"]),
            )
            cur.execute(
                """
                UPDATE app_user
                   SET role = 'leader',
                       domain_summary = %s,
                       profile = %s
                 WHERE id = %s
                """,
                (
                    LEADER_DOMAIN_SUMMARY,
                    Jsonb(
                        _profile(
                            LEADER_DOMAIN_SUMMARY,
                            "railway operations lead",
                            ("demo",),
                        )
                    ),
                    row["user_id"],
                ),
            )
            conn.commit()

    if row is None:
        return create_project_for_account(
            conn,
            account_id=account["id"],
            name=PROJECT_NAME,
            description=PROJECT_DESCRIPTION,
            domain_summary=LEADER_DOMAIN_SUMMARY,
        )

    return {
        **dict(row),
        "description": PROJECT_DESCRIPTION,
        "domain_summary": LEADER_DOMAIN_SUMMARY,
        "role": "leader",
    }


def _ensure_demo_teammates(
    conn: psycopg.Connection,
    project_id: UUID,
) -> list[dict[str, Any]]:
    teammates: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        for teammate in TEAMMATES:
            cur.execute(
                """
                SELECT id, project_id, display_name, domain_summary, profile, role, account_id
                  FROM app_user
                 WHERE project_id = %s
                   AND account_id IS NULL
                   AND display_name = %s
                   AND profile->>'demo_key' = %s
                 LIMIT 1
                """,
                (project_id, teammate.name, DEMO_KEY),
            )
            existing = cur.fetchone()
            profile = _profile(teammate.domain_summary, teammate.primary, teammate.tags)
            if existing is not None:
                cur.execute(
                    """
                    UPDATE app_user
                       SET domain_summary = %s,
                           profile = %s,
                           role = 'member'
                     WHERE id = %s
                    """,
                    (teammate.domain_summary, Jsonb(profile), existing["id"]),
                )
                teammates.append({**dict(existing), "domain_summary": teammate.domain_summary})
                continue

            cur.execute(
                """
                INSERT INTO app_user (
                  project_id, account_id, display_name, domain_summary, auth_token, profile, role
                )
                VALUES (%s, NULL, %s, %s, NULL, %s, 'member')
                RETURNING id, project_id, display_name, domain_summary, profile, role, account_id
                """,
                (project_id, teammate.name, teammate.domain_summary, Jsonb(profile)),
            )
            teammates.append(dict(cur.fetchone()))
    conn.commit()
    return teammates


def _profile(domain_summary: str, primary: str, tags: tuple[str, ...]) -> dict[str, Any]:
    profile = default_profile(domain_summary)
    return {
        **profile,
        "demo_key": DEMO_KEY,
        "domain": {
            **profile["domain"],
            "primary": primary,
            "tags": list(tags),
            "expertise_summary": domain_summary,
        },
    }


def _cleanup_demo_rows(conn: psycopg.Connection, project_id: UUID) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM project_context_entry
             WHERE project_id = %s
               AND metadata->>'demo_key' = %s
            """,
            (project_id, DEMO_KEY),
        )
        cur.execute(
            """
            DELETE FROM context_entry ce
             USING app_user u
             WHERE ce.user_id = u.id
               AND u.project_id = %s
               AND ce.metadata->>'demo_key' = %s
            """,
            (project_id, DEMO_KEY),
        )
        cur.execute(
            """
            DELETE FROM agent_memory_event
             WHERE project_id = %s
               AND metadata->>'demo_key' = %s
            """,
            (project_id, DEMO_KEY),
        )
        cur.execute(
            """
            DELETE FROM agent_memory_document
             WHERE project_id = %s
               AND metadata->>'demo_key' = %s
            """,
            (project_id, DEMO_KEY),
        )
        cur.execute(
            """
            DELETE FROM context_exchange
             WHERE project_id = %s
               AND metadata->>'demo_key' = %s
            """,
            (project_id, DEMO_KEY),
        )
    conn.commit()


def _seed_demo_rows(
    conn: psycopg.Connection,
    membership: dict[str, Any],
    teammates: list[dict[str, Any]],
) -> dict[str, int]:
    project_id = membership["project_id"]
    roster = [
        {
            "id": membership["user_id"],
            "display_name": membership["display_name"],
            "domain_summary": membership["domain_summary"],
        },
        *teammates,
    ]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    bucket_start = now.replace(minute=0, second=0)

    counts = {
        "project_context_entry": 0,
        "context_entry": 0,
        "agent_memory_document": 0,
        "agent_memory_event": 0,
        "context_exchange": 0,
    }

    with conn.cursor() as cur:
        for content in _project_context():
            cur.execute(
                """
                INSERT INTO project_context_entry (project_id, kind, content, metadata)
                VALUES (%s, 'seed', %s, %s)
                """,
                (project_id, content, Jsonb(_metadata("project_context"))),
            )
            counts["project_context_entry"] += 1

        for member in roster:
            for content in _member_context(member["display_name"]):
                cur.execute(
                    """
                    INSERT INTO context_entry (user_id, kind, content, metadata)
                    VALUES (%s, 'seed', %s, %s)
                    """,
                    (member["id"], content, Jsonb(_metadata("member_context"))),
                )
                counts["context_entry"] += 1

            responsibility = _responsibility_doc(member["display_name"], member["domain_summary"])
            cur.execute(
                """
                INSERT INTO agent_memory_document (
                  project_id, author_agent_id, importance, document_key, content, metadata
                )
                VALUES (%s, %s, 'global', %s, %s, %s)
                """,
                (
                    project_id,
                    member["id"],
                    RESPONSIBILITY_DOCUMENT_KEY,
                    responsibility,
                    Jsonb(_metadata("responsibility_doc", word_count=len(responsibility.split()))),
                ),
            )
            counts["agent_memory_document"] += 1

            for document_key, content in _global_docs(member["display_name"], member["domain_summary"]):
                cur.execute(
                    """
                    INSERT INTO agent_memory_document (
                      project_id, author_agent_id, importance, document_key, content, metadata
                    )
                    VALUES (%s, %s, 'global', %s, %s, %s)
                    """,
                    (
                        project_id,
                        member["id"],
                        document_key,
                        content,
                        Jsonb(_metadata("global_demo_doc", word_count=len(content.split()))),
                    ),
                )
                counts["agent_memory_document"] += 1

            for bucket, summary, event_count in _pulse_docs(member["display_name"], bucket_start):
                bucket_end = bucket + timedelta(hours=1)
                cur.execute(
                    """
                    INSERT INTO agent_memory_document (
                      project_id, author_agent_id, importance, document_key, content, metadata
                    )
                    VALUES (%s, %s, 'local', %s, %s, %s)
                    """,
                    (
                        project_id,
                        member["id"],
                        pulse_document_key(bucket),
                        summary,
                        Jsonb(
                            _metadata(
                                "team_pulse_bucket",
                                bucket_start=_iso(bucket),
                                bucket_end=_iso(bucket_end),
                                event_count=event_count,
                                event_ids=[],
                            )
                        ),
                    ),
                )
                counts["agent_memory_document"] += 1

            for content in _events(member["display_name"]):
                cur.execute(
                    """
                    INSERT INTO agent_memory_event (
                      project_id, author_agent_id, importance, content, metadata
                    )
                    VALUES (%s, %s, 'global', %s, %s)
                    """,
                    (project_id, member["id"], content, Jsonb(_metadata("demo_event"))),
                )
                counts["agent_memory_event"] += 1

        by_name = {member["display_name"]: member["id"] for member in roster}
        for asking, target, query in _exchanges():
            cur.execute(
                """
                INSERT INTO context_exchange (
                  project_id, asking_agent_id, target_agent_id, query, tool_name,
                  result_refs, metadata
                )
                VALUES (%s, %s, %s, %s, 'agent_ctx', %s, %s)
                """,
                (
                    project_id,
                    by_name[asking],
                    by_name[target],
                    query,
                    Jsonb([]),
                    Jsonb(_metadata("demo_exchange")),
                ),
            )
            counts["context_exchange"] += 1

    conn.commit()
    return counts


def _metadata(kind: str, **extra: Any) -> dict[str, Any]:
    return {"demo_key": DEMO_KEY, "kind": kind, **extra}


def _iso(ts: datetime) -> str:
    return (
        ts.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _project_context() -> list[str]:
    return [
        "Railwaywise operates the North-South commuter corridor with 42 stations, mixed express/local service, and strict safety hold points.",
        "Demo incident: a points failure near Central Junction is reducing platform throughput and causing passenger crowding downstream.",
        "Service recovery policy: safety decisions outrank punctuality; passenger comms must publish plain-language updates every 10 minutes during disruption.",
        "Key systems: GTFS-RT feed, station display network, crew rostering, maintenance workbank, and signal telemetry lake.",
        "Executive objective: preserve safety, keep airport branch moving, and document decisions for post-incident review.",
        "Operational cadence: Dispatch leads, Signals/Data validates telemetry, Maintenance confirms field action, Passenger Comms publishes updates, Integrations watches APIs.",
        "Primary demo line: San Martin morning service, where headway drift and Retiro terminal congestion create cascading passenger updates.",
        "Secondary demo line: Mitre branch, where a malformed consist entry can distort capacity estimates and crowding forecasts.",
        "Decision rule: automatic recommendations must show source evidence before a dispatcher can mark them as accepted.",
        "Escalation rule: any incident tagged safety-critical must page the on-call coordinator within two minutes.",
        "Customer rule: disruption copy should include affected line, direction, estimated delay, next update time, and accessible-routing guidance.",
        "Data quality rule: telemetry confidence below 0.74 must trigger a Signals/Data review before downstream dashboards trust the feed.",
    ]


def _member_context(name: str) -> list[str]:
    return [
        f"{name} uses Railwaywise shared incident channel RW-OPS-17 for cross-team decisions.",
        f"{name} should escalate any safety-critical uncertainty before recommending timetable recovery actions.",
        f"{name} is part of the demo roster seeded for graph, pulse, and responsibility views.",
    ]


def _responsibility_doc(name: str, domain_summary: str) -> str:
    return (
        f"## {name} responsibility\n"
        f"{domain_summary}\n\n"
        "During the Central Junction disruption, maintain a concise running brief, "
        "surface blockers quickly, and write decisions in language another rail "
        "operator could audit after the incident."
    )


def _global_docs(name: str, domain_summary: str) -> list[tuple[str, str]]:
    slug = name.lower().replace("/", "-").replace(" ", "-")
    return [
        (
            f"railwaywise-{slug}-operating-brief",
            (
                f"{name} operating brief: {domain_summary} Current focus is the "
                "Central Junction recovery thread, with decisions written for "
                "handoff and audit."
            ),
        ),
        (
            f"railwaywise-{slug}-task-summary",
            (
                f"{name} task summary: keep the Railwaywise demo moving by closing "
                "open incident, timeline, and graph evidence gaps before the live review."
            ),
        ),
    ]


def _pulse_docs(
    name: str,
    bucket_start: datetime,
) -> list[tuple[datetime, str, int]]:
    return [
        (
            bucket_start - timedelta(hours=4),
            f"{name} reviewed overnight handover and confirmed Railwaywise demo readiness.",
            2,
        ),
        (
            bucket_start - timedelta(hours=3),
            f"{name} triaged Central Junction evidence and noted the highest-risk follow-up.",
            3,
        ),
        (
            bucket_start - timedelta(hours=2),
            f"{name} coordinated the recovery plan with another Railwaywise owner.",
            2,
        ),
        (
            bucket_start - timedelta(hours=1),
            f"{name} updated the shared incident brief before stakeholder rehearsal.",
            4,
        ),
        (
            bucket_start,
            f"{name} is actively contributing to the Central Junction recovery thread.",
            5,
        ),
    ]


def _events(name: str) -> list[str]:
    return [
        f"{name} logged a status update for the Central Junction incident.",
        f"{name} added follow-up evidence for the Railwaywise demo graph.",
        f"{name} reviewed a task-board item tied to the San Martin morning recovery.",
        f"{name} captured a passenger-impact note for downstream timeline summarization.",
        f"{name} checked whether their responsibility brief still matched the latest incident evidence.",
        f"{name} marked a demo rehearsal risk with enough context for teammate retrieval.",
        f"{name} published a global memory checkpoint for the Railwaywise stakeholder review.",
    ]


def _exchanges() -> list[tuple[str, str, str]]:
    return [
        (
            "Dispatch",
            "Signals/Data",
            "Can we trust the current points telemetry at Central Junction?",
        ),
        ("Dispatch", "Maintenance", "What field crew ETA can we plan service recovery around?"),
        ("Passenger Comms", "Dispatch", "Which services should be named in the next passenger update?"),
        (
            "Integrations",
            "Passenger Comms",
            "Are downstream station displays receiving the latest disruption copy?",
        ),
        (
            "Signals/Data",
            "Maintenance",
            "Does the telemetry pattern match a mechanical fault or sensor drift?",
        ),
        ("Maintenance", "Dispatch", "Can we hold the airport branch while the crew gets track access?"),
        ("Integrations", "Signals/Data", "Which telemetry stream should the dashboard trust during failover?"),
        ("Dispatch", "Passenger Comms", "Please prepare a 10-minute customer update for crowding risk."),
        ("Passenger Comms", "Signals/Data", "Can we say telemetry confidence is improving in public updates?"),
        ("Signals/Data", "Dispatch", "Which dispatch override should be annotated for audit?"),
        ("Maintenance", "Integrations", "Will the maintenance workbank API accept the revised outage window?"),
        ("Integrations", "Dispatch", "Which train movement event should the live map prioritize?"),
        ("Signals/Data", "Passenger Comms", "Which anomaly explanation is safe for station staff?"),
        ("Passenger Comms", "Maintenance", "Do we have a field ETA suitable for passenger-facing copy?"),
    ]
