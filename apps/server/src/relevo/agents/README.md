# On-demand agent contract

Jorf owns `answer_on_demand(context_slice, question)`. Narf owns HTTP routing
and retrieval; Sarf owns the schema and embedding migration.

V2 call pattern:

1. Resolve the asking user and target user in the route layer.
2. Retrieve up to `ON_DEMAND_RETRIEVAL_TOP_K` rows from `context_entry`
   filtered to the target user's id.
3. Rank by vector cosine once embeddings are populated. Until then, use a
   deterministic fallback while keeping the same `OnDemandContextSlice` shape.
4. Pass the slice and question to `answer_on_demand`.
5. Write the returned answer through the closure path before returning HTTP
   success.

Defaults:

- On-demand model: `claude-sonnet-4-6`
- Embedding model for retrieval: `text-embedding-3-small`
- Vector dimension: 1536
- Retrieval depth: 6
- Included context kinds: `seed`, `prompt_answer`, `cross_user_qa`
