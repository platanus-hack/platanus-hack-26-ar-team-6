# V1 - Sarf: memory repository and personal seed data

Owner: Sarf
Branch: `v1/sarf`
Target: V1 converge

## Goal

Turn the V0 schema and seed-loader skeleton into the first usable memory layer:
store memory entries, retrieve the top matches for a question, and give Jorf and
Narf a stable way to ask for context.

## What to build

- Implement a `MemoryEntry` repository for insert and lookup.
- Add a simple top-k retrieval function for V1, targeting `top_k=5`.
- Wire the loader far enough to populate one agent's 30 personal memories.
- Keep embeddings async or stubbed if needed, but make the retrieval call shape
  match the future hybrid search path.
- Return memory chunks with ids, tier, agent/person ownership where relevant,
  content/snippet, and enough metadata for citations.

## Coordination notes

- Jorf needs retrieved chunks with stable memory ids so citation validation can
  be strict.
- Narf needs a callable retrieval boundary from the ask endpoint; do not couple
  it directly to route code.
- Jerf needs stable memory ids for retrieval eval cases.
- Use the existing migration shape unless a small additive change is necessary.

## Definition of done

- Loader can populate one real persona's 30 personal memories into Postgres.
- Retrieval returns up to five relevant chunks for a question.
- Missing DB/config errors fail clearly.
- Add focused tests around repository insert, retrieval return shape, and loader
  validation for the V1 seed file.
