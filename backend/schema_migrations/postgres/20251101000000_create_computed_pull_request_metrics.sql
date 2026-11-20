-- Create computed_pull_request_metrics table for storing precomputed pull request metrics
-- migrate:up

CREATE TABLE computed_pull_request_metrics (
  pull_request_id BIGINT PRIMARY KEY REFERENCES pull_request(pull_request_id) ON DELETE CASCADE,
  contributor_age_days INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE computed_pull_request_metrics IS 'Pre-computed pull request metrics keyed by pull_request_id';
COMMENT ON COLUMN computed_pull_request_metrics.contributor_age_days IS 'Age in days of the PR author at merge time based on first_seen_timestamp';

-- migrate:down

DROP TABLE IF EXISTS computed_pull_request_metrics;
