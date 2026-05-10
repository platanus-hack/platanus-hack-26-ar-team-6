# Omni

<img src="./apps/desktop/src/renderer/src/components/logo/Group%2047.png" alt="Omni octopus logo" width="180" />

Omni is a shared memory layer for teams working with local AI agents. Each
person keeps using their own assistant, while Omni captures useful context from
those sessions and makes it available to the rest of the team in real time.

Built during Platanus Hack 2026 in 36 hours.

## Why it exists

AI agents are already part of day-to-day engineering work, but most of their
context stays trapped in one person's local chat. Decisions, blockers, and
progress updates end up scattered across assistants, messages, pull requests,
and notes.

Omni turns that fragmented activity into a project memory that other people and
agents can query. If someone is away, their context is still available. If an
agent needs to know what another teammate decided, where a task stopped, or what
changed in another part of the project, it can ask Omni instead of guessing.

## What it does

- Captures assistant activity: prompts, final answers, changed file lists, and
  memory updates.
- Builds a shared project memory from individual agent sessions.
- Lets agents retrieve teammate-specific or project-wide context.
- Shows per-user responsibility summaries inferred from recent activity.
- Provides a task board with manual tasks and AI suggestions based on retrieved
  context.
- Shows a timeline of per-user activity summaries and checkpoints.
- Visualizes a graph of agents, memory documents, events, and context lookups.

## How it works

1. A teammate connects a local project folder in the Omni desktop app.
2. The desktop app installs a Claude Code activity hook into that folder.
3. Claude Code sessions send prompt, answer, checkpoint, and changed-file
   activity to the server.
4. The server stores project, account, memory, task, and team-pulse data.
5. Retrieval endpoints expose teammate-owned and project-global context.
6. The desktop app uses that context for chat, tasks, responsibilities,
   timeline, and graph views.

## Tech stack

- Desktop: Electron, Vite, React, TypeScript, LangGraph, Claude Agent SDK
- Server: FastAPI, Python, Pydantic, PostgreSQL, pgvector
- Auth: Google OAuth for account sessions, with legacy demo tokens for local use
- Retrieval: vector search when embeddings are configured, lexical fallback when
  they are not
- Deployment: Railway server service with local Docker Compose infrastructure

## Repository layout

```txt
apps/
  desktop/        Electron desktop app and local agent runtime
  server/         FastAPI API, auth, memory, retrieval, and migrations
eval/             Retrieval evaluation fixtures and runner
infra/            Local Postgres + pgvector and Railway config
migrations/       Versioned SQL migrations
prompts/          Agent system prompts and prompt contract tests
seeds/            Demo seed data
project-description.md
platanus-hack-project.json
```

## Quick start

### 1. Start local infrastructure

```sh
docker compose -f infra/docker-compose.yml up -d
```

### 2. Start the server

```sh
cd apps/server
uv sync
AUTO_MIGRATE=1 uv run uvicorn relevo.main:app --reload --port 8000
```

Check that it is healthy:

```sh
curl http://localhost:8000/health
```

### 3. Start the desktop app

```sh
cd apps/desktop
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

In the app, sign in, select or create a project, connect a local project folder,
configure an Anthropic API key from settings, and start chatting.

## Configuration

Desktop environment:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_ENABLE_HEALTHCHECK=true
```

Server environment commonly used in development:

```env
DATABASE_URL=postgresql://relevo:relevo@localhost:5432/relevo
AUTO_MIGRATE=1
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

If `OPENAI_API_KEY` is not set, the server falls back to lexical retrieval
instead of failing vector-backed context requests.

## Useful commands

Server:

```sh
cd apps/server
uv run pytest
uv run python -c "from relevo.admin import ensure_schema; ensure_schema()"
uv run python -m relevo.seeds.loader
```

Desktop:

```sh
cd apps/desktop
npm run lint
npm run typecheck
npm test
npm run build
```

## Key API routes

- `GET /health` checks server health.
- `GET /auth/google/start` starts Google login for the desktop app.
- `POST /auth/desktop/exchange` exchanges the desktop callback code for a
  session.
- `GET /me/projects` lists the signed-in user's projects.
- `POST /projects` creates a project.
- `POST /agent-ctx` retrieves context for a specific agent.
- `POST /global-ctx` retrieves project-wide context.
- `POST /retrieve-context` runs vector or lexical context retrieval.
- `POST /memory-updates` commits new memory operations.
- `POST /claude-code/activity` ingests Claude Code session activity.

See [apps/server/README.md](./apps/server/README.md) for detailed curl examples.

## Security notes

- Session tokens are stored in Electron main-process settings and are not
  exposed to the renderer.
- Anthropic API keys are configured in the desktop settings panel and encrypted
  with Electron `safeStorage` when the operating system supports it.
- Claude Code hook credentials are stored under the desktop app user-data
  directory, not in the connected project folder.
- The activity hook filters `.env`, `.relevo`, common key and certificate files,
  and secret folders from file-change metadata.

## Demo deploy

The hackathon deployment is configured in
[platanus-hack-project.json](./platanus-hack-project.json):

```txt
https://platanus-hack-26-ar-team-6-copy-production-5a85.up.railway.app
```

## Team

- Francisco Nattero ([@fnattero](https://github.com/fnattero))
- Jeremias Figueiredo ([@jerecoder](https://github.com/jerecoder))
- Santiago Barron ([@1337XxXSaNtIbArRoNXxX1337](https://github.com/1337XxXSaNtIbArRoNXxX1337))
- Mariia Osipova ([@mariia-osipova](https://github.com/mariia-osipova))
- Juan Kaplan ([@juan-kaplan](https://github.com/juan-kaplan))
