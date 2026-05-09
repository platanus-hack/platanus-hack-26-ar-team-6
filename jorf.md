# Jorf Lane

Jorf's old server-side answering-agent task has been superseded. The server no
longer hosts a live answering agent for teammate memory.

Current lane:

- own retriever prompt quality and retrieval iteration policy;
- keep retriever output as a grounded context packet with
  `context_exchange_id`;
- use only `agent_ctx` and `global_ctx` from the retriever role;
- treat insufficient context as a real limit;
- coordinate with updater behavior so closure metadata is preserved.

Use `prompts/agent_system.md`, `prompts/local_assistant_system.md`, and
`apps/desktop/src/runner.ts` as active references.
