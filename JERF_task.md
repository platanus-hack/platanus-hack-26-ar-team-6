# Jerf — V1 Task: Routing (Retrieval Routing & Eval)

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jerf's lane in V1.

## Lane

Routing in this product means **retrieval routing**: when the server
receives a `request_context({target, question})` call, the server has to
decide which slice of the target's stored context to retrieve, and how
to feed it to the on-demand agent. There is no agent-to-agent router in
this plan (the user's local AI decides when to call `request_context` —
that's Jorf's territory). What you own is the path from
*"the AI asked a question about user X"* to *"here are the right pieces
of user X's stored context to ground an answer in"*.

V1 is mostly preparation: the on-demand agent doesn't exist until V2,
so your retrieval routing isn't yet exercised end-to-end. Use V1 to
land the harness, the shape of routing decisions, and a baseline that
V2 can swap real retrieval into without changing the contract.

## Starting state

- `eval/run_eval.py` — ~480 lines of harness code that loads YAML cases,
  runs them against a router, and grades on precision/recall.
- `eval/test_run_eval.py` — unit tests for the harness.
- `eval/router_cases.yaml` — 20 hand-authored cases for the *old plan's*
  agent router (which agent should answer this prompt). These cases
  encode old-plan concepts and do not apply.
- `eval/_stub_router.py` — deliberately bad stub router from the old
  plan.
- `eval/agent_directory.yaml` — stub mapping of agent names to UUIDs,
  all currently null.
- `eval/retrieval_cases.yaml` — empty.
- `eval/README.md` — describes the old harness.

## Decisions you own in V1

None solely — but you are the natural reviewer for any retrieval-shape
decision Sarf makes, since you'll be writing the routing layer on top
of it.

## Decisions you contribute to (joint)

- **Storage backend / partitioning (with Sarf).** Sarf chooses, but the
  shape of per-user partitions and any embedding/index strategy
  directly determines what retrieval routing has to do. Push back if
  Sarf's choice makes routing impossible or wasteful.

## Deliverables

1. **Eval harness reworked.** Keep `eval/run_eval.py`'s loop structure
   (load YAML → run → grade) but pivot what it grades. The harness
   should support, at minimum:
   - cases that grade retrieval routing: given `(target_user_id,
     question)`, did the routing step return the expected context
     entries (by id or by tag)?
   - cases that grade AI self-assessment: given a prompt, did the
     user's local AI correctly decide whether to call
     `request_context`? (V1 can use a fixture / canned-AI stub.)
   - The harness must read against the *new* schema Sarf is building,
     not the old one.
2. **Retrieval routing module.** A small server-side layer (live in
   `apps/server/`, coordinate with Narf for placement) that takes
   `(target, question)` and returns a list of retrieved entries
   intended for the on-demand agent. V1 implementation can be naive
   (e.g. plain pgvector top-k over the target's partition); the
   *contract* is what matters, because V2 plugs the on-demand agent
   into this output and V3 expands it (multi-target consolidation,
   project-scoped queries).
3. **At least one passing eval case** against the new schema. Trivial
   is fine: "retrieval for `(user_id=user2, question='deployment')`
   returns at least one entry tagged with `deployment` from user2's
   seeded context."
4. **`eval/agent_directory.yaml` reshaped or replaced** as a *user
   directory* that the eval cases can reference (user id → display
   name → seeded context tags). Old-plan agent UUIDs are gone.
5. **Documentation in `eval/README.md`** describing the new harness:
   what it grades, how to run it, how to add a case. Short.

## Scrap

These are old-plan artifacts in your lane. Delete them.

- `eval/router_cases.yaml` — agent-router cases for a router that no
  longer exists.
- `eval/_stub_router.py` — the bad stub for the same router.
- `eval/retrieval_cases.yaml` — empty stub. If you want to keep the
  filename for the new harness, repurpose it; otherwise delete and let
  the new cases live in a fresh file (e.g.
  `eval/retrieval_routing_cases.yaml`).

## Rework

- `eval/run_eval.py` — keep the YAML-loading loop and grading
  scaffolding. Replace the case shape and the grading rubric.
- `eval/test_run_eval.py` — update tests to cover the new harness; many
  of them probably need to be rewritten rather than tweaked.
- `eval/agent_directory.yaml` — see deliverable 4.

## Out of scope for V1

- The on-demand agent itself (Jorf, in V2).
- The AI's *decision* to call `request_context` (Jorf's prompt; you
  evaluate it, you don't write it).
- Multi-hop / multi-target consolidation (V3).
- `target = "project"` retrieval (V3).
- Sophisticated retrieval strategies (graph-RAG expansion, reranking,
  etc.) — naive top-k is V1; improvements are V2/V3.

## Converge h10 — your part

- The new harness runs cleanly against the new schema.
- At least one retrieval routing case passes.
- The retrieval routing module returns a sensible (if naive) slice
  when called with a target user and a question, ready for V2 to feed
  into the on-demand agent.

## Coordination notes

- Sarf's schema is your hardest dependency. As soon as Sarf has a
  draft of per-user context table shape and the embedding column,
  start building the retrieval routing module against it.
- Narf owns where the routing module mounts inside the server. Agree
  on a function signature early so Narf can wire the
  `request_context` endpoint to it (even with the V1 stub, the
  signature should be real).
- Jorf will replace the canned-AI stub in your self-assessment eval
  with the real local AI prompt sometime in V2.
