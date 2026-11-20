-- migrate:up

CREATE TABLE computed_repository_contributors (
  repository_id bigint NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  active_contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  new_contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  churned_contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (repository_id, year, month)
);

-- migrate:down

DROP TABLE IF EXISTS computed_repository_contributors;
