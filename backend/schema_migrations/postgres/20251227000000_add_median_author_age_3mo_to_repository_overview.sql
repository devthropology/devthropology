-- Add median author age to repository overview
-- migrate:up
ALTER TABLE computed_repository_overview
ADD COLUMN median_author_age_3mo_days DOUBLE PRECISION;

COMMENT ON COLUMN computed_repository_overview.median_author_age_3mo_days IS
  'Median author age (days) for merged PRs in the last 3 months';

-- migrate:down
ALTER TABLE computed_repository_overview
DROP COLUMN median_author_age_3mo_days;
