# V2 Demo Lock

This is the seed contract for the cross-user demo. Keep these facts stable
unless the team intentionally changes the script.

## Users

- User1 (Frontend): local desktop app, chat UI, runner IPC, roster panel.
- User2 (Deployment): FastAPI server, Railway deployment, auth, Postgres ops.

The seed files are deliberately non-overlapping. User1's context should not
contain the deployment/auth answer below.

## Scripted Prompt

Ask this from User1's local app:

```text
How is the shared server deployed, what auth does the local app use, and what health endpoint should I check before the demo?
```

Expected routing:

- User1's assistant should decide this is deployment/server knowledge.
- It should call `request_context` with `target = user2_id`.
- User2's on-demand agent can answer from `seeds/context/user2.yaml`.

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

## Closure SQL

After the cross-user request succeeds, this should show the audit row:

```sql
SELECT asking.display_name AS asking_user,
       target.display_name AS target_user,
       q.question,
       q.answer,
       q.created_at
FROM qa_ledger q
JOIN app_user asking ON asking.id = q.asking_user_id
JOIN app_user target ON target.id = q.target_user_id
ORDER BY q.created_at DESC
LIMIT 1;
```

This should show the materialized target-user context row that later retrieval
can surface:

```sql
SELECT u.display_name,
       c.kind,
       c.content,
       c.metadata,
       c.created_at
FROM context_entry c
JOIN app_user u ON u.id = c.user_id
WHERE c.kind = 'cross_user_qa'
ORDER BY c.created_at DESC
LIMIT 1;
```
