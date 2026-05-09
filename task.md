# Superseded Task Note

This task file previously described the old `request_context` lane. That lane
has been replaced by the LangGraph multi-agent context network in `plan.md`.

Current ownership shape:

- Desktop runtime owns LangGraph orchestration and the user-agent
  `ask_retriever` tool.
- Retriever owns server-backed reads through `agent_ctx` and `global_ctx`.
- Updater owns automatic checkpoint writes through `commit_memory_update`.
- Server owns memory storage, retrieval primitives, and exchange audit rows.

Use `goal.md`, `plan.md`, and the app/server READMEs as the active source of
truth.
