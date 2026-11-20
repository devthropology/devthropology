-- migrate:up

CREATE TABLE computed_trends_monthly (
  repository_id bigint NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,

  merged_prs integer,

  avg_pr_size numeric(12,2),
  p50_pr_size numeric(12,2),
  p75_pr_size numeric(12,2),
  p90_pr_size numeric(12,2),

  active_authors integer,
  avg_merged_prs_per_author numeric(12,2),
  p50_merged_prs_per_author numeric(12,2),
  p75_merged_prs_per_author numeric(12,2),
  p90_merged_prs_per_author numeric(12,2),
  avg_lines_changed_per_author numeric(12,2),
  p50_lines_changed_per_author numeric(12,2),
  p75_lines_changed_per_author numeric(12,2),
  p90_lines_changed_per_author numeric(12,2),

  avg_rounds numeric(12,2),
  avg_all_rounds numeric(12,2),
  p50_rounds numeric(12,2),
  p75_rounds numeric(12,2),
  p90_rounds numeric(12,2),
  p95_rounds numeric(12,2),
  p99_rounds numeric(12,2),
  pct_zero_rounds numeric(12,1),
  pct_one_round numeric(12,1),
  pct_two_rounds numeric(12,1),
  pct_three_plus_rounds numeric(12,1),
  pct_any_round numeric(12,1),
  pct_two_plus_rounds numeric(12,1),
  pct_any_all_rounds numeric(12,1),
  pct_two_plus_all_rounds numeric(12,1),
  p50_time_to_first_review_hours numeric(12,2),
  p75_time_to_first_review_hours numeric(12,2),
  p90_time_to_first_review_hours numeric(12,2),
  p50_time_to_effective_approval_hours numeric(12,2),
  p75_time_to_effective_approval_hours numeric(12,2),
  p90_time_to_effective_approval_hours numeric(12,2),

  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (repository_id, year, month)
);

CREATE INDEX idx_ctm_repo_month
  ON computed_trends_monthly (repository_id, year, month);

CREATE TABLE computed_trends_monthly_size_bucket (
  repository_id bigint NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  size_bucket text NOT NULL,

  prs integer,
  pct_of_month_prs numeric(12,1),
  avg_rounds numeric(12,2),
  avg_all_rounds numeric(12,2),
  pct_zero_rounds numeric(12,1),
  pct_any_round numeric(12,1),
  p50_time_to_first_review_hours numeric(12,2),
  p75_time_to_first_review_hours numeric(12,2),
  p90_time_to_first_review_hours numeric(12,2),
  p50_time_to_effective_approval_hours numeric(12,2),
  p75_time_to_effective_approval_hours numeric(12,2),
  p90_time_to_effective_approval_hours numeric(12,2),

  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (repository_id, year, month, size_bucket)
);

CREATE INDEX idx_ctmsb_repo_month
  ON computed_trends_monthly_size_bucket (repository_id, year, month);

CREATE TABLE computed_trends_monthly_ai_model (
  repository_id bigint NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  model text NOT NULL,
  merged_prs integer,
  ai_assisted_prs integer,
  pct_ai_assisted_prs numeric(12,1),
  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (repository_id, year, month, model)
);

CREATE INDEX idx_ctmam_repo_month
  ON computed_trends_monthly_ai_model (repository_id, year, month);

-- migrate:down

DROP TABLE IF EXISTS computed_trends_monthly_ai_model;
DROP TABLE IF EXISTS computed_trends_monthly_size_bucket;
DROP TABLE IF EXISTS computed_trends_monthly;
