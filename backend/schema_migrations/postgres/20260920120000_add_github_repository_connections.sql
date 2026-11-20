-- migrate:up
ALTER TABLE repository ADD COLUMN github_repository_id BIGINT UNIQUE;

CREATE TABLE github_repository_attempt (
  state_hash TEXT PRIMARY KEY,
  auth_user_id UUID NOT NULL REFERENCES auth_users(auth_user_id),
  workspace_id UUID NOT NULL REFERENCES workspace(workspace_id),
  code_verifier TEXT NOT NULL,
  installation_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE TABLE workspace_github_installation (
  installation_id BIGINT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspace(workspace_id),
  connected_by UUID NOT NULL REFERENCES auth_users(auth_user_id),
  -- Set only after the GitHub account owner / org admin verifies the connection.
  account_login TEXT,
  UNIQUE (workspace_id, installation_id)
);
CREATE TABLE workspace_github_repository (
  workspace_id UUID NOT NULL,
  repository_id BIGINT NOT NULL,
  installation_id BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, repository_id),
  FOREIGN KEY (workspace_id, repository_id) REFERENCES workspace_repository(workspace_id, repository_id),
  FOREIGN KEY (workspace_id, installation_id) REFERENCES workspace_github_installation(workspace_id, installation_id)
);

-- migrate:down
DROP TABLE workspace_github_repository;
DROP TABLE workspace_github_installation;
DROP TABLE github_repository_attempt;
ALTER TABLE repository DROP COLUMN github_repository_id;
