# Plan: Project Activity Tab

**Branch:** `feat/activity-tab`

## Vision
A top-level tab showing what the whole team has been doing — a living pulse of the project. This is the demo centrepiece: when you open Relevo, you immediately see teammates' recent context updates, what they were working on, and who knows what.

## Data Sources (already in DB)
- `agent_memory_event` — append-only log of all context updates with author and timestamp
- `context_exchange` — cross-user queries (who asked whom about what)
- `agent_memory_document` — canonical knowledge per user (for "what X knows about Y" summaries)

## Features

### 1. Team Activity Feed
Chronological list of events across the whole project:
```
[Avatar] María updated her context — "Finished OAuth PR, moved to rate limiting"    2m ago
[Avatar] Juan asked @María about auth middleware                                      8m ago
[Avatar] Sarf updated his context — "DB schema finalized, running migrations"       15m ago
```

### 2. Teammate Knowledge Cards
Grid of teammate cards showing:
- Name + avatar
- Last active timestamp
- Their top 3 `document_key` labels (e.g. "auth", "API design", "migrations")
- Click → opens a panel with their full memory explorer view

### 3. Cross-Team Query Graph (stretch)
A small force-directed graph showing who has asked whom for context. Thicker edges = more frequent exchanges. Built with D3 or a lightweight React graph lib.

## Implementation

### API
`GET /projects/{project_id}/activity` — returns merged feed of events + exchanges sorted by time.

### IPC + Preload
`activity:load` handler and `loadActivity` in preload, same pattern as timeline.

### Renderer
New `ActivityView.tsx`. Add tab entry in `App.tsx` and `Tabs.tsx`.

### GitHub Integration (stretch)
If `GITHUB_TOKEN` is set, call `GET /repos/{owner}/{repo}/commits` and merge into the feed with a "commit" event type.

## Verification
- Activity tab shows real cross-team events
- Teammate cards reflect their latest context
- Clicking a teammate card opens their memory explorer

## Priority: High for demo (this is the WOW moment)
