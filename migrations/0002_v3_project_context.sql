-- V3 project-target backend migration.
--
-- Idempotent on purpose: Railway may already have some V2/V3 repair changes
-- from an earlier deploy. This migration is safe to run once through
-- schema_migration and harmless if replayed manually during the demo.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TYPE context_entry_kind ADD VALUE IF NOT EXISTS 'cross_user_qa';
ALTER TYPE context_entry_kind ADD VALUE IF NOT EXISTS 'project_qa';

CREATE TABLE IF NOT EXISTS qa_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  asking_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  context_entry_id UUID NOT NULL UNIQUE REFERENCES context_entry(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS qa_ledger_target_created ON qa_ledger (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_ledger_asking_created ON qa_ledger (asking_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_ledger_project_created ON qa_ledger (project_id, created_at DESC);

UPDATE context_entry
SET embedding = NULL
WHERE embedding IS NOT NULL;

ALTER TABLE context_entry
ALTER COLUMN embedding TYPE vector(1536);

UPDATE project_context_entry
SET embedding = NULL
WHERE embedding IS NOT NULL;

ALTER TABLE project_context_entry
ALTER COLUMN embedding TYPE vector(1536);

CREATE TABLE IF NOT EXISTS project_qa_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  asking_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  project_context_entry_id UUID NOT NULL UNIQUE REFERENCES project_context_entry(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_qa_ledger_project_created ON project_qa_ledger (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_qa_ledger_asking_created ON project_qa_ledger (asking_user_id, created_at DESC);
