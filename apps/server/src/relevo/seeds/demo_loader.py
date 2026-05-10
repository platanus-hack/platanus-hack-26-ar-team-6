"""TMNT demo seed loader.

This loader is intentionally separate from the YAML seed loader. The YAML path
is small bootstrap data; the demo needs a richer snapshot with accounts,
sessions, prompt history, memory events, pulse docs, task-board data, and graph
edges.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid5

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from relevo.admin import ensure_schema
from relevo.db import backfill_memory_chunks, get_connect_timeout, get_database_url, token_hash


LOGGER = logging.getLogger("relevo.seeds.demo_loader")
DEMO_NAMESPACE = UUID("8e776f8a-06c7-49d3-9f83-6696c8f6d651")
PROJECT_ID = uuid5(DEMO_NAMESPACE, "project:tmnt")
DEMO_SESSION_TTL_DAYS = int(os.environ.get("DEMO_SESSION_TTL_DAYS", "30"))


def demo_id(label: str) -> UUID:
    return uuid5(DEMO_NAMESPACE, label)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def ts(now: datetime, *, hours_ago: int) -> datetime:
    return now - timedelta(hours=hours_ago)


def bucket_start(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def bucket_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def user_id(key: str) -> UUID:
    return demo_id(f"user:{key}")


def account_id(key: str) -> UUID:
    return demo_id(f"account:{key}")


USERS: list[dict[str, Any]] = [
    {
        "key": "admin",
        "display_name": "S. Barron Bucolo",
        "email": "sbarronbucolo@udesa.edu.ar",
        "auth_token": "demo-token-sbarronbucolo",
        "session_token": "123",
        "role": "leader",
        "domain_summary": (
            "Demo administrator for the TMNT project. Can manage the project, inspect all seeded "
            "work, and operate the demo as the project owner."
        ),
        "voice": {
            "tone": "concise, operator-focused, demo-first",
            "first_person": True,
            "signature_phrases": ["show me the demo state", "keep the reset path clean"],
        },
        "domain": {
            "primary": "demo administration",
            "tags": ["admin", "demo", "project-owner", "railway"],
            "expertise_summary": (
                "Owns the seeded demo environment, project access, reset behavior, and final demo "
                "readiness for the TMNT automated sewer cleanup workspace."
            ),
        },
    },
    {
        "key": "leonardo",
        "display_name": "Leonardo",
        "email": "leonardo@tmnt.example",
        "auth_token": "demo-token-leonardo",
        "session_token": "rlv_demo_leonardo_session_token",
        "role": "leader",
        "domain_summary": (
            "Project manager for TMNT. Owns roadmap, demo scope, milestone risk, and status across "
            "the automated sewer cleanup product."
        ),
        "voice": {
            "tone": "structured, decisive, status-driven",
            "first_person": True,
            "signature_phrases": ["what changed since last checkpoint", "ship the demo path first"],
        },
        "domain": {
            "primary": "project management",
            "tags": ["roadmap", "status", "scope", "stakeholders", "demo-plan"],
            "expertise_summary": (
                "Turns teammate updates into milestones, keeps launch scope tight, and decides which "
                "robot, marketing, and staffing work is demo-critical."
            ),
        },
    },
    {
        "key": "donatello",
        "display_name": "Donatello",
        "email": "donatello@tmnt.example",
        "auth_token": "demo-token-donatello",
        "session_token": "rlv_demo_donatello_session_token",
        "role": "member",
        "domain_summary": (
            "Coder and robotics engineer. Owns cleaning robot autonomy, sludge detection, path "
            "planning, telemetry, and hardware integration."
        ),
        "voice": {
            "tone": "technical, precise, experiment-backed",
            "first_person": True,
            "signature_phrases": ["sensor data beats guesses", "keep the robot out of the main flow"],
        },
        "domain": {
            "primary": "robotics engineering",
            "tags": ["robots", "path-planning", "sensors", "telemetry", "firmware"],
            "expertise_summary": (
                "Builds the sewer-cleaning robot software stack, including navigation logic, cleaning "
                "patterns, docking behavior, and sensor validation."
            ),
        },
    },
    {
        "key": "michelangelo",
        "display_name": "Michelangelo",
        "email": "michelangelo@tmnt.example",
        "auth_token": "demo-token-michelangelo",
        "session_token": "rlv_demo_michelangelo_session_token",
        "role": "member",
        "domain_summary": (
            "Marketing lead. Owns product story, launch copy, pilot-city outreach, social content, "
            "and demo positioning for automated sewer cleanup."
        ),
        "voice": {
            "tone": "playful but conversion-focused",
            "first_person": True,
            "signature_phrases": ["make sewage boring again", "municipal buyers need receipts"],
        },
        "domain": {
            "primary": "marketing",
            "tags": ["positioning", "launch", "pilot-cities", "copy", "pricing"],
            "expertise_summary": (
                "Turns robot and operations work into a credible municipal buyer story with proof, "
                "clear savings, and a memorable launch narrative."
            ),
        },
    },
    {
        "key": "raphael",
        "display_name": "Raphael",
        "email": "raphael@tmnt.example",
        "auth_token": "demo-token-raphael",
        "session_token": "rlv_demo_raphael_session_token",
        "role": "member",
        "domain_summary": (
            "HR and people operations. Owns staffing, accountability, performance escalations, "
            "coverage gaps, and uncomfortable conversations."
        ),
        "voice": {
            "tone": "blunt, impatient, accountability-first",
            "first_person": True,
            "signature_phrases": ["name the blocker", "document it before it becomes a pattern"],
        },
        "domain": {
            "primary": "HR and operations",
            "tags": ["staffing", "accountability", "performance", "hiring", "coverage"],
            "expertise_summary": (
                "Tracks who is blocked, who is slipping, and who needs help or escalation before "
                "missed work damages the launch."
            ),
        },
    },
]


PROJECT_CONTEXT: list[dict[str, Any]] = [
    {
        "content": (
            "TMNT builds automated sewer cleanup systems for cities. The product combines compact "
            "inspection robots, sludge and debris detection, autonomous cleaning passes, and a fleet "
            "dashboard that proves before-and-after pipe conditions."
        ),
        "metadata": {"source": "demo-seed", "tags": ["product", "overview", "tmnt"]},
    },
    {
        "content": (
            "Current demo goal: show a robot planning a safe sewer segment pass, identifying a clog, "
            "selecting a cleaning routine, and reporting status back to the team dashboard."
        ),
        "metadata": {"source": "demo-seed", "tags": ["demo", "scope", "roadmap"]},
    },
    {
        "content": (
            "Role map: S. Barron Bucolo is the demo administrator; Leonardo manages scope and project "
            "status; Donatello owns robot software and hardware integration; Michelangelo owns launch "
            "narrative and city outreach; Raphael owns staffing, accountability, and performance "
            "escalation."
        ),
        "metadata": {"source": "demo-seed", "tags": ["responsibilities", "routing", "team"]},
    },
    {
        "content": (
            "Shared risk register: sensor reliability in high-turbidity water, battery return-to-dock "
            "behavior, municipal proof points, overnight operator coverage, and missed checkpoint "
            "updates before the investor demo."
        ),
        "metadata": {"source": "demo-seed", "tags": ["risks", "status", "shared"]},
    },
]


TASKS: list[dict[str, Any]] = [
    {
        "id": "tmnt-task-robot-route-planner",
        "title": "Finish robot route planner",
        "priority": "high",
        "status": "in progress",
        "context": "Needed for the core demo path through a sewer segment.",
        "owner_key": "donatello",
    },
    {
        "id": "tmnt-task-sensor-calibration",
        "title": "Calibrate sludge sensors",
        "priority": "high",
        "status": "open",
        "context": "The robot must distinguish sludge from loose debris before cleaning.",
        "owner_key": "donatello",
    },
    {
        "id": "tmnt-task-demo-scope",
        "title": "Lock demo scope",
        "priority": "high",
        "status": "in progress",
        "context": "Leonardo is cutting anything that does not prove the buyer workflow.",
        "owner_key": "leonardo",
    },
    {
        "id": "tmnt-task-city-pilot",
        "title": "Prepare city pilot pitch",
        "priority": "medium",
        "status": "in progress",
        "context": "Municipal buyers need savings, safety, and inspection proof in one story.",
        "owner_key": "michelangelo",
    },
    {
        "id": "tmnt-task-launch-copy",
        "title": "Finalize launch copy",
        "priority": "medium",
        "status": "open",
        "context": "The product needs a concise story for automated sewer cleanup.",
        "owner_key": "michelangelo",
    },
    {
        "id": "tmnt-task-staffing-risk",
        "title": "Resolve staffing blockers",
        "priority": "high",
        "status": "open",
        "context": "Raphael is tracking missed updates and coverage gaps before they hit the demo.",
        "owner_key": "raphael",
    },
]


PROMPT_LOGS: list[dict[str, Any]] = [
    {
        "user_key": "donatello",
        "checkpoint": 1,
        "hours_ago": 92,
        "prompt": "Design the first-pass navigation loop for a sewer-cleaning robot in a 1.2 meter pipe.",
        "answer": (
            "Use a three-state loop: map the reachable segment, classify blockage density, then run a "
            "bounded cleaning pass. Keep speed below 0.35 m/s in murky flow and require return-to-dock "
            "when battery drops under 22%."
        ),
        "changed_files": ["robot/nav/route_planner.py", "robot/config/safety_limits.yaml"],
        "tags": ["robotics", "navigation", "safety"],
    },
    {
        "user_key": "donatello",
        "checkpoint": 2,
        "hours_ago": 72,
        "prompt": "What sensors should the prototype use to tell sludge, gravel, and cloth apart?",
        "answer": (
            "Pair a short-range ultrasonic sensor with turbidity and motor-current readings. Treat high "
            "turbidity plus rising brush current as sludge; sharp ultrasonic edges with low turbidity "
            "are likely gravel or hard debris."
        ),
        "changed_files": ["robot/sensing/classifier.py", "robot/tests/test_classifier.py"],
        "tags": ["sensors", "sludge", "classifier"],
    },
    {
        "user_key": "donatello",
        "checkpoint": 3,
        "hours_ago": 48,
        "prompt": "Generate telemetry fields for the fleet dashboard during a cleaning pass.",
        "answer": (
            "Emit segment_id, position_m, battery_pct, cleaning_mode, debris_confidence, brush_current_a, "
            "water_turbidity_ntu, clog_score, and operator_override. The dashboard can summarize pass "
            "confidence from clog_score and cleaning_mode transitions."
        ),
        "changed_files": ["robot/telemetry/schema.json", "apps/server/src/relevo/api/robot_status.py"],
        "tags": ["telemetry", "dashboard", "schema"],
    },
    {
        "user_key": "donatello",
        "checkpoint": 4,
        "hours_ago": 18,
        "prompt": "Review the cleaning nozzle routine for places where it can damage old clay pipes.",
        "answer": (
            "Cap pressure during inspection mode, ramp jet intensity over three seconds, and stop rotating "
            "when vibration spikes. Old clay pipe mode should prefer two short passes instead of one "
            "aggressive pass."
        ),
        "changed_files": ["robot/cleaning/nozzle_controller.py"],
        "tags": ["cleaning", "hardware", "safety"],
    },
    {
        "user_key": "leonardo",
        "checkpoint": 1,
        "hours_ago": 88,
        "prompt": "Summarize what must be true before we show the sewer cleanup demo to city buyers.",
        "answer": (
            "The demo needs one reliable autonomous route, visible clog detection, a cleaning pass with "
            "telemetry, a before-and-after report, and a clear owner for each risk. Anything else is a "
            "post-demo enhancement."
        ),
        "changed_files": ["docs/demo_scope.md"],
        "tags": ["status", "demo", "scope"],
    },
    {
        "user_key": "leonardo",
        "checkpoint": 2,
        "hours_ago": 64,
        "prompt": "Update the project plan now that sensors are risky and marketing wants pilot proof.",
        "answer": (
            "Pull sensor calibration forward, make the pilot proof deck depend on live telemetry instead "
            "of hypothetical ROI, and move pressure-wash optimization out of the investor demo."
        ),
        "changed_files": ["docs/roadmap.md", "docs/risk_register.md"],
        "tags": ["roadmap", "risks", "status"],
    },
    {
        "user_key": "leonardo",
        "checkpoint": 3,
        "hours_ago": 38,
        "prompt": "Ask for current status by owner and flag anything threatening Friday's demo.",
        "answer": (
            "Donatello is on route planning and sensor calibration; Michelangelo is building the pilot "
            "story; Raphael is chasing coverage gaps. Friday is threatened by sensor confidence and "
            "missed staffing updates."
        ),
        "changed_files": ["docs/status/weekly.md"],
        "tags": ["status", "owners", "demo"],
    },
    {
        "user_key": "leonardo",
        "checkpoint": 4,
        "hours_ago": 11,
        "prompt": "Rewrite the implementation priority list after seeing the latest robot telemetry.",
        "answer": (
            "Priority order is now sensor calibration, route planner failsafes, dashboard pass summary, "
            "city pilot script, then HR coverage cleanup. The optional animated fleet map is cut."
        ),
        "changed_files": ["docs/roadmap.md", "docs/demo_scope.md"],
        "tags": ["priorities", "telemetry", "scope"],
    },
    {
        "user_key": "michelangelo",
        "checkpoint": 1,
        "hours_ago": 84,
        "prompt": "Create a launch tagline for automated sewage cleanup that does not sound gross.",
        "answer": (
            "Lead with reliability: 'Clean pipes, clear proof, no surprise shutdowns.' Use the product "
            "name TMNT as the operating team, not a joke, and keep the savings proof front and center."
        ),
        "changed_files": ["marketing/messaging.md"],
        "tags": ["copy", "launch", "positioning"],
    },
    {
        "user_key": "michelangelo",
        "checkpoint": 2,
        "hours_ago": 60,
        "prompt": "Draft city pilot outreach for public works directors.",
        "answer": (
            "The outreach should promise fewer emergency cleanouts, auditable before-and-after pipe "
            "reports, and safer night operations. Ask for one known trouble segment and a two-week pilot."
        ),
        "changed_files": ["marketing/pilot_outreach.md"],
        "tags": ["pilot", "outreach", "municipal"],
    },
    {
        "user_key": "michelangelo",
        "checkpoint": 3,
        "hours_ago": 42,
        "prompt": "Turn robot telemetry into a buyer-friendly demo story.",
        "answer": (
            "Show the robot entering a segment, spotting the clog, choosing a cleaning mode, and returning "
            "a simple pass report: risk lowered, debris removed, next inspection date recommended."
        ),
        "changed_files": ["marketing/demo_story.md"],
        "tags": ["demo", "telemetry", "story"],
    },
    {
        "user_key": "michelangelo",
        "checkpoint": 4,
        "hours_ago": 15,
        "prompt": "Write a pricing hypothesis for a city pilot that is easy to approve.",
        "answer": (
            "Offer a fixed pilot fee per mapped sewer segment with a credit toward annual fleet service. "
            "Avoid per-incident pricing because cities compare this against emergency contractor costs."
        ),
        "changed_files": ["marketing/pricing.md"],
        "tags": ["pricing", "pilot", "sales"],
    },
    {
        "user_key": "raphael",
        "checkpoint": 1,
        "hours_ago": 80,
        "prompt": "Find where the team needs help and identify who is late on their part.",
        "answer": (
            "The risky spots are sensor calibration and overnight test coverage. Donatello needs one "
            "operator for dirty-water runs; Michelangelo needs telemetry screenshots. Missing updates "
            "should be documented today, not after the demo slips."
        ),
        "changed_files": ["ops/blockers.md"],
        "tags": ["blockers", "staffing", "accountability"],
    },
    {
        "user_key": "raphael",
        "checkpoint": 2,
        "hours_ago": 56,
        "prompt": "Who keeps missing handoffs, and can I start preparing replacement options?",
        "answer": (
            "Document the missed handoffs first: sensor test logs, launch copy dependencies, and operator "
            "coverage. Replacement planning is reasonable for repeated misses, but pair each person with "
            "a concrete support ask before escalation."
        ),
        "changed_files": ["ops/accountability_log.md"],
        "tags": ["performance", "handoffs", "hr"],
    },
    {
        "user_key": "raphael",
        "checkpoint": 3,
        "hours_ago": 34,
        "prompt": "Tell me exactly where people need help so I can stop the slipping before it gets worse.",
        "answer": (
            "Donatello needs a second set of eyes on sensor thresholds; Leonardo needs current task status "
            "from everyone; Michelangelo needs stable screenshots. The fastest fix is a two-hour swarm "
            "on telemetry evidence."
        ),
        "changed_files": ["ops/support_plan.md"],
        "tags": ["help", "staffing", "status"],
    },
    {
        "user_key": "raphael",
        "checkpoint": 4,
        "hours_ago": 9,
        "prompt": "If someone screws up the demo deadline, what paperwork do I need before firing them?",
        "answer": (
            "Use a performance improvement record: missed commitment, impact, prior support offered, "
            "specific recovery deadline, and owner acknowledgement. Do not skip the documented support "
            "step just because the deadline is irritating."
        ),
        "changed_files": ["ops/performance_escalation.md"],
        "tags": ["performance", "deadline", "hr"],
    },
]


RESPONSIBILITIES: dict[str, str] = {
    "admin": (
        "S. Barron Bucolo is the seeded demo administrator and project leader for the TMNT workspace. "
        "This account can manage the project, verify seeded data, and operate the demo using the fixed "
        "demo credential while the turtle team provides the product storyline."
    ),
    "leonardo": (
        "Leonardo owns TMNT's demo plan and project control. He keeps the roadmap focused on one "
        "credible automated sewer cleanup flow: route planning, clog detection, cleaning action, and "
        "proof report. He is tracking sensor confidence, staffing coverage, and launch dependencies."
    ),
    "donatello": (
        "Donatello owns robot engineering. He is responsible for route planning, sludge and debris "
        "classification, cleaning nozzle safety, telemetry schema, return-to-dock behavior, and the "
        "technical proof that the sewer robot can clean without damaging old pipes."
    ),
    "michelangelo": (
        "Michelangelo owns go-to-market work. He is building the municipal buyer story, launch copy, "
        "pilot outreach, pricing hypothesis, and demo narrative that translates robot telemetry into "
        "reduced emergency cleanouts and safer city operations."
    ),
    "raphael": (
        "Raphael owns HR and operational accountability. He tracks coverage gaps, missed updates, "
        "handoff failures, and support plans. His current focus is making sure blockers are named, "
        "owners have help, and repeated misses are documented before escalation."
    ),
}


CHAT_SUMMARIES: dict[str, str] = {
    "admin": (
        "Recent working context: the demo administrator account exists to access the TMNT project, "
        "verify Railway reset behavior, and inspect the seeded team activity without changing the "
        "four-character product narrative."
    ),
    "leonardo": (
        "Recent working context: Leonardo narrowed the launch demo to the buyer-critical path, moved "
        "sensor calibration ahead of optional features, and cut the animated fleet map until after "
        "route planning and telemetry are stable."
    ),
    "donatello": (
        "Recent working context: Donatello has route planning, sludge classification, telemetry, and "
        "nozzle safety in progress. The highest technical risk is sensor confidence in high-turbidity "
        "water and safe behavior around old clay pipes."
    ),
    "michelangelo": (
        "Recent working context: Michelangelo has the product tagline, city outreach, demo story, and "
        "pricing hypothesis drafted. He needs telemetry screenshots and a clean pass report for the "
        "municipal pilot deck."
    ),
    "raphael": (
        "Recent working context: Raphael is tracking missed handoffs, dirty-water test coverage, and "
        "performance escalation documentation. He wants blockers named early and support recorded before "
        "replacement conversations."
    ),
}


EXCHANGES: list[dict[str, Any]] = [
    {
        "label": "leo-asks-don-robot-status",
        "asking": "leonardo",
        "target": "donatello",
        "query": "What is the current robot autonomy status before the TMNT demo?",
        "hours_ago": 35,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
    {
        "label": "leo-asks-mikey-pilot-story",
        "asking": "leonardo",
        "target": "michelangelo",
        "query": "Do we have a city pilot story that matches the robot telemetry we can actually show?",
        "hours_ago": 28,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
    {
        "label": "raph-asks-don-blockers",
        "asking": "raphael",
        "target": "donatello",
        "query": "Who is blocked on sensor work and who is missing the dirty-water test handoff?",
        "hours_ago": 22,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
    {
        "label": "raph-asks-leo-late-work",
        "asking": "raphael",
        "target": "leonardo",
        "query": "Which owners are late so I can document the escalation path?",
        "hours_ago": 14,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
    {
        "label": "mikey-asks-leo-launch-scope",
        "asking": "michelangelo",
        "target": "leonardo",
        "query": "Which features are locked for launch so the pilot deck does not promise fantasy?",
        "hours_ago": 12,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
    {
        "label": "don-asks-raph-operator-coverage",
        "asking": "donatello",
        "target": "raphael",
        "query": "Do we have operator coverage for overnight sewer tests?",
        "hours_ago": 7,
        "metadata": {"route": "agents", "source": "demo-seed"},
    },
]


def reset_tables(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            TRUNCATE TABLE
              memory_chunk,
              agent_memory_event,
              agent_memory_document,
              context_exchange,
              project_qa_ledger,
              qa_ledger,
              context_entry,
              project_context_entry,
              app_user,
              desktop_login_exchange,
              account_session,
              oauth_login_state,
              account,
              project
            RESTART IDENTITY CASCADE
            """
        )
    conn.commit()


def insert_project(cur: psycopg.Cursor, now: datetime) -> None:
    cur.execute(
        """
        INSERT INTO project (id, name, description, created_at)
        VALUES (%s, %s, %s, %s)
        """,
        (
            PROJECT_ID,
            "TMNT Automated Sewer Cleanup",
            (
                "Startup demo project for automated sewage cleanup. Leonardo, Donatello, "
                "Michelangelo, and Raphael are building a robot-led sewer maintenance product."
            ),
            now - timedelta(days=10),
        ),
    )


def insert_accounts_and_users(cur: psycopg.Cursor, now: datetime) -> None:
    expires_at = now + timedelta(days=DEMO_SESSION_TTL_DAYS)
    for user in USERS:
        key = user["key"]
        account = account_id(key)
        cur.execute(
            """
            INSERT INTO account (
              id, google_sub, email, email_normalized, display_name, avatar_url,
              email_verified, created_at, last_login_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, %s)
            """,
            (
                account,
                f"demo-google-sub-{key}",
                user["email"],
                str(user["email"]).lower(),
                user["display_name"],
                None,
                now - timedelta(days=10),
                now,
            ),
        )
        cur.execute(
            """
            INSERT INTO account_session (id, account_id, token_hash, created_at, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                demo_id(f"account-session:{key}"),
                account,
                token_hash(user["session_token"]),
                now,
                expires_at,
            ),
        )
        cur.execute(
            """
            INSERT INTO app_user (
              id, project_id, account_id, display_name, domain_summary, auth_token,
              profile, role, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                user_id(key),
                PROJECT_ID,
                account,
                user["display_name"],
                user["domain_summary"],
                user["auth_token"],
                Jsonb({"voice": user["voice"], "domain": user["domain"]}),
                user["role"],
                now - timedelta(days=10),
            ),
        )


def _task_json(now: datetime) -> list[dict[str, Any]]:
    approved_at = (now - timedelta(hours=20)).isoformat().replace("+00:00", "Z")
    rows: list[dict[str, Any]] = []
    for task in TASKS:
        user = next(item for item in USERS if item["key"] == task["owner_key"])
        rows.append(
            {
                "id": task["id"],
                "title": task["title"],
                "priority": task["priority"],
                "status": task["status"],
                "context": task["context"],
                "approvedAt": approved_at,
                "ownerId": str(user_id(task["owner_key"])),
                "ownerDisplayName": user["display_name"],
            }
        )
    return rows


def insert_project_context(cur: psycopg.Cursor, now: datetime) -> None:
    for index, entry in enumerate(PROJECT_CONTEXT, start=1):
        cur.execute(
            """
            INSERT INTO project_context_entry (id, project_id, kind, content, metadata, created_at)
            VALUES (%s, %s, 'seed', %s, %s, %s)
            """,
            (
                demo_id(f"project-context:{index}"),
                PROJECT_ID,
                entry["content"],
                Jsonb(entry["metadata"]),
                now - timedelta(hours=96 - index),
            ),
        )

    task_rows = _task_json(now)
    cur.execute(
        """
        INSERT INTO project_context_entry (id, project_id, kind, content, metadata, created_at)
        VALUES (%s, %s, 'seed', %s, %s, %s)
        """,
        (
            demo_id("project-context:tasks"),
            PROJECT_ID,
            "TMNT task board:\n" + json.dumps(task_rows),
            Jsonb({"source": "task-board", "tags": ["tasks", "assignments", "demo"]}),
            now - timedelta(hours=20),
        ),
    )


def insert_user_seed_context(cur: psycopg.Cursor, now: datetime) -> None:
    for user in USERS:
        key = user["key"]
        cur.execute(
            """
            INSERT INTO context_entry (id, user_id, kind, content, metadata, created_at)
            VALUES (%s, %s, 'seed', %s, %s, %s)
            """,
            (
                demo_id(f"context-seed:{key}:role"),
                user_id(key),
                f"{user['display_name']} role context: {user['domain_summary']}",
                Jsonb({"source": "demo-seed", "tags": ["role", user["domain"]["primary"]]}),
                now - timedelta(hours=100),
            ),
        )
        cur.execute(
            """
            INSERT INTO context_entry (id, user_id, kind, content, metadata, created_at)
            VALUES (%s, %s, 'seed', %s, %s, %s)
            """,
            (
                demo_id(f"context-seed:{key}:responsibility"),
                user_id(key),
                RESPONSIBILITIES[key],
                Jsonb({"source": "demo-seed", "tags": ["responsibility", "current-work"]}),
                now - timedelta(hours=82),
            ),
        )


def _event_content(log: dict[str, Any]) -> str:
    changed_files = "\n".join(f"- {path}" for path in log["changed_files"])
    return (
        f"Checkpoint {log['checkpoint']}:\n\n"
        f"USER: {log['prompt']}\n\n"
        f"ASSISTANT: {log['answer']}\n\n"
        f"Code changes:\nChanged files:\n{changed_files}"
    )


def insert_prompt_logs(cur: psycopg.Cursor, now: datetime) -> list[dict[str, Any]]:
    inserted_events: list[dict[str, Any]] = []
    for log in PROMPT_LOGS:
        key = log["user_key"]
        created_at = ts(now, hours_ago=log["hours_ago"])
        metadata = {
            "source": "claude_code_hook",
            "session_id": f"tmnt-demo-{key}",
            "chat_session_id": f"claude-code:tmnt-demo-{key}",
            "checkpoint_index": log["checkpoint"],
            "prompt": log["prompt"],
            "changed_files": log["changed_files"],
            "tags": log["tags"],
            "demo": "tmnt",
        }
        cur.execute(
            """
            INSERT INTO context_entry (id, user_id, kind, content, metadata, created_at)
            VALUES (%s, %s, 'prompt_answer', %s, %s, %s)
            """,
            (
                demo_id(f"context-prompt:{key}:{log['checkpoint']}"),
                user_id(key),
                f"USER PROMPT: {log['prompt']}\n\nASSISTANT ANSWER: {log['answer']}",
                Jsonb({"source": "demo-prompt-history", "tags": log["tags"], "checkpoint_index": log["checkpoint"]}),
                created_at,
            ),
        )
        event_id = demo_id(f"memory-event:{key}:{log['checkpoint']}")
        cur.execute(
            """
            INSERT INTO agent_memory_event (
              id, project_id, author_agent_id, importance, content, metadata,
              source_context_exchange_id, created_at
            )
            VALUES (%s, %s, %s, 'local', %s, %s, NULL, %s)
            """,
            (
                event_id,
                PROJECT_ID,
                user_id(key),
                _event_content(log),
                Jsonb(metadata),
                created_at,
            ),
        )
        inserted_events.append(
            {
                "id": event_id,
                "user_key": key,
                "created_at": created_at,
                "summary": f"Checkpoint {log['checkpoint']}: {log['prompt']}",
            }
        )
    return inserted_events


def insert_documents(cur: psycopg.Cursor, now: datetime) -> None:
    for key, content in CHAT_SUMMARIES.items():
        metadata = {
            "source": "demo-seed",
            "chat_session_id": f"claude-code:tmnt-demo-{key}",
            "checkpoint_index": 4,
        }
        cur.execute(
            """
            INSERT INTO agent_memory_document (
              id, project_id, author_agent_id, importance, document_key, content,
              metadata, created_at, updated_at
            )
            VALUES (%s, %s, %s, 'local', 'chat-summary', %s, %s, %s, %s)
            """,
            (
                demo_id(f"memory-doc:{key}:chat-summary"),
                PROJECT_ID,
                user_id(key),
                content,
                Jsonb(metadata),
                now - timedelta(hours=8),
                now - timedelta(hours=8),
            ),
        )

    for key, content in RESPONSIBILITIES.items():
        metadata = {
            "kind": "responsibility_doc",
            "source": "demo-seed",
            "generated_at": now.isoformat(),
            "source_window_start": (now - timedelta(days=7)).isoformat(),
            "word_count": len(content.split()),
        }
        cur.execute(
            """
            INSERT INTO agent_memory_document (
              id, project_id, author_agent_id, importance, document_key, content,
              metadata, created_at, updated_at
            )
            VALUES (%s, %s, %s, 'global', 'responsibility', %s, %s, %s, %s)
            """,
            (
                demo_id(f"memory-doc:{key}:responsibility"),
                PROJECT_ID,
                user_id(key),
                content,
                Jsonb(metadata),
                now - timedelta(hours=6),
                now - timedelta(hours=6),
            ),
        )

    for task in TASKS:
        key = task["owner_key"]
        content = (
            f"{task['title']}: {task['status']} ({task['priority']} priority). "
            f"{task['context']}"
        )
        cur.execute(
            """
            INSERT INTO agent_memory_document (
              id, project_id, author_agent_id, importance, document_key, content,
              metadata, created_at, updated_at
            )
            VALUES (%s, %s, %s, 'global', %s, %s, %s, %s, %s)
            """,
            (
                demo_id(f"memory-doc:task:{task['id']}"),
                PROJECT_ID,
                user_id(key),
                f"task:{task['id']}",
                content,
                Jsonb({"source": "task-board", "task_id": task["id"], "status": task["status"]}),
                now - timedelta(hours=20),
                now - timedelta(hours=20),
            ),
        )


def insert_pulse_documents(cur: psycopg.Cursor, events: list[dict[str, Any]]) -> None:
    grouped: dict[tuple[str, datetime], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[(event["user_key"], bucket_start(event["created_at"]))].append(event)

    for (key, start), bucket_events in grouped.items():
        end = start + timedelta(hours=1)
        summary = " | ".join(event["summary"] for event in bucket_events[:2])
        metadata = {
            "kind": "team_pulse_bucket",
            "source": "demo-seed",
            "bucket_start": bucket_iso(start),
            "bucket_end": bucket_iso(end),
            "event_count": len(bucket_events),
            "event_ids": [str(event["id"]) for event in bucket_events],
        }
        cur.execute(
            """
            INSERT INTO agent_memory_document (
              id, project_id, author_agent_id, importance, document_key, content,
              metadata, created_at, updated_at
            )
            VALUES (%s, %s, %s, 'local', %s, %s, %s, %s, %s)
            """,
            (
                demo_id(f"memory-doc:pulse:{key}:{bucket_iso(start)}"),
                PROJECT_ID,
                user_id(key),
                f"pulse:{bucket_iso(start)}",
                summary,
                Jsonb(metadata),
                start,
                start + timedelta(minutes=20),
            ),
        )


def insert_context_exchanges(cur: psycopg.Cursor, now: datetime) -> None:
    for exchange in EXCHANGES:
        cur.execute(
            """
            INSERT INTO context_exchange (
              id, project_id, asking_agent_id, target_agent_id, query, tool_name,
              result_refs, metadata, created_at
            )
            VALUES (%s, %s, %s, %s, %s, 'agent_ctx', %s, %s, %s)
            """,
            (
                demo_id(f"context-exchange:{exchange['label']}"),
                PROJECT_ID,
                user_id(exchange["asking"]),
                user_id(exchange["target"]),
                exchange["query"],
                Jsonb(
                    [
                        {
                            "id": str(demo_id(f"memory-doc:{exchange['target']}:responsibility")),
                            "source_table": "agent_memory_document",
                        }
                    ]
                ),
                Jsonb(exchange["metadata"]),
                ts(now, hours_ago=exchange["hours_ago"]),
            ),
        )


def seed_demo(conn: psycopg.Connection) -> int:
    now = utc_now()
    reset_tables(conn)
    with conn.cursor() as cur:
        insert_project(cur, now)
        insert_accounts_and_users(cur, now)
        insert_project_context(cur, now)
        insert_user_seed_context(cur, now)
        events = insert_prompt_logs(cur, now)
        insert_documents(cur, now)
        insert_pulse_documents(cur, events)
        insert_context_exchanges(cur, now)
    conn.commit()
    return len(events)


def run(
    *,
    database_url: str,
    apply_schema: bool = True,
    backfill_chunks: bool = True,
) -> int:
    LOGGER.info("=== TMNT demo seed loader ===")
    if apply_schema:
        LOGGER.info("applying migrations before reset")
        ensure_schema(database_url)

    with psycopg.connect(
        database_url,
        row_factory=dict_row,
        connect_timeout=get_connect_timeout(),
    ) as conn:
        event_count = seed_demo(conn)
        chunk_count = 0
        if backfill_chunks:
            chunk_count = backfill_memory_chunks(conn, project_id=PROJECT_ID, batch_size=1000)

    LOGGER.info(
        "seeded TMNT demo project_id=%s users=%d prompt_events=%d memory_chunks=%d",
        PROJECT_ID,
        len(USERS),
        event_count,
        chunk_count,
    )
    LOGGER.info(
        "demo session tokens: %s",
        ", ".join(f"{user['display_name']}={user['session_token']}" for user in USERS),
    )
    LOGGER.info("=== Done. ===")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reset and seed the TMNT demo database.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Defaults to $DATABASE_URL or local docker-compose URL.",
    )
    parser.add_argument(
        "--skip-schema",
        action="store_true",
        help="Do not run migrations before resetting and seeding.",
    )
    parser.add_argument(
        "--no-backfill",
        action="store_true",
        help="Do not populate memory_chunk rows after seeding source tables.",
    )
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return run(
        database_url=args.database_url or get_database_url(),
        apply_schema=not args.skip_schema,
        backfill_chunks=not args.no_backfill,
    )


if __name__ == "__main__":
    sys.exit(main())
