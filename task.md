# V0 — Narf: Server scaffold + /health + Railway deploy

**Owner:** Narf
**Branch:** `v0/narf-server-health`
**Deadline:** h3 (URL posted to team chat) / h4 converge
**Depends on:** nothing — this branch is self-contained

## Goal

Stand up the FastAPI server skeleton, deploy it to Railway, and expose a `/health` endpoint that other team members can hit during V0 (Marf will point the desktop app at it). No business logic yet.

## Deliverables

1. **Server scaffold** at `apps/server/` with this layout:
   ```
   apps/server/
   ├── src/relevo/
   │   ├── __init__.py
   │   ├── main.py            # FastAPI app entrypoint
   │   └── api/
   │       ├── __init__.py
   │       └── health.py      # /health route
   ├── pyproject.toml         # fastapi, uvicorn, pydantic
   └── README.md              # how to run locally
   ```

2. **`/health` endpoint** — `GET /health` returns:
   ```json
   {
     "status": "ok",
     "sha": "<git sha at build time>",
     "models": {
       "agent": "sonnet-4-6",
       "router": "haiku-4-5-20251001"
     }
   }
   ```
   - `sha` should come from an env var (`GIT_SHA`) injected at build/deploy time; fall back to `"dev"` locally.
   - Model versions hardcoded for V0; will become config later.

3. **CORS** — permissive for V0 (`allow_origins=["*"]`) so the Electron app can hit it without ceremony.

4. **Railway deploy**
   - Create the Railway project, link this repo's `apps/server/` directory.
   - Provide a `Dockerfile` or `railway.json` (whichever Narf prefers — Dockerfile recommended for control).
   - Inject `GIT_SHA` from Railway's commit metadata.
   - Confirm public URL responds with the JSON above.
   - Post the URL in the team chat by **h3**.

5. **Local run instructions** in the server README:
   ```
   cd apps/server
   uv sync   # or pip install -e .
   uvicorn relevo.main:app --reload --port 8000
   curl localhost:8000/health
   ```

## Out of scope for this branch

- No DB connection (Sarf's branch handles migrations/docker-compose).
- No auth, no `/workspaces`, no SSE — those land in V1.
- No tests required for V0 beyond a manual `curl` of `/health`.

## Definition of done

- [ ] `apps/server/` scaffold committed.
- [ ] `curl https://<railway-url>/health` returns the JSON above with a real sha.
- [ ] Railway URL posted in team chat.
- [ ] Local `uvicorn` run works on a fresh clone.
- [ ] PR opened against `main`, ready for V0 converge merge.

## Notes

- This branch creates only files under `apps/server/` (and optionally `infra/railway.json` if Narf goes that route). No collisions with other V0 branches.
- Marf's branch will point the desktop app at the Railway URL via an env var; coordinate the URL handoff but no code dependency.
