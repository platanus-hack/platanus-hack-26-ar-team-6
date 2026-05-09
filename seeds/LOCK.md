# Demo Lock

This is the seed contract for the retriever-mediated cross-user demo. Keep
these facts stable unless the team intentionally changes the script.

## Users

- User1 (Frontend): local desktop app, chat UI, runner IPC, roster panel.
- User2 (Deployment): FastAPI server, Railway deployment, auth, Postgres ops.

The seed files are deliberately non-overlapping. User1's context should not
contain the deployment/auth answer below.

## Cross-User Scripted Prompt

Ask this from User1's local app:

```text
How is the shared server deployed, what auth does the local app use, and what health endpoint should I check before the demo?
```

Expected retrieval:

- User1's assistant should decide this is deployment/server knowledge.
- It should call `ask_retriever` with User2 as the target agent.
- The retriever should call `agent_ctx(agent_id, query)` for User2.

Expected answer facts:

- Server is FastAPI deployed to Railway.
- Railway service points at `apps/server/Dockerfile`.
- Service reads `PORT` from the environment.
- Health check hits `/health`.
- `/health` returns `{status, sha, models}`.
- `sha` comes from `RAILWAY_GIT_COMMIT_SHA`.
- Auth is per-user bearer token.
- Seed tokens are `dev-token-user1` and `dev-token-user2`.
- Local Postgres uses `infra/docker-compose.yml` with `pgvector/pgvector:pg16`.

## Global Scripted Prompt

Ask this from User1's local app:

```text
What are the shared architecture pieces in this project, and when should the AI use project context instead of asking User1 or User2?
```

Expected retrieval:

- User1's assistant should decide this is shared project knowledge.
- It should call `ask_retriever` without a single target agent.
- The retriever should call `global_ctx(query)`.

Expected answer facts:

- The project has a shared remote server.
- Each user has a local app that hosts their coding AI and LangGraph runtime.
- The retriever can call `global_ctx` for shared project facts.
- User1 owns frontend / desktop app work.
- User2 owns server, deployment, and infra work.

## Closure SQL

After the updater checkpoint, this should show the target-agent closure event:

```sql
SELECT u.display_name,
       e.importance,
       e.content,
       e.metadata,
       e.source_context_exchange_id,
       e.created_at
FROM agent_memory_event e
JOIN app_user u ON u.id = e.author_agent_id
WHERE e.metadata->>'source' = 'retriever-closure'
ORDER BY e.created_at DESC
LIMIT 1;
```

This should show the canonical memory document updated by the updater:

```sql
SELECT u.display_name,
       d.importance,
       d.document_key,
       d.content,
       d.metadata,
       d.updated_at
FROM agent_memory_document d
JOIN app_user u ON u.id = d.author_agent_id
ORDER BY d.updated_at DESC
LIMIT 5;
```
