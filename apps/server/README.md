# Relevo Server

FastAPI server for the V0 health endpoint.

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

## Configuration

Runtime configuration has a single code entrypoint: `relevo.config`.

The app reads commit metadata in this order:

1. `GIT_SHA`
2. `RAILWAY_GIT_COMMIT_SHA`
3. `dev`

Railway provides `RAILWAY_GIT_COMMIT_SHA` automatically for GitHub-triggered deploys, so no manual SHA variable is required per deploy.

The Docker entrypoint reads `PORT` from the environment. Railway provides it automatically.

## Docker

```sh
docker build -t relevo-server apps/server
docker run --rm -e PORT=8000 -e GIT_SHA=test-sha -p 8000:8000 relevo-server
curl http://localhost:8000/health
```

## Railway

Create a Railway service from this GitHub repo and set the service root directory to:

```txt
/apps/server
```

Railway will detect `Dockerfile` in that directory. Generate a public domain and set `/health` as the healthcheck path.

Verify:

```sh
curl https://<railway-url>/health
```

The deployed response should include a real SHA through Railway's built-in `RAILWAY_GIT_COMMIT_SHA`.
