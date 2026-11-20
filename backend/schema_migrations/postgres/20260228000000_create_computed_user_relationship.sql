-- Create computed_user_relationship table for storing precomputed user interaction edges
-- migrate:up

CREATE TABLE computed_user_relationship (
  repository_id   BIGINT NOT NULL REFERENCES repository(repository_id),
  actor_user_id   BIGINT NOT NULL REFERENCES "user"(user_id),
  target_user_id  BIGINT NOT NULL REFERENCES "user"(user_id),
  period           TEXT   NOT NULL,
  edge_weight      INTEGER NOT NULL DEFAULT 0,
  edge_data        JSONB   NOT NULL DEFAULT '{}',

  PRIMARY KEY (repository_id, actor_user_id, target_user_id, period),
  CONSTRAINT chk_no_self_edge CHECK (actor_user_id <> target_user_id)
);

CREATE INDEX idx_cur_repo_period
  ON computed_user_relationship (repository_id, period);
CREATE INDEX idx_cur_actor
  ON computed_user_relationship (repository_id, actor_user_id, period);
CREATE INDEX idx_cur_target
  ON computed_user_relationship (repository_id, target_user_id, period);

-- migrate:down

DROP TABLE IF EXISTS computed_user_relationship;
