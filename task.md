# Jerf — V1 Task: `request_context` Tool + Closure Write

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jerf's lane in V1.

## Lane

The seam where the AI's tool call becomes a real cross-user write. Two
sides of the seam:

1. **Client side.** Register `request_context` as a custom tool with the
   local runner so the AI can call it. Broker the call to the server
   over HTTP. Return the server's answer as the tool result.
2. **Server side.** Make `POST /request_context` durably enrich the
   queried user's DB before returning. This is the closure invariant
   from plan.md §7. Without it, the demo fails its success criterion.

You do not own the on-demand LLM call itself (Jorf), retrieval (Jorf +
Narf), the rest of the server's endpoints (Narf), or the chat UI (Marf).
You own the tool's existence on the client and the write path on the
server.

## Coordination

Pair with Narf and Jorf at h0 to lock the `POST /request_context`
payload shape and response shape. Don't start coding before that 15-min
sync — three lanes converge on this contract.

## Deliverables

1. `request_context(target, question)` registered as a custom tool with
   the local runner.
2. Client broker: tool invocation → HTTP POST → return `{answer,
   source_user_ids}` as the tool result.
3. Server-side closure write inside `POST /request_context`:
   - `qa_ledger` row written.
   - `context_entries` row owned by `target_user_id` written, containing
     the Q&A in a form that surfaces in later retrievals.
   - Both writes synchronous, before the response returns. If either
     fails, the request fails.
4. Smoke test for the closure property: cross-user query as User1 →
   target user's DB has the Q&A → later retrieval against the target
   user surfaces it.

## Decisions you own

Keep it simple. Pick whatever the runner makes easiest for tool
registration. Pick whatever the schema makes easiest for the
context_entries write (kind/tag whichever way Sarf's table allows).
Document the choice inline in the PR description.

## Out of scope for V1

- Multi-hop loop (V3 stretch).
- `target = "project"` (V3 stretch).
- Multi-target consolidation (V3 stretch).
- Eval cases beyond the closure smoke test.

## Done when

The V2 converge sequence in plan.md §8 passes end-to-end on the deployed
server: User1 prompts something only User2's context can answer, AI
calls the tool, server returns a grounded answer, User2's DB shows the
Q&A entry, a follow-up retrieval as User2 surfaces it.
