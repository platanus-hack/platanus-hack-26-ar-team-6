# Jorf — V3 Task: Agent + Retrieval Stretch

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jorf's lane in V3.

## Lane

The on-demand agent and retrieval, extended past V2's single-target,
single-hop, recency-only baseline. V3 only happens if V2 is green at
h20; otherwise jump to V4 hardening.

You own the agent module (`relevo.agents.on_demand`), the agent system
prompt, and retrieval quality. You do not own routing (Narf), the
client tool (Jerf), the schema (Sarf), or the desktop UI (Marf).

## V2 baseline you inherit

- `answer_on_demand(slice, question)` returns `{answer,
  source_user_ids, citations, confidence, insufficient_context}`.
- Slice = top-N most-recent `context_entries` for one target user.
- `POST /request_context` accepts a single `target = user_id` and runs
  one stateless LLM call.

V3 expands all three.

## Pick from this list (only what V2 failures actually demand)

1. **Vector retrieval.** Replace the V2 recency baseline with a real
   pgvector query against the question's embedding. Pair with whoever
   wires the embedding model on the server side.
2. **`target = "project"`.** Agent prompt and retrieval glue for the
   shared project context. Same answer-shape contract; the slice just
   has `project_id` rows instead of one user's rows.
3. **Multi-target consolidation.** When `target = [user2, "project"]`,
   pick a strategy: single agent over a combined slice, or parallel
   agents + merge. Document the choice. Single-agent-combined is
   simpler; default to that unless V2 evidence says otherwise.
4. **Multi-hop prompt.** Allow the asking user's AI to call
   `request_context` more than once per turn with a clean termination
   signal. Coordinate with Jerf on the tool-result shape; you only
   own the prompt-side instructions, not the loop control.
5. **Retrieval-quality fixes.** Drive these from V2 eval failures, not
   from speculation. Examples: top-k tuning, metadata filtering by
   `kind`, dedup of near-identical rows.

## Decisions you own

Top-k value, embedding model selection (align with whatever Sarf seeded
with), consolidation strategy, prompt phrasing for multi-hop. Pick
defaults and document inline.

## Out of scope for V3

- IPC event contract for the renderer (Marf's lane, separate V3 item).
- Closure write changes (Jerf still owns).
- New schema columns (Sarf).

## Done when

V2 smoke tests still pass. Whichever V3 items you pick are demoable
end-to-end on the deployed server with at least one eval-style case
showing the V2 baseline could not have answered as well. If you only
land item 1 (vector retrieval) and skip 2–5, that is fine.
