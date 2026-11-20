-- Denormalize PR change totals into computed_pull_request_metrics
-- migrate:up

ALTER TABLE computed_pull_request_metrics
  ADD COLUMN additions INTEGER,
  ADD COLUMN deletions INTEGER,
  ADD COLUMN changed_files INTEGER;

COMMENT ON COLUMN computed_pull_request_metrics.additions IS 'PR additions (denormalized from pull_request)';
COMMENT ON COLUMN computed_pull_request_metrics.deletions IS 'PR deletions (denormalized from pull_request)';
COMMENT ON COLUMN computed_pull_request_metrics.changed_files IS 'PR changed files (denormalized from pull_request)';

-- migrate:down

ALTER TABLE computed_pull_request_metrics
  DROP COLUMN additions,
  DROP COLUMN deletions,
  DROP COLUMN changed_files;
