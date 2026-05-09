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
4. **Embedding model: `text-embedding-3-small`** (Jorf V2 default). Nullable
   embedding columns on both context tables use `vector(1536)`. **No HNSW
   index exists yet**; create it only after embeddings are backfilled.
5. **Project-target Q&A storage: both `project_context_entry` and
   `project_qa_ledger`**. `target="project"` writes
   `project_context_entry(kind='project_qa')` plus an audit row in
   `project_qa_ledger`. The user-target `qa_ledger` FK constraints stay
   unchanged.
6. **Google account login is separate from project persona**. `account` is
   the real login identity. `app_user` remains the project-scoped membership
   and persona row, so one Google account can have different `app_user.id`,
   `role`, and `domain_summary` in different projects.

## Schema

See [`migrations/0001_init.sql`](../../../../migrations/0001_init.sql),
[`migrations/0002_v3_project_context.sql`](../../../../migrations/0002_v3_project_context.sql),
and [`migrations/0003_accounts_projects_login.sql`](../../../../migrations/0003_accounts_projects_login.sql).

Tables:

- **`project`** — one row for the demo. Other tables FK to it.
- **`account`** — Google login identity with `google_sub`, email fields,
  display name, avatar, verification flag, creation time, and last login.
- **`account_session`** — opaque account sessions. Only `token_hash` is stored;
  raw session tokens exist only in the client and request headers.
- **`oauth_login_state`** — short-lived Google OAuth state records containing
  CSRF state plus desktop redirect information.
- **`desktop_login_exchange`** — short-lived one-time codes returned to the
  desktop deep link and exchanged for an account session.
- **`schema_migration`** — versioned SQL migration history. Existing demo DBs
  that predate this table are baselined at `0001`, then receive `0002` and
  later migrations through `AUTO_MIGRATE=1`.
- **`app_user`** — one row per project membership/persona. Holds optional
  legacy `auth_token`, optional `account_id`, `role`, `domain_summary`, and
  `profile` JSONB. `(project_id, account_id)` is unique for non-null
  `account_id`, and legacy `auth_token` stays unique only when non-null.
- **`context_entry`** — per-user content. `kind` is one of `seed`,
  `prompt_answer`, `cross_user_qa`, `project_qa`. Append-only. `project_qa`
  is only used by `project_context_entry`.
- **`project_context_entry`** — same shape as `context_entry`, but
  scoped to the project. Read and appended by V3's `target="project"` flow.
- **`qa_ledger`** — append-only cross-user Q&A audit table. Each row points
  at the materialized target-user `context_entry` through
  `context_entry_id`.
- **`project_qa_ledger`** — append-only project-target Q&A audit table. Each
  row points at the materialized project `project_context_entry`.

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
  middleware uses this for legacy seeded tokens.
- `get_account_by_session_token(conn, token) -> dict | None` — account-session
  auth path. It hashes the supplied opaque token and ignores expired or revoked
  sessions.
- `get_project_memberships_for_account(conn, account_id) -> list[dict]` —
  returns the project picker rows: project id/name/description plus membership
  `user_id`, `display_name`, `domain_summary`, and `role`.
- `get_project_membership_for_account(conn, account_id, project_id) -> dict | None`
  — resolves the current account's `app_user` membership for a selected project.
- `create_project_for_account(conn, account_id, name, ...) -> dict` — creates a
  project and the account's first `leader` membership.
- `add_existing_account_to_project(conn, project_id, account_id, ...) -> dict`
  — creates a `member` membership for an account that already exists.
- `get_user_directory(conn, project_id) -> list[dict]` — Jerf's eval
  fixtures and the roster both consume this.
- `write_prompt_answer_entry(conn, user_id, prompt, final_answer, …) -> UUID`
  — Narf's `POST /context-entries` writes through this.
- `write_cross_user_qa_entry(conn, target_user_id, asker_user_id, question, answer, …) -> UUID`
  — `POST /request-context` writes through this. It creates the target
  user's `context_entry(kind='cross_user_qa')`, creates the `qa_ledger`
  row, annotates the context metadata with `qa_ledger_id`, commits, and
  returns the context entry id.
- `retrieve_project_context(conn, project_id, question, limit) -> list[dict]`
  — lexical fallback retrieval over `project_context_entry` while embeddings
  remain nullable.
- `write_project_qa_entry(conn, project_id, asker_user_id, question, answer, …) -> UUID`
  — `POST /request-context` with `target="project"` writes through this.
  It creates `project_context_entry(kind='project_qa')`, creates the
  `project_qa_ledger` row, annotates metadata with `project_qa_ledger_id`,
  commits, and returns the project context entry id.

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

## Remaining Retrieval Upgrade

These are not blocking the V2 demo path, which currently uses lexical
retrieval over `context_entry`/`project_context_entry` while preserving the
target filter and closure-write contract.

1. Add a backfill pass that re-embeds existing rows with
   `text-embedding-3-small`.
2. Create HNSW indexes on the user and project `embedding` columns after
   backfill.
3. Replace the lexical fallback at the isolated retrieval functions with
   vector-first ranking while keeping lexical fallback deterministic.
