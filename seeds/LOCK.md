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

## Project Scripted Prompt

Ask this from User1's local app:

```text
What are the shared architecture pieces in this project, and when should the AI use project context instead of asking User1 or User2?
```

Expected routing:

- User1's assistant should decide this is shared project knowledge.
- It should call `request_context` with `target = "project"`.
- The server should retrieve only `project_context_entry` rows.

Expected answer facts:

- The project has a shared remote server.
- Each user has a local app that hosts their coding AI.
- The server can answer from `project_context_entry` for shared project facts.
- User1 owns frontend / desktop app work.
- User2 owns server, deployment, and infra work.

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

For the project-target flow, this should show the audit row:

```sql
SELECT asking.display_name AS asking_user,
       p.name AS project_name,
       q.question,
       q.answer,
       q.created_at
FROM project_qa_ledger q
JOIN app_user asking ON asking.id = q.asking_user_id
JOIN project p ON p.id = q.project_id
ORDER BY q.created_at DESC
LIMIT 1;
```

This should show the materialized project context row that later project
retrieval can surface:

```sql
SELECT p.name,
       c.kind,
       c.content,
       c.metadata,
       c.created_at
FROM project_context_entry c
JOIN project p ON p.id = c.project_id
WHERE c.kind = 'project_qa'
ORDER BY c.created_at DESC
LIMIT 1;
```
