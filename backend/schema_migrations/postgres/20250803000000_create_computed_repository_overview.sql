-- Create computed_repository_overview table for pre-computed repository metrics
-- This table stores heavy calculations that are too expensive to compute on-demand
-- migrate:up
CREATE TABLE computed_repository_overview (
    repository_id bigint NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
    first_activity timestamptz,
    last_activity timestamptz,
    total_users integer NOT NULL,
    active_users_3mo integer NOT NULL,
    merged_prs integer NOT NULL,
    open_prs integer NOT NULL,
    closed_prs integer NOT NULL,
    total_prs integer NOT NULL,
    estimated_total_files integer NOT NULL,
    estimated_total_loc bigint NOT NULL,
    top_file_types jsonb,
    computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repository_id)
);

-- Index for tracking computation freshness
CREATE INDEX idx_computed_repository_overview_computed_at 
ON computed_repository_overview(computed_at);

-- Comments for documentation
COMMENT ON TABLE computed_repository_overview IS 'Pre-computed repository overview metrics updated after backfill operations';
COMMENT ON COLUMN computed_repository_overview.first_activity IS 'Earliest issue creation date in repository';
COMMENT ON COLUMN computed_repository_overview.last_activity IS 'Latest issue update date in repository';
COMMENT ON COLUMN computed_repository_overview.total_users IS 'Total unique users who created issues/PRs';
COMMENT ON COLUMN computed_repository_overview.active_users_3mo IS 'Users with activity in last 3 months';
COMMENT ON COLUMN computed_repository_overview.merged_prs IS 'Count of merged pull requests';
COMMENT ON COLUMN computed_repository_overview.open_prs IS 'Count of currently open pull requests';
COMMENT ON COLUMN computed_repository_overview.closed_prs IS 'Count of closed but not merged pull requests';
COMMENT ON COLUMN computed_repository_overview.total_prs IS 'Total count of all pull requests';
COMMENT ON COLUMN computed_repository_overview.estimated_total_files IS 'Estimated current file count based on PR file changes';
COMMENT ON COLUMN computed_repository_overview.estimated_total_loc IS 'Estimated current lines of code based on PR file changes';
COMMENT ON COLUMN computed_repository_overview.top_file_types IS 'JSON object of top file extensions and their counts';
COMMENT ON COLUMN computed_repository_overview.computed_at IS 'When these metrics were last computed';

-- migrate:down