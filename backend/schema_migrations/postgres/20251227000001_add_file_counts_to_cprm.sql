-- Add file count columns to computed_pull_request_metrics
-- migrate:up

ALTER TABLE computed_pull_request_metrics
  ADD COLUMN files_added INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN files_modified INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN files_removed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN files_renamed INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN computed_pull_request_metrics.files_added IS 'Count of files added in the PR';
COMMENT ON COLUMN computed_pull_request_metrics.files_modified IS 'Count of files modified in the PR';
COMMENT ON COLUMN computed_pull_request_metrics.files_removed IS 'Count of files removed in the PR';
COMMENT ON COLUMN computed_pull_request_metrics.files_renamed IS 'Count of files renamed in the PR';

-- migrate:down

ALTER TABLE computed_pull_request_metrics
  DROP COLUMN files_added,
  DROP COLUMN files_modified,
  DROP COLUMN files_removed,
  DROP COLUMN files_renamed;
