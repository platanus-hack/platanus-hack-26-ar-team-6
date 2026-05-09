from __future__ import annotations

import os
from pathlib import Path

import psycopg

from relevo.db import get_database_url
from relevo.seeds.loader import run as run_seed_loader


TRUE_VALUES = {"1", "true", "yes", "y", "on"}


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in TRUE_VALUES


def ensure_schema(database_url: str | None = None) -> bool:
    """Apply 0001_init.sql to an empty database.

    This is intentionally small and hackathon-focused. If the DB has an old
    partial schema, fail loudly instead of trying to migrate in place.
    """
    url = database_url or get_database_url()
    with psycopg.connect(url) as conn:
        if _schema_ready(conn):
            return False
        if _has_public_tables(conn):
            raise RuntimeError(
                "Database has tables but qa_ledger is missing. Recreate the DB "
                "or apply the edited 0001_init.sql manually."
            )
        sql = _migration_path().read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    return True


def seed_if_empty(database_url: str | None = None) -> bool:
    url = database_url or get_database_url()
    with psycopg.connect(url) as conn:
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
