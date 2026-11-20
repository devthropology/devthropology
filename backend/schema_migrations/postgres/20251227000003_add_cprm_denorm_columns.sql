-- Denormalize PR timing data into computed_pull_request_metrics for faster dashboard queries
-- migrate:up

ALTER TABLE computed_pull_request_metrics
  ADD COLUMN repository_id BIGINT,
  ADD COLUMN merged_at TIMESTAMPTZ,
  ADD COLUMN issue_created_at TIMESTAMPTZ,
  ADD COLUMN target_branch TEXT;

COMMENT ON COLUMN computed_pull_request_metrics.repository_id IS 'Repository id for the PR (denormalized from issue)';
COMMENT ON COLUMN computed_pull_request_metrics.merged_at IS 'Merged timestamp for the PR (denormalized from pull_request)';
COMMENT ON COLUMN computed_pull_request_metrics.issue_created_at IS 'Issue created timestamp for the PR (denormalized from issue)';
COMMENT ON COLUMN computed_pull_request_metrics.target_branch IS 'Target branch for the PR (denormalized from pull_request)';

CREATE INDEX cprm_repo_merged_main_idx
  ON computed_pull_request_metrics (repository_id, merged_at)
  WHERE target_branch IN ('main', 'master')
    AND merged_at IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS cprm_repo_merged_main_idx;

ALTER TABLE computed_pull_request_metrics
  DROP COLUMN repository_id,
  DROP COLUMN merged_at,
  DROP COLUMN issue_created_at,
  DROP COLUMN target_branch;
