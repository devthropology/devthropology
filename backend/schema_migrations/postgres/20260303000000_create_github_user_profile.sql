-- migrate:up

CREATE TABLE IF NOT EXISTS github_user_profile (
    profile_id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE UNIQUE,
    avatar_url text,
    synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_github_user_profile_user_id
    ON github_user_profile (user_id);

CREATE TABLE IF NOT EXISTS github_user_profile_history (
    history_id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
    avatar_url text,
    synced_at timestamptz NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_github_user_profile_history_user_id
    ON github_user_profile_history (user_id);

-- migrate:down

DROP INDEX IF EXISTS idx_github_user_profile_history_user_id;
DROP TABLE IF EXISTS github_user_profile_history;
DROP INDEX IF EXISTS idx_github_user_profile_user_id;
DROP TABLE IF EXISTS github_user_profile;
