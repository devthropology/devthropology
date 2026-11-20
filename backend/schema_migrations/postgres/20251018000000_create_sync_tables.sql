-- migrate:up

CREATE TABLE IF NOT EXISTS sync_api_keys (
    sync_api_key_id bigserial PRIMARY KEY,
    api_key text NOT NULL,
    gh_username text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_api_keys_api_key ON sync_api_keys (api_key);

CREATE TABLE IF NOT EXISTS sync_modes (
    sync_mode_id bigserial PRIMARY KEY,
    code text NOT NULL UNIQUE,
    description text,
    inserted_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sync_modes (code, description) VALUES
    ('LAST_SEEN', 'Backfill from the oldest unprocessed issue'),
    ('LATEST_ISSUES', 'Backfill from the most recent issues')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_repositories (
    sync_repository_id bigserial PRIMARY KEY,
    repository_id bigint NOT NULL REFERENCES repository (repository_id) ON DELETE CASCADE,
    sync_mode_id bigint NOT NULL REFERENCES sync_modes (sync_mode_id),
    num_to_sync integer NOT NULL DEFAULT 100,
    active boolean NOT NULL DEFAULT true,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id, sync_mode_id)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
    sync_job_id bigserial PRIMARY KEY,
    repository_id bigint NOT NULL REFERENCES repository (repository_id) ON DELETE CASCADE,
    sync_mode_id bigint REFERENCES sync_modes (sync_mode_id),
    sync_api_key_id bigint REFERENCES sync_api_keys (sync_api_key_id),
    duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_repository_started_at
    ON sync_jobs (repository_id, started_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_sync_jobs_repository_started_at;
DROP TABLE IF EXISTS sync_jobs;
DROP TABLE IF EXISTS sync_repositories;
DROP TABLE IF EXISTS sync_modes;
DROP TABLE IF EXISTS sync_api_keys;
