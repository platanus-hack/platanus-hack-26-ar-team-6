# Jerf — V2 Task: Wire Real Agent Into `POST /request_context`

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jerf's lane in V2.

## Lane

The seam between Jerf's V1 stub answer and Jorf's V2 on-demand agent.
After V1, `POST /request-context` returns a deterministic placeholder
and writes a closure entry. After V2, the same handler must:

1. retrieve a slice of the target user's `context_entries`,
2. call `answer_on_demand(slice, question)` (Jorf's module),
3. write the real answer into `qa_ledger` + a `cross_user_qa` row on
   the target user,
4. return `{answer, source_user_ids, source_context_entry_ids}`.

Same route file, same closure-write call, same MCP tool surface. Only
the answer source changes.

## V1 baseline you inherit (already on main)

- `apps/server/src/relevo/api/request_context.py` — handler, stub
  answer, `write_cross_user_qa_entry(...)`.
- `apps/desktop/src/main/tools/request_context.ts` — MCP tool
  registration, allowed tool name `mcp__relevo__request_context`.
- `apps/server/scripts/smoke_closure.py` — closure smoke against the
  stub answer.

## V2 deliverables

1. **Naive retrieval** inside `POST /request-context`:
   `SELECT ... FROM context_entry WHERE owner_user_id = $target ORDER
   BY created_at DESC LIMIT N`. No query-embedding yet — vector ranking
   is V3 (Jorf/Narf). Build the slice in the shape
   `OnDemandContextSlice` from `relevo.agents`.
2. **Replace the stub** with `answer_on_demand(slice, question)`.
3. **Plumb fields:** add `source_context_entry_ids` to the HTTP
   response (from Jorf's `citations[].context_entry_id`). Write
   `confidence`, `insufficient_context`, and `citations` into the
   `cross_user_qa` row's metadata. The MCP tool result keeps its
   minimal `{answer, source_user_ids}` shape; client AI does not need
   the extras yet.
4. **Error path:** catch `OnDemandAgentError`, return HTTP 502, write
   nothing. Failure ≠ context.
5. **`insufficient_context = true`** still writes the Q&A row, with
   the flag in metadata. Closure invariant holds even when the agent
   didn't ground.
6. **Update `smoke_closure.py`:** assert `kind='cross_user_qa'` row
   exists with the question text and asker metadata. Do not assert
   exact answer text — the real LLM is non-deterministic now.
7. **One new smoke case:** empty target user (no `context_entries`)
   → response carries `insufficient_context=true` in the row metadata,
   Q&A row still written, no LLM call charged.

## Coordination

- Pair with Jorf at h0 on import path and slice/answer Pydantic shapes
  (already published in `relevo.agents`).
- When Narf wakes, hand him the route — vector retrieval upgrade is
  his lane, not yours. Don't block on him; ship naive retrieval.

## Decisions you own

`N` for top-N recency, error response payload shape, exact metadata
keys for `confidence` / `citations` / `insufficient_context`. Pick
defaults and document inline.

## Out of scope for V2

- Vector retrieval (V3, Narf/Jorf).
- `target = "project"` / multi-target / multi-hop (V3 stretch).
- IPC streaming event contract on the desktop (V3 stretch, Marf).
- New schema columns (Sarf).

## Done when

`smoke_closure.py` passes against the deployed server with the real
LLM in the loop, the Q&A row on User2 contains the actual model
answer, and `OnDemandAgentError` (simulate via bad API key) returns
502 without a Q&A row.
