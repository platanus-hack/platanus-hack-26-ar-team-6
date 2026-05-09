# Local Infrastructure

This directory hosts the local Postgres+pgvector environment used for development. Production deploys to Railway (see [`infra/railway.json`](railway.json)) — same schema, same `0001_init.sql`.

## Prerequisites

- Docker + Docker Compose v2 (`docker compose` not `docker-compose`)
- Python 3.11+ (for the seed loader)

## One-time setup

From the repo root:

```bash
docker compose -f infra/docker-compose.yml up -d
```

On first boot the container runs every `*.sql` in `migrations/` automatically (mounted at `/docker-entrypoint-initdb.d`). That gives you a clean DB with the schema applied.

Verify it's up:

```bash
docker compose -f infra/docker-compose.yml ps
docker exec -it relevo-postgres psql -U relevo -d relevo -c "\dt"
```

You should see the seven tables: `agent`, `memory_entry`, `person`, `task`, `timeline_event`, `workspace`, plus pg's own metadata.

## Default credentials (dev only)

| field    | value    |
|----------|----------|
| host     | localhost|
| port     | 5432     |
| user     | relevo   |
| password | relevo   |
| db       | relevo   |

Default `DATABASE_URL`:

```
postgresql://relevo:relevo@localhost:5432/relevo
```

These creds are fine for local dev only. Never reuse them anywhere shared.

## Apply migrations

The server can apply versioned migrations automatically on startup when
`AUTO_MIGRATE=1` is set. For a local one-off run without starting the server:

```bash
cd apps/server
uv run python -c "from relevo.admin import ensure_schema; ensure_schema()"
```

Existing demo DBs without `schema_migration` are baselined at `0001`, then
receive later migrations such as `0002_v3_project_context.sql`.

## Nuke + reset the DB

`down -v` removes the named volume, so the next `up -d` re-runs the init scripts against an empty DB.

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
```

## Run the seed loader (V0 — logs only, no inserts)

The loader validates seed YAMLs against the Pydantic schemas in [`apps/server/src/relevo/seeds/schemas.py`](../apps/server/src/relevo/seeds/schemas.py) and logs what it would insert. V1 wires real inserts.

From `apps/server/`:

```bash
pip install -e .
python -m relevo.seeds.loader --workspace-name "demo" --seeds-dir ../../seeds/__fixtures__
```

Pointing it at `seeds/__fixtures__/` is what runs in CI / for local sanity checks until Jorf authors the real `seeds/personas.yaml` etc. To run against the real seeds (once they exist):

```bash
python -m relevo.seeds.loader --workspace-name "demo" --seeds-dir ../../seeds
```

Override the DB URL with `--database-url` or `$DATABASE_URL`. In V0 a connectivity probe runs but isn't required to pass.
