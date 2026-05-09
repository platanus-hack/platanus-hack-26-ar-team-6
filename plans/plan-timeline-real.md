# Plan: Wire Timeline Tab to Real Data

**Branch:** `feat/timeline-real`

## Problem
The Timeline tab currently shows mock/static data. The server has `agent_memory_event` with timestamps, content, and author — everything needed for a real activity feed.

## Changes

### 1. API Endpoint — `apps/server/src/relevo/api/`
Add `GET /projects/{project_id}/timeline?limit=50&before=<iso_timestamp>`:
```python
@router.get("/projects/{project_id}/timeline")
async def get_timeline(project_id: str, limit: int = 50, before: str | None = None):
    events = await db.fetch_timeline_events(project_id, limit=limit, before=before)
    return {"events": events}
```

Query:
```sql
SELECT e.id, e.agent_id, e.event_content, e.created_at, u.display_name
FROM agent_memory_event e
JOIN agent u ON u.id = e.agent_id
WHERE e.project_id = $1
  AND ($2::timestamptz IS NULL OR e.created_at < $2)
ORDER BY e.created_at DESC
LIMIT $3;
```

### 2. IPC Handler — `apps/desktop/src/main/index.ts`
```typescript
ipcMain.handle('timeline:load', async (_, projectId: string, before?: string) => {
  const res = await fetch(`${serverUrl}/projects/${projectId}/timeline?limit=50${before ? `&before=${before}` : ''}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return res.json();
});
```

### 3. Preload — `apps/desktop/src/preload/index.ts`
```typescript
loadTimeline: (projectId: string, before?: string) =>
  ipcRenderer.invoke('timeline:load', projectId, before),
```

### 4. TimelineView — `apps/desktop/src/renderer/src/views/TimelineView.tsx`
Replace mock data with `useEffect` that calls `window.api.loadTimeline(projectId)` on mount. Support infinite scroll (load more on scroll-to-bottom using `before` cursor).

## Verification
- Timeline tab shows real events from the DB
- Scrolling past 50 items loads more
- New events appear after a chat turn (refresh or poll)

## Priority: Medium (key demo feature)
