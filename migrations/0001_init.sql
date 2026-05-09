CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE person (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  domain_summary TEXT NOT NULL
);

CREATE TABLE agent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  persona JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE memory_tier AS ENUM ('personal', 'pool', 'timeline');

CREATE TABLE memory_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  tier memory_tier NOT NULL,
  agent_id UUID REFERENCES agent(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((tier = 'personal' AND agent_id IS NOT NULL) OR (tier <> 'personal'))
);

CREATE INDEX memory_embedding_hnsw ON memory_entry USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_tier_ws ON memory_entry (workspace_id, tier);
CREATE INDEX memory_agent ON memory_entry (agent_id) WHERE agent_id IS NOT NULL;

CREATE TYPE task_status AS ENUM ('proposed','open','in_progress','blocked','review','done');

CREATE TABLE task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_agent_id UUID REFERENCES agent(id),
  status task_status NOT NULL DEFAULT 'proposed',
  dependencies UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE timeline_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_agent_id UUID REFERENCES agent(id),
  event_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX timeline_ws_time ON timeline_event (workspace_id, occurred_at DESC);
