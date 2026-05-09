# Server Agent Boundary

The server no longer hosts an on-demand answering agent.

The desktop LangGraph runtime owns the user-facing agent, retriever agent, and
updater agent. The server exposes only memory primitives for those agents:

- `agent_ctx(agent_id, query)`
- `global_ctx(query)`
- `commit_memory_update(...)`

This package remains as a placeholder for server-owned agent-adjacent helpers
that may appear later, but live agent sessions should not be added here.
