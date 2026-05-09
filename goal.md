# Project Goal

## One-line pitch

A workflow where every user on a project can transparently borrow each other's
context. When your AI assistant does not know something, it asks a dedicated
retriever agent for teammate or global project memory, folds the returned
context into the current turn, and keeps you in flow without switching tools or
interrupting teammates.

## The problem we are solving

On real projects, knowledge is scattered across people. User1 knows the
frontend conventions, User2 owns the data model, User3 has the deploy quirks
in their head. When User1's coding assistant tries to help User1 with
something that touches User2's domain, it either:

- guesses and gets it wrong,
- asks User1 to go ask User2, which breaks flow, or
- demands that all context be manually centralized, which rarely happens.

We want the assistant itself to know that it is missing context, fetch it from
the right teammate's accumulated context automatically, and use it. The
cross-team knowledge handoff becomes an under-the-hood detail of a single
prompt, not a human coordination problem.

## The shape of the system

There are three runtime pieces.

### 1. Desktop LangGraph runtime

The local app owns multi-agent orchestration. It runs a LangGraph graph with:

- `preflightRetriever`, which fetches useful context before each user-agent
  turn;
- `userAgent`, the user-facing coding assistant session;
- `retriever`, the only read agent that can ask the server for memory;
- `updater`, the only write agent that can commit memory updates.

Normal agents do not call the server. The user agent has local coding tools
and `ask_retriever`. That tool delegates to the retriever agent.

### 2. Server memory API

The server does not spin up teammate agents. It owns shared storage and exposes
only the primitives that the retriever and updater need:

- `agent_ctx(agent_id, query)` returns author-owned memory for one agent.
- `global_ctx(query)` returns project memory marked `importance = "global"`.
- `commit_memory_update(...)` appends memory events and upserts canonical
  memory documents.

The server also records every retrieval as a `context_exchange` audit row so
closure writes can be tied back to the exact retrieval that caused them.

### 3. Memory model

Memory is append-plus-canonical:

- immutable `agent_memory_event` rows preserve what happened;
- `agent_memory_document` rows keep the latest canonical summaries;
- `importance = "local"` keeps memory scoped to one author agent;
- `importance = "global"` makes memory available through global project
  retrieval.

Legacy seed context remains readable during the migration, but new writes use
the memory event/document model.

## The end-to-end flow

1. **Session start.** The desktop app calls `/bootstrap` and loads the user's
   own recent context, shared project context, and project roster.

2. **User prompts.** The user asks a question or requests a change.

3. **Preflight retrieval.** LangGraph runs `preflightRetriever`, then the
   retriever agent. The retriever may call `agent_ctx` or `global_ctx` until it
   has a useful context packet or decides context is insufficient.

4. **User-agent turn.** The user-facing coding agent receives local context and
   the preflight context packet. If it still needs more context, it calls
   `ask_retriever(query, target_agent_id?)`, which delegates back to the same
   retriever agent.

5. **Iterate if needed.** The user agent may ask the retriever multiple times
   during a turn. This loops until the user agent judges it has enough context
   or the retriever reports that the missing context is not available.

6. **User answer.** The user agent produces its final response.

7. **Automatic persistence.** After every 6 finalized chat messages,
   LangGraph sends the checkpoint to the updater. The updater calls
   `commit_memory_update(...)` to append events and update canonical memory
   documents.

## The invariant that makes this work

> When User1's agent retrieves context from User2's memory, both User1's memory
> and User2's memory/audit trail must reflect what was learned.

This is the closure property that keeps everyone's context growing.

- User1 gets memory about what their agent learned and how it was used.
- User2 gets a closure record that their memory answered a question for
  another agent.
- The retrieval itself is recorded in `context_exchange`.
- A later query by User2 or another teammate can discover the exchange if it is
  relevant.

This turns the system from "everyone's notes in one place" into a compounding
shared memory network.

## What success looks like

A working demo where:

1. Two or more users have populated context in the system.
2. User1 prompts their local app with a question that genuinely requires
   knowledge User2 has and User1 does not.
3. The user agent asks the retriever, the retriever calls `agent_ctx`, and the
   user agent answers without User1 leaving their session.
4. After the checkpoint, the updater writes User1's learned context and User2's
   closure record through `commit_memory_update`.
5. A subsequent query can retrieve the relevant global, local, or closure
   memory, proving the loop compounds.

## Out of scope for this document

This file describes what we are building and why. It deliberately does not
specify:

- the exact retrieval algorithm;
- vector search or graph-RAG ranking details;
- model choices for each desktop agent session;
- versioned milestones;
- production authorization and rate-limit policy.

Those belong in `plan.md` and implementation docs.
