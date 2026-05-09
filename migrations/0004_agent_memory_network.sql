-- LangGraph multi-agent memory network.
--
-- The desktop runtime now owns multi-agent orchestration. The server exposes
-- only retriever/updater memory primitives: author-scoped reads, global reads,
-- and append-plus-canonical writes.
--
-- This is version 0004 because main already has
-- 0003_accounts_projects_login.sql. The migration runner keys applied
-- migrations by the numeric prefix, so adding another 0003 would be skipped on
-- databases that already applied the login migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS context_exchange (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  asking_agent_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  target_agent_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  result_refs JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS context_exchange_project_created
  ON context_exchange (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_exchange_asking_created
  ON context_exchange (asking_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_exchange_target_created
  ON context_exchange (target_agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  author_agent_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  importance TEXT NOT NULL CHECK (importance IN ('local', 'global')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  source_context_exchange_id UUID REFERENCES context_exchange(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_memory_event_author_created
  ON agent_memory_event (author_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_memory_event_project_importance_created
  ON agent_memory_event (project_id, importance, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  author_agent_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  importance TEXT NOT NULL CHECK (importance IN ('local', 'global')),
  document_key TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, author_agent_id, importance, document_key)
);

CREATE INDEX IF NOT EXISTS agent_memory_document_author_updated
  ON agent_memory_document (author_agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_memory_document_project_importance_updated
  ON agent_memory_document (project_id, importance, updated_at DESC);
