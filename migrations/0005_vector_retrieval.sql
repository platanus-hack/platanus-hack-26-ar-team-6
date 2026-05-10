-- Vector retrieval chunk projection.
--
-- Source tables remain authoritative. memory_chunk is the derived, indexed
-- retrieval surface that embedding ingestion can upsert by source row and
-- chunk index.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS memory_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  author_agent_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  importance TEXT NOT NULL CHECK (importance IN ('local', 'global')),
  source_table TEXT NOT NULL CHECK (
    source_table IN (
      'agent_memory_document',
      'agent_memory_event',
      'context_entry',
      'project_context_entry'
    )
  ),
  source_id UUID NOT NULL,
  source_kind TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  embedding_model TEXT,
  embedding_dimensions INTEGER NOT NULL DEFAULT 1536 CHECK (embedding_dimensions = 1536),
  embedded_at TIMESTAMPTZ,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (importance = 'global' OR author_agent_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_chunk_source_unique
  ON memory_chunk (source_table, source_id, chunk_index);

CREATE INDEX IF NOT EXISTS memory_chunk_agent_filter
  ON memory_chunk (project_id, author_agent_id, updated_at DESC)
  WHERE author_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_chunk_global_filter
  ON memory_chunk (project_id, importance, updated_at DESC)
  WHERE importance = 'global';

CREATE INDEX IF NOT EXISTS memory_chunk_project_updated
  ON memory_chunk (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS memory_chunk_agent_embedding_hnsw
  ON memory_chunk USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND author_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_chunk_global_embedding_hnsw
  ON memory_chunk USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND importance = 'global';

CREATE INDEX IF NOT EXISTS agent_memory_document_project_author_updated
  ON agent_memory_document (project_id, author_agent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_memory_event_project_author_created
  ON agent_memory_event (project_id, author_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS context_entry_user_kind_created
  ON context_entry (user_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS project_context_entry_project_kind_created
  ON project_context_entry (project_id, kind, created_at DESC);
