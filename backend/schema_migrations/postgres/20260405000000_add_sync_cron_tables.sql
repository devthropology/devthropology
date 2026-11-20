-- migrate:up

CREATE TABLE IF NOT EXISTS sync_cron_repositories (
    sync_cron_repository_id bigserial PRIMARY KEY,
    repository_id bigint NOT NULL REFERENCES repository (repository_id) ON DELETE CASCADE,
    batch_size integer NOT NULL DEFAULT 500 CHECK (batch_size > 0),
    active boolean NOT NULL DEFAULT true,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id)
);

CREATE TABLE IF NOT EXISTS sync_cron_repository_api_keys (
    sync_cron_repository_api_key_id bigserial PRIMARY KEY,
    sync_cron_repository_id bigint NOT NULL REFERENCES sync_cron_repositories (sync_cron_repository_id) ON DELETE CASCADE,
    sync_api_key_id bigint NOT NULL REFERENCES sync_api_keys (sync_api_key_id),
    active boolean NOT NULL DEFAULT true,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sync_cron_repository_id, sync_api_key_id)
);

CREATE TABLE IF NOT EXISTS sync_cron_runs (
    sync_cron_run_id bigserial PRIMARY KEY,
    sync_cron_repository_id bigint NOT NULL REFERENCES sync_cron_repositories (sync_cron_repository_id) ON DELETE CASCADE,
    outcome_code text NOT NULL,
    requested_count integer NOT NULL CHECK (requested_count >= 0),
    processed_count integer NOT NULL CHECK (processed_count >= 0),
    api_keys_used integer NOT NULL CHECK (api_keys_used >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_cron_repositories_repository_id
    ON sync_cron_repositories (repository_id);

CREATE INDEX IF NOT EXISTS idx_sync_cron_repository_api_keys_repo_active
    ON sync_cron_repository_api_keys (sync_cron_repository_id, active);

CREATE INDEX IF NOT EXISTS idx_sync_cron_runs_started_at
    ON sync_cron_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_cron_runs_repository_started_at
    ON sync_cron_runs (sync_cron_repository_id, started_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_sync_cron_runs_repository_started_at;
DROP INDEX IF EXISTS idx_sync_cron_runs_started_at;
DROP INDEX IF EXISTS idx_sync_cron_repository_api_keys_repo_active;
DROP INDEX IF EXISTS idx_sync_cron_repositories_repository_id;
DROP TABLE IF EXISTS sync_cron_runs;
DROP TABLE IF EXISTS sync_cron_repository_api_keys;
DROP TABLE IF EXISTS sync_cron_repositories;
