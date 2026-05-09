# Plan: Team Pulse + Responsibilities

**Branch:** `feat/team-pulse`
**Supersedes:** `plans/plan-timeline-real.md`

## Goal

Make the project state legible at a glance and route prompts to the right
teammate automatically.

Two surfaces:

1. **Timeline tab** — N rows × T columns grid. Rows = project members.
   Columns = hour buckets (default last 24h, configurable). Each cell holds a
   short sentence (≤80 chars) describing what that user did in that hour, or
   is empty.
2. **Responsibilities tab** — one card per project member. Each card shows
   the member's "responsibility document" (≤2000 words) covering general
   responsibility + specific recent implementations. Markdown rendered.

The responsibility documents are **also fed into the retriever** so the agent
can decide which teammate to ask when global context is insufficient.

## Why this shape

- "What is X working on right now" is the first question every team asks.
- "Who owns this area" is the question the AI must answer to route a prompt.
- Existing `agent_memory_event` rows are already authored on every chat
  checkpoint, so the data is there. We just need to summarize and present it.
- Reusing `agent_memory_document` (already in `global_ctx`) means responsibility
  docs are retrievable for free; no new index.

## Non-goals (v1)

- Cron job. We compute on demand, cache in DB.
- Pushing local Obsidian activity notes to server. The notes stay local for
  now. Cross-user data comes only from `agent_memory_event`.
- Embedding-based ranking. Lexical match in `global_ctx` is enough.

## Data model

No new tables. Reuse `agent_memory_document`.

| Purpose | `document_key` | `importance` | `content` |
|---|---|---|---|
| Hourly cell | `pulse:<bucket_iso>` (e.g. `pulse:2026-05-09T14:00:00Z`) | `local` | ≤80 char sentence |
| Responsibility doc | `responsibility` | `global` | ≤2000 word markdown |

`metadata` for pulse rows includes:
```json
{
  "kind": "team_pulse_bucket",
  "bucket_start": "2026-05-09T14:00:00Z",
  "bucket_end":   "2026-05-09T15:00:00Z",
  "event_count":  3,
  "event_ids":    ["...","...","..."]
}
```

`metadata` for responsibility docs:
```json
{
  "kind": "responsibility_doc",
  "generated_at": "...",
  "source_window_start": "...",
  "word_count": 1583
}
```

This way:
- `global_ctx(query)` already returns responsibility docs (because `importance='global'`).
- No schema migration needed.

## Bucket math

- Bucket size = `PULSE_BUCKET_SECONDS` env, default `3600` (1h).
- Demo override e.g. `300` for 5-minute buckets.
- Window = `?buckets=24` (default 24 buckets).
- Bucket alignment: `floor(epoch / size) * size`, UTC.
- Render: client converts to local TZ for column headers.
- "Open" bucket = bucket containing now. Always recomputed on refresh.
- "Closed" buckets are immutable once cached.

## Where the LLM call lives

Server has no Anthropic key. Desktop main process has it. So:

- **Desktop computes summaries** during a refresh.
- Desktop fetches raw events from a dedicated read endpoint.
- Desktop POSTs computed summaries back via a dedicated write endpoint.
- Server is stateful storage + projection; it does no LLM calls.

This keeps server stateless re LLM and avoids leaking the user's API key.

## API

All routes require bearer + `X-Project-Id` (matching existing `agent_ctx` pattern).

### `GET /projects/{project_id}/team-pulse?buckets=24&size=3600`

Reads cached pulse documents and returns the grid.

```jsonc
{
  "bucket_size_seconds": 3600,
  "bucket_starts": ["2026-05-09T00:00:00Z", "..."],
  "members": [
    {
      "agent_id": "uuid",
      "display_name": "María",
      "cells": [
        { "summary": "wired oauth callback", "event_count": 3 },
        { "summary": null, "event_count": 0 },
        ...
      ]
    }
  ]
}
```

### `POST /projects/{project_id}/team-pulse/refresh`

Body:
```jsonc
{
  "size": 3600,
  "buckets": 24,
  "summaries": [
    {
      "agent_id": "uuid",
      "bucket_start": "2026-05-09T14:00:00Z",
      "summary": "wired oauth callback",
      "event_count": 3,
      "event_ids": ["...", "..."]
    }
  ],
  "responsibilities": [
    {
      "agent_id": "uuid",
      "content": "## General responsibility\n...",
      "word_count": 1583
    }
  ]
}
```

Response:
```jsonc
{ "pulse_doc_ids": ["..."], "responsibility_doc_ids": ["..."] }
```

The desktop client is responsible for:
1. Calling `GET /team-pulse/raw-events?since=...` (see below) to get inputs.
2. Running summarizer for any bucket whose summary is missing or stale.
3. Running responsibility regen for the current account's user **only**
   (so each member's local app authors their own docs; we never have one
   user authoring another user's doc).
4. POSTing to `/team-pulse/refresh`.

This means: **a user's pulse cells become real only once that user opens the
app**. That's acceptable for the demo and matches "users push their own
context".

### `GET /projects/{project_id}/team-pulse/raw-events?bucket_starts=...&agent_id=...`

Returns `agent_memory_event` rows in those buckets for that agent (or all
project members if `agent_id` omitted, but auth check still applies). Used
by the desktop summarizer to know what each bucket contains.

```jsonc
{
  "events": [
    {
      "id": "uuid",
      "agent_id": "uuid",
      "bucket_start": "2026-05-09T14:00:00Z",
      "content": "...",
      "metadata": {...},
      "created_at": "..."
    }
  ]
}
```

### `GET /projects/{project_id}/responsibilities`

```jsonc
{
  "members": [
    {
      "agent_id": "uuid",
      "display_name": "María",
      "content": "## General responsibility\n...",
      "updated_at": "...",
      "word_count": 1583
    }
  ]
}
```

Members with no responsibility doc yet appear with `content: null`.

## Desktop

### IPC + preload

```ts
loadTeamPulse: (projectId: string, opts?: { buckets?: number; size?: number }) => Promise<TeamPulseResponse>
refreshTeamPulse: (projectId: string, opts?: { buckets?: number; size?: number }) => Promise<{ pulse_doc_ids: string[]; responsibility_doc_ids: string[] }>
loadResponsibilities: (projectId: string) => Promise<ResponsibilitiesResponse>
```

The `refresh` handler in `apps/desktop/src/main/index.ts`:

1. Reads selected project + bootstrap (already wired).
2. `GET /team-pulse` to know which buckets are missing.
3. `GET /team-pulse/raw-events?agent_id=<self>&bucket_starts=...` for missing buckets.
4. For each missing bucket with ≥1 events, build summary:
   - 1–2 events: pick latest event.content, truncate to 80 chars at word boundary.
   - ≥3 events: Anthropic call with model `claude-3-5-haiku-20241022`, 1-sentence output, ≤80 chars.
5. `GET /team-pulse/raw-events?agent_id=<self>&since=<30d_ago>` to build the responsibility doc.
6. Anthropic call to generate ≤2000-word doc (general responsibility + recent implementations sections).
   - Pass previous doc as hint, instruct model to **rewrite from scratch using events as ground truth**.
7. POST consolidated payload to `/team-pulse/refresh`.

Refresh is debounced: server returns 200 with empty arrays if last refresh
for this `(project, agent)` was < `PULSE_REFRESH_DEBOUNCE_SECONDS` (default 600)
ago. Desktop UI handles that gracefully.

### TimelineView (rewrite)

- On mount: call `refreshTeamPulse` (fire-and-forget), then `loadTeamPulse`.
- Render grid:
  - First column = sticky member name + avatar dot.
  - Top row = bucket start time labels (local TZ, e.g., `14:00`).
  - Each cell:
    - empty (`event_count == 0`): faded square, no text.
    - with text (`summary`): square with truncated summary, tooltip with full sentence + event_count.
  - Click cell → drawer: list of events in that bucket (calls `/raw-events` lazily).
- Optional: refresh button in panel header.

The old Obsidian-graph rendering moves to a hidden / dev-only path (kept in
the file behind a flag for now; we'll delete in a follow-up).

### ResponsibilitiesView (new)

- New file `apps/desktop/src/renderer/src/views/ResponsibilitiesView.tsx`.
- New tab entry in `App.tsx` + tab bar.
- On mount: `loadResponsibilities(projectId)`.
- Render: stack of cards, one per roster member.
  - Card shows display_name, last_updated, word_count, markdown body.
  - Members without doc: greyed card "no responsibility doc yet".

## Retriever wiring (the routing feature)

Goal: when `global_ctx` is insufficient, retriever should pick a teammate
from the responsibility docs and call `agent_ctx(target_agent_id, query)`.

Today retriever already has both tools. The piece missing is the *signal*
that responsibility docs are the right thing to consult and that
`agent_ctx` is the right next step.

Changes:

1. The responsibility docs already land in `global_ctx` results because
   `importance='global'`. We just need to make sure the retriever's prompt
   tells it to treat documents with `metadata.kind == "responsibility_doc"`
   as a routing index: "if the answer is not in the result text but a
   responsibility doc says user X owns the topic, call `agent_ctx(X, ...)`."
2. Update retriever system prompt in `apps/desktop/src/runner.ts` to
   describe this fallback.
3. Add a small unit/integration test that simulates: `global_ctx` returns
   only a responsibility doc → retriever then calls `agent_ctx` with that
   user → returns combined results.

We do **not** add a separate `list_responsibilities` tool yet. If the
prompt-based routing turns out flaky we add it as v2.

## Verification

1. Server unit: refresh upserts pulse docs and responsibility docs; debounce
   blocks re-writes within window; raw-events endpoint scopes to project +
   bucket window.
2. Desktop unit: summarizer truncates, falls back when LLM unavailable.
3. Manual smoke: chat a few prompts, open Timeline → see at least one cell
   with a sentence in current hour for the active user. Open
   Responsibilities → see a card for the active user with non-empty body.
4. Retriever smoke: prompt about a topic owned by another user → trace shows
   `global_ctx` → `agent_ctx(<that user>)` → final answer references both.

## Rollout

1. `plans/plan-team-pulse.md` (this file).
2. Server endpoints + db helpers + tests.
3. Desktop IPC + preload.
4. TimelineView rewrite.
5. ResponsibilitiesView + tab.
6. Retriever prompt update + test.

## Priority: High (demo centerpiece)
