-- migrate:up
CREATE INDEX IF NOT EXISTS idx_prf_filename_pattern ON pull_request_file (filename text_pattern_ops);

-- migrate:down
DROP INDEX IF EXISTS idx_prf_filename_pattern;
