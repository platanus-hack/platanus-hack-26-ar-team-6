# Database (V2) — Sarf

This document records the storage decisions and the contract Narf and
Jerf depend on. If you change anything here, sync with them.

## Decisions locked for the demo

1. **Backend: Postgres + pgvector**, single store. No graph DB, no graph
   table. Graph-RAG is a V3 question, not a V2 blocker.
2. **Per-user partitioning: single table + `user_id` discriminator**. One
   `context_entry` table with a `user_id` foreign key. pgvector indexes
   cover all users; queries filter by `user_id`. Schema-per-user was
   considered and rejected (it makes roster queries cross-schema).
3. **Cross-user Q&A storage: both `context_entry` and `qa_ledger`**.
   The closure invariant is satisfied by writing a
   `context_entry(kind='cross_user_qa')` row on the *queried* user's
   `user_id` whenever `/request-context` resolves a per-user target.
   The same transaction writes a `qa_ledger` row for simple audit/demo
   queries.
4. **Embedding model: deferred to V2** (joint with Jorf). The
   `embedding vector(1024)` column exists on both context tables and is
   nullable. **No HNSW index is created yet** because the dimension may
   change in V2; V2's first task is to lock the model, run a migration to
   set the correct dimension, and create the index.

## Schema

See [`migrations/0001_init.sql`](../../../../migrations/0001_init.sql).

Tables:

- **`project`** — one row in V1. Other tables FK to it.
- **`app_user`** — one row per user. Holds `auth_token` (Narf's bearer
  auth), `domain_summary` (one-line role description), and `profile`
  JSONB (denormalized voice + domain blocks for Jorf's on-demand agent).
- **`context_entry`** — per-user content. `kind` is one of `seed`,
  `prompt_answer`, `cross_user_qa`. Append-only.
- **`project_context_entry`** — same shape as `context_entry`, but
  scoped to the project. Read by V3's `target="project"` flow; V2 just
  seeds rows.
- **`qa_ledger`** — append-only cross-user Q&A audit table. Each row points
  at the materialized target-user `context_entry` through
  `context_entry_id`.

## Data-access layer

Narf calls into [`relevo.db`](db.py). The functions there are the only
place that should issue SQL.

Key functions and their return shapes:

- `get_bootstrap(conn, user_id) -> dict` — returns
  `{user, project, roster, recent_entries}`. This is what Narf's
  `/bootstrap` endpoint serializes. Marirf renders the roster; Jorf's
  local-AI prompt embeds the user, project, and roster into the AI's
  initial context.
- `get_user_by_token(conn, token) -> dict | None` — Narf's auth
  middleware uses this.
- `get_user_directory(conn, project_id) -> list[dict]` — Jerf's eval
  fixtures and the roster both consume this.
- `write_prompt_answer_entry(conn, user_id, prompt, final_answer, …) -> UUID`
  — Narf's `POST /context-entries` writes through this.
- `write_cross_user_qa_entry(conn, target_user_id, asker_user_id, question, answer, …) -> UUID`
  — `POST /request-context` writes through this. It creates the target
  user's `context_entry(kind='cross_user_qa')`, creates the `qa_ledger`
  row, annotates the context metadata with `qa_ledger_id`, commits, and
  returns the context entry id.

## Seeds

Seed YAMLs live under [`seeds/`](../../../../seeds):

- `seeds/project.yaml` — single project + project-context entries.
- `seeds/users.yaml` — users with auth tokens (`dev-token-user1`,
  `dev-token-user2`) and domain blocks.
- `seeds/context/<user_key>.yaml` — per-user context entries. Two are
  shipped: `user1.yaml` (frontend) and `user2.yaml` (deployment). They
  are deliberately non-overlapping so V2's cross-user `request_context`
  flow has something to demonstrate.
- `seeds/LOCK.md` — demo prompt, routing expectation, and SQL snippets for
  proving the closure write.

## How to load seeds

```sh
# 1. Bring up Postgres + apply the migration
docker compose -f infra/docker-compose.yml up -d

# 2. Install the server package (creates the venv if needed)
cd apps/server
uv sync   # or: python -m pip install -e .

# 3. Run the seed loader
uv run python -m relevo.seeds.loader
```

The loader TRUNCATEs all data tables before inserting; pass
`--keep-existing` to skip the wipe.

## Remaining V2 handoff

1. Sarf+Jorf lock the embedding model. Edit the migration before deploy, if needed,
   alters `vector(1024)` to the correct dimension.
2. Create the HNSW index on `embedding`.
3. Add a backfill pass that re-embeds existing rows.
4. Narf wires `write_cross_user_qa_entry` into the real `/request-context`
   route after Jorf returns an answer.
