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
    """Apply unapplied SQL migrations.

    Fresh DBs run every file in migrations/. Existing demo DBs that predate
    migration tracking are baselined at 0001, then receive later additive
    migrations. That lets Railway deploys migrate the existing Postgres
    service automatically when AUTO_MIGRATE=1.
    """
    url = database_url or get_database_url()
    with psycopg.connect(url, connect_timeout=get_connect_timeout()) as conn:
        migrations = _migration_files()
        has_app_schema = _has_app_schema(conn)
        _ensure_migration_table(conn)

        applied = _applied_migration_versions(conn)
        changed = False
        if has_app_schema and migrations:
            first = migrations[0]
            first_version = _migration_version(first)
            if first_version not in applied:
                _record_migration(conn, first, mode="baseline")
                applied.add(first_version)
                changed = True

        for migration in migrations:
            version = _migration_version(migration)
            if version in applied:
                continue
            _apply_migration(conn, migration)
            applied.add(version)
            changed = True
    return changed


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


def _has_app_schema(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_regclass('public.project') IS NOT NULL
               AND to_regclass('public.app_user') IS NOT NULL
               AND to_regclass('public.context_entry') IS NOT NULL
            """
        )
        return bool(cur.fetchone()[0])


def _ensure_migration_table(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migration (
              version TEXT PRIMARY KEY,
              filename TEXT NOT NULL,
              mode TEXT NOT NULL DEFAULT 'apply',
              applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    conn.commit()


def _applied_migration_versions(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM schema_migration")
        rows = cur.fetchall()
    return {str(row[0]) for row in rows}


def _apply_migration(conn: psycopg.Connection, migration: Path) -> None:
    sql = migration.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    _record_migration(conn, migration, mode="apply")


def _record_migration(conn: psycopg.Connection, migration: Path, *, mode: str) -> None:
    version = _migration_version(migration)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO schema_migration (version, filename, mode)
            VALUES (%s, %s, %s)
            ON CONFLICT (version) DO NOTHING
            """,
            (version, migration.name, mode),
        )
    conn.commit()


def _migration_version(path: Path) -> str:
    return path.stem.split("_", 1)[0]


def _migration_files() -> list[Path]:
    return sorted(_migrations_dir().glob("[0-9][0-9][0-9][0-9]_*.sql"))


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


def _migrations_dir() -> Path:
    if os.environ.get("MIGRATIONS_DIR"):
        return Path(os.environ["MIGRATIONS_DIR"])
    return _migration_path().parent


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
