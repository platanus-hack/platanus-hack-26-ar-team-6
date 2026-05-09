"""Seed loader (V0 skeleton).

Reads YAML files from a seeds directory, validates them against the Pydantic
schemas in `relevo.seeds.schemas`, and logs what it would insert. Real DB
inserts land in V1.

Usage:
    python -m relevo.seeds.loader --workspace-name "demo"
    python -m relevo.seeds.loader --workspace-name "demo" --seeds-dir path/to/seeds

Environment:
    DATABASE_URL  postgres connection string. Used to verify connectivity only
                  in V0 (no writes). Default: postgresql://relevo:relevo@localhost:5432/relevo
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from relevo.seeds.schemas import (
    PersonalMemoriesFile,
    PersonasFile,
    PoolFile,
    TasksFile,
    TimelineFile,
)

logger = logging.getLogger("relevo.seeds.loader")

DEFAULT_DATABASE_URL = "postgresql://relevo:relevo@localhost:5432/relevo"
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


def load_personas(seeds_dir: Path) -> PersonasFile | None:
    path = seeds_dir / "personas.yaml"
    if not path.exists():
        logger.info("personas.yaml not found at %s — skipping", path)
        return None
    raw = _load_yaml(path)
    if raw is None:
        logger.info("personas.yaml is empty — skipping")
        return None
    parsed = _validate_or_die(PersonasFile, raw, path)
    logger.info("personas.yaml: would insert %d person(s) + %d agent(s)", len(parsed.personas), len(parsed.personas))
    for p in parsed.personas:
        logger.info("  - person/agent key=%s display_name=%r domain=%s", p.key, p.display_name, p.domain.primary)
    return parsed


def load_personal_memories(seeds_dir: Path) -> list[PersonalMemoriesFile]:
    memories_dir = seeds_dir / "memories"
    if not memories_dir.is_dir():
        logger.info("seeds/memories/ not found — skipping personal memories")
        return []
    files: list[PersonalMemoriesFile] = []
    for path in sorted(memories_dir.glob("*.yaml")):
        raw = _load_yaml(path)
        if raw is None:
            continue
        parsed = _validate_or_die(PersonalMemoriesFile, raw, path)
        files.append(parsed)
        logger.info(
            "memories/%s: would insert %d personal memory entries for persona_key=%s",
            path.name,
            len(parsed.entries),
            parsed.persona_key,
        )
    return files


def load_pool(seeds_dir: Path) -> PoolFile | None:
    path = seeds_dir / "pool.yaml"
    if not path.exists():
        logger.info("pool.yaml not found at %s — skipping", path)
        return None
    raw = _load_yaml(path)
    if raw is None:
        return None
    parsed = _validate_or_die(PoolFile, raw, path)
    logger.info("pool.yaml: would insert %d pool memory entries", len(parsed.entries))
    return parsed


def load_timeline(seeds_dir: Path) -> TimelineFile | None:
    path = seeds_dir / "timeline.yaml"
    if not path.exists():
        logger.info("timeline.yaml not found at %s — skipping", path)
        return None
    raw = _load_yaml(path)
    if raw is None:
        return None
    parsed = _validate_or_die(TimelineFile, raw, path)
    logger.info("timeline.yaml: would insert %d timeline events", len(parsed.events))
    return parsed


def load_tasks(seeds_dir: Path) -> TasksFile | None:
    path = seeds_dir / "tasks.yaml"
    if not path.exists():
        logger.info("tasks.yaml not found at %s — skipping", path)
        return None
    raw = _load_yaml(path)
    if raw is None:
        return None
    parsed = _validate_or_die(TasksFile, raw, path)
    logger.info("tasks.yaml: would insert %d tasks", len(parsed.tasks))
    return parsed


def verify_db_connectivity(database_url: str) -> None:
    """Best-effort connection check. Optional in V0 — if asyncpg/psycopg are not
    installed, we just log and continue. V1 will hard-require this.
    """
    try:
        import psycopg  # type: ignore
    except ImportError:
        logger.info("psycopg not installed; skipping connectivity check (DATABASE_URL=%s)", database_url)
        return
    try:
        with psycopg.connect(database_url, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        logger.info("DB connectivity ok: %s", database_url)
    except Exception as exc:
        logger.warning("DB connectivity check failed: %s (continuing — V0 does not require live DB)", exc)


def run(workspace_name: str, seeds_dir: Path, database_url: str) -> int:
    logger.info("=== Relevo seed loader (V0 skeleton — no inserts) ===")
    logger.info("workspace_name=%r seeds_dir=%s database_url=%s", workspace_name, seeds_dir, database_url)

    if not seeds_dir.is_dir():
        logger.error("seeds_dir does not exist: %s", seeds_dir)
        return 2

    verify_db_connectivity(database_url)

    logger.info("Would create workspace: name=%r", workspace_name)
    load_personas(seeds_dir)
    load_personal_memories(seeds_dir)
    load_pool(seeds_dir)
    load_timeline(seeds_dir)
    load_tasks(seeds_dir)

    logger.info("=== Done. V1 will wire actual INSERTs. ===")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Relevo seed loader (V0 skeleton).")
    parser.add_argument("--workspace-name", required=True, help="Display name for the workspace to (eventually) create.")
    parser.add_argument(
        "--seeds-dir",
        default=str(REPO_ROOT_SEEDS),
        help=f"Directory containing seed YAMLs. Default: {REPO_ROOT_SEEDS}",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        help="Postgres connection string. Defaults to $DATABASE_URL or local docker-compose URL.",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    return run(
        workspace_name=args.workspace_name,
        seeds_dir=Path(args.seeds_dir),
        database_url=args.database_url,
    )


if __name__ == "__main__":
    sys.exit(main())
