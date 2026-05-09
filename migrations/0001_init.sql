-- V1 schema: cross-user context workflow.
--
-- Storage decision (V1):
--   - Postgres + pgvector, single backend.
--   - Per-user partitioning via user_id discriminator on a single context_entry table.
--   - Cross-user Q&A is stored as kind='cross_user_qa' rows in context_entry on the
--     queried user's side (closure invariant). No separate ledger table.
--   - Embedding column is nullable in V1; the model/dimension is a V2 decision (Jorf+Sarf).
--     The vector dimension below is provisional and will be locked when the embedding
--     model is chosen. Indexes on the embedding column are deferred until then so we
--     don't have to drop and rebuild after a dimension change.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  domain_summary TEXT NOT NULL,
  auth_token TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX app_user_auth_token ON app_user (auth_token);
CREATE INDEX app_user_project ON app_user (project_id);

CREATE TYPE context_entry_kind AS ENUM (
  'seed',
  'prompt_answer',
  'cross_user_qa'
);

CREATE TABLE context_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind context_entry_kind NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX context_entry_user ON context_entry (user_id, created_at DESC);
CREATE INDEX context_entry_user_kind ON context_entry (user_id, kind);

CREATE TABLE project_context_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind context_entry_kind NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX project_context_entry_project ON project_context_entry (project_id, created_at DESC);
