# Plan: Memory Explorer (Pool Tab)

**Branch:** `feat/memory-explorer`

## Problem
The Pool tab has no real data. `agent_memory_document` holds canonical, deduplicated knowledge per user — exactly what should be browsable here.

## Changes

### 1. API Endpoint — `apps/server/src/relevo/api/`
Add `GET /agents/{agent_id}/memory?search=<query>`:
```python
@router.get("/agents/{agent_id}/memory")
async def get_agent_memory(agent_id: str, search: str | None = None):
    docs = await db.fetch_memory_documents(agent_id, search=search)
    return {"documents": docs}
```

Query (full-text search with pgvector fallback):
```sql
SELECT id, document_key, canonical_content, importance, updated_at
FROM agent_memory_document
WHERE agent_id = $1
  AND ($2::text IS NULL OR canonical_content ILIKE '%' || $2 || '%')
ORDER BY updated_at DESC
LIMIT 100;
```

### 2. IPC + Preload
Same pattern as timeline — `memory:load` handler in main, `loadMemory` in preload.

### 3. UI — Pool Tab
- Search box at top (debounced 300ms)
- Card per document: `document_key` as title, `canonical_content` as body (truncated to 3 lines)
- Badge: `local` vs `global` importance
- Click to expand full content in a modal or sidebar

## Verification
- Pool tab shows the user's own memory documents
- Search filters results as you type
- Clicking a card shows full content

## Priority: Medium (showcases the memory system)
