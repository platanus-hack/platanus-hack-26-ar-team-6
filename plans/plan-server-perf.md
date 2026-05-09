# Plan: Server Performance Improvements

**Branch:** `feat/server-perf`

## Problem
Every request opens a new `psycopg.connect()` call (5–15ms overhead). `retrieve_agent_memory()` runs N+1 queries. Vector columns exist but have no indexes — full table scans on every retrieval.

## Changes

### 1. Connection Pooling — `apps/server/src/relevo/db.py`
Replace bare `psycopg.connect()` with `psycopg_pool.AsyncConnectionPool`:
```python
from psycopg_pool import AsyncConnectionPool

pool = AsyncConnectionPool(conninfo=DATABASE_URL, min_size=2, max_size=10)

async def get_conn():
    async with pool.connection() as conn:
        yield conn
```
Inject via FastAPI `Depends(get_conn)` in all route handlers.

### 2. Merge N+1 Queries — retrieval endpoint
Current: fetches agent list, then queries memory for each agent separately.
Fix: single query with `WHERE agent_id = ANY($1)` and rank in SQL using `<=>` cosine distance.

### 3. pgvector Indexes — migration
```sql
CREATE INDEX ON agent_memory_document USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON agent_memory_event USING hnsw (embedding vector_cosine_ops);
```
Add as Alembic migration or startup script.

### 4. Async OAuth Token Fetch — `apps/server/src/relevo/api/auth.py`
Current `httpx.get()` (sync) blocks the event loop during Google token validation.
Fix: use `httpx.AsyncClient` with `await client.get(...)`.

## Verification
- Measure response time before/after with `time curl ...` on the retrieval endpoint
- Confirm pool stats via `pool.get_stats()` in a health endpoint
- Verify HNSW index is used via `EXPLAIN ANALYZE`

## Priority: High (affects every user interaction)
