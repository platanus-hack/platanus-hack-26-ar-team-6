-- V4 account login and multi-project memberships.
--
-- app_user remains the project-scoped membership/persona row. A Google account
-- can own multiple app_user rows, one per project.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_google_sub ON account (google_sub);
CREATE UNIQUE INDEX IF NOT EXISTS account_email_normalized ON account (email_normalized);

CREATE TABLE IF NOT EXISTS account_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS account_session_token_hash ON account_session (token_hash);
CREATE INDEX IF NOT EXISTS account_session_account ON account_session (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_login_state (
  state TEXT PRIMARY KEY,
  desktop_redirect_uri TEXT NOT NULL,
  google_redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS desktop_login_exchange (
  code TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS desktop_login_exchange_account ON desktop_login_exchange (account_id, created_at DESC);

ALTER TABLE app_user
ADD COLUMN IF NOT EXISTS account_id UUID;

ALTER TABLE app_user
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

ALTER TABLE app_user
ALTER COLUMN auth_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_user_account_id_fkey'
  ) THEN
    ALTER TABLE app_user
    ADD CONSTRAINT app_user_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES account(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_user_role_check'
  ) THEN
    ALTER TABLE app_user
    ADD CONSTRAINT app_user_role_check
    CHECK (role IN ('leader', 'member'));
  END IF;
END $$;

DROP INDEX IF EXISTS app_user_auth_token;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_auth_token
ON app_user (auth_token)
WHERE auth_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_user_account ON app_user (account_id);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_project_account
ON app_user (project_id, account_id)
WHERE account_id IS NOT NULL;
