-- migrate:up
ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE github_identity (
  github_user_id TEXT PRIMARY KEY,
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth_users(auth_user_id),
  github_login TEXT NOT NULL
);

CREATE TABLE github_login_attempt (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);
CREATE INDEX github_login_attempt_expiry ON github_login_attempt(expires_at);

-- migrate:down
DROP TABLE github_login_attempt;
DROP TABLE github_identity;
-- Preserve passwordless accounts but keep them unable to authenticate with passwords.
UPDATE auth_users SET password_hash = 'disabled' WHERE password_hash IS NULL;
ALTER TABLE auth_users ALTER COLUMN password_hash SET NOT NULL;
