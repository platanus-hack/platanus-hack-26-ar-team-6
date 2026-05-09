# Superseded Sarf Task Note

The old cross-user schema task has been replaced by the append-plus-canonical
memory model in `plan.md`.

Sarf's current backend/data lane is:

- keep legacy seed context readable during migration;
- own `context_exchange`, `agent_memory_event`, and `agent_memory_document`;
- preserve lexical retrieval while vector ranking is still future work;
- ensure updater commits append events plus canonical document upserts;
- keep global context represented by `importance = "global"`.

Use `apps/server/src/relevo/DATABASE.md` for the active database contract.
