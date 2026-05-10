# Database — LangGraph Memory Network

The desktop app owns multi-agent orchestration. The server owns identity,
projects, bootstrap data, durable memory, and the vector retrieval client used
by the desktop runtime.

## Current Tables

- `project` and `app_user` — project and agent/user identity. `app_user.id` is
  the runtime `agent_id`; `app_user` is also the account's project membership
  and persona row.
- `account`, `account_session`, `oauth_login_state`, and
  `desktop_login_exchange` — Google login plus desktop session exchange.
- `context_entry` and `project_context_entry` — legacy seed/bootstrap context.
  Only `kind = 'seed'` rows are included in lexical fallback reads, so old
  `prompt_answer`, `cross_user_qa`, and `project_qa` rows cannot recursively
  dominate the new memory network. Retrieved memory payloads are capped at 4000
  characters per row and marked with `metadata.truncated` when capped; stored
  rows remain intact.
- `context_exchange` — append-only audit for retrieval calls to `agent_ctx`,
  `global_ctx`, or `retrieve_context`.
- `agent_memory_event` — immutable updater-written memory events.
- `agent_memory_document` — canonical current memory docs keyed by
  `(project_id, author_agent_id, importance, document_key)`.
- `memory_chunk` — embedding-ready retrieval projection over memory/source rows.
  Source rows remain canonical; chunks are unique by
  `(source_table, source_id, chunk_index)` and use `embedding vector(1536)` for
  cosine HNSW indexes. Each chunk stores `content_hash`, `embedding_model`, and
  `embedding_dimensions` so ingestion can detect stale embeddings.

`importance` is either `local` or `global`. Global context is still authored by
an agent; `global_ctx` searches rows flagged `importance = 'global'` across the
authenticated project.

`memory_chunk` is the fast retrieval surface. The old retriever-agent runtime is
not on the retrieval path; reads embed the query once, search pool and
agent-owned chunks server-side, and fall back to lexical source-table reads only
when embeddings or the vector table are unavailable.

## Migrations

The expected order after rebasing on main is:

- `0001_init.sql`
- `0002_v3_project_context.sql`
- `0003_accounts_projects_login.sql`
- `0004_agent_memory_network.sql`
- `0005_vector_retrieval.sql`

The migration runner records only the numeric prefix. The memory-network
migration is `0004` because main already owns `0003` for account/project login.

## API-Backed Data Functions

- `get_bootstrap(conn, user_id) -> dict` returns the selected membership's user,
  project, roster, recent entries, and project context.
- `get_account_by_session_token(conn, token) -> dict | None` resolves Google
  desktop sessions.
- `get_project_membership_for_account(conn, account_id, project_id) -> dict | None`
  resolves the current account's selected project membership.
- `retrieve_context(conn, project_id, query, target_agent_ids, limit)` returns a
  route, selected agents, diagnostics, and `MemoryResultOut`-compatible rows.
- `retrieve_agent_memory(conn, project_id, agent_id, query, limit)` is a
  compatibility wrapper forcing the agent route for `agent_ctx`.
- `retrieve_global_memory(conn, project_id, query, limit)` is a compatibility
  wrapper forcing the pool route for `global_ctx`.
- `record_context_exchange(...)` stores retrieval-call audit metadata.
- `commit_memory_update(conn, project_id, operations)` appends memory events and
  upserts canonical documents in one transaction.
- `backfill_memory_chunks(conn, project_id, batch_size)` indexes existing source
  rows in idempotent batches.

The old `/request-context` and `/context-entries` HTTP surface has been removed.
Closure is now written by the updater through `commit_memory_update`, using the
`context_exchange_id` produced by retrieval reads.
