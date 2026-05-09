# Plan: Pool Tab — Team Memory Browser

**Branch:** `feat/pool-tab-real-data`

## Context & Use Case

An employee opens the Pool tab. Their real need: **"What does the AI currently know about my teammates?"** — before asking a question, they want to browse the accumulated context that informs cross-team answers. This directly visualizes Relevo's core value: knowledge flowing between people automatically.

A secondary need: **"What does the AI know about me? Is it accurate?"** — verifying their own stored context, building trust in the system.

The current Pool tab renders 3 hardcoded fixtures and has zero backend integration. The fix: a **team roster picker** at the top + real memory documents below. Clicking your name shows all your documents. Clicking a teammate shows their global-importance documents (the ones they've shared with the team).

**Why global-only for teammates?** The `importance='global'` flag is exactly this: knowledge an agent marked as "useful to the whole team". Local documents are private AI-to-user context. This distinction teaches users the memory model in one glance.

**Data already available:** `bootstrapQuery.data.roster` (array of `{id, display_name, domain_summary}`) and `activeUserId` are already in `App.tsx` scope — no new bootstrap calls needed.

---

## UI Design

```
Pool Tab
┌────────────────────────────────────────┐
│ [You ✓] [María] [Sarf]                 │  ← roster pills; You = default
├────────────────────────────────────────┤
│ chat-summary              local  2m ago│
│ Working on rate limiting for the API…  │
├────────────────────────────────────────┤
│ auth-ownership            global  1h ago│
│ Owns OAuth middleware, responsible for…│
├────────────────────────────────────────┤
│ (empty state) no memory documents yet  │
└────────────────────────────────────────┘
```

---

## Critical Files

| Layer | File | Change |
|---|---|---|
| Server DB | `apps/server/src/relevo/db.py` | add `list_memory_documents()` |
| Server API | `apps/server/src/relevo/api/context.py` | add `GET /memory/documents` |
| Desktop IPC | `apps/desktop/src/main/index.ts` | add `memory:documents:load` handler |
| Preload | `apps/desktop/src/preload/index.ts` + `index.d.ts` | expose `loadMemoryDocuments` |
| Renderer | `apps/desktop/src/renderer/src/views/PoolView.tsx` | full rewrite |
| Renderer | `apps/desktop/src/renderer/src/App.tsx` | pass `roster` + `currentUserId` to PoolView |
| CSS | `apps/desktop/src/renderer/src/assets/main.css` | pool-specific classes |

---

## What Changes

### 1. `apps/server/src/relevo/db.py` — new DB function

```python
def list_memory_documents(
    conn: psycopg.Connection,
    project_id: UUID,
    agent_id: UUID,
    global_only: bool = False,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List canonical memory documents for an agent.
    global_only=True is used when fetching a teammate's documents (privacy boundary).
    """
    importance_filter = "AND importance = 'global'" if global_only else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, importance, document_key, content, metadata, created_at, updated_at
            FROM agent_memory_document
            WHERE project_id = %s AND author_agent_id = %s {importance_filter}
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (project_id, agent_id, limit),
        )
        return [dict(row) for row in cur.fetchall()]
```

Uses existing `agent_memory_document_author_updated` index.

---

### 2. `apps/server/src/relevo/api/context.py` — new endpoint

**Add to imports:**
```python
from relevo.db import (
    ...
    list_memory_documents,
)
```

**Add Pydantic models** (after existing models):
```python
class MemoryDocumentOut(BaseModel):
    id: UUID
    importance: str
    document_key: str
    content: str
    metadata: dict[str, Any]
    created_at: Any
    updated_at: Any

class MemoryDocumentsResponse(BaseModel):
    documents: list[MemoryDocumentOut]
```

**Add endpoint:**
```python
@router.get("/memory/documents", response_model=MemoryDocumentsResponse)
def get_memory_documents(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    current_auth: Annotated[dict[str, Any], Depends(require_auth)],
    x_project_id: Annotated[UUID | None, Header(alias="X-Project-Id")] = None,
    agent_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> MemoryDocumentsResponse:
    current_user = require_project_membership(conn, current_auth, x_project_id)
    project_id = current_user["project_id"]

    if agent_id is None or agent_id == current_user["id"]:
        # Own documents — all importances
        docs = list_memory_documents(conn, project_id=project_id, agent_id=current_user["id"], limit=limit)
    else:
        # Teammate — validate they're in the same project, then return global-only
        target = get_user(conn, agent_id)
        if target is None or target["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Agent not found in this project")
        docs = list_memory_documents(conn, project_id=project_id, agent_id=agent_id, global_only=True, limit=limit)

    return MemoryDocumentsResponse(documents=docs)
```

No new router file — joins the existing `context_router`.

---

### 3. `apps/desktop/src/main/index.ts` — IPC handler

```typescript
ipcMain.handle('memory:documents:load', async (_, agentId?: string): Promise<unknown> => {
  const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
  const url = new URL(`${serverBaseUrl}/memory/documents`)
  if (agentId) url.searchParams.set('agent_id', agentId)
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'X-Project-Id': selectedProjectId ?? '',
    },
  })
  if (!res.ok) throw new Error(`Failed to load memory documents: ${res.status}`)
  return res.json()
})
```

---

### 4. Preload additions

**`preload/index.ts`** — add to api object:
```typescript
loadMemoryDocuments: (agentId?: string) =>
  ipcRenderer.invoke('memory:documents:load', agentId),
```

**`preload/index.d.ts`** — add type:
```typescript
loadMemoryDocuments: (agentId?: string) => Promise<{
  documents: Array<{
    id: string
    importance: string
    document_key: string
    content: string
    metadata: Record<string, unknown>
    created_at: string
    updated_at: string
  }>
}>
```

---

### 5. `apps/desktop/src/renderer/src/App.tsx` — pass props

```tsx
} else if (activeTab === 'pool') {
  activeView = (
    <PoolView
      currentUserId={activeUserId}
      roster={roster}
    />
  )
}
```

`roster` and `activeUserId` are already computed in App.tsx scope.

---

### 6. `apps/desktop/src/renderer/src/views/PoolView.tsx` — full rewrite

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type RosterEntry = { id: string; display_name: string; domain_summary: string }

type MemoryDocument = {
  id: string
  importance: 'local' | 'global'
  document_key: string
  content: string
  updated_at: string
}

type Props = {
  currentUserId: string
  roster: RosterEntry[]
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 2) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function contentPreview(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

export default function PoolView({ currentUserId, roster }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState(currentUserId)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['memory-documents', selectedAgentId],
    queryFn: () => window.api.loadMemoryDocuments(
      selectedAgentId === currentUserId ? undefined : selectedAgentId
    ),
    staleTime: 30_000,
  })

  const docs = (data?.documents ?? []) as MemoryDocument[]
  const isViewingSelf = selectedAgentId === currentUserId

  return (
    <section className="pool-view">
      {/* Roster picker */}
      <div className="pool-roster">
        <button
          className={`pool-roster__pill ${isViewingSelf ? 'pool-roster__pill--active' : ''}`}
          onClick={() => setSelectedAgentId(currentUserId)}
        >
          you
        </button>
        {roster
          .filter((u) => u.id !== currentUserId)
          .map((u) => (
            <button
              key={u.id}
              className={`pool-roster__pill ${selectedAgentId === u.id ? 'pool-roster__pill--active' : ''}`}
              onClick={() => setSelectedAgentId(u.id)}
            >
              {u.display_name.split(' ')[0].toLowerCase()}
            </button>
          ))}
      </div>

      {/* Scope hint for teammates */}
      {!isViewingSelf && (
        <p className="pool-scope-hint">showing global context only</p>
      )}

      {/* Document list */}
      <div className="pool-docs">
        {isLoading && <p className="pool-empty">loading…</p>}
        {isError && <p className="pool-empty">failed to load memory documents.</p>}
        {!isLoading && !isError && docs.length === 0 && (
          <p className="pool-empty">
            {isViewingSelf
              ? 'no memory documents yet — they appear after your first chat checkpoint.'
              : 'no shared context from this teammate yet.'}
          </p>
        )}
        {docs.map((doc) => (
          <div className="pool-doc" key={doc.id}>
            <div className="pool-doc__header">
              <span className="pool-doc__key">{doc.document_key}</span>
              <span className={`pool-doc__badge pool-doc__badge--${doc.importance}`}>
                {doc.importance}
              </span>
              <span className="pool-doc__time">{timeAgo(doc.updated_at)}</span>
            </div>
            <div className="pool-doc__preview">{contentPreview(doc.content)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

---

### 7. CSS — `apps/desktop/src/renderer/src/assets/main.css`

```css
.pool-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.pool-roster {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.pool-roster__pill {
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.pool-roster__pill:hover {
  background: var(--bubble-assistant);
  color: var(--text-primary);
}

.pool-roster__pill--active {
  background: var(--bubble-user);
  color: var(--bubble-user-text);
  border-color: var(--bubble-user);
}

.pool-scope-hint {
  font-size: 0.75em;
  color: var(--text-secondary);
  padding: 6px 16px 0;
  margin: 0;
}

.pool-docs {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
}

.pool-empty {
  color: var(--text-secondary);
  font-size: 0.875em;
  padding: 16px 0;
  margin: 0;
}

.pool-doc {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.pool-doc:last-child { border-bottom: none; }

.pool-doc__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.pool-doc__key {
  font-weight: 600;
  font-size: 0.875em;
  color: var(--text-primary);
  flex: 1;
}

.pool-doc__badge {
  font-size: 0.7em;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  flex-shrink: 0;
}

.pool-doc__badge--local  { background: rgba(99,102,241,0.15); color: #6366f1; }
.pool-doc__badge--global { background: rgba(16,185,129,0.15);  color: #10b981; }

.pool-doc__time {
  font-size: 0.75em;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.pool-doc__preview {
  font-size: 0.8em;
  color: var(--text-secondary);
  line-height: 1.4;
}
```

---

## What We Are NOT Changing
- **Pagination** — 50 docs is the demo upper bound
- **Expand/click-to-read-full** — can layer on later; preview is enough for demo
- **`agent_memory_event` log** — the append-only events table is separate from canonical documents
- **Search** — the endpoint accepts `?limit=` already; text search is a follow-up

---

## Verification
1. `npx tsc --noEmit` → 0 errors
2. `pytest tests/` (server) → all pass
3. Pool tab opens → shows "you" pill selected, loads current user's documents
4. Click a teammate pill → shows only their global-importance documents with the "showing global context only" hint
5. No documents yet → correct empty state message per persona (you vs teammate)
6. `curl -H "Authorization: Bearer <token>" -H "X-Project-Id: <id>" <server>/memory/documents` → 200 with real data
7. `curl ... /memory/documents?agent_id=<teammate_id>` → 200, only global docs returned
