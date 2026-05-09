# Hackathon Plan — LangGraph Multi-Agent Context Network

> Read [goal.md](goal.md) first. This plan supersedes the older
> `request_context` flow: the runtime is now a real multi-agent graph, and the
> privileged server-facing role is named **retriever**, not router/retriever.

## 0. What we are building

A local LangGraph runtime where the user-facing coding agent can ask a separate
retriever agent for context. Normal agents never call the server. The retriever
is the only read-capable agent, and an updater agent is invoked automatically
after every 6 finalized chat messages to write memory.

Components:

1. **Desktop LangGraph runtime** — orchestrates `preflightRetriever`,
   `retriever`, `userAgent`, and `updater` nodes.
2. **Retriever agent** — has only `agent_ctx` and `global_ctx` tools.
3. **User agent** — has local coding tools plus `ask_retriever`.
4. **Updater agent** — has only `commit_memory_update`.
5. **Shared server** — stores append-only memory events, canonical memory
   documents, and context exchange audit rows.

## 1. End-to-end flow

1. User sends a message in the desktop app.
2. LangGraph runs `preflightRetriever` and then `retriever`.
3. The retriever calls:
   - `agent_ctx(agent_id, query)` for author-owned agent memory.
   - `global_ctx(query)` for project-wide memory marked `importance = "global"`.
4. The user agent receives the preflight context packet and answers. If it
   still needs context, it calls `ask_retriever`, which delegates to the same
   retriever agent.
5. After the assistant answer, LangGraph checks the finalized message count.
6. Every 6 messages, the updater calls `commit_memory_update` with:
   - local memory for the asking agent;
   - closure memory/audit for any target agent whose context was retrieved.

## 2. Locked decisions

```text
Orchestration:     LangGraph.js in the Electron desktop app
Agent primitive:   Separate Claude Agent SDK sessions per role
Read tools:        agent_ctx, global_ctx (retriever only)
Write tool:        commit_memory_update (updater only)
User tool:         ask_retriever (local delegate, no direct server access)
Agent id:          app_user.id
Memory model:      Append-only events + canonical documents
Global memory:     importance = "global" flag, still authored by an agent
Updater trigger:   Every 6 finalized user/assistant messages
```

## 3. Server API

Every endpoint except `/health` and bootstrap requires the existing bearer
token.

```text
POST /agent-ctx
  { agent_id, query, limit?, metadata? }
  -> { results, context_exchange_id, insufficient_context }

POST /global-ctx
  { query, limit?, metadata? }
  -> { results, context_exchange_id, insufficient_context }

POST /memory-updates
  { chat_session_id, checkpoint_index, operations[] }
  -> { event_ids, document_ids }
```

The old `/request-context` and `/context-entries` route surface is removed.

## 4. Storage

New tables:

- `context_exchange` — immutable audit of retriever calls.
- `agent_memory_event` — append-only memory written by the updater.
- `agent_memory_document` — canonical current memory docs keyed by
  `(project_id, author_agent_id, importance, document_key)`.

Legacy `context_entry` and `project_context_entry` stay readable during the
migration so existing seed data remains useful.

## 5. Test Plan

- Desktop typecheck and Vitest cover the LangGraph node order, updater
  threshold, memory clients, and role-specific tool surfaces.
- Server unittest covers `agent_ctx`, `global_ctx`, `memory_updates`, and proves
  `/request-context` is gone.
- Prompt contract tests cover `ask_retriever` replacing `request_context`.
- Smoke path: user agent asks retriever, retriever calls server, user agent
  answers, updater writes asking-agent memory and target-agent closure memory.
