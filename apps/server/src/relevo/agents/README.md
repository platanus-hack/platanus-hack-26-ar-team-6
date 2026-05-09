# Server Agent Boundary

The server no longer hosts an on-demand answering agent.

The desktop LangGraph runtime owns the user-facing agent and updater agent. The
old retriever-agent runtime is gone; the server exposes a retrieval client over
memory primitives:

- `agent_ctx(agent_id, query)`
- `global_ctx(query)`
- `retrieve_context(query, target_agent_ids, limit)`
- `commit_memory_update(...)`

This package remains as a placeholder for server-owned agent-adjacent helpers
that may appear later, but live agent sessions should not be added here.
