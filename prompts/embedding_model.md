# Embedding Model

V1 uses OpenAI `text-embedding-3-small` for semantic context embeddings.

Decision:
- Store vectors in Postgres pgvector at 1536 dimensions.
- Generate embeddings server-side when seed entries are ingested.
- Generate embeddings server-side again at query time before retrieval.
- Never generate embeddings in the desktop client.

This keeps seed-time and query-time vectors compatible for Sarf's storage work and for Jerf's V2 retrieval path.
