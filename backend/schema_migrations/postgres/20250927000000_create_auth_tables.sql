-- migrate:up

CREATE TABLE IF NOT EXISTS auth_roles (
  auth_role_id SERIAL PRIMARY KEY,
  role TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS auth_users (
  auth_user_id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bearer_token UUID NOT NULL UNIQUE,
  auth_role_id INT NOT NULL REFERENCES auth_roles(auth_role_id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);
CREATE INDEX IF NOT EXISTS idx_auth_users_bearer_token ON auth_users(bearer_token);

INSERT INTO auth_roles (role) VALUES
  ('superuser'),
  ('admin'),
  ('reader')
ON CONFLICT (role) DO NOTHING;

-- migrate:down
DROP TABLE IF EXISTS auth_users;
DROP TABLE IF EXISTS auth_roles;
