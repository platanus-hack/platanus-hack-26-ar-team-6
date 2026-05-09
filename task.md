# Narf — V1 Task: Server (Endpoints, Retrieval, Deployment)

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Narf's lane in V1.

## Lane

The shared FastAPI server that every local app talks to. Endpoints,
retrieval, deployment. The cross-user mechanism cannot exist on a single
laptop, so this lane is a P0 blocker for the whole team.

You do not own the schema (Sarf), the on-demand LLM call (Jorf), the
client-side tool registration (Jerf), or the desktop UI (Marf). You own
the HTTP surface and the retrieval glue between the schema and the
on-demand agent.

## Coordination

- Pair with Sarf at h0 to confirm the schema shapes you'll read/write.
- Pair with Jerf and Jorf at h0 to lock the `POST /request_context`
  payload + response shape.
- Pair with Marf early to confirm the bootstrap response shape that the
  desktop app consumes.

## Deliverables

1. **Endpoints** on the deployed FastAPI server:
   - `GET /health` (kept).
   - `GET /bootstrap?user_id=...` → `{user_summary, project_context,
     roster}`.
   - `POST /context_entries` → write a prompt+answer entry for the
     asking user.
   - `POST /request_context` → retrieve target's slice, hand the slice
     + question to the on-demand agent (Jorf's module), receive an
     answer, return `{answer, source_user_ids}`. Jerf owns the closure
     writes that happen inside this handler; you own the orchestration.
2. **Retrieval.** Vector search over `context_entries` filtered by
   `owner_user_id`. Return a slice the on-demand agent can ground on.
   Cheap top-k is fine for V1.
3. **Auth.** Per-user header token. One header, one check, one rejection
   path. Don't overbuild.
4. **Deployment.** Server live on Railway (or equivalent), reachable
   from a laptop on the venue network. URL shared with the team.

## Decisions you own

Keep it simple. Top-k value, embedding model for retrieval queries (use
whatever Sarf used to embed seed content), error response shape — pick
defaults and move on. Document inline in the PR.

## Out of scope for V1

- On-demand LLM call internals (Jorf's lane — you import it).
- Closure writes (Jerf — happens inside your handler but he owns the
  code).
- `target = "project"`, multi-target, multi-hop server logic (V3
  stretch).
- Streaming responses, websockets, real-time sync.

## Done when

V1 converge in plan.md §8 passes against the deployed server: `/health`
green, `/bootstrap` returns roster including User2, `POST
/context_entries` persists, `POST /request_context` (with V1 stub from
Jerf in place) returns a deterministic answer.
