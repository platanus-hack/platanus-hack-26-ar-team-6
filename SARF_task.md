# Sarf — V2 Task: Cross-User Schema + Seed Realism

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Sarf's lane in V2.

## Lane

The schema and seed work that V2's cross-user demo depends on. V1
landed the base schema (users, projects, context_entries). V2 needs
the cross-user write path to be queryable, the seed data to be
deliberately non-overlapping, and the closure invariant to be visible
via a simple SQL query during the demo.

You do not own the FastAPI routes (Narf), the on-demand agent (Jorf),
the client-side tool wiring (Jerf), or the desktop UI (Marf). You own
the storage shape and the seed realism.

## Coordination

- Pair with Jerf at h0 on the closure write shape — what columns the
  `qa_ledger` and the materialized `context_entries` row need so the
  Q&A surfaces in later retrievals.
- Pair with Jorf early on the slice shape that retrieval returns; your
  metadata columns drive what his prompt can cite.
- Pair with Narf on any new indexes the retrieval queries need.

## Deliverables

1. **`qa_ledger` table** (if not already in the V1 migration): asking
   user, target user, question, answer, created_at. Append-only.
2. **Closure-write support in `context_entries`.** Whatever metadata or
   `kind` value tags a row as "this came from a cross-user Q&A", so
   later retrievals against the target user surface it naturally and
   the demo can show it in a one-line SQL query.
3. **Seed realism.** Two users with deliberately non-overlapping
   context. The V2 demo needs at least one prompt that User1's seed
   cannot answer but User2's can. Document the prompt in
   `seeds/LOCK.md` (or wherever the team keeps demo prompts) so V4 can
   freeze it.
4. **Indexes.** Whatever pgvector and B-tree indexes the V2 retrieval
   queries actually need. Add them when the queries appear; don't
   pre-optimize.

## Decisions you own

Column names, `kind` enum values, index strategy, exact seed content
for both users. Keep it consistent with V1's choices. Document
non-obvious choices in the PR.

## Out of scope for V2

- Project-context seeding beyond the row that already exists (V3
  stretch will populate it).
- Schema for multi-target / multi-hop write tracking (V3 stretch).
- Migration tooling polish, fixtures for an eval harness (P2).

## Done when

V2 converge in plan.md §8 passes: after a cross-user `request_context`
call, a one-line SQL query against the deployed DB shows the Q&A row
on the target user, and a follow-up retrieval against the target user
surfaces it.
