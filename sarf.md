# Sarf Deployment Instructions

This is the deployment handoff for the LangGraph multi-agent context network.
The old deployed Railway service is online, but it is running the previous API
shape until this branch is deployed.

## Current Production Check

Public server URL:

```text
https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app
```

Before redeploying, check what is currently live:

```bash
curl https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app/health
```

If `/health` returns `models.agent` and `models.router`, production is still on
the old server. The new server health response should expose:

```json
{
  "models": {
    "user_agent": "claude-code-sdk-session",
    "retriever": "claude-code-sdk-session",
    "updater": "claude-code-sdk-session"
  }
}
```

Also check the new global retriever endpoint:

```bash
curl -X POST https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app/global-ctx \
  -H "Authorization: Bearer dev-token-user1" \
  -H "Content-Type: application/json" \
  -d '{"query":"shared architecture"}'
```

Expected current-branch behavior: HTTP 200 with `context_exchange_id`.
If this returns 404, the new memory API is not deployed yet.

## Railway Service Variables

Set these on the FastAPI server service:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
AUTO_MIGRATE=1
AUTO_SEED=1
RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile
```

Railway normally injects `PORT`. If the service crashes with a missing `PORT`,
set:

```env
PORT=8000
```

Do not set `FORCE_SEED=1` unless you intentionally want to wipe and reseed demo
data. `AUTO_SEED=1` only seeds when `app_user` is empty.

## Deploy Current Code

Railway needs committed and pushed code. From the repo root:

```bash
git status --short --branch
git push -u origin feature/langgraph-multi-agent-context
```

Then deploy the code with Railway CLI:

```bash
railway login
railway link
railway up
```

Use `railway up` for new code. `railway redeploy` only redeploys the latest
already-uploaded deployment, so it will not pick up local source changes.

If Railway prompts for a service, choose the FastAPI/server service. If the
project has separate services for server and Postgres, do not deploy this code
to the Postgres service.

## Migration Behavior

The server startup hook runs these when enabled:

- `AUTO_MIGRATE=1` calls `ensure_schema()` and applies SQL files in
  `migrations/` in order.
- `AUTO_SEED=1` calls `seed_if_empty()` and loads `seeds/` only when there are
  no `app_user` rows.

The new deployment needs `migrations/0003_agent_memory_network.sql` applied.
It creates:

- `context_exchange`
- `agent_memory_event`
- `agent_memory_document`

## Post-Deploy Verification

After `railway up` completes, verify in this order:

```bash
curl https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app/health
```

Then:

```bash
curl -X POST https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app/global-ctx \
  -H "Authorization: Bearer dev-token-user1" \
  -H "Content-Type: application/json" \
  -d '{"query":"shared architecture"}'
```

Then targeted retrieval. Replace `TARGET_AGENT_ID` with User2's UUID from
`/bootstrap`:

```bash
curl -X POST https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app/agent-ctx \
  -H "Authorization: Bearer dev-token-user1" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"TARGET_AGENT_ID","query":"How is the server deployed?"}'
```

Finally, run the smoke scripts from a machine that can reach the deployed DB and
server:

```bash
SERVER_URL=https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app \
  uv run python apps/server/scripts/smoke_closure.py

SERVER_URL=https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app \
  uv run python apps/server/scripts/smoke_project_context.py
```

## Desktop Configuration

The desktop app should point at the deployed server:

```env
VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app
VITE_ENABLE_HEALTHCHECK=true
VITE_AUTH_TOKEN=dev-token-user1
VITE_LOCAL_REPO_PATH=/absolute/path/to/your/repo
```

The Anthropic API key is configured in the app settings panel, not in `.env`.

## Useful Railway References

- Deploy source code with `railway up`: https://docs.railway.com/cli/deploying
- Configure a non-root Dockerfile path: https://docs.railway.com/deploy/dockerfiles
- Configure service variables: https://docs.railway.com/variables
