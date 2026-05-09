# Relevo Server

FastAPI server for the cross-user context workflow. See [`src/relevo/DATABASE.md`](src/relevo/DATABASE.md)
for the storage decisions and the data-access contract the local app builds against.

## Local run

```sh
cd apps/server
uv sync
uv run uvicorn relevo.main:app --reload --port 8000
```

If `uv` is not installed:

```sh
cd apps/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
uvicorn relevo.main:app --reload --port 8000
```

Check the endpoint:

```sh
curl http://localhost:8000/health
```

Expected local response:

```json
{
  "status": "ok",
  "sha": "dev",
  "models": {
    "agent": "sonnet-4-6",
    "router": "haiku-4-5-20251001"
  }
}
```

## V2 endpoints

Every endpoint except `/health` expects a per-user bearer token:

```sh
Authorization: Bearer dev-token-user1
```

The seeded demo tokens are `dev-token-user1` and `dev-token-user2`.

Bootstrap:

```sh
curl -H 'Authorization: Bearer dev-token-user1' \
  http://localhost:8000/bootstrap
```

Cross-user context request:

```sh
curl -X POST http://localhost:8000/request-context \
  -H 'Authorization: Bearer dev-token-user1' \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "<user2 uuid from bootstrap roster>",
    "question": "How is the shared server deployed, what auth does the local app use, and what health endpoint should I check before the demo?"
  }'
```

The response includes:

```json
{
  "answer": "...",
  "source_user_ids": ["<user2 uuid>"],
  "target_user_id": "<user2 uuid>",
  "context_entry_id": "<materialized cross_user_qa row>",
  "retrieved_context_entries": []
}
```

Persist the prompting user's final prompt+answer:

```sh
curl -X POST http://localhost:8000/context-entries \
  -H 'Authorization: Bearer dev-token-user1' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "How is the shared server deployed?",
    "final_answer": "FastAPI on Railway; check /health."
  }'
```

Both dashed and underscored route names are mounted for client compatibility:
`/request-context`, `/request_context`, `/context-entries`, and
`/context_entries`.

## Seed and smoke test

With local Postgres running:

```sh
docker compose -f infra/docker-compose.yml up -d
docker exec -i relevo-postgres psql -U relevo -d relevo < migrations/0001_init.sql
cd apps/server
uv run python -m relevo.seeds.loader
uv run uvicorn relevo.main:app --reload --port 8000
```

If the database already has old tables, recreate the local DB before applying
the edited `0001_init.sql`.

After a `request-context` call, prove the closure write:

```sql
SELECT asking.display_name AS asking_user,
       target.display_name AS target_user,
       q.question,
       q.answer,
       c.kind
FROM qa_ledger q
JOIN app_user asking ON asking.id = q.asking_user_id
JOIN app_user target ON target.id = q.target_user_id
JOIN context_entry c ON c.id = q.context_entry_id
ORDER BY q.created_at DESC
LIMIT 1;
```

## Configuration

Runtime configuration has a single code entrypoint: `relevo.config`.

The app reads commit metadata in this order:

1. `GIT_SHA`
2. `RAILWAY_GIT_COMMIT_SHA`
3. `dev`

Railway provides `RAILWAY_GIT_COMMIT_SHA` automatically for GitHub-triggered deploys, so no manual SHA variable is required per deploy.

The Docker entrypoint reads `PORT` from the environment. Railway provides it automatically.

On-demand agent defaults for V2:

| Variable | Default |
|---|---|
| `ON_DEMAND_AGENT_MODEL` | `claude-sonnet-4-6` |
| `ON_DEMAND_AGENT_MAX_TOKENS` | `1200` |
| `ON_DEMAND_AGENT_TIMEOUT_SECONDS` | `20` |
| `ON_DEMAND_RETRIEVAL_TOP_K` | `6` |

Live on-demand calls use the Anthropic Python SDK, which reads
`ANTHROPIC_API_KEY` from the environment.

## Docker

```sh
docker build -f apps/server/Dockerfile -t relevo-server .
docker run --rm -e PORT=8000 -e GIT_SHA=test-sha -p 8000:8000 relevo-server
curl http://localhost:8000/health
```

## Railway

Create a Railway service from this GitHub repo. Use the repo root as the
service root and set this service variable so Railway uses the server
Dockerfile:

```txt
RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile
```

The Docker build needs the repo root because the image copies `migrations/`
and `seeds/` into the container for first boot. Generate a public domain and
set `/health` as the healthcheck path.

Add a Railway Postgres service and set the server service `DATABASE_URL` to
the Postgres connection string. If you want live LLM synthesis instead of the
retrieved-context fallback, set `ANTHROPIC_API_KEY` and optionally
`ANTHROPIC_MODEL`. Without those variables, `/request-context` still works and
returns an extractive answer from retrieved rows.

For a fresh hackathon DB, set these variables on the server service:

```txt
AUTO_MIGRATE=1
AUTO_SEED=1
```

On startup, the server applies `migrations/0001_init.sql` only if the database
is empty, then seeds the demo users if no users exist. Do not point this at an
old partial database; recreate the DB or migrate it manually.

Verify:

```sh
curl https://<railway-url>/health
```

The deployed response should include a real SHA through Railway's built-in `RAILWAY_GIT_COMMIT_SHA`.
