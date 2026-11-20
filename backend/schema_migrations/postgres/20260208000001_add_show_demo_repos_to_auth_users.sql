-- migrate:up

-- User preference for showing/hiding demo repositories in the UI
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS show_demo_repos BOOLEAN NOT NULL DEFAULT TRUE;

-- migrate:down
ALTER TABLE auth_users DROP COLUMN IF EXISTS show_demo_repos;
