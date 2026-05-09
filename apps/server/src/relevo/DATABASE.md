# Database — LangGraph Memory Network

The desktop app owns multi-agent orchestration. The server owns identity,
projects, bootstrap data, and durable memory for the retriever and updater
agents.

## Current Tables

- `project` and `app_user` — project and agent/user identity. `app_user.id` is
  the runtime `agent_id`; `app_user` is also the account's project membership
  and persona row.
- `account`, `account_session`, `oauth_login_state`, and
  `desktop_login_exchange` — Google login plus desktop session exchange.
- `context_entry` and `project_context_entry` — legacy seed/bootstrap context.
  These stay readable so existing demo data remains useful while the new memory
  tables take over.
- `context_exchange` — append-only audit for retriever calls to `agent_ctx` or
  `global_ctx`.
- `agent_memory_event` — immutable updater-written memory events.
- `agent_memory_document` — canonical current memory docs keyed by
  `(project_id, author_agent_id, importance, document_key)`.

`importance` is either `local` or `global`. Global context is still authored by
an agent; `global_ctx` searches rows flagged `importance = 'global'` across the
authenticated project.

## Migrations

The expected order after rebasing on main is:

- `0001_init.sql`
- `0002_v3_project_context.sql`
- `0003_accounts_projects_login.sql`
- `0004_agent_memory_network.sql`

The migration runner records only the numeric prefix. The memory-network
migration is `0004` because main already owns `0003` for account/project login.

## API-Backed Data Functions

- `get_bootstrap(conn, user_id) -> dict` returns the selected membership's user,
  project, roster, recent entries, and project context.
- `get_account_by_session_token(conn, token) -> dict | None` resolves Google
  desktop sessions.
- `get_project_membership_for_account(conn, account_id, project_id) -> dict | None`
  resolves the current account's selected project membership.
- `retrieve_agent_memory(conn, project_id, agent_id, query, limit)` returns
  author-owned memory for `agent_ctx`.
- `retrieve_global_memory(conn, project_id, query, limit)` returns project-wide
  global memory for `global_ctx`.
- `record_context_exchange(...)` stores retriever-call audit metadata.
- `commit_memory_update(conn, project_id, operations)` appends memory events and
  upserts canonical documents in one transaction.

The old `/request-context` and `/context-entries` HTTP surface has been removed.
Closure is now written by the updater through `commit_memory_update`, using the
`context_exchange_id` produced by retriever reads.
