# V0 — Sarf: schema migration + local Postgres + seed loader skeleton

This PR closes [task.md](task.md) for V0. It lands the canonical schema, gives the team a one-command local DB, and stubs the YAML→DB seed loader so Jorf/Jerf can drop seed files in later versions without re-architecting.

## What ships

- [migrations/0001_init.sql](migrations/0001_init.sql) — verbatim from [plan.md §1](plan.md#L57-L128). 7 tables, 2 enums, 4 custom indexes (HNSW + 3 btree), 1 CHECK constraint, pgvector extension. The V2 task→timeline trigger is **not** included (out of scope).
- [infra/docker-compose.yml](infra/docker-compose.yml) — single-service `pgvector/pgvector:pg16`, mounts `migrations/` into `/docker-entrypoint-initdb.d/` so the schema applies on first boot. Healthcheck via `pg_isready` so dependent services can wait on it.
- [infra/README.md](infra/README.md) — up / nuke / migrate-manually / run-loader recipes.
- [apps/server/src/relevo/seeds/](apps/server/src/relevo/seeds/) — the loader package:
  - `schemas.py`: Pydantic models for every seed YAML shape (`PersonasFile`, `PersonalMemoriesFile`, `PoolFile`, `TimelineFile`, `TasksFile`).
  - `loader.py`: CLI `python -m relevo.seeds.loader --workspace-name "demo"`. Validates each file, logs what it would insert, runs a best-effort DB connectivity probe. **No actual inserts** — that's V1.
- [seeds/__fixtures__/](seeds/__fixtures__/) — minimal valid YAML for every seed shape (1 persona, 2 personal memories, 2 pool entries, 2 timeline events, 2 tasks). Lets the loader be exercised locally and in CI without depending on Jorf's `personas.yaml` PR.
- [apps/server/pyproject.toml](apps/server/pyproject.toml) — adds `pydantic`, `pyyaml`, `asyncpg`, `psycopg[binary]` and a `setuptools` package layout pointing at `src/`.

## Verification

Done locally on a clean machine:

1. `docker compose -f infra/docker-compose.yml down -v && docker compose -f infra/docker-compose.yml up -d`
2. Healthcheck reports `healthy` within ~10s.
3. `\dt` shows 6 tables (`agent`, `memory_entry`, `person`, `task`, `timeline_event`, `workspace`); `\dT` shows the two enums.
4. `pg_extension` shows `vector 0.8.2` installed.
5. `\di` shows the 4 custom indexes plus pkeys.
6. `pip install -e apps/server` then `python -m relevo.seeds.loader --workspace-name "demo" --seeds-dir seeds/__fixtures__` runs to completion: connectivity ok, all 5 fixture files validated, expected counts logged.

## Implementation liberties (not specified by task.md)

These were judgment calls made during implementation. Flagging them so the team can override before V1 wires real inserts.

### 1. Loader location: `apps/server/src/relevo/seeds/loader.py` (not repo root)

Task gave a choice between `apps/server/seeds/loader.py` and `seeds/loader.py`. I went with `apps/server/src/relevo/seeds/loader.py` because the task's CLI spec is `python -m relevo.seeds.loader`, which only resolves cleanly if the module is reachable as `relevo.seeds.loader`. That requires it to live inside the `relevo` package under `apps/server/src/`.

A `seeds/` directory at repo root is preserved for the data files themselves (Jorf's `personas.yaml`, etc.) — only the loader code moved.

### 2. `pyproject.toml` package layout

`apps/server/pyproject.toml` previously had only `[project]` metadata. I added a `setuptools` `find` declaration pointing at `src/` so `pip install -e .` actually installs the `relevo` package. I picked setuptools (not poetry/hatch) because the existing file was already PEP 621 / setuptools-shaped and Narf hadn't picked a build backend yet.

If Narf prefers a different backend, swap freely — the `relevo/` source layout under `src/` is the only thing that matters for the loader CLI to work.

### 3. Pydantic model shapes

Task said "Pydantic models for each YAML shape so Jorf/Jerf get type errors when they author seeds wrong" but didn't spec the YAML shapes. I made these calls:

- **Personas use a string `key`** (e.g. `ada`) as a stable handle for cross-file references rather than UUIDs. Memories live in `seeds/memories/<key>.yaml`, tasks reference `owner_persona_key: ada`, etc. The loader will resolve keys → UUIDs at insert time in V1. This avoids forcing seed authors to invent UUIDs by hand.
- **`PersonalMemoriesFile` requires `persona_key`** at the top of the file in addition to the filename matching it. Belt-and-braces: filename can drift, the in-file key is the authoritative one.
- **`extra="forbid"` on every model.** Typos in seed files become validation errors instead of silently-dropped fields. If this is too strict for Jorf's iteration speed, relax to `ignore` later.
- **`TaskEntry.dependencies` is `list[str]`** of dependency *titles* (not UUIDs), matching the persona-key pattern. V1 resolves to UUIDs.

If any of these clash with how Jorf or Jerf want to author seeds, the schemas in [schemas.py](apps/server/src/relevo/seeds/schemas.py) are the only place to change.

### 4. V0 connectivity probe is best-effort, not required

Task said the loader needs to "connect to the DB via `DATABASE_URL`". I made the connection check best-effort: if `psycopg` isn't installed it logs and continues; if the connection fails it warns and continues. V0 has no inserts so a hard requirement felt premature, and it lets the loader be exercised in CI without spinning up Postgres. V1 will hard-require live DB.

### 5. Loader logs but does not validate cross-file references

The loader will happily accept `tasks.yaml` referencing `owner_persona_key: ada` even when `personas.yaml` doesn't define `ada`. Cross-file integrity belongs to V1's insert pass (where it can be enforced via FK constraints anyway). Calling this out so the team isn't surprised when V0 passes garbage through.

### 6. Fixture content uses an `Ada Lovelace` placeholder persona

The fixture YAMLs need *something* to validate against. I used a minimally-realistic placeholder (`Ada Lovelace` as a data-infra lead) rather than leaving the fixtures empty. These are pure validation fixtures — Jorf's real `seeds/personas.yaml` will be entirely separate and authored from scratch.

### 7. Container name is hardcoded to `relevo-postgres`

This is convenient for `docker exec relevo-postgres ...` recipes in the README but means you can't run two clones of this repo simultaneously without renaming. Acceptable tradeoff for hackathon ergonomics; revisit if it becomes a problem.

## Coordination notes for converge

- **`pyproject.toml`:** I added deps to the existing file in `apps/server/`. If Narf's branch also touches it, treat his FastAPI deps as additive and merge both lists. No structural conflict expected.
- **`apps/server/src/relevo/__init__.py`** is created as an empty file by this PR. If Narf's branch creates the same file, prefer his (he owns the package init).
- **`seeds/__fixtures__/`** is a Sarf-only path. Jorf's real `seeds/personas.yaml` lives one directory up and won't collide.

## Out of scope (deferred to V1+)

- Real INSERTs.
- Embedding writes (`memory_entry.embedding`).
- Cross-tier retrieval (`retrieve(workspace_id, query, tiers=[…], …)`).
- The `task` → `timeline_event` trigger (V2).
- FastAPI integration of the loader (Narf).
- Real seed YAML content (Jorf for personas, Jerf for memories).
