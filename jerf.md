# Jerf — V3 Task: Tool Surface Stretch + V2 Polish

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jerf's lane in V3. V3 only happens if V2 is green at h20.

## Lane

The `request_context` client tool and the `POST /request-context`
write/error path. V2 left a clean single-target single-hop loop
working. V3 expands the tool surface (multi-hop, multi-target) and
finishes the polish items V2 deferred.

You do not own retrieval (Jorf/Narf), the agent prompt internals
(Jorf), the schema (Sarf), or the desktop UI (Marf). You own the
contract between the AI's tool call and the server's write.

## V2 polish status

Audited against main as of `f76470b`:

1. ~~`OnDemandAgentError` → 502.~~ **N/A** — `apps/server/src/relevo/agent.py`
   wraps the Anthropic call in `try/except Exception` and falls back to
   an extractive answer (`_fallback_answer`). The agent never raises.
   Promoting failures to 502 would mean changing the fallback
   philosophy; that is a Jorf design decision, not a Jerf polish item.
2. **Empty-target-user smoke.** Deferred. Requires a third seeded user
   with zero `context_entry` rows. Cross-lane with Sarf (seeds). Open
   when Sarf has bandwidth.
3. ~~`source_context_entry_ids` field.~~ **Done.** `POST
   /request-context` returns `source_context_entry_ids` alongside
   `source_user_ids`. Verified live against the deployed server.
4. **Delete `apps/server/src/relevo/api/request_context.py`.** Done in
   this PR. Verified zero imports under `apps/server/` before removal.

## Cap stored Q&A length (new polish item)

V2 demo on the deployed server shows that cross-user retrieval boosts
prior `cross_user_qa` rows in `apps/server/src/relevo/db.py:220`
(`kind_boost = 1 if row.get("kind") == "cross_user_qa" else 0`).
Repeat queries produce answers that quote previous answers verbatim,
so the materialized row keeps growing each round.

Two cheap mitigations live in Jerf's lane:

- Truncate the answer string written into the `cross_user_qa` row's
  content + metadata to ~1.5KB at write time.
- Strip nested `QUESTION (from ...) ANSWER:` blocks from the answer
  before persisting, so a Q&A round never embeds prior rounds.

Bigger fix (drop or invert `kind_boost`) is Narf/Jorf retrieval lane,
not yours.

## V3 stretch (only after polish)

Pick from this list based on what V2 evals expose:

1. **Multi-hop loop.** AI can call `request_context` more than once
   per turn. Coordinate with Jorf on prompt-side termination
   signal. Tool registration on the client doesn't change; what
   changes is how the agent runtime treats repeat tool calls and
   when it stops. Add a `max_hops` guard (default 3) on the client
   broker so a runaway agent can't fan out.
2. **Multi-target single call.** Accept `target = list[user_id]`
   on the tool schema and the route. Server orchestration
   (consolidation strategy: combined slice vs parallel agents) is
   Jorf's call; you only own the request/response shape and the
   per-target Q&A writes. **Each target user still gets exactly one
   `cross_user_qa` row** — the closure invariant scales linearly,
   not as one combined entry.
3. **Citations passthrough to MCP tool result.** Today the tool
   result is `{answer, source_user_ids}`. If V2 evals show the AI
   would benefit from seeing which entries grounded the answer
   (e.g. for follow-up questions), surface
   `source_context_entry_ids` in the MCP tool result too. Costs
   token budget; only do this if there's evidence it helps.

Skip whatever V2 didn't expose pain on. Don't build for hypotheticals.

## Decisions you own

`max_hops` value, multi-target request shape (single key vs array),
whether citations enter the MCP result. Document inline.

## Out of scope for V3

- `target = "project"` retrieval/agent (Jorf's lane).
- Vector retrieval (Narf/Jorf).
- Renderer streaming event contract (Marf, separate V3 stretch
  item).
- New schema columns (Sarf).

## Done when

V2 smoke tests still pass. The 4 polish items are in. Whichever
stretch items you picked are demoable: multi-hop produces a final
answer that integrates two teammates' contributions, or multi-target
produces matching `cross_user_qa` rows on each targeted user. If
V2 evals don't justify any stretch item, ship just the polish and
move on.
