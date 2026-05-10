# Relevo Server

FastAPI server for Google/account login, project membership, bootstrap, and the
LangGraph multi-agent memory network. See
[`src/relevo/DATABASE.md`](src/relevo/DATABASE.md) for storage details.

## Local Run

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
    "user_agent": "claude-code-sdk-session",
    "retriever": "vector-retrieval-client",
    "updater": "claude-code-sdk-session"
  }
}
```

## Vector Retrieval Config

Fast retrieval uses pgvector-backed `memory_chunk` rows. Configure embeddings
with:

```sh
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

If `OPENAI_API_KEY` is missing, reads fall back to lexical source-table
retrieval instead of returning 500s.

Backfill existing rows after applying migrations:

```sh
cd apps/server
uv run python scripts/backfill_memory_chunks.py --batch-size 25 --max-batches 20
```

## Auth and Endpoints

Every endpoint except `/health` expects either a Relevo account session token or
a legacy seeded `app_user.auth_token`.

Account sessions come from Google login:

```txt
GET  /auth/google/start?desktop_redirect_uri=relevo://auth/callback
GET  /auth/google/callback
POST /auth/desktop/exchange
POST /auth/logout
```

Account/project routes:

```txt
GET  /me/projects
POST /projects
DELETE /projects/{project_id}
POST /projects/{project_id}/members
```

Legacy demo tokens still work:

```sh
Authorization: Bearer dev-token-user1
```

The seeded demo tokens are `dev-token-user1` and `dev-token-user2`.

Bootstrap:

```sh
curl -H 'Authorization: Bearer dev-token-user1' \
  http://localhost:8000/bootstrap
```

Session-token bootstrap is project-scoped:

```sh
curl -H 'Authorization: Bearer <session-token>' \
  'http://localhost:8000/bootstrap?project_id=<project uuid>'
```

Agent-owned context compatibility route:

```sh
curl -X POST http://localhost:8000/agent-ctx \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Project-Id: <project uuid for account sessions>' \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_id": "<agent uuid from bootstrap roster>",
    "query": "How is the server deployed?"
  }'
```

Project-global context:

```sh
curl -X POST http://localhost:8000/global-ctx \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Project-Id: <project uuid for account sessions>' \
  -H 'Content-Type: application/json' \
  -d '{"query": "shared deployment decisions"}'
```

Vector retrieval client:

```sh
curl -X POST http://localhost:8000/retrieve-context \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Project-Id: <project uuid for account sessions>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "How is the server deployed?",
    "target_agent_ids": ["<optional agent uuid>"],
    "limit": 6,
    "metadata": {}
  }'
```

Updater memory commit:

```sh
curl -X POST http://localhost:8000/memory-updates \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Project-Id: <project uuid for account sessions>' \
  -H 'Content-Type: application/json' \
  -d '{
    "chat_session_id": "workspace-1",
    "checkpoint_index": 1,
    "operations": [
      {
        "author_agent_id": "<agent uuid>",
        "importance": "local",
        "document_key": "chat-summary",
        "event_content": "The agent learned how deployment works.",
        "canonical_content": "Deployment runs on Railway."
      }
    ]
  }'
```

The old `/request-context` and `/context-entries` routes are intentionally not
mounted.

Claude Code activity ingest:

```sh
curl -X POST http://localhost:8000/claude-code/activity \
  -H 'Authorization: Bearer <token>' \
  -H 'X-Project-Id: <project uuid for account sessions>' \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "claude-session-id",
    "checkpoint_index": 1,
    "cwd": "/path/to/project",
    "prompt": "Implement the hook.",
    "final_answer": "Implemented the hook.",
    "changed_files": [".claude/hooks/relevo_activity.py"]
  }'
```

The desktop app installs this hook when a user connects a local project folder.
It creates or updates `.claude/settings.json`, writes
`.claude/hooks/relevo_activity.py`, stores hook credentials under the Electron
user data directory instead of inside the repo, and posts changed Claude Code
sessions here. The hook records the submitted prompt, captures the final
assistant answer from Claude's transcript on `Stop`, and filters `.env`,
`.relevo`, common key/cert files, and secret folders from file-change metadata.
The desktop settings panel can disable this tracking; disabling removes only
Relevo hook commands from connected folders.

For hook debugging, launch Claude Code with `RELEVO_CLAUDE_HOOK_DEBUG=1`.

## Seed and Migrate

With local Postgres running:

```sh
docker compose -f infra/docker-compose.yml up -d
cd apps/server
uv run python -c "from relevo.admin import ensure_schema; ensure_schema()"
uv run python -m relevo.seeds.loader
```

`AUTO_MIGRATE=1` applies every SQL file in `migrations/` in order. Existing
demo databases that predate migration tracking are baselined at `0001`, then
receive later migrations. The LangGraph memory tables live in
`0004_agent_memory_network.sql` because main already has
`0003_accounts_projects_login.sql` and the migration runner keys applied
migrations by numeric prefix. The vector retrieval chunk/index layer lives in
`0005_vector_retrieval.sql`.

## Configuration

Runtime configuration has a single code entrypoint: `relevo.config`.

The app reads commit metadata in this order:

1. `GIT_SHA`
2. `RAILWAY_GIT_COMMIT_SHA`
3. `dev`

Railway provides `RAILWAY_GIT_COMMIT_SHA` automatically for GitHub-triggered
deploys. The Docker entrypoint reads `PORT`; Railway provides it automatically.

Google OAuth defaults:

| Variable | Default |
|---|---|
| `GOOGLE_CLIENT_ID` | empty |
| `GOOGLE_CLIENT_SECRET` | empty |
| `GOOGLE_REDIRECT_URI` | generated from `/auth/google/callback` |
| `GOOGLE_AUTH_URL` | `https://accounts.google.com/o/oauth2/v2/auth` |
| `GOOGLE_TOKEN_URL` | `https://oauth2.googleapis.com/token` |
| `GOOGLE_USERINFO_URL` | `https://openidconnect.googleapis.com/v1/userinfo` |
| `GOOGLE_OAUTH_STATE_TTL_SECONDS` | `600` |
| `DESKTOP_LOGIN_EXCHANGE_TTL_SECONDS` | `120` |
| `ACCOUNT_SESSION_TTL_SECONDS` | `2592000` |

For Railway, create a Google OAuth Client ID with application type **Web
application**. Add this authorized redirect URI exactly:

```txt
https://<railway-domain>/auth/google/callback
```

Then set these Railway variables on the server service:

```txt
GOOGLE_CLIENT_ID=<client id from Google Cloud>
GOOGLE_CLIENT_SECRET=<client secret from Google Cloud>
GOOGLE_REDIRECT_URI=https://<railway-domain>/auth/google/callback
```

The desktop redirect remains `relevo://auth/callback`; it is passed to the
server as `desktop_redirect_uri` and is not registered as the Google OAuth
redirect URI.

## Docker

```sh
docker build -f apps/server/Dockerfile -t relevo-server .
docker run --rm -e PORT=8000 -e GIT_SHA=test-sha -p 8000:8000 relevo-server
curl http://localhost:8000/health
```

## Railway

Create a Railway service from this GitHub repo. Use the repo root as the
service root and point Railway at [`infra/railway.json`](../../infra/railway.json)
or set:

```txt
RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile
```

The Docker build needs the repo root because the image copies `migrations/` and
`seeds/` into the container for first boot. Generate a public domain and set
`/health` as the healthcheck path.

Add a Railway Postgres service and set the server service `DATABASE_URL` to the
Postgres connection string.

For a fresh hackathon DB, set these variables on the server service:

```txt
AUTO_MIGRATE=1
AUTO_SEED=1
```

Keep `AUTO_MIGRATE=1` on for the deployed server. `AUTO_SEED=1` only inserts
demo seeds when no users exist, unless `FORCE_SEED=1` is also set.

Verify:

```sh
curl https://<railway-url>/health
```

The deployed response should include a real SHA through Railway's built-in
`RAILWAY_GIT_COMMIT_SHA`.
