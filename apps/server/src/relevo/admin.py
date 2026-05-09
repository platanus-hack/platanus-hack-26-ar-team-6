from __future__ import annotations

import os
from pathlib import Path

import psycopg

from relevo.db import get_connect_timeout, get_database_url
from relevo.seeds.loader import run as run_seed_loader


TRUE_VALUES = {"1", "true", "yes", "y", "on"}


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in TRUE_VALUES


def ensure_schema(database_url: str | None = None) -> bool:
    """Apply the demo schema.

    Empty DBs get the full edited 0001. Existing V1 demo DBs get the missing
    V2 closure table/indexes added in place so Railway deploys can recover.
    """
    url = database_url or get_database_url()
    with psycopg.connect(url, connect_timeout=get_connect_timeout()) as conn:
        if _schema_ready(conn):
            return False
        if _has_public_tables(conn):
            _ensure_v2_tables(conn)
            conn.commit()
            return True
        sql = _migration_path().read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    return True


def seed_if_empty(database_url: str | None = None) -> bool:
    url = database_url or get_database_url()
    with psycopg.connect(url, connect_timeout=get_connect_timeout()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM app_user")
            user_count = cur.fetchone()[0]
    if user_count > 0 and not env_flag("FORCE_SEED"):
        return False
    run_seed_loader(_seeds_dir(), url, keep_existing=False)
    return True


def _schema_ready(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.qa_ledger') IS NOT NULL")
        return bool(cur.fetchone()[0])


def _has_public_tables(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
            )
            """
        )
        return bool(cur.fetchone()[0])


def _ensure_v2_tables(conn: psycopg.Connection) -> None:
    """Bring an existing V1 demo DB up to the V2 closure-write schema."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_regclass('public.project') IS NOT NULL
               AND to_regclass('public.app_user') IS NOT NULL
               AND to_regclass('public.context_entry') IS NOT NULL
            """
        )
        has_v1_core = bool(cur.fetchone()[0])
        if not has_v1_core:
            raise RuntimeError(
                "Database has tables but is not the expected demo schema. "
                "Recreate the DB or apply migrations manually."
            )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS qa_ledger (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
              asking_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
              target_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
              context_entry_id UUID NOT NULL UNIQUE REFERENCES context_entry(id) ON DELETE CASCADE,
              question TEXT NOT NULL,
              answer TEXT NOT NULL,
              metadata JSONB NOT NULL DEFAULT '{}',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS qa_ledger_target_created ON qa_ledger (target_user_id, created_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS qa_ledger_asking_created ON qa_ledger (asking_user_id, created_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS qa_ledger_project_created ON qa_ledger (project_id, created_at DESC)"
        )


def _migration_path() -> Path:
    if os.environ.get("MIGRATION_FILE"):
        return Path(os.environ["MIGRATION_FILE"])
    candidates = [
        Path.cwd() / "migrations" / "0001_init.sql",
        Path("/app/migrations/0001_init.sql"),
        Path(__file__).resolve().parents[4] / "migrations" / "0001_init.sql",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("Could not find migrations/0001_init.sql")


def _seeds_dir() -> Path:
    if os.environ.get("SEEDS_DIR"):
        return Path(os.environ["SEEDS_DIR"])
    candidates = [
        Path.cwd() / "seeds",
        Path("/app/seeds"),
        Path(__file__).resolve().parents[4] / "seeds",
    ]
    for path in candidates:
        if path.is_dir():
            return path
    raise FileNotFoundError("Could not find seeds directory")
