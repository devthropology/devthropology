-- migrate:up

ALTER TABLE github_user_profile
    ADD COLUMN IF NOT EXISTS name text,
    ADD COLUMN IF NOT EXISTS company text,
    ADD COLUMN IF NOT EXISTS location text,
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS github_created_at timestamptz;

ALTER TABLE github_user_profile_history
    ADD COLUMN IF NOT EXISTS name text,
    ADD COLUMN IF NOT EXISTS company text,
    ADD COLUMN IF NOT EXISTS location text,
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS github_created_at timestamptz;

-- migrate:down

ALTER TABLE github_user_profile_history
    DROP COLUMN IF EXISTS github_created_at,
    DROP COLUMN IF EXISTS email,
    DROP COLUMN IF EXISTS location,
    DROP COLUMN IF EXISTS company,
    DROP COLUMN IF EXISTS name;

ALTER TABLE github_user_profile
    DROP COLUMN IF EXISTS github_created_at,
    DROP COLUMN IF EXISTS email,
    DROP COLUMN IF EXISTS location,
    DROP COLUMN IF EXISTS company,
    DROP COLUMN IF EXISTS name;
