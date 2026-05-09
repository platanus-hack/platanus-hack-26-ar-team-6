# Jerf Lane

Jerf's old tool-surface task has been superseded by the LangGraph
multi-agent context network.

Current lane:

- keep the user-agent tool surface limited to local coding tools plus
  `ask_retriever`;
- ensure `ask_retriever(query, target_agent_id?)` delegates to the retriever
  agent, not directly to the server;
- preserve multi-hop retrieval inside one user-agent turn with clear loop
  control;
- surface retriever tool calls/results in the desktop UI;
- ensure automatic updater checkpoints run after every 6 finalized chat
  messages.

Use `apps/desktop/src/runner.ts`, `apps/desktop/src/agentGraph.ts`, and
`plan.md` as the active references.
