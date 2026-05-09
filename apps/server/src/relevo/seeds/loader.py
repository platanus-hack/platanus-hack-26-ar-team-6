"""V1 seed loader.

Resets the V1 tables on a target Postgres and loads:
  - one project row from seeds/project.yaml,
  - users from seeds/users.yaml,
  - per-user context entries from seeds/context/<user_key>.yaml.

Embeddings are intentionally left NULL in V1 — the embedding model is a V2
decision (Jorf+Sarf joint).

Usage:
    python -m relevo.seeds.loader
    python -m relevo.seeds.loader --seeds-dir /path/to/seeds
    python -m relevo.seeds.loader --keep-existing  # don't TRUNCATE first

Environment:
    DATABASE_URL  postgres connection string. Default:
                  postgresql://relevo:relevo@localhost:5432/relevo
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
import yaml
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from relevo.db import get_database_url
from relevo.seeds.schemas import (
    ProjectFile,
    UserContextFile,
    UsersFile,
)

logger = logging.getLogger("relevo.seeds.loader")

REPO_ROOT_SEEDS = Path(__file__).resolve().parents[5] / "seeds"


def _load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _validate_or_die(model_cls, raw: Any, path: Path):
    try:
        return model_cls.model_validate(raw)
    except ValidationError as exc:
        logger.error("Schema validation failed for %s:\n%s", path, exc)
        raise


def load_project_file(seeds_dir: Path) -> ProjectFile:
    path = seeds_dir / "project.yaml"
    if not path.exists():
        raise FileNotFoundError(f"required seed file missing: {path}")
    raw = _load_yaml(path)
    return _validate_or_die(ProjectFile, raw, path)


def load_users_file(seeds_dir: Path) -> UsersFile:
    path = seeds_dir / "users.yaml"
    if not path.exists():
        raise FileNotFoundError(f"required seed file missing: {path}")
    raw = _load_yaml(path)
    return _validate_or_die(UsersFile, raw, path)


def load_user_context_files(seeds_dir: Path) -> list[UserContextFile]:
    context_dir = seeds_dir / "context"
    if not context_dir.is_dir():
        logger.info("seeds/context/ not found — no per-user context will be seeded")
        return []
    files: list[UserContextFile] = []
    for path in sorted(context_dir.glob("*.yaml")):
        raw = _load_yaml(path)
        if raw is None:
            continue
        files.append(_validate_or_die(UserContextFile, raw, path))
    return files


def reset_tables(conn: psycopg.Connection) -> None:
    """V1 reset: wipe rows from all data tables. Schema is left intact."""
    with conn.cursor() as cur:
        cur.execute(
            "TRUNCATE TABLE context_entry, project_context_entry, app_user, project RESTART IDENTITY CASCADE"
        )
    conn.commit()


def insert_project(conn: psycopg.Connection, project_file: ProjectFile) -> UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project (name, description)
            VALUES (%s, %s)
            RETURNING id
            """,
            (project_file.project.name, project_file.project.description),
        )
        project_id = cur.fetchone()[0]
        for entry in project_file.context_entries:
            cur.execute(
                """
                INSERT INTO project_context_entry (project_id, kind, content, metadata)
                VALUES (%s, 'seed', %s, %s)
                """,
                (project_id, entry.content, Jsonb(entry.metadata)),
            )
    conn.commit()
    return project_id


def insert_users(
    conn: psycopg.Connection, project_id: UUID, users_file: UsersFile
) -> dict[str, UUID]:
    """Insert users; return a map from user_key -> user_id for context loading."""
    key_to_id: dict[str, UUID] = {}
    with conn.cursor() as cur:
        for user in users_file.users:
            profile = {
                "voice": user.voice.model_dump(),
                "domain": user.domain.model_dump(),
            }
            cur.execute(
                """
                INSERT INTO app_user (project_id, display_name, domain_summary, auth_token, profile)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    project_id,
                    user.display_name,
                    user.domain_summary,
                    user.auth_token,
                    Jsonb(profile),
                ),
            )
            key_to_id[user.key] = cur.fetchone()[0]
    conn.commit()
    return key_to_id


def insert_user_context(
    conn: psycopg.Connection,
    key_to_id: dict[str, UUID],
    context_files: list[UserContextFile],
) -> int:
    total = 0
    with conn.cursor() as cur:
        for cf in context_files:
            user_id = key_to_id.get(cf.user_key)
            if user_id is None:
                logger.warning(
                    "context file references unknown user_key=%r; skipping",
                    cf.user_key,
                )
                continue
            for entry in cf.entries:
                cur.execute(
                    """
                    INSERT INTO context_entry (user_id, kind, content, metadata)
                    VALUES (%s, 'seed', %s, %s)
                    """,
                    (user_id, entry.content, Jsonb(entry.metadata)),
                )
                total += 1
    conn.commit()
    return total


def run(seeds_dir: Path, database_url: str, keep_existing: bool = False) -> int:
    logger.info("=== Relevo seed loader (V1) ===")
    logger.info("seeds_dir=%s database_url=%s", seeds_dir, database_url)

    if not seeds_dir.is_dir():
        logger.error("seeds_dir does not exist: %s", seeds_dir)
        return 2

    project_file = load_project_file(seeds_dir)
    users_file = load_users_file(seeds_dir)
    context_files = load_user_context_files(seeds_dir)

    logger.info(
        "loaded YAML: project=%r users=%d context_files=%d",
        project_file.project.name,
        len(users_file.users),
        len(context_files),
    )

    with psycopg.connect(database_url) as conn:
        if not keep_existing:
            logger.info("resetting tables (use --keep-existing to skip)")
            reset_tables(conn)

        project_id = insert_project(conn, project_file)
        logger.info("inserted project: id=%s name=%r", project_id, project_file.project.name)

        key_to_id = insert_users(conn, project_id, users_file)
        for key, uid in key_to_id.items():
            logger.info("inserted user: key=%r id=%s", key, uid)

        n_entries = insert_user_context(conn, key_to_id, context_files)
        logger.info("inserted %d per-user context entries (kind=seed)", n_entries)

    logger.info("=== Done. ===")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Relevo V1 seed loader.")
    parser.add_argument(
        "--seeds-dir",
        default=str(REPO_ROOT_SEEDS),
        help=f"Directory containing seed YAMLs. Default: {REPO_ROOT_SEEDS}",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Defaults to $DATABASE_URL or local docker-compose URL.",
    )
    parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="Skip the TRUNCATE before inserting. Default is to wipe all rows first.",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    return run(
        seeds_dir=Path(args.seeds_dir),
        database_url=args.database_url or get_database_url(),
        keep_existing=args.keep_existing,
    )


if __name__ == "__main__":
    sys.exit(main())
