# V0 — Sarf: Schema migration + local Postgres + seed loader skeleton

**Owner:** Sarf
**Branch:** `v0/sarf-data-migrations`
**Deadline:** h2 (migration merged) / h4 converge
**Depends on:** nothing — this branch is self-contained

## Goal

Land the canonical schema for the project, give the team a one-command local Postgres+pgvector environment, and stub the YAML→DB seed loader so Jorf/Jerf can drop seed files in later versions without re-architecting.

## Deliverables

1. **`migrations/0001_init.sql`** — exactly the schema in `plan.md` §1. Includes:
   - `CREATE EXTENSION vector`
   - Tables: `workspace`, `person`, `agent`, `memory_entry`, `task`, `timeline_event`
   - Enums: `memory_tier`, `task_status`
   - Indexes: HNSW on `memory_entry.embedding`, `(workspace_id, tier)`, partial index on `agent_id`, `(workspace_id, occurred_at DESC)` on timeline
   - The `CHECK` constraint on `memory_entry` tier/agent_id consistency

   Triggers (`task` → `timeline_event`) are V2 — do **not** include yet.

2. **`infra/docker-compose.yml`** for local dev:
   - Service: `postgres` using `pgvector/pgvector:pg16` (or equivalent image with pgvector preinstalled).
   - Exposes `5432` on host.
   - Mounts `./migrations` and runs `0001_init.sql` on first boot via `/docker-entrypoint-initdb.d/`.
   - Healthcheck so other services can wait on it.
   - Default creds for dev only: `relevo / relevo / relevo` (user/pass/db) — document in README.

3. **`apps/server/seeds/loader.py`** skeleton (or `seeds/loader.py` if Sarf prefers it at repo root — pick one and document it):
   - Reads YAML files from `seeds/` (`personas.yaml`, `memories/<agent>.yaml`, `pool.yaml`, `timeline.yaml`, `tasks.yaml`).
   - For V0, it just needs to: connect to the DB via `DATABASE_URL`, parse YAML, and **log what it would insert** (no actual inserts required yet — V1 wires real inserts).
   - CLI: `python -m relevo.seeds.loader --workspace-name "demo"`.
   - Pydantic models for each YAML shape so Jorf/Jerf get type errors when they author seeds wrong.

4. **README section** in `infra/README.md` (new file):
   - `docker compose -f infra/docker-compose.yml up -d`
   - How to apply migrations manually if compose init didn't run them
   - How to nuke + reset the DB (`docker compose down -v`)
   - How to run the loader against the local DB

## Out of scope for this branch

- No actual seed YAML content (Jorf authors `personas.yaml` on his branch; Sarf's loader skeleton just needs to parse a fixture during dev).
- No FastAPI integration (Narf's branch).
- No real DB inserts — that's V1.
- No embedding writes — V1.

## Definition of done

- [ ] `migrations/0001_init.sql` applies cleanly to a fresh Postgres+pgvector instance.
- [ ] `docker compose up -d` from a clean clone gives a working DB with the schema applied.
- [ ] `python -m relevo.seeds.loader --workspace-name demo` runs end-to-end against a tiny fixture YAML in `seeds/__fixtures__/` (Sarf creates this fixture; Jorf will replace with the real file later).
- [ ] `infra/README.md` documents the local-dev loop.
- [ ] PR opened against `main`.

## Notes

- This branch creates files under `migrations/`, `infra/`, `seeds/__fixtures__/`, and `apps/server/src/relevo/seeds/` (or wherever the loader lives — Sarf decides). It does **not** create `apps/server/src/relevo/main.py` (Narf owns that file).
- If Sarf and Narf both end up creating `apps/server/pyproject.toml`, resolve at converge — Narf merges first, Sarf adds his deps (`asyncpg`, `pyyaml`, `pydantic`) on top. Coordinate verbally; do not block on it.
- The schema in `plan.md` is the source of truth. If Sarf wants to deviate, raise it before writing SQL.
