# Jorf — V2 Task: On-Demand Agent + Retrieval Glue

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jorf's lane in V2.

## Lane

The on-demand agent that the server spins up to answer cross-user
questions. Given a retrieved slice of a target user's context plus a
question, produce a grounded answer. This is the "queried user's agent"
in goal.md's flow.

You also own the agent's system prompt and any retrieval-quality
tweaks that come out of V2 testing.

You do not own: HTTP routing (Narf), the schema (Sarf), the client-side
tool registration (Jerf), the desktop UI (Marf). You own a function the
server imports.

## Coordination

- Pair with Narf at h0 on the function signature: what shape of slice
  comes in, what shape of answer goes out.
- Pair with Jerf at h0 on the `POST /request_context` payload contract
  (your output is part of that response).
- Pair with Sarf early to confirm the slice shape returned by retrieval
  matches what your prompt expects.

## Starting state

`prompts/agent_system.md` is the most salvageable piece in the V0
codebase. It already expects retrieval + citation. Strip the multi-agent
coordination language and the `handoff` field; rebind variables to the
on-demand agent's context (a slice of one target user's DB).

## Deliverables

1. **On-demand agent module.** A function the server's `POST
   /request_context` handler can call: `(slice, question) → {answer,
   source_user_ids}`. Stateless LLM call with the slice inlined into
   the prompt is fine for V2 — no sub-agent process needed.
2. **Reworked `prompts/agent_system.md`** for the on-demand agent role.
3. **Retrieval glue (with Narf).** If V2 testing shows retrieval is
   pulling the wrong slice, tune top-k, embedding strategy, or filter
   metadata. Joint lane with Narf.
4. **Citations.** `source_user_ids` is required. Citing specific
   `context_entries` rows is nice-to-have.

## Decisions you own

Model choice, prompt structure, citation format, top-k retrieval depth.
Pick defaults that work and document them in the PR. Don't bikeshed.

## Out of scope for V2

- Multi-target consolidation (V3 stretch).
- Project-context grounding (V3 stretch).
- Sub-agent processes / persistent agent state.
- Eval harness population (P2).

## PR note for V3

- Desktop currently has a renderer-side duplicate guard because the local
  runner can emit streamed assistant text and then the completed assistant
  message as another `assistant_text` event. V3 should make the runner event
  contract explicit, e.g. separate delta/final events or suppress the final
  full-text event after streaming, so the renderer does not need this heuristic.

## Done when

V2 converge in plan.md §8 passes: User1 prompts something only User2's
context can answer, the server retrieves User2's slice, your agent
answers grounded in that slice, the answer cites User2 as a source.
